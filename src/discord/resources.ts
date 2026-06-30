import {
  ChannelType,
  DiscordAPIError,
  PermissionFlagsBits,
  ThreadAutoArchiveDuration,
  type CategoryChannel,
  type Client,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type GuildTextBasedChannel,
  type VoiceChannel,
} from "discord.js";
import type {
  MoveSummary,
  ResourceGateway,
} from "../application/session-service.js";
import type { Repository } from "../db/repository.js";
import { UserError } from "../domain/errors.js";
import {
  renderCategoryName,
  renderTeamChannelName,
} from "../domain/naming.js";
import type {
  CustomAggregate,
  SpectatorMode,
  TeamMember,
} from "../domain/types.js";
import type { Logger } from "../logger.js";
import { buildPanel } from "./panel.js";

function isMissingDiscordResource(error: unknown): boolean {
  return (
    error instanceof DiscordAPIError &&
    (error.code === 10003 || error.code === 10008)
  );
}

export class DiscordResources implements ResourceGateway {
  public constructor(
    private readonly client: Client,
    private readonly repository: Repository,
    private readonly logger: Logger,
  ) {}

  public async provision(customId: string): Promise<void> {
    await this.repair(customId);
    this.repository.setCustomStatus(customId, "setup");
    await this.refreshPanel(customId);
  }

  public async repair(customId: string): Promise<void> {
    let aggregate = this.requireAggregate(customId);
    if (aggregate.custom.status === "ending") {
      await this.destroy(customId, "Finishing interrupted cleanup");
      return;
    }
    const guild = await this.fetchGuild(aggregate.custom.guildId);
    const config = this.repository.getGuildConfig(guild.id);
    if (!config?.voiceLobbyChannelId) {
      throw new UserError(
        "This server must configure both text and voice lobbies with `/setup lobby`.",
      );
    }
    const lobby = await guild.channels.fetch(config.lobbyChannelId);
    if (!lobby || lobby.type !== ChannelType.GuildText) {
      throw new UserError(
        "The configured lobby channel is missing or is not a text channel.",
      );
    }
    const categoryName = renderCategoryName(
      config.categoryFormat,
      aggregate.custom.name,
    );
    let category = await this.fetchChannel<CategoryChannel>(
      aggregate.custom.categoryId,
    );
    if (!category || category.type !== ChannelType.GuildCategory) {
      category = await guild.channels.create({
        name: categoryName,
        type: ChannelType.GuildCategory,
        reason: `SkyCustoms ${aggregate.custom.name}`,
      });
      this.repository.setCustomResources(customId, {
        categoryId: category.id,
      });
    } else if (category.name !== categoryName) {
      await category.setName(categoryName, "Restore SkyCustoms category name");
    }

    aggregate = this.requireAggregate(customId);
    for (const team of aggregate.teams) {
      let voice = await this.fetchChannel<VoiceChannel>(team.voiceChannelId);
      if (!voice || voice.type !== ChannelType.GuildVoice) {
        voice = await guild.channels.create({
          name: renderTeamChannelName(
            config.channelFormat,
            aggregate.custom.name,
            team.ordinal,
            team.name,
          ),
          type: ChannelType.GuildVoice,
          parent: category.id,
          userLimit: 0,
          reason: `SkyCustoms ${aggregate.custom.name} team ${team.ordinal}`,
        });
        this.repository.setTeamVoiceChannel(team.id, voice.id);
      } else {
        const canonicalName = renderTeamChannelName(
          config.channelFormat,
          aggregate.custom.name,
          team.ordinal,
          team.name,
        );
        if (
          voice.name !== canonicalName ||
          voice.parentId !== category.id
        ) {
          await voice.edit({
            name: canonicalName,
            parent: category.id,
            reason: "Restore SkyCustoms channel",
          });
        }
      }
      await this.applyTeamPermissions(
        voice,
        this.requireAggregate(customId),
        team.id,
      );
    }

    aggregate = this.requireAggregate(customId);
    let thread = await this.fetchChannel<GuildTextBasedChannel>(
      aggregate.custom.threadId,
    );
    if (!thread || !thread.isThread()) {
      const starter = await lobby.send({
        content: `**SkyCustoms:** ${aggregate.custom.name}`,
      });
      thread = await starter.startThread({
        name: `Custom • ${aggregate.custom.name}`,
        autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
        reason: `SkyCustoms ${aggregate.custom.name} control thread`,
      });
      this.repository.setCustomResources(customId, {
        starterMessageId: starter.id,
        threadId: thread.id,
        panelMessageId: null,
      });
    } else if (thread.archived) {
      await thread.setArchived(false, "SkyCustoms session is active");
    }

    await this.refreshPanel(customId);
  }

