import { randomInt } from "node:crypto";
import type { DraftAction, Team } from "./types.js";
import { UserError } from "./errors.js";

export function shuffledTeamOrder(teams: Team[]): number[] {
  const order = teams.map((team) => team.id);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const target = randomInt(index + 1);
    [order[index], order[target]] = [order[target]!, order[index]!];
  }
  return order;
}

export function currentDraftTeamId(
  order: number[],
  actions: DraftAction[],
): number {
  if (order.length < 2) {
    throw new UserError("A draft requires at least two teams.");
  }
  const pickIndex = actions.length;
  const round = Math.floor(pickIndex / order.length);
  const position = pickIndex % order.length;
  const effectivePosition =
    round % 2 === 0 ? position : order.length - 1 - position;
  return order[effectivePosition]!;
}
