import { randomBytes, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { UserError } from "../domain/errors.js";
import type {
  Custom,
  CustomAggregate,
  CustomMode,
  CustomStatus,
  DraftAction,
  GrantType,
  GuildConfig,
  SpectatorMode,
  Team,
  TeamMember,
} from "../domain/types.js";

type Row = Record<string, unknown>;

function customFromRow(row: Row): Custom {
  return {
    id: String(row.id),
    shortId: String(row.short_id),
    guildId: String(row.guild_id),
    creatorId: String(row.creator_id),
    name: String(row.name),
    mode: row.mode as CustomMode,
    status: row.status as CustomStatus,
    categoryId: row.category_id === null ? null : String(row.category_id),
    threadId: row.thread_id === null ? null : String(row.thread_id),
    starterMessageId:
      row.starter_message_id === null ? null : String(row.starter_message_id),
    panelMessageId:
      row.panel_message_id === null ? null : String(row.panel_message_id),
    draftOrder:
      row.draft_order === null
        ? null
        : (JSON.parse(String(row.draft_order)) as number[]),
    everOccupied: Boolean(row.ever_occupied),
    emptySince: row.empty_since === null ? null : Number(row.empty_since),
    setupDeadline: Number(row.setup_deadline),
    setupTimeoutMinutes: Number(row.setup_timeout_minutes),
    emptyTimeoutMinutes: Number(row.empty_timeout_minutes),
    warningSentFor:
      row.warning_sent_for === null ? null : Number(row.warning_sent_for),
    startedAt: row.started_at === null ? null : Number(row.started_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function teamFromRow(row: Row): Team {
  return {
    id: Number(row.id),
    customId: String(row.custom_id),
    ordinal: Number(row.ordinal),
    name: String(row.name),
    leaderId: row.leader_id === null ? null : String(row.leader_id),
    voiceChannelId:
      row.voice_channel_id === null ? null : String(row.voice_channel_id),
    leaderPromptMessageId:
      row.leader_prompt_message_id === null
        ? null
        : String(row.leader_prompt_message_id),
    spectatorMode: row.spectator_mode as SpectatorMode,
  };
}

function memberFromRow(row: Row): TeamMember {
  return {
    guildId: String(row.guild_id),
    customId: String(row.custom_id),
    teamId: Number(row.team_id),
    userId: String(row.user_id),
    createdAt: Number(row.created_at),
  };
}

function actionFromRow(row: Row): DraftAction {
  return {
    id: Number(row.id),
    customId: String(row.custom_id),
    sequence: Number(row.sequence),
    teamId: Number(row.team_id),
    actorId: String(row.actor_id),
    actionType: row.action_type as "pick" | "pass",
    memberId: row.member_id === null ? null : String(row.member_id),
    createdAt: Number(row.created_at),
  };
}

export class Repository {
  public constructor(private readonly database: Database.Database) {}

  public close(): void {
    this.database.close();
  }

  public drainMigrationNotices(): string[] {
    const rows = this.database
      .prepare("SELECT message FROM migration_notices ORDER BY id")
      .all() as Row[];
    this.database.prepare("DELETE FROM migration_notices").run();
    return rows.map((row) => String(row.message));
  }

  public getGuildConfig(guildId: string): GuildConfig | null {
    const row = this.database
      .prepare("SELECT * FROM guild_config WHERE guild_id = ?")
      .get(guildId) as Row | undefined;
    if (!row) return null;
    return {
      guildId: String(row.guild_id),
      lobbyChannelId: String(row.lobby_channel_id),
      voiceLobbyChannelId:
        row.voice_lobby_channel_id === null
          ? null
          : String(row.voice_lobby_channel_id),
      categoryFormat: String(row.category_format),
      channelFormat: String(row.channel_format),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  public upsertGuildConfig(
    guildId: string,
    lobbyChannelId: string,
    voiceLobbyChannelId: string,
  ): void {
    const now = Date.now();
    this.database
      .prepare(
        `INSERT INTO guild_config (
           guild_id, lobby_channel_id, voice_lobby_channel_id, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET
           lobby_channel_id = excluded.lobby_channel_id,
           voice_lobby_channel_id = excluded.voice_lobby_channel_id,
           updated_at = excluded.updated_at`,
      )
      .run(guildId, lobbyChannelId, voiceLobbyChannelId, now, now);
  }

  public addHostGrant(
    guildId: string,
    grantType: GrantType,
    grantId: string,
  ): void {
    this.database
      .prepare(
        `INSERT OR IGNORE INTO host_grants
         (guild_id, grant_type, grant_id, created_at) VALUES (?, ?, ?, ?)`,
      )
      .run(guildId, grantType, grantId, Date.now());
  }

  public removeHostGrant(
    guildId: string,
    grantType: GrantType,
    grantId: string,
  ): void {
    this.database
      .prepare(
        "DELETE FROM host_grants WHERE guild_id = ? AND grant_type = ? AND grant_id = ?",
      )
      .run(guildId, grantType, grantId);
  }

  public listHostGrants(
    guildId: string,
  ): Array<{ type: GrantType; id: string }> {
    const rows = this.database
      .prepare(
        "SELECT grant_type, grant_id FROM host_grants WHERE guild_id = ? ORDER BY grant_type, grant_id",
      )
      .all(guildId) as Row[];
    return rows.map((row) => ({
      type: row.grant_type as GrantType,
      id: String(row.grant_id),
    }));
  }

  public setNamingFormats(
    guildId: string,
    categoryFormat: string,
    channelFormat: string,
  ): void {
    this.database
      .prepare(
        `UPDATE guild_config SET category_format = ?, channel_format = ?,
         updated_at = ? WHERE guild_id = ?`,
      )
      .run(categoryFormat, channelFormat, Date.now(), guildId);
  }

  public isHost(
    guildId: string,
    userId: string,
    roleIds: readonly string[],
  ): boolean {
    const userGrant = this.database
      .prepare(
        `SELECT 1 FROM host_grants
         WHERE guild_id = ? AND grant_type = 'user' AND grant_id = ?`,
      )
      .get(guildId, userId);
    if (userGrant) return true;
    if (roleIds.length === 0) return false;
    const placeholders = roleIds.map(() => "?").join(",");
    return Boolean(
      this.database
        .prepare(
          `SELECT 1 FROM host_grants
           WHERE guild_id = ? AND grant_type = 'role'
             AND grant_id IN (${placeholders}) LIMIT 1`,
        )
        .get(guildId, ...roleIds),
    );
  }

  public createCustom(input: {
    guildId: string;
    creatorId: string;
    name: string;
    mode: CustomMode;
    teamCount: number;
  }): CustomAggregate {
    return this.database.transaction(() => {
      const id = randomUUID();
      let shortId = "";
      for (let attempts = 0; attempts < 20; attempts += 1) {
        shortId = randomBytes(5)
          .toString("base64url")
          .replace(/[-_]/gu, "")
          .slice(0, 6)
          .toUpperCase();
        if (shortId.length < 6) continue;
        const exists = this.database
          .prepare(
            "SELECT 1 FROM customs WHERE guild_id = ? AND short_id = ?",
          )
          .get(input.guildId, shortId);
        if (!exists) break;
        shortId = "";
      }
      if (!shortId) throw new Error("Could not generate a unique custom ID.");

      const now = Date.now();
      const setupDeadline = now + 60 * 60_000;
      this.database
        .prepare(
          `INSERT INTO customs (
             id, short_id, guild_id, creator_id, name, mode, status,
             setup_deadline, setup_timeout_minutes, empty_timeout_minutes,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'creating', ?, 60, 30, ?, ?)`,
        )
        .run(
          id,
          shortId,
          input.guildId,
          input.creatorId,
          input.name,
          input.mode,
          setupDeadline,
          now,
          now,
        );
      const insertTeam = this.database.prepare(
        `INSERT INTO teams (custom_id, ordinal, name, spectator_mode)
         VALUES (?, ?, ?, 'off')`,
      );
      for (let ordinal = 1; ordinal <= input.teamCount; ordinal += 1) {
        insertTeam.run(id, ordinal, `Team ${ordinal}`);
      }
      return this.getAggregateById(id)!;
    })();
  }

  public getCustom(guildId: string, reference: string): Custom | null {
    const row = this.database
      .prepare(
        `SELECT * FROM customs
         WHERE guild_id = ? AND (id = ? OR short_id = ?)`,
      )
      .get(guildId, reference, reference.toUpperCase()) as Row | undefined;
    return row ? customFromRow(row) : null;
  }

  public getCustomByThread(guildId: string, threadId: string): Custom | null {
    const row = this.database
      .prepare("SELECT * FROM customs WHERE guild_id = ? AND thread_id = ?")
      .get(guildId, threadId) as Row | undefined;
    return row ? customFromRow(row) : null;
  }

  public getCustomByVoiceChannel(channelId: string): Custom | null {
    const row = this.database
      .prepare(
        `SELECT c.* FROM customs c
         JOIN teams t ON t.custom_id = c.id
         WHERE t.voice_channel_id = ?`,
      )
      .get(channelId) as Row | undefined;
    return row ? customFromRow(row) : null;
  }

  public getCustomByResource(guildId: string, resourceId: string): Custom | null {
    const row = this.database
      .prepare(
        `SELECT DISTINCT c.* FROM customs c
         LEFT JOIN teams t ON t.custom_id = c.id
         WHERE c.guild_id = ?
           AND (c.category_id = ? OR c.thread_id = ? OR
                c.starter_message_id = ? OR c.panel_message_id = ? OR
                t.voice_channel_id = ?)
         LIMIT 1`,
      )
      .get(
        guildId,
        resourceId,
        resourceId,
        resourceId,
        resourceId,
        resourceId,
      ) as Row | undefined;
    return row ? customFromRow(row) : null;
  }

  public getAggregate(
    guildId: string,
    reference: string,
  ): CustomAggregate | null {
    const custom = this.getCustom(guildId, reference);
    return custom ? this.getAggregateById(custom.id) : null;
  }

  public getAggregateById(id: string): CustomAggregate | null {
    const customRow = this.database
      .prepare("SELECT * FROM customs WHERE id = ?")
      .get(id) as Row | undefined;
    if (!customRow) return null;
    const teamRows = this.database
      .prepare("SELECT * FROM teams WHERE custom_id = ? ORDER BY ordinal")
      .all(id) as Row[];
    const memberRows = this.database
      .prepare(
        `SELECT * FROM team_members
         WHERE custom_id = ? ORDER BY created_at, user_id`,
      )
      .all(id) as Row[];
    const members = memberRows.map(memberFromRow);
    const actionRows = this.database
      .prepare(
        "SELECT * FROM draft_actions WHERE custom_id = ? ORDER BY sequence",
      )
      .all(id) as Row[];
    return {
      custom: customFromRow(customRow),
      teams: teamRows.map((row) => {
        const team = teamFromRow(row);
        return {
          ...team,
          members: members.filter((member) => member.teamId === team.id),
        };
      }),
      draftActions: actionRows.map(actionFromRow),
    };
  }

  public listCustoms(guildId?: string): Custom[] {
    const rows = guildId
      ? (this.database
          .prepare(
            "SELECT * FROM customs WHERE guild_id = ? ORDER BY created_at",
          )
          .all(guildId) as Row[])
      : (this.database
          .prepare("SELECT * FROM customs ORDER BY created_at")
          .all() as Row[]);
    return rows.map(customFromRow);
  }

  public setCustomStatus(id: string, status: CustomStatus): void {
    this.database
      .prepare("UPDATE customs SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, Date.now(), id);
  }

  public setCustomName(id: string, name: string): void {
    this.database
      .prepare("UPDATE customs SET name = ?, updated_at = ? WHERE id = ?")
      .run(name, Date.now(), id);
  }

  public setCustomResources(
    id: string,
    resources: {
      categoryId?: string | null;
      threadId?: string | null;
      starterMessageId?: string | null;
      panelMessageId?: string | null;
    },
  ): void {
    const columns: string[] = [];
    const values: unknown[] = [];
    const mapping = {
      categoryId: "category_id",
      threadId: "thread_id",
      starterMessageId: "starter_message_id",
      panelMessageId: "panel_message_id",
    } as const;
    for (const [key, column] of Object.entries(mapping)) {
      if (Object.prototype.hasOwnProperty.call(resources, key)) {
        columns.push(`${column} = ?`);
        values.push(resources[key as keyof typeof resources] ?? null);
      }
    }
    if (columns.length === 0) return;
    columns.push("updated_at = ?");
    values.push(Date.now(), id);
    this.database
      .prepare(`UPDATE customs SET ${columns.join(", ")} WHERE id = ?`)
      .run(...values);
  }

  public setTeamVoiceChannel(teamId: number, channelId: string | null): void {
    this.database
      .prepare("UPDATE teams SET voice_channel_id = ? WHERE id = ?")
      .run(channelId, teamId);
  }

  public setLeaderPromptMessage(
    teamId: number,
    messageId: string | null,
  ): void {
    this.database
      .prepare("UPDATE teams SET leader_prompt_message_id = ? WHERE id = ?")
      .run(messageId, teamId);
  }

  public addTeam(customId: string, ordinal: number, name: string): Team {
    const result = this.database
      .prepare(
        `INSERT INTO teams (custom_id, ordinal, name, spectator_mode)
         VALUES (?, ?, ?, 'off')`,
      )
      .run(customId, ordinal, name);
    const row = this.database
      .prepare("SELECT * FROM teams WHERE id = ?")
      .get(Number(result.lastInsertRowid)) as Row;
    return teamFromRow(row);
  }

  public deleteTeam(customId: string, teamId: number): void {
    this.database
      .prepare("DELETE FROM teams WHERE custom_id = ? AND id = ?")
      .run(customId, teamId);
  }

  public setTeamName(teamId: number, name: string): void {
    this.database
      .prepare("UPDATE teams SET name = ? WHERE id = ?")
      .run(name, teamId);
  }

  public setTeamSpectatorMode(teamId: number, mode: SpectatorMode): void {
    this.database
      .prepare("UPDATE teams SET spectator_mode = ? WHERE id = ?")
      .run(mode, teamId);
  }

  public setLeader(customId: string, teamId: number, userId: string): void {
    this.database.transaction(() => {
      const target = this.database
        .prepare(
          "SELECT 1 FROM teams WHERE id = ? AND custom_id = ?",
        )
        .get(teamId, customId);
      if (!target) throw new UserError("Team not found.");
      const membership = this.database
        .prepare(
          `SELECT tm.custom_id, tm.team_id
           FROM team_members tm
           JOIN customs target ON target.id = ?
           WHERE tm.guild_id = target.guild_id AND tm.user_id = ?`,
        )
        .get(customId, userId) as
        | { custom_id: string; team_id: number }
        | undefined;
      if (
        membership &&
        (membership.custom_id !== customId || membership.team_id !== teamId)
      ) {
        throw new UserError(
          membership.custom_id === customId
            ? "That member already belongs to another team."
            : "That member already belongs to another active custom in this server.",
        );
      }
      this.database
        .prepare("UPDATE teams SET leader_id = ? WHERE id = ? AND custom_id = ?")
        .run(userId, teamId, customId);
      if (!membership) {
        this.database
          .prepare(
            `INSERT INTO team_members (
               guild_id, custom_id, team_id, user_id, created_at
             )
             SELECT guild_id, id, ?, ?, ?
             FROM customs WHERE id = ?`,
          )
          .run(teamId, userId, Date.now(), customId);
      }
    })();
  }

  public addTeamMember(customId: string, teamId: number, userId: string): void {
    const result = this.updateTeamMembers(customId, teamId, [userId], "add");
    if (result.unchanged === 1) {
      throw new UserError("That member already belongs to this team.");
    }
  }

  public updateTeamMembers(
    customId: string,
    teamId: number,
    userIds: readonly string[],
    action: "add" | "remove",
  ): { changed: number; unchanged: number } {
    const uniqueUserIds = [...new Set(userIds)];
    if (uniqueUserIds.length === 0) return { changed: 0, unchanged: 0 };
    return this.database.transaction(() => {
      const target = this.database
        .prepare(
          `SELECT c.guild_id, t.leader_id
           FROM teams t
           JOIN customs c ON c.id = t.custom_id
           WHERE t.id = ? AND t.custom_id = ?`,
        )
        .get(teamId, customId) as
        | { guild_id: string; leader_id: string | null }
        | undefined;
      if (!target) throw new UserError("Team not found.");

      const placeholders = uniqueUserIds.map(() => "?").join(",");
      const memberships = this.database
        .prepare(
          `SELECT custom_id, team_id, user_id
           FROM team_members
           WHERE guild_id = ? AND user_id IN (${placeholders})`,
        )
        .all(target.guild_id, ...uniqueUserIds) as Array<{
        custom_id: string;
        team_id: number;
        user_id: string;
      }>;
      const byUser = new Map(
        memberships.map((membership) => [membership.user_id, membership]),
      );

      if (action === "add") {
        const conflict = uniqueUserIds.find((userId) => {
          const membership = byUser.get(userId);
          return (
            membership &&
            (membership.custom_id !== customId || membership.team_id !== teamId)
          );
        });
        if (conflict) {
          const membership = byUser.get(conflict)!;
          throw new UserError(
            membership.custom_id === customId
              ? `<@${conflict}> already belongs to another team.`
              : `<@${conflict}> already belongs to another active custom in this server.`,
          );
        }
        const missing = uniqueUserIds.filter((userId) => !byUser.has(userId));
        const insert = this.database.prepare(
          `INSERT INTO team_members (
             guild_id, custom_id, team_id, user_id, created_at
           ) VALUES (?, ?, ?, ?, ?)`,
        );
        const now = Date.now();
        for (const userId of missing) {
          insert.run(target.guild_id, customId, teamId, userId, now);
        }
        return {
          changed: missing.length,
          unchanged: uniqueUserIds.length - missing.length,
        };
      }

      if (target.leader_id && uniqueUserIds.includes(target.leader_id)) {
        throw new UserError(
          "Replace the team leader before removing them.",
        );
      }
      const present = uniqueUserIds.filter((userId) => {
        const membership = byUser.get(userId);
        return (
          membership?.custom_id === customId &&
          membership.team_id === teamId
        );
      });
      const remove = this.database.prepare(
        `DELETE FROM team_members
         WHERE custom_id = ? AND team_id = ? AND user_id = ?`,
      );
      for (const userId of present) remove.run(customId, teamId, userId);
      return {
        changed: present.length,
        unchanged: uniqueUserIds.length - present.length,
      };
    })();
  }

  public startDraft(customId: string, order: number[]): void {
    this.database
      .prepare(
        `UPDATE customs SET status = 'drafting', draft_order = ?,
         updated_at = ? WHERE id = ?`,
      )
      .run(JSON.stringify(order), Date.now(), customId);
  }

  public addDraftAction(input: {
    customId: string;
    teamId: number;
    actorId: string;
    memberId?: string;
  }): void {
    this.database.transaction(() => {
      const row = this.database
        .prepare(
          "SELECT COALESCE(MAX(sequence), -1) + 1 AS sequence FROM draft_actions WHERE custom_id = ?",
        )
        .get(input.customId) as { sequence: number };
      if (input.memberId) {
        this.addTeamMember(input.customId, input.teamId, input.memberId);
      }
      this.database
        .prepare(
          `INSERT INTO draft_actions (
             custom_id, sequence, team_id, actor_id, action_type, member_id, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.customId,
          row.sequence,
          input.teamId,
          input.actorId,
          input.memberId ? "pick" : "pass",
          input.memberId ?? null,
          Date.now(),
        );
    })();
  }

  public undoDraftAction(customId: string): DraftAction {
    return this.database.transaction(() => {
      const row = this.database
        .prepare(
          "SELECT * FROM draft_actions WHERE custom_id = ? ORDER BY sequence DESC LIMIT 1",
        )
        .get(customId) as Row | undefined;
      if (!row) throw new UserError("There is no draft action to undo.");
      const action = actionFromRow(row);
      if (action.memberId) {
        this.database
          .prepare(
            "DELETE FROM team_members WHERE custom_id = ? AND user_id = ?",
          )
          .run(customId, action.memberId);
      }
      this.database
        .prepare("DELETE FROM draft_actions WHERE id = ?")
        .run(action.id);
      return action;
    })();
  }

  public finishDraft(customId: string): void {
    this.database
      .prepare(
        "UPDATE customs SET status = 'active', updated_at = ? WHERE id = ?",
      )
      .run(Date.now(), customId);
  }

  public markStarted(customId: string): void {
    const now = Date.now();
    this.database
      .prepare(
        `UPDATE customs SET status = 'active', started_at = ?,
         updated_at = ? WHERE id = ?`,
      )
      .run(now, now, customId);
  }

  public touchSetup(customId: string): void {
    const custom = this.getAggregateById(customId)?.custom;
    if (!custom || custom.everOccupied) return;
    const deadline = Date.now() + custom.setupTimeoutMinutes * 60_000;
    this.database
      .prepare(
        `UPDATE customs SET setup_deadline = ?, warning_sent_for = NULL,
         updated_at = ? WHERE id = ?`,
      )
      .run(deadline, Date.now(), customId);
  }

  public setTimeouts(
    customId: string,
    setupMinutes: number,
    emptyMinutes: number,
  ): void {
    const custom = this.getAggregateById(customId)?.custom;
    if (!custom) throw new UserError("Custom not found.");
    const deadline = custom.everOccupied
      ? custom.setupDeadline
      : Date.now() + setupMinutes * 60_000;
    this.database
      .prepare(
        `UPDATE customs SET setup_timeout_minutes = ?,
         empty_timeout_minutes = ?, setup_deadline = ?,
         warning_sent_for = NULL, updated_at = ? WHERE id = ?`,
      )
      .run(setupMinutes, emptyMinutes, deadline, Date.now(), customId);
  }

  public setOccupancy(customId: string, occupied: boolean): void {
    const custom = this.getAggregateById(customId)?.custom;
    if (!custom) return;
    if (occupied) {
      this.database
        .prepare(
          `UPDATE customs SET ever_occupied = 1, empty_since = NULL,
           warning_sent_for = NULL, updated_at = ? WHERE id = ?`,
        )
        .run(Date.now(), customId);
    } else if (custom.everOccupied && custom.emptySince === null) {
      this.database
        .prepare(
          `UPDATE customs SET empty_since = ?, warning_sent_for = NULL,
           updated_at = ? WHERE id = ?`,
        )
        .run(Date.now(), Date.now(), customId);
    }
  }

  public setWarningSent(customId: string, deadline: number): void {
    this.database
      .prepare(
        "UPDATE customs SET warning_sent_for = ?, updated_at = ? WHERE id = ?",
      )
      .run(deadline, Date.now(), customId);
  }

  public deleteCustom(id: string): void {
    this.database.prepare("DELETE FROM customs WHERE id = ?").run(id);
  }

  public deleteGuild(guildId: string): void {
    this.database
      .prepare("DELETE FROM guild_config WHERE guild_id = ?")
      .run(guildId);
  }
}
