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
        leaderPromptMessageId: null,
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
        leaderPromptMessageId: null,
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
  it("shows only the role-aware manage entry point", () => {
    expect(actions(aggregate("direct", "setup"))).toEqual([
      "sc:manage:custom-id",
    ]);
  });

  it("does not expose cleanup configuration", () => {
    const description =
      buildPanel(aggregate("draft", "setup")).embeds[0]?.toJSON().description;
    expect(description).not.toContain("Cleanup:");
  });

  it("disables management while ending", () => {
    const panel = buildPanel(aggregate("draft", "ending"));
    const button = panel.components[0]?.toJSON().components[0];
    expect(button?.disabled).toBe(true);
  });
});
