import { describe, expect, it } from "vitest";
import { isMissingDiscordResource } from "../src/discord/resources.js";

describe("Discord resource cleanup", () => {
  it("treats already-deleted channels and messages as successful cleanup", () => {
    expect(isMissingDiscordResource({ code: 10003 })).toBe(true);
    expect(isMissingDiscordResource({ code: "10008" })).toBe(true);
  });

  it("keeps real Discord failures retryable", () => {
    expect(isMissingDiscordResource({ code: 50013 })).toBe(false);
    expect(isMissingDiscordResource(new Error("network failure"))).toBe(false);
  });
});
