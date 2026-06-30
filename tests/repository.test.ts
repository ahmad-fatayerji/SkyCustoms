import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
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

  it("prevents participation in two customs in one guild", () => {
    const repo = repository();
    repo.upsertGuildConfig("guild", "lobby", "voice");
    const first = repo.createCustom({
      guildId: "guild",
      creatorId: "host",
      name: "First",
      mode: "direct",
      teamCount: 2,
    });
    const second = repo.createCustom({
      guildId: "guild",
      creatorId: "host",
      name: "Second",
      mode: "direct",
      teamCount: 2,
    });
    repo.addTeamMember(first.custom.id, first.teams[0]!.id, "player");

    expect(() =>
      repo.addTeamMember(second.custom.id, second.teams[0]!.id, "player"),
    ).toThrow(/another active custom/);

    repo.deleteCustom(first.custom.id);
    expect(() =>
      repo.addTeamMember(second.custom.id, second.teams[0]!.id, "player"),
    ).not.toThrow();
    repo.close();
  });

  it("allows the same player in different guilds", () => {
    const repo = repository();
    repo.upsertGuildConfig("guild-a", "lobby-a", "voice-a");
    repo.upsertGuildConfig("guild-b", "lobby-b", "voice-b");
    const first = repo.createCustom({
      guildId: "guild-a",
      creatorId: "host",
      name: "First",
      mode: "direct",
      teamCount: 2,
    });
    const second = repo.createCustom({
      guildId: "guild-b",
      creatorId: "host",
      name: "Second",
      mode: "direct",
      teamCount: 2,
    });
    repo.addTeamMember(first.custom.id, first.teams[0]!.id, "player");
    expect(() =>
      repo.addTeamMember(second.custom.id, second.teams[0]!.id, "player"),
    ).not.toThrow();
    repo.close();
  });

  it("applies bulk membership changes atomically and idempotently", () => {
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
    repo.addTeamMember(custom.custom.id, second!.id, "conflict");

    expect(() =>
      repo.updateTeamMembers(
        custom.custom.id,
        first!.id,
        ["new-player", "conflict"],
        "add",
      ),
    ).toThrow(/another team/);
    expect(
      repo
        .getAggregateById(custom.custom.id)
        ?.teams[0]?.members.some((member) => member.userId === "new-player"),
    ).toBe(false);

    expect(
      repo.updateTeamMembers(
        custom.custom.id,
        first!.id,
        ["new-player", "new-player"],
        "add",
      ),
    ).toEqual({ changed: 1, unchanged: 0 });
    expect(
      repo.updateTeamMembers(
        custom.custom.id,
        first!.id,
        ["new-player"],
        "add",
      ),
    ).toEqual({ changed: 0, unchanged: 1 });
    expect(
      repo.updateTeamMembers(
        custom.custom.id,
        first!.id,
        ["absent"],
        "remove",
      ),
    ).toEqual({ changed: 0, unchanged: 1 });
    repo.close();
  });

  it("protects leaders from bulk removal", () => {
    const repo = repository();
    repo.upsertGuildConfig("guild", "lobby", "voice");
    const custom = repo.createCustom({
      guildId: "guild",
      creatorId: "host",
      name: "CS2",
      mode: "direct",
      teamCount: 2,
    });
    repo.setLeader(custom.custom.id, custom.teams[0]!.id, "leader");

    expect(() =>
      repo.updateTeamMembers(
        custom.custom.id,
        custom.teams[0]!.id,
        ["leader", "absent"],
        "remove",
      ),
    ).toThrow(/Replace the team leader/);
    expect(
      repo.getAggregateById(custom.custom.id)?.teams[0]?.members,
    ).toHaveLength(1);
    repo.close();
  });

  it("persists leader prompt message identifiers", () => {
    const repo = repository();
    repo.upsertGuildConfig("guild", "lobby", "voice");
    const custom = repo.createCustom({
      guildId: "guild",
      creatorId: "host",
      name: "CS2",
      mode: "direct",
      teamCount: 2,
    });
    repo.setLeaderPromptMessage(custom.teams[0]!.id, "message");
    expect(
      repo.getAggregateById(custom.custom.id)?.teams[0]?.leaderPromptMessageId,
    ).toBe("message");
    repo.close();
  });

  it("migrates duplicate guild participants deterministically", () => {
    const directory = mkdtempSync(join(tmpdir(), "skycustoms-migration-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "legacy.sqlite");
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE guild_config (guild_id TEXT PRIMARY KEY);
      CREATE TABLE customs (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE teams (
        id INTEGER PRIMARY KEY,
        custom_id TEXT NOT NULL,
        leader_id TEXT
      );
      CREATE TABLE team_members (
        custom_id TEXT NOT NULL,
        team_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (custom_id, user_id)
      );
      INSERT INTO guild_config VALUES ('guild');
      INSERT INTO customs VALUES ('older', 'guild', 1), ('newer', 'guild', 2);
      INSERT INTO teams VALUES
        (1, 'older', 'player'),
        (2, 'newer', 'player');
      INSERT INTO team_members VALUES
        ('older', 1, 'player', 1),
        ('newer', 2, 'player', 2);
      PRAGMA user_version = 3;
    `);
    legacy.close();

    const migrated = openDatabase(path);
    const assignments = migrated
      .prepare("SELECT custom_id FROM team_members ORDER BY custom_id")
      .all() as Array<{ custom_id: string }>;
    const newerTeam = migrated
      .prepare("SELECT leader_id FROM teams WHERE id = 2")
      .get() as { leader_id: string | null };
    const notices = migrated
      .prepare("SELECT message FROM migration_notices")
      .all();

    expect(assignments).toEqual([{ custom_id: "older" }]);
    expect(newerTeam.leader_id).toBeNull();
    expect(notices).toHaveLength(1);
    migrated.close();
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
