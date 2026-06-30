import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db/database.js";
import { Repository } from "../src/db/repository.js";

const temporaryDirectories: string[] = [];

function repository(): Repository {
  const directory = mkdtempSync(join(tmpdir(), "skycustoms-"));
  temporaryDirectories.push(directory);
  return new Repository(openDatabase(join(directory, "test.sqlite")));
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Repository", () => {
  it("isolates customs and grants by guild", () => {
    const repo = repository();
    repo.upsertGuildConfig("guild-a", "lobby-a", "voice-a");
    repo.upsertGuildConfig("guild-b", "lobby-b", "voice-b");
    repo.addHostGrant("guild-a", "user", "host");

    const custom = repo.createCustom({
      guildId: "guild-a",
      creatorId: "host",
      name: "CS2",
      mode: "direct",
      teamCount: 2,
    });

    expect(repo.getCustom("guild-a", custom.custom.shortId)?.id).toBe(
      custom.custom.id,
    );
    expect(repo.getCustom("guild-b", custom.custom.shortId)).toBeNull();
    expect(repo.isHost("guild-a", "host", [])).toBe(true);
    expect(repo.isHost("guild-b", "host", [])).toBe(false);
    repo.close();
  });

  it("prevents one player from joining two teams", () => {
    const repo = repository();
    repo.upsertGuildConfig("guild", "lobby", "voice");
    const custom = repo.createCustom({
      guildId: "guild",
      creatorId: "host",
      name: "CS2",
      mode: "direct",
      teamCount: 2,
    });
    const [first, second] = custom.teams;
    repo.addTeamMember(custom.custom.id, first!.id, "player");
    expect(() =>
      repo.addTeamMember(custom.custom.id, second!.id, "player"),
    ).toThrow(/already belongs/);
    repo.close();
  });

  it("persists occupancy and cleanup state", () => {
    const repo = repository();
    repo.upsertGuildConfig("guild", "lobby", "voice");
    const custom = repo.createCustom({
      guildId: "guild",
      creatorId: "host",
      name: "CS2",
      mode: "draft",
      teamCount: 2,
    });
    repo.setOccupancy(custom.custom.id, true);
    expect(repo.getAggregateById(custom.custom.id)?.custom.everOccupied).toBe(
      true,
    );
    repo.setOccupancy(custom.custom.id, false);
    expect(
      repo.getAggregateById(custom.custom.id)?.custom.emptySince,
    ).not.toBeNull();
    repo.close();
  });
});
