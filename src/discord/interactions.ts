import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  GuildMember,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
  type ModalSubmitInteraction,
  type UserSelectMenuInteraction,
} from "discord.js";
import type { Actor } from "../application/auth.js";
import type { SessionService } from "../application/session-service.js";
import type { Config } from "../config.js";
import type { Repository } from "../db/repository.js";
import { UserError } from "../domain/errors.js";
import type { CustomMode, SpectatorMode } from "../domain/types.js";
import type { Logger } from "../logger.js";
import { commandDefinitions } from "./commands.js";

export class InteractionHandler {
  public constructor(
    private readonly client: Client,
    private readonly config: Config,
    private readonly repository: Repository,
    private readonly sessions: SessionService,
    private readonly logger: Logger,
  ) {}

  public async registerCommands(): Promise<void> {
    const rest = new REST({ version: "10" }).setToken(this.config.token);
    const route = this.config.devGuildId
      ? Routes.applicationGuildCommands(
          this.config.clientId,
          this.config.devGuildId,
        )
      : Routes.applicationCommands(this.config.clientId);
    await rest.put(route, { body: commandDefinitions });
    this.logger.info(
      { scope: this.config.devGuildId ?? "global" },
      "Discord commands registered",
    );
  }

  public async handle(interaction: Interaction): Promise<void> {
    if (!interaction.inCachedGuild()) return;
    try {
      if (interaction.isAutocomplete()) {
        await this.handleAutocomplete(interaction);
      } else if (interaction.isChatInputCommand()) {
        await this.handleCommand(interaction);
      } else if (interaction.isButton()) {
        await this.handleButton(interaction);
      } else if (
        interaction.isUserSelectMenu() ||
        interaction.isStringSelectMenu()
      ) {
        await this.handleUserSelect(interaction);
      } else if (interaction.isModalSubmit()) {
        await this.handleModal(interaction);
      }
    } catch (error) {
      await this.respondWithError(interaction, error);
    }
  }

  private async handleCommand(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const actor = this.actor(interaction);
    const subcommand = interaction.options.getSubcommand();

    if (interaction.commandName === "setup") {
      await this.handleSetup(interaction, actor, subcommand);
      return;
    }
    if (!this.repository.getGuildConfig(interaction.guildId)?.voiceLobbyChannelId) {
      throw new UserError(
        "SkyCustoms is not configured in this server. The server owner must run `/setup lobby` first.",
      );
    }
    if (interaction.commandName === "custom") {
      await this.handleCustom(interaction, actor, subcommand);
      return;
    }
    if (interaction.commandName === "team") {
      await this.handleTeam(interaction, actor, subcommand);
      return;
    }
    if (interaction.commandName === "draft") {
      await this.handleDraft(interaction, actor, subcommand);
    }
  }

