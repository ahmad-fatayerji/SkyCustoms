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
import {
  renderCategoryName,
  renderTeamChannelName,
  validateCategoryFormat,
  validateChannelFormat,
} from "../domain/naming.js";
import type { CustomMode, SpectatorMode, Team } from "../domain/types.js";
import type { Logger } from "../logger.js";
import { commandDefinitions } from "./commands.js";
import { buildManageComponents } from "./manage.js";

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
      const select = new UserSelectMenuBuilder()
        .setCustomId(`sc:setuphosts:${action}`)
        .setPlaceholder(
          action === "add"
            ? "Select users to add as hosts"
            : "Select host users to remove",
        )
        .setMinValues(1)
        .setMaxValues(25);
      await interaction.editReply({
        content: `Select up to 25 users to ${action} ${action === "add" ? "as SkyCustoms hosts" : "from SkyCustoms hosts"}.`,
        components: [
          new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(select),
        ],
      });
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
    if (subcommand === "naming") {
      const categoryFormat = validateCategoryFormat(
        interaction.options.getString("category-format", true),
      );
      const channelFormat = validateChannelFormat(
        interaction.options.getString("channel-format", true),
      );
      const categoryPreview = renderCategoryName(
        categoryFormat,
        "Example Custom",
      );
      const channelPreview = renderTeamChannelName(
        channelFormat,
        "Example Custom",
        1,
        "Example Team",
      );
      const activeCustoms = this.repository
        .listCustoms(interaction.guildId)
        .filter((custom) => custom.status !== "ending");
      for (const custom of activeCustoms) {
        renderCategoryName(categoryFormat, custom.name);
        const aggregate = this.repository.getAggregateById(custom.id);
        for (const team of aggregate?.teams ?? []) {
          renderTeamChannelName(
            channelFormat,
            custom.name,
            team.ordinal,
            team.name,
          );
        }
      }
      this.repository.setNamingFormats(
        interaction.guildId,
        categoryFormat,
        channelFormat,
      );
      const repairs = await Promise.allSettled(
        activeCustoms.map((custom) => this.sessions.repair(actor, custom.id)),
      );
      const failed = repairs.filter((result) => result.status === "rejected");
      await interaction.editReply(
        [
          "Naming formats updated.",
          `Category preview: **${categoryPreview}**`,
          `Channel preview: **${channelPreview}**`,
          ...(failed.length
            ? [
                `${failed.length} active custom(s) could not be renamed; use \`/custom repair\` after checking their name lengths.`,
              ]
            : []),
        ].join("\n"),
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
        `Category format: \`${config?.categoryFormat ?? "{custom}"}\``,
        `Channel format: \`${config?.channelFormat ?? "T{number:02} • {team}"}\``,
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
    } else if (subcommand === "rename") {
      await this.sessions.renameCustom(
        actor,
        reference,
        interaction.options.getString("name", true),
      );
      await interaction.editReply("Custom renamed.");
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
    if (subcommand === "create") {
      const reference = this.resolveReference(interaction);
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
    const target = this.resolveTeamTarget(
      interaction.guildId,
      interaction.options.getString("team", true),
    );
    const { reference, ordinal } = target;
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
      await interaction.editReply(
        this.buildBulkMemberSelect(reference, ordinal, "add"),
      );
    } else if (subcommand === "remove") {
      await interaction.editReply(
        this.buildBulkMemberSelect(reference, ordinal, "remove"),
      );
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
    if (action === "manage") {
      const aggregate = this.repository.getAggregate(
        interaction.guildId,
        customId,
      );
      if (!aggregate) throw new UserError("Custom not found.");
      const components = buildManageComponents(actor, aggregate);
      if (components.length === 0) {
        throw new UserError("You do not manage this custom or one of its teams.");
      }
      await interaction.reply({
        content: `Manage **${aggregate.custom.name}**:`,
        flags: MessageFlags.Ephemeral,
        components,
      });
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
    if (action === "renamecustom") {
      const modal = new ModalBuilder()
        .setCustomId(`sc:renamecustommodal:${customId}`)
        .setTitle("Rename custom")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("name")
              .setLabel("New custom name")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(48),
          ),
        );
      await interaction.showModal(modal);
      return;
    }
    if (action === "rename") {
      const team = this.leaderTeamForScopedAction(
        actor,
        interaction.guildId,
        customId,
      );
      if (team) {
        await interaction.showModal(
          this.buildRenameTeamModal(customId, team.ordinal),
        );
      } else {
        await this.replyWithTeamSelect(
          interaction,
          customId,
          "renameteam",
          "Choose the team to rename:",
        );
      }
      return;
    }
    if (action === "timeoutmodal") {
      const aggregate = this.repository.getAggregate(
        interaction.guildId,
        customId,
      );
      if (!aggregate) throw new UserError("Custom not found.");
      const modal = new ModalBuilder()
        .setCustomId(`sc:timeoutsubmit:${customId}`)
        .setTitle("Inactivity timeouts")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("setup")
              .setLabel("Setup timeout in minutes")
              .setStyle(TextInputStyle.Short)
              .setValue(String(aggregate.custom.setupTimeoutMinutes))
              .setRequired(true),
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("empty")
              .setLabel("Empty timeout in minutes")
              .setStyle(TextInputStyle.Short)
              .setValue(String(aggregate.custom.emptyTimeoutMinutes))
              .setRequired(true),
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
        const team = this.leaderTeamForScopedAction(
          actor,
          interaction.guildId,
          customId,
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
        .setMaxValues(action === "pick" ? 1 : 25);
      await interaction.reply({
        content:
          action === "pick"
            ? "Choose a server member:"
            : `Choose up to 25 members to ${action}:`,
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
      const team = this.leaderTeamForScopedAction(
        actor,
        interaction.guildId,
        customId,
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
      const select = this.buildSpectatorModeSelect(
        customId,
        team.ordinal,
        team.spectatorMode,
      );
      await interaction.editReply({
        content: `Choose spectator access for **T${String(team.ordinal).padStart(2, "0")} • ${team.name}**:`,
        components: [
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
        ],
      });
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
    const actor = this.actor(interaction);
    if (action === "leaderprompt") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const user = interaction.users.first();
      if (!user) throw new UserError("No member was selected.");
      this.rejectBot(user.bot);
      const ordinal = Number(ordinalText);
      await this.sessions.assignLeader(actor, customId, ordinal, user.id);
      await interaction.editReply(
        `Assigned <@${user.id}> as the team leader.`,
      );
      return;
    }
    await interaction.deferUpdate();
    if (action === "setuphosts") {
      if (!actor.isOwner) {
        throw new UserError(
          "Only the Discord server owner can configure SkyCustoms.",
        );
      }
      if (
        !this.repository.getGuildConfig(interaction.guildId)
          ?.voiceLobbyChannelId
      ) {
        throw new UserError(
          "Configure `/setup lobby` before assigning hosts.",
        );
      }
      if (customId !== "add" && customId !== "remove") {
        throw new UserError("Invalid host action.");
      }
      const users = [...interaction.users.values()];
      if (users.length === 0) {
        throw new UserError("No members were selected.");
      }
      if (users.some((user) => user.bot)) {
        throw new UserError("Bots cannot be assigned as SkyCustoms hosts.");
      }
      for (const user of users) {
        if (customId === "add") {
          this.repository.addHostGrant(interaction.guildId, "user", user.id);
        } else {
          this.repository.removeHostGrant(
            interaction.guildId,
            "user",
            user.id,
          );
        }
      }
      await interaction.editReply({
        content: `${customId === "add" ? "Added" : "Removed"} ${users.length} SkyCustoms host user${users.length === 1 ? "" : "s"}.`,
        components: [],
      });
      return;
    }
    if (action === "addselect" || action === "removeselect") {
      const users = [...interaction.users.values()];
      if (users.length === 0) throw new UserError("No members were selected.");
      if (users.some((user) => user.bot)) {
        throw new UserError("Bots cannot be team members.");
      }
      const ordinal = Number(ordinalText);
      const result = await this.sessions.updateMembers(
        actor,
        customId,
        ordinal,
        users.map((user) => user.id),
        action === "addselect" ? "add" : "remove",
      );
      await interaction.editReply({
        content: `${action === "addselect" ? "Added" : "Removed"} **${result.changed}** member${result.changed === 1 ? "" : "s"}${result.unchanged ? `; **${result.unchanged}** already had the requested state` : ""}.`,
        components: [],
      });
      return;
    }
    const user = interaction.users.first();
    if (!user) throw new UserError("No member was selected.");
    this.rejectBot(user.bot);
    const ordinal = Number(ordinalText);
    if (action === "pickselect") {
      await this.sessions.draftPick(actor, customId, user.id);
    } else if (action === "leaderselect") {
      await this.sessions.assignLeader(actor, customId, ordinal, user.id);
    }
    await interaction.editReply({ content: "Team updated.", components: [] });
  }

  private async handleTeamSelect(
    interaction: StringSelectMenuInteraction<"cached">,
  ): Promise<void> {
    const [namespace, action, customId, ordinalText] =
      interaction.customId.split(":");
    if (namespace !== "sc" || !action || !customId) return;
    if (action === "spectatormode") {
      const ordinal = Number(ordinalText);
      const mode = interaction.values[0] as SpectatorMode | undefined;
      if (
        !Number.isInteger(ordinal) ||
        !mode ||
        !["off", "silent", "speak"].includes(mode)
      ) {
        throw new UserError("Invalid spectator selection.");
      }
      await interaction.deferUpdate();
      await this.sessions.setSpectators(
        this.actor(interaction),
        customId,
        ordinal,
        mode,
      );
      await interaction.editReply({
        content: `Spectator mode set to **${mode}**.`,
        components: [],
      });
      return;
    }
    const ordinal = Number(interaction.values[0]);
    if (!Number.isInteger(ordinal)) throw new UserError("Invalid team selection.");
    if (action === "renameteam") {
      await interaction.showModal(
        this.buildRenameTeamModal(customId, ordinal),
      );
      return;
    }
    if (action === "specteam") {
      const aggregate = this.repository.getAggregate(
        interaction.guildId,
        customId,
      );
      const team = aggregate?.teams.find(
        (candidate) => candidate.ordinal === ordinal,
      );
      if (!team) throw new UserError("Team not found.");
      const select = this.buildSpectatorModeSelect(
        customId,
        ordinal,
        team.spectatorMode,
      );
      await interaction.update({
        content: `Choose spectator access for **T${String(ordinal).padStart(2, "0")} • ${team.name}**:`,
        components: [
          new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
        ],
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
      .setMaxValues(
        action === "addteam" || action === "removeteam" ? 25 : 1,
      );
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
    const [namespace, action, customId, ordinalText] =
      interaction.customId.split(":");
    if (namespace !== "sc" || !action || !customId) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (action === "renamecustommodal") {
      await this.sessions.renameCustom(
        this.actor(interaction),
        customId,
        interaction.fields.getTextInputValue("name"),
      );
      await interaction.editReply("Custom renamed.");
      return;
    }
    if (action === "renameteammodal") {
      const ordinal = Number(ordinalText);
      if (!Number.isInteger(ordinal)) throw new UserError("Invalid team.");
      await this.sessions.renameTeam(
        this.actor(interaction),
        customId,
        ordinal,
        interaction.fields.getTextInputValue("name"),
      );
      await interaction.editReply(`Team ${ordinal} renamed.`);
      return;
    }
    if (action === "timeoutsubmit") {
      const setupMinutes = Number(
        interaction.fields.getTextInputValue("setup"),
      );
      const emptyMinutes = Number(
        interaction.fields.getTextInputValue("empty"),
      );
      if (
        !Number.isInteger(setupMinutes) ||
        !Number.isInteger(emptyMinutes)
      ) {
        throw new UserError("Timeouts must be whole numbers of minutes.");
      }
      await this.sessions.setTimeouts(
        this.actor(interaction),
        customId,
        setupMinutes,
        emptyMinutes,
      );
      await interaction.editReply("Custom inactivity timeouts updated.");
    }
  }

  private async handleAutocomplete(
    interaction: import("discord.js").AutocompleteInteraction<"cached">,
  ): Promise<void> {
    const focused = interaction.options.getFocused(true);
    if (!this.repository.getGuildConfig(interaction.guildId)?.voiceLobbyChannelId) {
      await interaction.respond([]);
      return;
    }
    const query = String(focused.value).normalize("NFKC").toLocaleLowerCase();
    if (focused.name === "team") {
      const actor = this.actor(interaction);
      const subcommand = interaction.options.getSubcommand();
      const leaderActions = new Set([
        "rename",
        "add",
        "remove",
        "spectators",
      ]);
      const choices = this.repository
        .listCustoms(interaction.guildId)
        .filter((custom) => custom.status !== "ending")
        .flatMap((custom) => {
          const aggregate = this.repository.getAggregateById(custom.id);
          if (!aggregate) return [];
          const override =
            custom.creatorId === actor.userId ||
            actor.isOwner ||
            actor.isAdministrator;
          return aggregate.teams
            .filter(
              (team) =>
                override ||
                (leaderActions.has(subcommand) &&
                  team.leaderId === actor.userId),
            )
            .map((team) => ({
              name: `${custom.name} — T${String(team.ordinal).padStart(2, "0")} • ${team.name}`.slice(
                0,
                100,
              ),
              value: `${custom.id}:${team.id}`,
            }));
        })
        .filter((choice) =>
          choice.name.normalize("NFKC").toLocaleLowerCase().includes(query),
        )
        .slice(0, 25);
      await interaction.respond(choices);
      return;
    }
    if (focused.name !== "custom") {
      await interaction.respond([]);
      return;
    }
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

  private resolveTeamTarget(
    guildId: string,
    value: string,
  ): { reference: string; ordinal: number } {
    const [customId, teamIdText] = value.split(":");
    const teamId = Number(teamIdText);
    if (!customId || !Number.isInteger(teamId)) {
      throw new UserError("Select a team from the autocomplete list.");
    }
    const aggregate = this.repository.getAggregate(guildId, customId);
    const team = aggregate?.teams.find((candidate) => candidate.id === teamId);
    if (!aggregate || !team) {
      throw new UserError("That team is no longer available.");
    }
    return { reference: aggregate.custom.id, ordinal: team.ordinal };
  }

  private buildBulkMemberSelect(
    customId: string,
    ordinal: number,
    action: "add" | "remove",
  ) {
    return {
      content: `Choose up to 25 members to ${action}:`,
      components: [
        new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
          new UserSelectMenuBuilder()
            .setCustomId(`sc:${action}select:${customId}:${ordinal}`)
            .setPlaceholder(
              action === "add"
                ? "Select players to add"
                : "Select players to remove",
            )
            .setMinValues(1)
            .setMaxValues(25),
        ),
      ],
    };
  }

  private buildRenameTeamModal(
    customId: string,
    ordinal: number,
  ): ModalBuilder {
    return new ModalBuilder()
      .setCustomId(`sc:renameteammodal:${customId}:${ordinal}`)
      .setTitle("Rename team")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("name")
            .setLabel("New team name")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(64),
        ),
      );
  }

  private leaderTeamForScopedAction(
    actor: Actor,
    guildId: string,
    customId: string,
  ): Team | null {
    const aggregate = this.repository.getAggregate(guildId, customId);
    if (!aggregate) throw new UserError("Custom not found.");
    if (
      actor.userId === aggregate.custom.creatorId ||
      actor.isOwner ||
      actor.isAdministrator
    ) {
      return null;
    }
    return (
      aggregate.teams.find((team) => team.leaderId === actor.userId) ?? null
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

  private buildSpectatorModeSelect(
    customId: string,
    ordinal: number,
    currentMode: SpectatorMode,
  ): StringSelectMenuBuilder {
    return new StringSelectMenuBuilder()
      .setCustomId(`sc:spectatormode:${customId}:${ordinal}`)
      .setPlaceholder("Select spectator access")
      .addOptions(
        {
          label: "Disabled",
          description: "Only the team roster and custom creator may connect",
          value: "off",
          default: currentMode === "off",
        },
        {
          label: "Silent",
          description: "Spectators may connect but cannot speak or stream",
          value: "silent",
          default: currentMode === "silent",
        },
        {
          label: "May Speak",
          description: "Spectators may connect and speak",
          value: "speak",
          default: currentMode === "speak",
        },
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
