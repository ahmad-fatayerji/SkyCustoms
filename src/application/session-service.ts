import type { Repository } from "../db/repository.js";
import { currentDraftTeamId, shuffledTeamOrder } from "../domain/draft.js";
import { UserError } from "../domain/errors.js";
import {
  normalizeCustomName,
  normalizedNameKey,
  normalizeTeamName,
  renderTeamChannelName,
} from "../domain/naming.js";
import type {
  CustomAggregate,
  CustomMode,
  SpectatorMode,
  Team,
} from "../domain/types.js";
import { Authorizer, type Actor } from "./auth.js";
import { KeyedLock } from "./lock.js";

export interface ResourceGateway {
  provision(customId: string): Promise<void>;
  repair(customId: string): Promise<void>;
  syncTeam(customId: string, teamId: number): Promise<void>;
  refreshPanel(customId: string): Promise<void>;
  moveRosterToTeamChannels(customId: string): Promise<MoveSummary>;
  removeTeamChannel(customId: string, teamId: number): Promise<void>;
  destroy(customId: string, reason: string): Promise<void>;
}

export interface MoveSummary {
  moved: number;
  disconnected: number;
  failed: number;
}

export class SessionService {
  private readonly authorizer: Authorizer;
  private readonly locks = new KeyedLock();

  public constructor(
    private readonly repository: Repository,
    private readonly resources: ResourceGateway,
  ) {
    this.authorizer = new Authorizer(repository);
  }

  public async create(
    actor: Actor,
    input: { name: string; teamCount: number; mode: CustomMode },
  ): Promise<CustomAggregate> {
    this.authorizer.requireHost(actor);
    if (!this.repository.getGuildConfig(actor.guildId)?.voiceLobbyChannelId) {
      throw new UserError(
        "This server is not configured. The server owner must run `/setup lobby` first.",
      );
    }
    if (input.teamCount < 2 || input.teamCount > 10) {
      throw new UserError("A custom must have between 2 and 10 teams.");
    }
    const name = normalizeCustomName(input.name);
    if (
      this.repository
        .listCustoms(actor.guildId)
        .some(
          (custom) =>
            custom.status !== "ending" &&
            normalizedNameKey(custom.name) === normalizedNameKey(name),
        )
    ) {
      throw new UserError(
        "An active custom with that name already exists in this server.",
      );
    }
    const aggregate = this.repository.createCustom({
      guildId: actor.guildId,
      creatorId: actor.userId,
      name,
      mode: input.mode,
      teamCount: input.teamCount,
    });
    try {
      await this.resources.provision(aggregate.custom.id);
    } catch (error) {
      this.repository.setCustomStatus(aggregate.custom.id, "ending");
      try {
        await this.resources.destroy(
          aggregate.custom.id,
          "Creation failed; rolling back",
        );
      } catch {
        // The persisted transitional state is intentionally retained for recovery.
      }
      throw error;
    }
    return this.requireAggregate(actor.guildId, aggregate.custom.id);
  }

  public async assignLeader(
    actor: Actor,
    reference: string,
    ordinal: number,
    userId: string,
  ): Promise<void> {
    const aggregate = this.requireAggregate(actor.guildId, reference);
    this.authorizer.requireCustomCreatorOrOverride(actor, aggregate.custom);
    this.ensureMutable(aggregate);
    if (aggregate.custom.status === "drafting") {
      throw new UserError("Leaders cannot be replaced during a draft.");
    }
    const team = this.requireTeam(aggregate, ordinal);
    await this.locks.run(aggregate.custom.id, async () => {
      this.repository.setLeader(aggregate.custom.id, team.id, userId);
      this.repository.touchSetup(aggregate.custom.id);
      await this.resources.syncTeam(aggregate.custom.id, team.id);
      await this.resources.refreshPanel(aggregate.custom.id);
    });
  }