  public async syncTeam(customId: string, teamId: number): Promise<void> {
    const aggregate = this.requireAggregate(customId);
    const team = aggregate.teams.find((candidate) => candidate.id === teamId);
    if (!team) throw new UserError("Team not found.");
    const voice = await this.fetchChannel<VoiceChannel>(team.voiceChannelId);
    if (!voice || voice.type !== ChannelType.GuildVoice) {
      await this.repair(customId);
      return;
    }
    const canonicalName = renderTeamChannelName(
      this.requireConfig(aggregate.custom.guildId).channelFormat,
      aggregate.custom.name,
      team.ordinal,
      team.name,
    );
    if (voice.name !== canonicalName) {
      await voice.setName(canonicalName, "SkyCustoms team rename");
    }
    await this.applyTeamPermissions(voice, aggregate, teamId);
  }

  public async refreshPanel(customId: string): Promise<void> {
    const aggregate = this.requireAggregate(customId);
    const thread = await this.fetchChannel<GuildTextBasedChannel>(
      aggregate.custom.threadId,
    );
    if (!thread || !thread.isThread()) return;
    if (thread.archived) {
      await thread.setArchived(false, "Update SkyCustoms controls");
    }
    const payload = buildPanel(aggregate);
    if (aggregate.custom.panelMessageId) {
      try {
        const panel = await thread.messages.fetch(
          aggregate.custom.panelMessageId,
        );
        await panel.edit(payload);
        return;
      } catch (error) {
        if (!isMissingDiscordResource(error) && !String(error).includes("Unknown Message")) {
          throw error;
        }
      }
    }
    const panel = await thread.send(payload);
    await panel.pin("SkyCustoms control panel").catch(() => undefined);
    this.repository.setCustomResources(customId, {
      panelMessageId: panel.id,
    });
  }

  public async moveRosterToTeamChannels(
    customId: string,
  ): Promise<MoveSummary> {
    const aggregate = this.requireAggregate(customId);
    const guild = await this.fetchGuild(aggregate.custom.guildId);
    const summary: MoveSummary = { moved: 0, disconnected: 0, failed: 0 };

    for (const team of aggregate.teams) {
      if (!team.voiceChannelId) {
        summary.failed += team.members.length;
        continue;
      }
      for (const rosterMember of team.members) {
        try {
          const member =
            guild.members.cache.get(rosterMember.userId) ??
            (await guild.members.fetch(rosterMember.userId));
          if (!member.voice.channelId) {
            summary.disconnected += 1;
            continue;
          }
          if (member.voice.channelId !== team.voiceChannelId) {
            await member.voice.setChannel(
              team.voiceChannelId,
              `Start SkyCustoms session ${aggregate.custom.name}`,
            );
          }
          summary.moved += 1;
        } catch (error) {
          summary.failed += 1;
          this.logger.warn(
            {
              error,
              customId,
              guildId: aggregate.custom.guildId,
              userId: rosterMember.userId,
              teamId: team.id,
            },
            "Could not move roster member to team channel",
          );
        }
      }
    }
    return summary;
  }

