import {
  ApplicationCommandOptionType,
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type SlashCommandStringOption,
} from "discord.js";

const customReference = {
  name: "custom",
  description: "Custom session (optional when used in its control thread)",
  type: ApplicationCommandOptionType.String,
  required: false,
} as const;

function addCustomReference(
  option: SlashCommandStringOption,
): SlashCommandStringOption {
  return option
    .setName(customReference.name)
    .setDescription(customReference.description)
    .setAutocomplete(true);
}

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure SkyCustoms for this Discord server")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((command) =>
      command
        .setName("lobby")
        .setDescription("Set the public control-thread lobby")
        .addChannelOption((option) =>
          option
            .setName("text-channel")
            .setDescription("Text channel for control threads")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        )
        .addChannelOption((option) =>
          option
            .setName("voice-channel")
            .setDescription("Voice channel players return to when a custom ends")
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(true),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName("host-user")
        .setDescription("Add or remove an individual host")
        .addStringOption((option) =>
          option
            .setName("action")
            .setDescription("Grant action")
            .setRequired(true)
            .addChoices(
              { name: "Add", value: "add" },
              { name: "Remove", value: "remove" },
            ),
        )
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("Host user")
            .setRequired(true),
        ),
    )
    .addSubcommand((command) =>
      command
        .setName("host-role")
        .setDescription("Add or remove a host role")
        .addStringOption((option) =>
          option
            .setName("action")
            .setDescription("Grant action")
            .setRequired(true)
            .addChoices(
              { name: "Add", value: "add" },
              { name: "Remove", value: "remove" },
            ),
        )
        .addRoleOption((option) =>
          option
            .setName("role")
            .setDescription("Host role")
            .setRequired(true),
        ),
    )
    .addSubcommand((command) =>
      command.setName("status").setDescription("Show server configuration"),
    ),
  new SlashCommandBuilder()
    .setName("custom")
    .setDescription("Create and manage custom-game sessions")
    .setDMPermission(false)
    .addSubcommand((command) =>
      command
        .setName("create")
        .setDescription("Create a custom")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Custom name")
            .setMaxLength(48)
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName("teams")
            .setDescription("Number of teams")
            .setMinValue(2)
            .setMaxValue(10)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("mode")
            .setDescription("Roster-building mode")
            .setRequired(true)
            .addChoices(
              { name: "Direct assignment", value: "direct" },
              { name: "Managed draft", value: "draft" },
            ),
        ),
    )
    .addSubcommand((command) =>
      command.setName("list").setDescription("List active customs"),
    )
    .addSubcommand((command) =>
      command
        .setName("start")
        .setDescription("Move connected players into their team channels")
        .addStringOption(addCustomReference),
    )
    .addSubcommand((command) =>
      command
        .setName("timeout")
        .setDescription("Change inactivity timeouts")
        .addIntegerOption((option) =>
          option
            .setName("setup-minutes")
            .setDescription("Unused setup timeout")
            .setMinValue(10)
            .setMaxValue(1440)
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName("empty-minutes")
            .setDescription("Empty voice-channel timeout")
            .setMinValue(10)
            .setMaxValue(1440)
            .setRequired(true),
        )
        .addStringOption(addCustomReference),
    )
    .addSubcommand((command) =>
      command
        .setName("repair")
        .setDescription("Recreate and reconcile Discord resources")
        .addStringOption(addCustomReference),
    )
    .addSubcommand((command) =>
      command
        .setName("end")
        .setDescription("End a custom and delete its resources")
        .addStringOption(addCustomReference),
    ),
  new SlashCommandBuilder()
    .setName("team")
    .setDescription("Manage custom teams")
    .setDMPermission(false)
    .addSubcommand((command) =>
      command
        .setName("create")
        .setDescription("Add another team to a custom")
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("Initial team name")
            .setMaxLength(64),
        )
        .addUserOption((option) =>
          option.setName("leader").setDescription("Initial team leader"),
        )
        .addStringOption(addCustomReference),
    )
    .addSubcommand((command) =>
      command
        .setName("delete")
        .setDescription("Remove a team and its channel")
        .addIntegerOption((option) =>
          option
            .setName("team")
            .setDescription("Team number")
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(true),
        )
        .addStringOption(addCustomReference),
    )
    .addSubcommand((command) =>
      command
        .setName("leader")
        .setDescription("Assign or replace a team leader")
        .addIntegerOption((option) =>
          option
            .setName("team")
            .setDescription("Team number")
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(true),
        )
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("New leader")
            .setRequired(true),
        )
        .addStringOption(addCustomReference),
    )
    .addSubcommand((command) =>
      command
        .setName("rename")
        .setDescription("Rename a team")
        .addIntegerOption((option) =>
          option
            .setName("team")
            .setDescription("Team number")
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("name")
            .setDescription("New team name")
            .setMaxLength(64)
            .setRequired(true),
        )
        .addStringOption(addCustomReference),
    )
    .addSubcommand((command) =>
      command
        .setName("add")
        .setDescription("Add a player")
        .addIntegerOption((option) =>
          option
            .setName("team")
            .setDescription("Team number")
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(true),
        )
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("Player")
            .setRequired(true),
        )
        .addStringOption(addCustomReference),
    )
    .addSubcommand((command) =>
      command
        .setName("remove")
        .setDescription("Remove a player")
        .addIntegerOption((option) =>
          option
            .setName("team")
            .setDescription("Team number")
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(true),
        )
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("Player")
            .setRequired(true),
        )
        .addStringOption(addCustomReference),
    )
    .addSubcommand((command) =>
      command
        .setName("spectators")
        .setDescription("Set spectator access")
        .addIntegerOption((option) =>
          option
            .setName("team")
            .setDescription("Team number")
            .setMinValue(1)
            .setMaxValue(10)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("mode")
            .setDescription("Spectator mode")
            .setRequired(true)
            .addChoices(
              { name: "Disabled", value: "off" },
              { name: "Silent", value: "silent" },
              { name: "May speak", value: "speak" },
            ),
        )
        .addStringOption(addCustomReference),
    ),
  new SlashCommandBuilder()
    .setName("draft")
    .setDescription("Manage a custom draft")
    .setDMPermission(false)
    .addSubcommand((command) =>
      command
        .setName("start")
        .setDescription("Start the randomized snake draft")
        .addStringOption(addCustomReference),
    )
    .addSubcommand((command) =>
      command
        .setName("pick")
        .setDescription("Pick a player on your turn")
        .addUserOption((option) =>
          option
            .setName("user")
            .setDescription("Player to pick")
            .setRequired(true),
        )
        .addStringOption(addCustomReference),
    )
    .addSubcommand((command) =>
      command
        .setName("pass")
        .setDescription("Pass your current turn")
        .addStringOption(addCustomReference),
    )
    .addSubcommand((command) =>
      command
        .setName("undo")
        .setDescription("Undo the last pick or pass")
        .addStringOption(addCustomReference),
    )
    .addSubcommand((command) =>
      command
        .setName("finish")
        .setDescription("Finish drafting and unlock roster editing")
        .addStringOption(addCustomReference),
    ),
].map((command) => command.toJSON());
