import { describe, expect, it } from "vitest";
import type { CustomAggregate, CustomStatus } from "../src/domain/types.js";
import { buildPanel } from "../src/discord/panel.js";

function aggregate(
  mode: "direct" | "draft",
  status: CustomStatus,
): CustomAggregate {
  return {
    custom: {
      id: "custom-id",
      shortId: "ABC123",
      guildId: "guild",
      creatorId: "creator",
      name: "CS2",
      mode,
      status,
      categoryId: null,
      threadId: "thread",
      starterMessageId: "starter",
      panelMessageId: "panel",
      draftOrder: status === "drafting" ? [1, 2] : null,
      everOccupied: false,
      emptySince: null,
      setupDeadline: Date.now() + 60_000,
      setupTimeoutMinutes: 60,
      emptyTimeoutMinutes: 30,
      warningSentFor: null,
      startedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    teams: [
      {
        id: 1,
        customId: "custom-id",
        ordinal: 1,
        name: "One",
        leaderId: "leader-1",
        voiceChannelId: "voice-1",
        spectatorMode: "off",
        members: [],
      },
      {
        id: 2,
        customId: "custom-id",
        ordinal: 2,
        name: "Two",
        leaderId: "leader-2",
        voiceChannelId: "voice-2",
        spectatorMode: "off",
        members: [],
      },
    ],
    draftActions: [],
  };
}

function actions(value: CustomAggregate): string[] {
  return buildPanel(value).components.flatMap((row) =>
    row.toJSON().components.map((component) => component.custom_id ?? ""),
  );
}

describe("control panel", () => {
  it("does not show draft controls for direct customs", () => {
    const ids = actions(aggregate("direct", "setup"));
    expect(ids.some((id) => id.includes(":pick:"))).toBe(false);
    expect(ids.some((id) => id.includes(":start:"))).toBe(false);
    expect(ids.some((id) => id.includes(":customstart:"))).toBe(true);
  });

  it("removes the start button after the custom starts", () => {
    const value = aggregate("direct", "active");
    value.custom.startedAt = Date.now();
    const ids = actions(value);
    expect(ids.some((id) => id.includes(":customstart:"))).toBe(false);
  });

  it("shows only setup-relevant draft controls before drafting", () => {
    const ids = actions(aggregate("draft", "setup"));
    expect(ids.some((id) => id.includes(":start:"))).toBe(true);
    expect(ids.some((id) => id.includes(":pick:"))).toBe(false);
    expect(ids.some((id) => id.includes(":add:"))).toBe(false);
  });

  it("shows draft actions and hides structural controls while drafting", () => {
    const ids = actions(aggregate("draft", "drafting"));
    expect(ids.some((id) => id.includes(":pick:"))).toBe(true);
    expect(ids.some((id) => id.includes(":createteam:"))).toBe(false);
    expect(ids.some((id) => id.includes(":removeteam:"))).toBe(false);
    expect(ids.some((id) => id.includes(":add:"))).toBe(false);
  });
});