  public async removeTeamChannel(
    customId: string,
    teamId: number,
  ): Promise<void> {
    const aggregate = this.requireAggregate(customId);
    const team = aggregate.teams.find((candidate) => candidate.id === teamId);
    if (!team) throw new UserError("Team not found.");
    const config = this.repository.getGuildConfig(aggregate.custom.guildId);
    if (!config?.voiceLobbyChannelId) {
      throw new UserError("The return voice lobby is not configured.");
    }
    const lobby = await this.fetchChannel<VoiceChannel>(
      config.voiceLobbyChannelId,
    );
    if (!lobby || lobby.type !== ChannelType.GuildVoice) {
      throw new UserError("The configured return voice lobby is unavailable.");
    }
    const voice = await this.fetchChannel<VoiceChannel>(team.voiceChannelId);
    if (!voice || voice.type !== ChannelType.GuildVoice) return;

    const results = await Promise.allSettled(
      [...voice.members.values()].map((member) =>
        member.voice.setChannel(
          lobby.id,
          `Remove team from SkyCustoms session ${aggregate.custom.name}`,
        ),
      ),
    );
    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length > 0) {
      throw new UserError(
        `Could not return ${failed.length} occupant(s) to the voice lobby; the team was not removed.`,
      );
    }
    await voice.delete(`Remove team from SkyCustoms session ${aggregate.custom.name}`);
  }

  public async sendWarning(customId: string, deadline: number): Promise<void> {
    const aggregate = this.repository.getAggregateById(customId);
    if (!aggregate?.custom.threadId) return;
    const thread = await this.fetchChannel<GuildTextBasedChannel>(
      aggregate.custom.threadId,
    );
    if (!thread?.isThread()) return;
    if (thread.archived) {
      await thread.setArchived(false, "SkyCustoms cleanup warning");
    }
    await thread.send(
      `⚠️ This custom is inactive and will be removed <t:${Math.floor(deadline / 1000)}:R>. Rejoin a team channel to cancel active-session cleanup.`,
    );
  }

  public async destroy(customId: string, reason: string): Promise<void> {
    const aggregate = this.repository.getAggregateById(customId);
    if (!aggregate) return;
    const errors: unknown[] = [];

    await this.moveManagedOccupantsToLobby(aggregate).catch((error) => {
      this.logger.warn(
        { error, customId, guildId: aggregate.custom.guildId },
        "Could not return all occupants to the voice lobby before cleanup",
      );
    });

    if (aggregate.custom.panelMessageId && aggregate.custom.threadId) {
      const thread = await this.fetchChannel<GuildTextBasedChannel>(
        aggregate.custom.threadId,
      );
      if (thread?.isThread()) {
        try {
          const message = await thread.messages.fetch(
            aggregate.custom.panelMessageId,
          );
          await message.edit(buildPanel({
            ...aggregate,
            custom: { ...aggregate.custom, status: "ending" },
          }));
        } catch {
          // Best effort; deletion below is authoritative.
        }
      }
    }

    for (const team of aggregate.teams) {
      await this.tryDeleteChannel(team.voiceChannelId, reason, errors);
    }
    await this.tryDeleteChannel(aggregate.custom.categoryId, reason, errors);
    await this.tryDeleteChannel(aggregate.custom.threadId, reason, errors);

    if (aggregate.custom.starterMessageId) {
      const config = this.repository.getGuildConfig(aggregate.custom.guildId);
      if (config) {
        try {
          const guild = await this.fetchGuild(aggregate.custom.guildId);
          const lobby = await guild.channels.fetch(config.lobbyChannelId);
          if (lobby?.isTextBased() && "messages" in lobby) {
            const message = await lobby.messages
              .fetch(aggregate.custom.starterMessageId)
              .catch(() => null);
            if (message) await message.delete();
          }
        } catch (error) {
          errors.push(error);
        }
      }
    }

    if (errors.length > 0) {
      this.logger.warn(
        {
          customId,
          guildId: aggregate.custom.guildId,
          errorCount: errors.length,
        },
        "Custom cleanup was incomplete and will be retried",
      );
      throw new AggregateError(errors, "Custom cleanup incomplete.");
    }
    this.repository.deleteCustom(customId);
    this.logger.info(
      { customId, guildId: aggregate.custom.guildId, reason },
      "Custom deleted",
    );
  }

  public async isOccupied(customId: string): Promise<boolean> {
    const aggregate = this.repository.getAggregateById(customId);
    if (!aggregate) return false;
    for (const team of aggregate.teams) {
      const voice = await this.fetchChannel<VoiceChannel>(team.voiceChannelId);
      if (voice?.type === ChannelType.GuildVoice && voice.members.size > 0) {
        return true;
      }
    }
    return false;
  }

  private async applyTeamPermissions(
    voice: VoiceChannel,
    aggregate: CustomAggregate,
    teamId: number,
  ): Promise<void> {
    const team = aggregate.teams.find((candidate) => candidate.id === teamId);
    if (!team) throw new UserError("Team not found.");
    const everyone = this.everyonePermissions(team.spectatorMode);
    const memberAllow = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.Speak,
      PermissionFlagsBits.Stream,
      PermissionFlagsBits.UseSoundboard,
      PermissionFlagsBits.UseExternalSounds,
      PermissionFlagsBits.SendVoiceMessages,
    ];
    const memberIds = new Set([
      aggregate.custom.creatorId,
      ...team.members.map((member: TeamMember) => member.userId),
    ]);
    const botId = this.client.user?.id;
    if (!botId) throw new Error("Discord client is not ready.");
    await voice.permissionOverwrites.set(
      [
        { id: voice.guild.roles.everyone.id, ...everyone },
        {
          id: botId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageRoles,
            PermissionFlagsBits.MoveMembers,
          ],
        },
        ...Array.from(memberIds, (id) => ({ id, allow: memberAllow })),
      ],
      "Reconcile SkyCustoms access",
    );

    if (team.spectatorMode === "off") {
      await Promise.all(
        voice.members
          .filter((member) => !memberIds.has(member.id))
          .map((member: GuildMember) =>
            member.voice
              .disconnect("SkyCustoms spectator access disabled")
              .catch((error) => {
                this.logger.warn(
                  { error, memberId: member.id, channelId: voice.id },
                  "Could not disconnect unauthorized voice member",
                );
              }),
          ),
      );
    }
  }

  private async moveManagedOccupantsToLobby(
    aggregate: CustomAggregate,
  ): Promise<void> {
    const config = this.repository.getGuildConfig(aggregate.custom.guildId);
    if (!config?.voiceLobbyChannelId) return;
    const lobby = await this.fetchChannel<VoiceChannel>(
      config.voiceLobbyChannelId,
    );
    if (!lobby || lobby.type !== ChannelType.GuildVoice) return;

    const occupants = new Map<string, GuildMember>();
    for (const team of aggregate.teams) {
      const voice = await this.fetchChannel<VoiceChannel>(team.voiceChannelId);
      if (voice?.type !== ChannelType.GuildVoice) continue;
      for (const member of voice.members.values()) {
        occupants.set(member.id, member);
      }
    }
    await Promise.all(
      [...occupants.values()].map((member) =>
        member.voice
          .setChannel(
            lobby.id,
            `End SkyCustoms session ${aggregate.custom.name}`,
          )
          .catch((error) => {
            this.logger.warn(
              {
                error,
                customId: aggregate.custom.id,
                userId: member.id,
              },
              "Could not return voice occupant to lobby",
            );
          }),
      ),
    );
  }

  private everyonePermissions(mode: SpectatorMode): {
    id?: string;
    allow: bigint[];
    deny: bigint[];
  } {
    const silentPermissions = [
      PermissionFlagsBits.Speak,
      PermissionFlagsBits.Stream,
      PermissionFlagsBits.UseSoundboard,
      PermissionFlagsBits.UseExternalSounds,
      PermissionFlagsBits.SendVoiceMessages,
    ];
    if (mode === "speak") {
      return {
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
        ],
        deny: [
          PermissionFlagsBits.Stream,
          PermissionFlagsBits.UseSoundboard,
          PermissionFlagsBits.UseExternalSounds,
        ],
      };
    }
    if (mode === "silent") {
      return {
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
        deny: silentPermissions,
      };
    }
    return {
      allow: [PermissionFlagsBits.ViewChannel],
      deny: [PermissionFlagsBits.Connect, ...silentPermissions],
    };
  }

  private requireAggregate(customId: string): CustomAggregate {
    const aggregate = this.repository.getAggregateById(customId);
    if (!aggregate) throw new UserError("Custom no longer exists.");
    return aggregate;
  }

  private requireConfig(guildId: string) {
    const config = this.repository.getGuildConfig(guildId);
    if (!config) throw new UserError("This server is not configured.");
    return config;
  }

  private async fetchGuild(guildId: string): Promise<Guild> {
    return this.client.guilds.fetch(guildId);
  }

  private async fetchChannel<T extends GuildBasedChannel>(
    channelId: string | null,
  ): Promise<T | null> {
    if (!channelId) return null;
    try {
      return (await this.client.channels.fetch(channelId)) as T | null;
    } catch (error) {
      if (isMissingDiscordResource(error)) return null;
      throw error;
    }
  }

  private async tryDeleteChannel(
    channelId: string | null,
    reason: string,
    errors: unknown[],
  ): Promise<void> {
    if (!channelId) return;
    try {
      const channel = await this.fetchChannel<GuildBasedChannel>(channelId);
      if (channel) await channel.delete(reason);
    } catch (error) {
      if (!isMissingDiscordResource(error)) errors.push(error);
    }
  }
}
