import { ActivityType } from "discord.js";
import { describe, expect, it } from "vitest";
import { buildPresenceOptions } from "../src/application/presence.js";

const stats = {
  guilds: 3,
  customs: 2,
  teamChannels: 5,
  assignedPlayers: 18,
};

describe("presence rotation", () => {
  it("rotates through playful state-independent activities", () => {
    const options = buildPresenceOptions(stats);

    expect(options).toHaveLength(8);
    expect(new Set(options.map((activity) => activity.name)).size).toBe(8);
    expect(options.map((activity) => activity.type)).toEqual(
      expect.arrayContaining([
        ActivityType.Playing,
        ActivityType.Watching,
        ActivityType.Listening,
        ActivityType.Competing,
      ]),
    );
  });

  it("includes aggregate statistics and gaming jokes", () => {
    const names = buildPresenceOptions(stats)
      .map((activity) => activity.name)
      .join(" ");

    expect(names).toContain("5 team channels across 3 servers");
    expect(names).toContain("2 active customs");
    expect(names).toContain("18 assigned players");
    expect(names).toContain("customs without the chaos");
    expect(names).toContain("captains blame the draft");
    expect(names).toContain("one more game");
  });

  it("uses singular labels for single totals", () => {
    const names = buildPresenceOptions({
      guilds: 1,
      customs: 1,
      teamChannels: 1,
      assignedPlayers: 1,
    })
      .map((activity) => activity.name)
      .join(" ");

    expect(names).toContain("1 team channel across 1 server");
    expect(names).toContain("1 active custom");
    expect(names).toContain("1 assigned player");
  });
});
