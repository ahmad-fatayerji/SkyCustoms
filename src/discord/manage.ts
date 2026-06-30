import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import type { Actor } from "../application/auth.js";
import { currentDraftTeamId } from "../domain/draft.js";
import type { CustomAggregate } from "../domain/types.js";

interface ManageAction {
  action: string;
  label: string;
  style?: ButtonStyle;
  disabled?: boolean;
}

export function buildManageComponents(
  actor: Actor,
  aggregate: CustomAggregate,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  if (aggregate.custom.status === "ending") return [];
  const override =
    actor.userId === aggregate.custom.creatorId ||
    actor.isOwner ||
    actor.isAdministrator;
  const leaderTeam = aggregate.teams.find(
    (team) => team.leaderId === actor.userId,
  );
  if (!override && !leaderTeam) return [];

  const actions: ManageAction[] = [];
  const add = (
    action: string,
    label: string,
    style = ButtonStyle.Secondary,
    disabled = false,
  ) => actions.push({ action, label, style, disabled });

  if (override) {
    add("renamecustom", "Rename Custom");
    add("rename", "Rename Team");
    if (aggregate.custom.status !== "drafting") {
      add("assignleader", "Change Leader");
      if (aggregate.teams.length < 10) add("createteam", "Add Team");
      if (aggregate.teams.length > 2) add("removeteam", "Remove Team");
    }
  } else {
    add("rename", "Rename Team");
  }

  const rosterEditingAvailable =
    aggregate.custom.mode === "direct" ||
    aggregate.custom.status === "active";
  if (rosterEditingAvailable) {
    add("add", "Add Players");
    add("remove", "Remove Players");
  }
  add("spectators", "Spectators");

  const leadersReady = aggregate.teams.every((team) => team.leaderId);
  if (override) {
    if (
      aggregate.custom.mode === "draft" &&
      aggregate.custom.status === "setup" &&
      leadersReady
    ) {
      add("start", "Start Draft", ButtonStyle.Primary);
    } else if (
      aggregate.custom.status === "drafting"
    ) {
      add(
        "undo",
        "Undo Draft Action",
        ButtonStyle.Secondary,
        aggregate.draftActions.length === 0,
      );
      add("finish", "Finish Draft", ButtonStyle.Success);
    } else if (
      aggregate.custom.startedAt === null &&
      leadersReady &&
      (aggregate.custom.mode === "direct" ||
        aggregate.custom.status === "active")
    ) {
      add("customstart", "Start Custom", ButtonStyle.Success);
    }
  }

  if (
    aggregate.custom.status === "drafting" &&
    aggregate.custom.draftOrder &&
    leaderTeam &&
    currentDraftTeamId(
      aggregate.custom.draftOrder,
      aggregate.draftActions,
    ) === leaderTeam.id
  ) {
    add("pick", "Pick Player", ButtonStyle.Primary);
    add("pass", "Pass");
  }

  if (override) {
    add("timeoutmodal", "Timeouts");
    add("repair", "Repair");
    add("end", "End Custom", ButtonStyle.Danger);
  }

  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  for (let index = 0; index < actions.length; index += 5) {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        actions.slice(index, index + 5).map((item) =>
          new ButtonBuilder()
            .setCustomId(`sc:${item.action}:${aggregate.custom.id}`)
            .setLabel(item.label)
            .setStyle(item.style ?? ButtonStyle.Secondary)
            .setDisabled(item.disabled ?? false),
        ),
      ),
    );
  }
  return rows;
}
