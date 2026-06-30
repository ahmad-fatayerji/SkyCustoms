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

  const rows = [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`sc:manage:${custom.id}`)
        .setLabel("Manage")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(custom.status === "ending"),
    ),
  ];

  return {
    embeds: [embed],
    components: rows,
  };
}
