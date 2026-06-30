import { describe, expect, it } from "vitest";
import type { Actor } from "../src/application/auth.js";
import type { CustomAggregate } from "../src/domain/types.js";
import { buildManageComponents } from "../src/discord/manage.js";

function actor(userId: string, override = false): Actor {
  return {
    guildId: "guild",
    userId,
    roleIds: [],
    isOwner: override,
    isAdministrator: false,
  };
}

function aggregate(mode: "direct" | "draft" = "direct"): CustomAggregate {
  return {
    custom: {
      id: "custom",
      shortId: "ABC123",
      guildId: "guild",
      creatorId: "creator",
      name: "CS2",
      mode,
      status: mode === "draft" ? "drafting" : "setup",
      categoryId: null,
      threadId: null,
      starterMessageId: null,
      panelMessageId: null,
      draftOrder: mode === "draft" ? [1, 2] : null,
      everOccupied: false,
      emptySince: null,
      setupDeadline: 0,
      setupTimeoutMinutes: 60,
      emptyTimeoutMinutes: 30,
      warningSentFor: null,
      startedAt: null,
      createdAt: 0,
      updatedAt: 0,
    },
    teams: [
      {
        id: 1,
        customId: "custom",
        ordinal: 1,
        name: "One",
        leaderId: "leader-1",
        voiceChannelId: null,
        leaderPromptMessageId: null,
        spectatorMode: "off",
        members: [],
      },
      {
        id: 2,
        customId: "custom",
        ordinal: 2,
        name: "Two",
        leaderId: "leader-2",
        voiceChannelId: null,
        leaderPromptMessageId: null,
        spectatorMode: "off",
        members: [],
      },
    ],
    draftActions: [],
  };
}

function actions(value: CustomAggregate, valueActor: Actor): string[] {
  return buildManageComponents(valueActor, value).flatMap((row) =>
    row.toJSON().components.map((component) => component.custom_id ?? ""),
  );
}

describe("role-aware management", () => {
  it("shows no controls to unrelated members or other hosts", () => {
    expect(actions(aggregate(), actor("unrelated"))).toEqual([]);
  });

  it("shows a leader only their relevant team controls", () => {
    const ids = actions(aggregate(), actor("leader-1"));
    expect(ids).toEqual([
      "sc:rename:custom",
      "sc:add:custom",
      "sc:remove:custom",
      "sc:spectators:custom",
    ]);
    expect(ids.some((id) => id.includes("end"))).toBe(false);
  });

  it("shows complete structural controls to the creator", () => {
    const ids = actions(aggregate(), actor("creator"));
    expect(ids).toContain("sc:renamecustom:custom");
    expect(ids).toContain("sc:assignleader:custom");
    expect(ids).toContain("sc:customstart:custom");
    expect(ids).toContain("sc:end:custom");
  });

  it("shows draft actions only to the current leader", () => {
    expect(actions(aggregate("draft"), actor("leader-1"))).toContain(
      "sc:pick:custom",
    );
    expect(actions(aggregate("draft"), actor("leader-2"))).not.toContain(
      "sc:pick:custom",
    );
  });
});