  public async addTeam(
    actor: Actor,
    reference: string,
    requestedName?: string,
    leaderId?: string,
  ): Promise<number> {
    const aggregate = this.requireAggregate(actor.guildId, reference);
    this.authorizer.requireCustomCreatorOrOverride(actor, aggregate.custom);
    this.ensureMutable(aggregate);
    if (aggregate.custom.status === "drafting") {
      throw new UserError("Teams cannot be added during an active draft.");
    }
    if (aggregate.teams.length >= 10) {
      throw new UserError("A custom can have at most 10 teams.");
    }
    return this.locks.run(aggregate.custom.id, async () => {
      const fresh = this.repository.getAggregateById(aggregate.custom.id);
      if (!fresh || fresh.teams.length >= 10) {
        throw new UserError("A custom can have at most 10 teams.");
      }
      const ordinal = Array.from(
        { length: 10 },
        (_, index) => index + 1,
      ).find(
        (candidate) =>
          !fresh.teams.some((team) => team.ordinal === candidate),
      )!;
      const name = requestedName
        ? normalizeTeamName(requestedName)
        : `Team ${ordinal}`;
      renderTeamChannelName(fresh.custom.name, ordinal, name);
      if (
        fresh.teams.some(
          (team) => normalizedNameKey(team.name) === normalizedNameKey(name),
        )
      ) {
        throw new UserError("Team names must be unique within a custom.");
      }
      const team = this.repository.addTeam(
        fresh.custom.id,
        ordinal,
        name,
      );
      if (leaderId) {
        try {
          this.repository.setLeader(fresh.custom.id, team.id, leaderId);
        } catch (error) {
          this.repository.deleteTeam(fresh.custom.id, team.id);
          throw error;
        }
      }
      this.repository.touchSetup(fresh.custom.id);
      await this.resources.repair(fresh.custom.id);
      return ordinal;
    });
  }

  public async removeTeam(
    actor: Actor,
    reference: string,
    ordinal: number,
  ): Promise<void> {
    const aggregate = this.requireAggregate(actor.guildId, reference);
    this.authorizer.requireCustomCreatorOrOverride(actor, aggregate.custom);
    this.ensureMutable(aggregate);
    if (aggregate.custom.status === "drafting") {
      throw new UserError("Teams cannot be removed during an active draft.");
    }
    await this.locks.run(aggregate.custom.id, async () => {
      const fresh = this.repository.getAggregateById(aggregate.custom.id);
      if (!fresh || fresh.teams.length <= 2) {
        throw new UserError("A custom must keep at least two teams.");
      }
      if (fresh.custom.status === "drafting") {
        throw new UserError("Teams cannot be removed during an active draft.");
      }
      const team = this.requireTeam(fresh, ordinal);
      await this.resources.removeTeamChannel(fresh.custom.id, team.id);
      this.repository.deleteTeam(fresh.custom.id, team.id);
      this.repository.touchSetup(fresh.custom.id);
      await this.resources.refreshPanel(fresh.custom.id);
    });
  }

  public async renameTeam(
    actor: Actor,
    reference: string,
    ordinal: number,
    requestedName: string,
  ): Promise<void> {
    const aggregate = this.requireAggregate(actor.guildId, reference);
    this.ensureMutable(aggregate);
    const team = this.requireTeam(aggregate, ordinal);
    this.requireTeamManager(actor, aggregate, team);
    const name = normalizeTeamName(requestedName);
    renderTeamChannelName(aggregate.custom.name, ordinal, name);
    const key = normalizedNameKey(name);
    if (
      aggregate.teams.some(
        (candidate) =>
          candidate.id !== team.id && normalizedNameKey(candidate.name) === key,
      )
    ) {
      throw new UserError("Team names must be unique within a custom.");
    }
    await this.locks.run(aggregate.custom.id, async () => {
      const fresh = this.repository.getAggregateById(aggregate.custom.id);
      if (
        !fresh ||
        fresh.teams.some(
          (candidate) =>
            candidate.id !== team.id &&
            normalizedNameKey(candidate.name) === key,
        )
      ) {
        throw new UserError("Team names must be unique within a custom.");
      }
      this.repository.setTeamName(team.id, name);
      this.repository.touchSetup(aggregate.custom.id);
      await this.resources.syncTeam(aggregate.custom.id, team.id);
      await this.resources.refreshPanel(aggregate.custom.id);
    });
  }

  public async addMember(
    actor: Actor,
    reference: string,
    ordinal: number,
    userId: string,
  ): Promise<void> {
    const aggregate = this.requireAggregate(actor.guildId, reference);
    this.ensureMutable(aggregate);
    const team = this.requireTeam(aggregate, ordinal);
    this.requireTeamManager(actor, aggregate, team);
    if (
      aggregate.custom.mode === "draft" &&
      aggregate.custom.status !== "active"
    ) {
      throw new UserError(
        "Use the draft controls until the custom creator finishes the draft.",
      );
    }
    await this.locks.run(aggregate.custom.id, async () => {
      this.repository.addTeamMember(aggregate.custom.id, team.id, userId);
      this.repository.touchSetup(aggregate.custom.id);
      await this.resources.syncTeam(aggregate.custom.id, team.id);
      await this.resources.refreshPanel(aggregate.custom.id);
    });
  }

