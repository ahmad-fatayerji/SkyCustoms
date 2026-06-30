import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { currentDraftTeamId } from "../domain/draft.js";
import type { CustomAggregate } from "../domain/types.js";

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

export function buildPanel(aggregate: CustomAggregate) {
  const { custom, teams, draftActions } = aggregate;
  const embed = new EmbedBuilder()
    .setColor(custom.status === "ending" ? 0x992d22 : 0x3498db)
    .setTitle(custom.name)
    .setDescription(
      [
        `Mode: **${custom.mode === "draft" ? "Managed draft" : "Direct assignment"}**`,
        `Status: **${custom.status}**`,
        `Creator: <@${custom.creatorId}>`,
        `Started: ${custom.startedAt ? `<t:${Math.floor(custom.startedAt / 1000)}:R>` : "**not yet**"}`,
        `Cleanup: ${custom.setupTimeoutMinutes}m setup / ${custom.emptyTimeoutMinutes}m empty`,
      ].join("\n"),
    )
    .setFooter({ text: "SkyCustoms" })
    .setTimestamp(custom.updatedAt);

  for (const team of teams) {
    const members =
      team.members.length === 0
        ? "No roster members"
        : team.members.map((member) => `<@${member.userId}>`).join(", ");
    embed.addFields({
      name: `T${String(team.ordinal).padStart(2, "0")} • ${team.name}`,
      value: truncate(
        [
          `Leader: ${team.leaderId ? `<@${team.leaderId}>` : "Unassigned"}`,
          `Spectators: **${team.spectatorMode}**`,
          `Roster: ${members}`,
        ].join("\n"),
        420,
      ),
      inline: teams.length > 2,
    });
  }

  if (custom.status === "drafting" && custom.draftOrder) {
    const nextId = currentDraftTeamId(custom.draftOrder, draftActions);
    const nextTeam = teams.find((team) => team.id === nextId);
    embed.addFields({
      name: "Current draft turn",
      value: nextTeam
        ? `T${String(nextTeam.ordinal).padStart(2, "0")} · <@${nextTeam.leaderId}>`
        : "Unknown",
    });
  }

  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  const rosterEditingAvailable =
    custom.mode === "direct" || custom.status === "active";
  const teamButtons = [
    new ButtonBuilder()
      .setCustomId(`sc:rename:${custom.id}`)
      .setLabel("Rename Team")
      .setStyle(ButtonStyle.Secondary),
    ...(rosterEditingAvailable
      ? [
          new ButtonBuilder()
            .setCustomId(`sc:add:${custom.id}`)
            .setLabel("Add Player")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`sc:remove:${custom.id}`)
            .setLabel("Remove Player")
            .setStyle(ButtonStyle.Secondary),
        ]
      : []),
    new ButtonBuilder()
      .setCustomId(`sc:spectators:${custom.id}`)
      .setLabel("Spectators")
      .setStyle(ButtonStyle.Secondary),
  ];
  rows.push(
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      teamButtons,
    ),
  );

  if (custom.mode === "draft" && custom.status === "drafting") {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`sc:pick:${custom.id}`)
          .setLabel("Pick Player")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`sc:pass:${custom.id}`)
          .setLabel("Pass")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`sc:undo:${custom.id}`)
          .setLabel("Undo")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(draftActions.length === 0),
        new ButtonBuilder()
          .setCustomId(`sc:finish:${custom.id}`)
          .setLabel("Finish Draft")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`sc:end:${custom.id}`)
          .setLabel("End Custom")
          .setStyle(ButtonStyle.Danger),
      ),
    );
  } else {
    const hostButtons = [
      new ButtonBuilder()
        .setCustomId(`sc:assignleader:${custom.id}`)
        .setLabel("Assign Leader")
        .setStyle(ButtonStyle.Secondary),
      ...(teams.length < 10
        ? [
            new ButtonBuilder()
              .setCustomId(`sc:createteam:${custom.id}`)
              .setLabel("Add Team")
              .setStyle(ButtonStyle.Secondary),
          ]
        : []),
      ...(teams.length > 2
        ? [
            new ButtonBuilder()
              .setCustomId(`sc:removeteam:${custom.id}`)
              .setLabel("Remove Team")
              .setStyle(ButtonStyle.Secondary),
          ]
        : []),
      custom.mode === "draft" && custom.status === "setup"
        ? new ButtonBuilder()
            .setCustomId(`sc:start:${custom.id}`)
            .setLabel("Start Draft")
            .setStyle(ButtonStyle.Primary)
        : new ButtonBuilder()
            .setCustomId(`sc:customstart:${custom.id}`)
            .setLabel("Start Custom")
            .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`sc:end:${custom.id}`)
        .setLabel("End Custom")
        .setStyle(ButtonStyle.Danger),
    ];
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        hostButtons,
      ),
    );
  }

  const disabled = custom.status === "ending";
  for (const row of rows) {
    for (const component of row.components) component.setDisabled(disabled);
  }

  return {
    embeds: [embed],
    components: rows,
  };
}
