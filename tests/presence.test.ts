import { ActivityType } from "discord.js";
import { describe, expect, it } from "vitest";
import {
  buildPresenceOptions,
  type PresenceSnapshot,
} from "../src/application/presence.js";

const idle: PresenceSnapshot = {
  guilds: 3,
  customs: 0,
  setup: 0,
  drafting: 0,
  live: 0,
  ending: 0,
  teams: 0,
};

describe("presence rotation", () => {
  it("uses playful idle activities", () => {
    const options = buildPresenceOptions(idle);
    expect(options).toHaveLength(3);
    expect(options.some((activity) => activity.type === ActivityType.Custom)).toBe(
      true,
    );
  });

  it("prioritizes cleanup over other states", () => {
    const options = buildPresenceOptions({
      ...idle,
      ending: 1,
      drafting: 2,
      live: 3,
    });
    expect(options[0]?.name).toMatch(/Cleanup/);
  });

  it("summarizes live customs and teams", () => {
    const options = buildPresenceOptions({
      ...idle,
      customs: 2,
      live: 2,
      teams: 5,
    });
    expect(options.map((activity) => activity.name).join(" ")).toContain(
      "2 live customs",
    );
    expect(options.map((activity) => activity.name).join(" ")).toContain(
      "5 team channels",
    );
  });
});