  public async removeMember(
    actor: Actor,
    reference: string,
    ordinal: number,
    userId: string,
  ): Promise<void> {
    const aggregate = this.requireAggregate(actor.guildId, reference);
    this.ensureMutable(aggregate);
    const team = this.requireTeam(aggregate, ordinal);
    this.requireTeamManager(actor, aggregate, team);
    if (
      aggregate.custom.mode === "draft" &&
      aggregate.custom.status !== "active"
    ) {
      throw new UserError("Roster edits are locked while drafting.");
    }
    await this.locks.run(aggregate.custom.id, async () => {
      this.repository.removeTeamMember(aggregate.custom.id, team.id, userId);
      this.repository.touchSetup(aggregate.custom.id);
      await this.resources.syncTeam(aggregate.custom.id, team.id);
      await this.resources.refreshPanel(aggregate.custom.id);
    });
  }

  public async setSpectators(
    actor: Actor,
    reference: string,
    ordinal: number,
    mode: SpectatorMode,
  ): Promise<void> {
    const aggregate = this.requireAggregate(actor.guildId, reference);
    this.ensureMutable(aggregate);
    const team = this.requireTeam(aggregate, ordinal);
    this.requireTeamManager(actor, aggregate, team);
    await this.locks.run(aggregate.custom.id, async () => {
      this.repository.setTeamSpectatorMode(team.id, mode);
      this.repository.touchSetup(aggregate.custom.id);
      await this.resources.syncTeam(aggregate.custom.id, team.id);
      await this.resources.refreshPanel(aggregate.custom.id);
    });
  }

  public async startDraft(actor: Actor, reference: string): Promise<void> {
    const aggregate = this.requireAggregate(actor.guildId, reference);
    this.authorizer.requireCustomCreatorOrOverride(actor, aggregate.custom);
    this.ensureMutable(aggregate);
    if (aggregate.custom.mode !== "draft") {
      throw new UserError("This custom uses direct roster assignment.");
    }
    if (aggregate.custom.status !== "setup") {
      throw new UserError("The draft has already started or finished.");
    }
    if (aggregate.custom.startedAt !== null) {
      throw new UserError("The custom has already started.");
    }
    if (aggregate.teams.some((team) => !team.leaderId)) {
      throw new UserError("Assign a leader to every team before drafting.");
    }
    await this.locks.run(aggregate.custom.id, async () => {
      const fresh = this.repository.getAggregateById(aggregate.custom.id);
      if (!fresh || fresh.custom.status !== "setup") {
        throw new UserError("The draft has already started or finished.");
      }
      this.repository.startDraft(
        aggregate.custom.id,
        shuffledTeamOrder(fresh.teams),
      );
      this.repository.touchSetup(aggregate.custom.id);
      await this.resources.refreshPanel(aggregate.custom.id);
    });
  }

  public async draftPick(
    actor: Actor,
    reference: string,
    memberId: string,
  ): Promise<void> {
    await this.performDraftAction(actor, reference, memberId);
  }

  public async draftPass(actor: Actor, reference: string): Promise<void> {
    await this.performDraftAction(actor, reference);
  }

  private async performDraftAction(
    actor: Actor,
    reference: string,
    memberId?: string,
  ): Promise<void> {
    const aggregate = this.requireAggregate(actor.guildId, reference);
    await this.locks.run(aggregate.custom.id, async () => {
      const fresh = this.repository.getAggregateById(aggregate.custom.id);
      if (
        !fresh ||
        fresh.custom.status !== "drafting" ||
        !fresh.custom.draftOrder
      ) {
        throw new UserError("This custom does not have an active draft.");
      }
      const teamId = currentDraftTeamId(
        fresh.custom.draftOrder,
        fresh.draftActions,
      );
      const team = fresh.teams.find((candidate) => candidate.id === teamId)!;
      if (team.leaderId !== actor.userId) {
        throw new UserError(
          `It is currently <@${team.leaderId}>’s turn for Team ${team.ordinal}.`,
        );
      }
      this.repository.addDraftAction({
        customId: fresh.custom.id,
        teamId,
        actorId: actor.userId,
        ...(memberId ? { memberId } : {}),
      });
      this.repository.touchSetup(fresh.custom.id);
      if (memberId) await this.resources.syncTeam(fresh.custom.id, teamId);
      await this.resources.refreshPanel(fresh.custom.id);
    });
  }

  public async undoDraft(actor: Actor, reference: string): Promise<void> {
    const aggregate = this.requireAggregate(actor.guildId, reference);
    this.authorizer.requireCustomCreatorOrOverride(actor, aggregate.custom);
    if (aggregate.custom.status !== "drafting") {
      throw new UserError("There is no active draft.");
    }
    await this.locks.run(aggregate.custom.id, async () => {
      const action = this.repository.undoDraftAction(aggregate.custom.id);
      if (action.memberId) {
        await this.resources.syncTeam(aggregate.custom.id, action.teamId);
      }
      this.repository.touchSetup(aggregate.custom.id);
      await this.resources.refreshPanel(aggregate.custom.id);
    });
  }