  private async handleSetup(
    interaction: ChatInputCommandInteraction<"cached">,
    actor: Actor,
    subcommand: string,
  ): Promise<void> {
    if (!actor.isOwner) {
      throw new UserError("Only the Discord server owner can configure SkyCustoms.");
    }
    if (subcommand === "lobby") {
      const channel = interaction.options.getChannel("text-channel", true);
      const voiceChannel = interaction.options.getChannel(
        "voice-channel",
        true,
      );
      if (channel.type !== ChannelType.GuildText) {
        throw new UserError("The lobby must be a standard server text channel.");
      }
      if (voiceChannel.type !== ChannelType.GuildVoice) {
        throw new UserError("The return lobby must be a voice channel.");
      }
      if (!channel.parentId || channel.parentId !== voiceChannel.parentId) {
        throw new UserError(
          "The text lobby and voice lobby must be inside the same category.",
        );
      }
      this.repository.upsertGuildConfig(
        interaction.guildId,
        channel.id,
        voiceChannel.id,
      );
      const repairs = await Promise.allSettled(
        this.repository
          .listCustoms(interaction.guildId)
          .filter((custom) => custom.status !== "ending")
          .map((custom) => this.sessions.repair(actor, custom.id)),
      );
      const failed = repairs.filter((result) => result.status === "rejected");
      await interaction.editReply(
        `SkyCustoms configured with control lobby <#${channel.id}> and return lobby <#${voiceChannel.id}>.${failed.length ? ` ${failed.length} active custom(s) could not be migrated; use \`/custom repair\`.` : ""}`,
      );
      return;
    }
    if (
      subcommand !== "status" &&
      !this.repository.getGuildConfig(interaction.guildId)?.voiceLobbyChannelId
    ) {
      throw new UserError("Configure `/setup lobby` before assigning hosts.");
    }
    if (subcommand === "host-user") {
      const action = interaction.options.getString("action", true);
      const user = interaction.options.getUser("user", true);
      if (action === "add") {
        this.repository.addHostGrant(interaction.guildId, "user", user.id);
      } else {
        this.repository.removeHostGrant(interaction.guildId, "user", user.id);
      }
      await interaction.editReply(
        `${action === "add" ? "Added" : "Removed"} <@${user.id}> ${action === "add" ? "as" : "from"} a SkyCustoms host.`,
      );
      return;
    }
    if (subcommand === "host-role") {
      const action = interaction.options.getString("action", true);
      const role = interaction.options.getRole("role", true);
      if (action === "add") {
        this.repository.addHostGrant(interaction.guildId, "role", role.id);
      } else {
        this.repository.removeHostGrant(interaction.guildId, "role", role.id);
      }
      await interaction.editReply(
        `${action === "add" ? "Added" : "Removed"} <@&${role.id}> ${action === "add" ? "as" : "from"} a SkyCustoms host role.`,
      );
      return;
    }
    const config = this.repository.getGuildConfig(interaction.guildId);
    const grants = this.repository.listHostGrants(interaction.guildId);
    const bot = interaction.guild.members.me;
    const required = [
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.ManageRoles,
      PermissionFlagsBits.MoveMembers,
      PermissionFlagsBits.ManageThreads,
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.SendMessagesInThreads,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.Speak,
      PermissionFlagsBits.Stream,
      PermissionFlagsBits.UseSoundboard,
      PermissionFlagsBits.UseExternalSounds,
      PermissionFlagsBits.SendVoiceMessages,
    ];
    const missing = required.filter((permission) => !bot?.permissions.has(permission));
    await interaction.editReply(
      [
        `Lobby: ${config ? `<#${config.lobbyChannelId}>` : "Not configured"}`,
        `Voice return lobby: ${config?.voiceLobbyChannelId ? `<#${config.voiceLobbyChannelId}>` : "Not configured"}`,
        `Hosts: ${grants.length ? grants.map((grant) => (grant.type === "role" ? `<@&${grant.id}>` : `<@${grant.id}>`)).join(", ") : "None"}`,
        `Bot permissions: ${missing.length === 0 ? "OK" : `Missing ${missing.length} required permission(s)`}`,
      ].join("\n"),
    );
  }

  private async handleCustom(
    interaction: ChatInputCommandInteraction<"cached">,
    actor: Actor,
    subcommand: string,
  ): Promise<void> {
    if (subcommand === "create") {
      const aggregate = await this.sessions.create(actor, {
        name: interaction.options.getString("name", true),
        teamCount: interaction.options.getInteger("teams", true),
        mode: interaction.options.getString("mode", true) as CustomMode,
      });
      await interaction.editReply(
        `Created **${aggregate.custom.name}** in <#${aggregate.custom.threadId}>.`,
      );
      return;
    }
    if (subcommand === "list") {
      const customs = this.repository.listCustoms(interaction.guildId);
      await interaction.editReply(
        customs.length
          ? customs
              .map(
                (custom) =>
                  `**${custom.name}** · ${custom.status} · <@${custom.creatorId}>${custom.threadId ? ` · <#${custom.threadId}>` : ""}`,
              )
              .join("\n")
          : "There are no active customs in this server.",
      );
      return;
    }
    const reference = this.resolveReference(interaction);
    if (subcommand === "start") {
      const summary = await this.sessions.startCustom(actor, reference);
      await interaction.editReply(
        `Custom started: moved **${summary.moved}**, disconnected/not in voice **${summary.disconnected}**, failed **${summary.failed}**.`,
      );
    } else if (subcommand === "timeout") {
      await this.sessions.setTimeouts(
        actor,
        reference,
        interaction.options.getInteger("setup-minutes", true),
        interaction.options.getInteger("empty-minutes", true),
      );
      await interaction.editReply("Custom inactivity timeouts updated.");
    } else if (subcommand === "repair") {
      await this.sessions.repair(actor, reference);
      await interaction.editReply("Custom resources reconciled.");
    } else if (subcommand === "end") {
      const custom = this.repository.getCustom(interaction.guildId, reference);
      if (!custom) throw new UserError("Custom not found.");
      await interaction.editReply({
        content: `End **${custom.name}** and permanently delete its temporary channels?`,
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`sc:endconfirm:${custom.id}`)
              .setLabel("Confirm End")
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(`sc:cancel:${custom.id}`)
              .setLabel("Cancel")
              .setStyle(ButtonStyle.Secondary),
          ),
        ],
      });
    }
  }

  private async handleTeam(
    interaction: ChatInputCommandInteraction<"cached">,
    actor: Actor,
    subcommand: string,
  ): Promise<void> {
    const reference = this.resolveReference(interaction);
    if (subcommand === "create") {
      const leader = interaction.options.getUser("leader");
      if (leader) this.rejectBot(leader.bot);
      const ordinal = await this.sessions.addTeam(
        actor,
        reference,
        interaction.options.getString("name") ?? undefined,
        leader?.id,
      );
      await interaction.editReply(`Created Team ${ordinal}.`);
      return;
    }
    const ordinal = interaction.options.getInteger("team", true);
    if (subcommand === "delete") {
      await this.sessions.removeTeam(actor, reference, ordinal);
      await interaction.editReply(`Removed Team ${ordinal}.`);
    } else if (subcommand === "leader") {
      const user = interaction.options.getUser("user", true);
      this.rejectBot(user.bot);
      await this.sessions.assignLeader(actor, reference, ordinal, user.id);
      await interaction.editReply(`Assigned <@${user.id}> to Team ${ordinal}.`);
    } else if (subcommand === "rename") {
      await this.sessions.renameTeam(
        actor,
        reference,
        ordinal,
        interaction.options.getString("name", true),
      );
      await interaction.editReply(`Team ${ordinal} renamed.`);
    } else if (subcommand === "add") {
      const user = interaction.options.getUser("user", true);
      this.rejectBot(user.bot);
      await this.sessions.addMember(actor, reference, ordinal, user.id);
      await interaction.editReply(`Added <@${user.id}> to Team ${ordinal}.`);
    } else if (subcommand === "remove") {
      const user = interaction.options.getUser("user", true);
      await this.sessions.removeMember(actor, reference, ordinal, user.id);
      await interaction.editReply(`Removed <@${user.id}> from Team ${ordinal}.`);
    } else if (subcommand === "spectators") {
      const mode = interaction.options.getString("mode", true) as SpectatorMode;
      await this.sessions.setSpectators(actor, reference, ordinal, mode);
      await interaction.editReply(
        `Team ${ordinal} spectator mode set to **${mode}**.`,
      );
    }
  }

  private async handleDraft(
    interaction: ChatInputCommandInteraction<"cached">,
    actor: Actor,
    subcommand: string,
  ): Promise<void> {
    const reference = this.resolveReference(interaction);
    if (subcommand === "start") {
      await this.sessions.startDraft(actor, reference);
      await interaction.editReply("Randomized snake draft started.");
    } else if (subcommand === "pick") {
      const user = interaction.options.getUser("user", true);
      this.rejectBot(user.bot);
      await this.sessions.draftPick(actor, reference, user.id);
      await interaction.editReply(`Picked <@${user.id}>.`);
    } else if (subcommand === "pass") {
      await this.sessions.draftPass(actor, reference);
      await interaction.editReply("Turn passed.");
    } else if (subcommand === "undo") {
      await this.sessions.undoDraft(actor, reference);
      await interaction.editReply("Last draft action undone.");
    } else if (subcommand === "finish") {
      await this.sessions.finishDraft(actor, reference);
      await interaction.editReply("Draft finished; roster editing is unlocked.");
    }
  }

  private async handleButton(
    interaction: ButtonInteraction<"cached">,
  ): Promise<void> {
    const [namespace, action, customId] = interaction.customId.split(":");
    if (namespace !== "sc" || !action || !customId) return;
    const actor = this.actor(interaction);
    if (action === "cancel") {
      await interaction.update({ content: "Cancelled.", components: [] });
      return;
    }
    if (action === "end") {
      await interaction.reply({
        content: "End this custom and delete all temporary channels?",
        flags: MessageFlags.Ephemeral,
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`sc:endconfirm:${customId}`)
              .setLabel("Confirm End")
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(`sc:cancel:${customId}`)
              .setLabel("Cancel")
              .setStyle(ButtonStyle.Secondary),
          ),
        ],
      });
      return;
    }
    if (action === "endconfirm") {
      await interaction.deferUpdate();
      await this.sessions.end(actor, customId);
      return;
    }
    if (action === "rename") {
      const modal = new ModalBuilder()
        .setCustomId(`sc:renamemodal:${customId}`)
        .setTitle("Rename a team")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("team")
              .setLabel("Team number")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(2),
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("name")
              .setLabel("New team name")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(64),
          ),
        );
      await interaction.showModal(modal);
      return;
    }
    if (action === "assignleader") {
      await this.replyWithTeamSelect(
        interaction,
        customId,
        "leaderteam",
        "Choose the team whose leader should be assigned:",
      );
      return;
    }
    if (action === "removeteam") {
      await this.replyWithTeamSelect(
        interaction,
        customId,
        "deleteteam",
        "Choose the team to remove:",
      );
      return;
    }
    if (["add", "remove", "pick"].includes(action)) {
      let ordinal = 0;
      if (action !== "pick") {
        const team = this.sessions.findLeaderTeam(
          interaction.guildId,
          customId,
          interaction.user.id,
        );
        if (!team) {
          await this.replyWithTeamSelect(
            interaction,
            customId,
            action === "add" ? "addteam" : "removeteam",
            `Choose the team to ${action === "add" ? "add a player to" : "remove a player from"}:`,
          );
          return;
        }
        ordinal = team.ordinal;
      }
      const select = new UserSelectMenuBuilder()
        .setCustomId(`sc:${action}select:${customId}:${ordinal}`)
        .setPlaceholder(action === "remove" ? "Select player to remove" : "Select a player")
        .setMinValues(1)
        .setMaxValues(1);
      await interaction.reply({
        content: "Choose a server member:",
        flags: MessageFlags.Ephemeral,
        components: [
          new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(select),
        ],
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (action === "pass") {
      await this.sessions.draftPass(actor, customId);
      await interaction.editReply("Turn passed.");
    } else if (action === "finish") {
      await this.sessions.finishDraft(actor, customId);
      await interaction.editReply("Draft finished.");
    } else if (action === "customstart") {
      const summary = await this.sessions.startCustom(actor, customId);
      await interaction.editReply(
        `Custom started: moved **${summary.moved}**, disconnected/not in voice **${summary.disconnected}**, failed **${summary.failed}**.`,
      );
    } else if (action === "createteam") {
      const ordinal = await this.sessions.addTeam(actor, customId);
      await interaction.editReply(`Created Team ${ordinal}.`);
    } else if (action === "start") {
      await this.sessions.startDraft(actor, customId);
      await interaction.editReply("Randomized snake draft started.");
    } else if (action === "undo") {
      await this.sessions.undoDraft(actor, customId);
      await interaction.editReply("Last draft action undone.");
    } else if (action === "repair") {
      await this.sessions.repair(actor, customId);
      await interaction.editReply("Custom resources reconciled.");
    } else if (action === "spectators") {
      const team = this.sessions.findLeaderTeam(
        interaction.guildId,
        customId,
        interaction.user.id,
      );
      if (!team) {
        const aggregate = this.repository.getAggregate(
          interaction.guildId,
          customId,
        );
        if (!aggregate) throw new UserError("Custom not found.");
        const select = this.buildTeamSelect(
          aggregate.teams,
          `sc:specteam:${customId}`,
        );
        await interaction.editReply({
          content: "Choose the team whose spectator mode should be changed:",
          components: [
            new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
          ],
        });
        return;
      }
      const next: Record<SpectatorMode, SpectatorMode> = {
        off: "silent",
        silent: "speak",
        speak: "off",
      };
      await this.sessions.setSpectators(
        actor,
        customId,
        team.ordinal,
        next[team.spectatorMode],
      );
      await interaction.editReply(
        `Spectator mode set to **${next[team.spectatorMode]}**.`,
      );
    }
  }

  private async handleUserSelect(
    interaction:
      | UserSelectMenuInteraction<"cached">
      | StringSelectMenuInteraction<"cached">,
  ): Promise<void> {
    if (interaction.isStringSelectMenu()) {
      await this.handleTeamSelect(interaction);
      return;
    }
    const [namespace, action, customId, ordinalText] =
      interaction.customId.split(":");
    if (namespace !== "sc" || !action || !customId) return;
    await interaction.deferUpdate();
    const actor = this.actor(interaction);
    const user = interaction.users.first();
    if (!user) throw new UserError("No member was selected.");
    this.rejectBot(user.bot);
    const ordinal = Number(ordinalText);
    if (action === "addselect") {
      await this.sessions.addMember(actor, customId, ordinal, user.id);
    } else if (action === "removeselect") {
      await this.sessions.removeMember(actor, customId, ordinal, user.id);
    } else if (action === "pickselect") {
      await this.sessions.draftPick(actor, customId, user.id);
    } else if (action === "leaderselect") {
      await this.sessions.assignLeader(actor, customId, ordinal, user.id);
    }
    await interaction.editReply({ content: "Team updated.", components: [] });
  }

  private async handleTeamSelect(
    interaction: StringSelectMenuInteraction<"cached">,
  ): Promise<void> {
    const [namespace, action, customId] = interaction.customId.split(":");
    if (namespace !== "sc" || !action || !customId) return;
    const ordinal = Number(interaction.values[0]);
    if (!Number.isInteger(ordinal)) throw new UserError("Invalid team selection.");
    if (action === "specteam") {
      await interaction.deferUpdate();
      const aggregate = this.repository.getAggregate(
        interaction.guildId,
        customId,
      );
      const team = aggregate?.teams.find(
        (candidate) => candidate.ordinal === ordinal,
      );
      if (!team) throw new UserError("Team not found.");
      const next: Record<SpectatorMode, SpectatorMode> = {
        off: "silent",
        silent: "speak",
        speak: "off",
      };
      await this.sessions.setSpectators(
        this.actor(interaction),
        customId,
        ordinal,
        next[team.spectatorMode],
      );
      await interaction.editReply({
        content: `Spectator mode set to **${next[team.spectatorMode]}**.`,
        components: [],
      });
      return;
    }
    if (action === "deleteteam") {
      await interaction.deferUpdate();
      await this.sessions.removeTeam(
        this.actor(interaction),
        customId,
        ordinal,
      );
      await interaction.editReply({
        content: `Removed Team ${ordinal}.`,
        components: [],
      });
      return;
    }
    const selectAction: Record<string, string> = {
      leaderteam: "leaderselect",
      addteam: "addselect",
      removeteam: "removeselect",
    };
    const nextAction = selectAction[action];
    if (!nextAction) return;
    const userSelect = new UserSelectMenuBuilder()
      .setCustomId(`sc:${nextAction}:${customId}:${ordinal}`)
      .setPlaceholder("Select a server member")
      .setMinValues(1)
      .setMaxValues(1);
    await interaction.update({
      content: "Choose a server member:",
      components: [
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(userSelect),
      ],
    });
  }

  private async handleModal(
    interaction: ModalSubmitInteraction<"cached">,
  ): Promise<void> {
    const [namespace, action, customId] = interaction.customId.split(":");
    if (namespace !== "sc" || action !== "renamemodal" || !customId) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ordinal = Number(interaction.fields.getTextInputValue("team"));
    if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 10) {
      throw new UserError("Team number must be between 1 and 10.");
    }
    await this.sessions.renameTeam(
      this.actor(interaction),
      customId,
      ordinal,
      interaction.fields.getTextInputValue("name"),
    );
    await interaction.editReply(`Team ${ordinal} renamed.`);
  }

  private async handleAutocomplete(
    interaction: import("discord.js").AutocompleteInteraction<"cached">,
  ): Promise<void> {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== "custom") {
      await interaction.respond([]);
      return;
    }
    if (!this.repository.getGuildConfig(interaction.guildId)?.voiceLobbyChannelId) {
      await interaction.respond([]);
      return;
    }
    const query = String(focused.value).normalize("NFKC").toLocaleLowerCase();
    const choices = this.repository
      .listCustoms(interaction.guildId)
      .filter(
        (custom) =>
          custom.status !== "ending" &&
          custom.name.normalize("NFKC").toLocaleLowerCase().includes(query),
      )
      .slice(0, 25)
      .map((custom) => ({
        name: `${custom.name} · ${custom.status}`.slice(0, 100),
        value: custom.id,
      }));
    await interaction.respond(choices);
  }

  private actor(interaction: Interaction<"cached">): Actor {
    const roles = [...interaction.member.roles.cache.keys()];
    return {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      roleIds: roles,
      isOwner: interaction.guild.ownerId === interaction.user.id,
      isAdministrator:
        interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ??
        false,
    };
  }

  private resolveReference(
    interaction: ChatInputCommandInteraction<"cached">,
  ): string {
    const supplied = interaction.options.getString("custom");
    if (supplied) return supplied;
    const custom = this.repository.getCustomByThread(
      interaction.guildId,
      interaction.channelId,
    );
    if (custom) return custom.id;
    throw new UserError(
      "Select a custom or run this command in its control thread.",
    );
  }

  private rejectBot(isBot: boolean): void {
    if (isBot) throw new UserError("Bots cannot be team members.");
  }

  private async replyWithTeamSelect(
    interaction: ButtonInteraction<"cached">,
    customId: string,
    action: string,
    content: string,
  ): Promise<void> {
    const aggregate = this.repository.getAggregate(
      interaction.guildId,
      customId,
    );
    if (!aggregate) throw new UserError("Custom not found.");
    const select = this.buildTeamSelect(
      aggregate.teams,
      `sc:${action}:${customId}`,
    );
    await interaction.reply({
      content,
      flags: MessageFlags.Ephemeral,
      components: [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      ],
    });
  }

  private buildTeamSelect(
    teams: Array<{ ordinal: number; name: string }>,
    customId: string,
  ): StringSelectMenuBuilder {
    return new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder("Select a team")
      .addOptions(
        teams.map((team) => ({
          label: `T${String(team.ordinal).padStart(2, "0")} • ${team.name}`.slice(
            0,
            100,
          ),
          value: String(team.ordinal),
        })),
      );
  }

  private async respondWithError(
    interaction: Interaction,
    error: unknown,
  ): Promise<void> {
    const message =
      error instanceof UserError
        ? error.message
        : "SkyCustoms could not complete that action.";
    if (!(error instanceof UserError)) {
      this.logger.error({ error }, "Interaction failed");
    }
    if (!interaction.isRepliable()) return;
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: message, components: [] });
      } else {
        await interaction.reply({
          content: message,
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (responseError) {
      this.logger.warn({ responseError }, "Could not send interaction error");
    }
  }
}
