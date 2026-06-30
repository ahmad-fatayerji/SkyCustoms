import { describe, expect, it } from "vitest";
import { currentDraftTeamId } from "../src/domain/draft.js";
import {
  normalizeTeamName,
  renderTeamChannelName,
} from "../src/domain/naming.js";
import type { DraftAction } from "../src/domain/types.js";

function actions(count: number): DraftAction[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    customId: "custom",
    sequence: index,
    teamId: 1,
    actorId: "user",
    actionType: "pass",
    memberId: null,
    createdAt: 0,
  }));
}

describe("draft order", () => {
  it("uses a snake sequence", () => {
    const order = [10, 20, 30];
    expect(
      Array.from({ length: 9 }, (_, index) =>
        currentDraftTeamId(order, actions(index)),
      ),
    ).toEqual([10, 20, 30, 30, 20, 10, 10, 20, 30]);
  });
});

describe("team naming", () => {
  it("normalizes and renders channel names", () => {
    expect(
      renderTeamChannelName("CS2", 2, normalizeTeamName("  Rush   B  ")),
    ).toBe("CS2 • T02 • Rush B");
  });

  it("rejects the reserved separator", () => {
    expect(() => normalizeTeamName("A • B")).toThrow(/reserved/);
  });
});