  public async finishDraft(actor: Actor, reference: string): Promise<void> {
    const aggregate = this.requireAggregate(actor.guildId, reference);
    this.authorizer.requireCustomCreatorOrOverride(actor, aggregate.custom);
    if (aggregate.custom.status !== "drafting") {
      throw new UserError("There is no active draft.");
    }
    await this.locks.run(aggregate.custom.id, async () => {
      this.repository.finishDraft(aggregate.custom.id);
      this.repository.touchSetup(aggregate.custom.id);
      await this.resources.refreshPanel(aggregate.custom.id);
    });
  }

  public async setTimeouts(
    actor: Actor,
    reference: string,
    setupMinutes: number,
    emptyMinutes: number,
  ): Promise<void> {
    const aggregate = this.requireAggregate(actor.guildId, reference);
    this.authorizer.requireCustomCreatorOrOverride(actor, aggregate.custom);
    for (const [label, value] of [
      ["Setup", setupMinutes],
      ["Empty", emptyMinutes],
    ] as const) {
      if (value < 10 || value > 24 * 60) {
        throw new UserError(`${label} timeout must be 10–1440 minutes.`);
      }
    }
    this.repository.setTimeouts(
      aggregate.custom.id,
      setupMinutes,
      emptyMinutes,
    );
    await this.resources.refreshPanel(aggregate.custom.id);
  }

  public async startCustom(
    actor: Actor,
    reference: string,
  ): Promise<MoveSummary> {
    const aggregate = this.requireAggregate(actor.guildId, reference);
    this.authorizer.requireCustomCreatorOrOverride(actor, aggregate.custom);
    this.ensureMutable(aggregate);
    if (aggregate.teams.some((team) => !team.leaderId)) {
      throw new UserError("Assign a leader to every team before starting.");
    }
    if (
      aggregate.custom.mode === "draft" &&
      aggregate.custom.status !== "active"
    ) {
      throw new UserError("Finish the draft before starting the custom.");
    }
    return this.locks.run(aggregate.custom.id, async () => {
      const summary = await this.resources.moveRosterToTeamChannels(
        aggregate.custom.id,
      );
      this.repository.markStarted(aggregate.custom.id);
      await this.resources.refreshPanel(aggregate.custom.id);
      return summary;
    });
  }

  public async repair(actor: Actor, reference: string): Promise<void> {
    const aggregate = this.requireAggregate(actor.guildId, reference);
    this.authorizer.requireCustomCreatorOrOverride(actor, aggregate.custom);
    this.ensureMutable(aggregate);
    await this.locks.run(aggregate.custom.id, () =>
      this.resources.repair(aggregate.custom.id),
    );
  }

  public async end(
    actor: Actor,
    reference: string,
    reason = "Ended manually",
  ): Promise<void> {
    const aggregate = this.requireAggregate(actor.guildId, reference);
    this.authorizer.requireCustomCreatorOrOverride(actor, aggregate.custom);
    await this.endById(aggregate.custom.id, reason);
  }

  public async endById(customId: string, reason: string): Promise<void> {
    await this.locks.run(customId, async () => {
      const aggregate = this.repository.getAggregateById(customId);
      if (!aggregate) return;
      this.repository.setCustomStatus(customId, "ending");
      await this.resources.destroy(customId, reason);
    });
  }

  public findLeaderTeam(
    guildId: string,
    reference: string,
    userId: string,
  ): Team | null {
    const aggregate = this.requireAggregate(guildId, reference);
    return (
      aggregate.teams.find((team) => team.leaderId === userId) ??
      null
    );
  }

  private requireAggregate(
    guildId: string,
    reference: string,
  ): CustomAggregate {
    const aggregate = this.repository.getAggregate(guildId, reference);
    if (!aggregate) throw new UserError("Custom not found in this server.");
    return aggregate;
  }

  private requireTeam(
    aggregate: CustomAggregate,
    ordinal: number,
  ): CustomAggregate["teams"][number] {
    const team = aggregate.teams.find(
      (candidate) => candidate.ordinal === ordinal,
    );
    if (!team) throw new UserError("Team number not found.");
    return team;
  }

  private requireTeamManager(
    actor: Actor,
    aggregate: CustomAggregate,
    team: Team,
  ): void {
    if (
      actor.userId === team.leaderId ||
      actor.userId === aggregate.custom.creatorId ||
      actor.isOwner ||
      actor.isAdministrator
    ) {
      return;
    }
    throw new UserError("You can only manage a team that you lead.");
  }

  private ensureMutable(aggregate: CustomAggregate): void {
    if (aggregate.custom.status === "ending") {
      throw new UserError("This custom is already ending.");
    }
  }
}
