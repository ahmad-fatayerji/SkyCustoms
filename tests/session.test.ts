import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Actor } from "../src/application/auth.js";
import {
  type MoveSummary,
  type ResourceGateway,
  SessionService,
} from "../src/application/session-service.js";
import { openDatabase } from "../src/db/database.js";
import { Repository } from "../src/db/repository.js";

const temporaryDirectories: string[] = [];

class FakeResources implements ResourceGateway {
  public readonly repairs: string[] = [];

  public constructor(private readonly repository: Repository) {}

  public async provision(customId: string): Promise<void> {
    this.repository.setCustomStatus(customId, "setup");
  }

  public async repair(customId: string): Promise<void> {
    this.repairs.push(customId);
  }

  public async syncTeam(): Promise<void> {}
  public async syncLeaderPrompts(): Promise<void> {}
  public async refreshPanel(): Promise<void> {}
  public async removeTeamChannel(): Promise<void> {}
  public async destroy(customId: string): Promise<void> {
    this.repository.deleteCustom(customId);
  }
  public async moveRosterToTeamChannels(): Promise<MoveSummary> {
    return { moved: 0, disconnected: 0, failed: 0 };
  }
}

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "skycustoms-session-"));
  temporaryDirectories.push(directory);
  const repository = new Repository(
    openDatabase(join(directory, "test.sqlite")),
  );
  repository.upsertGuildConfig("guild", "lobby", "voice");
  const resources = new FakeResources(repository);
  return {
    repository,
    resources,
    sessions: new SessionService(repository, resources),
  };
}

const creator: Actor = {
  guildId: "guild",
  userId: "creator",
  roleIds: [],
  isOwner: true,
  isAdministrator: false,
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("custom renaming", () => {
  it("renames the canonical custom and reconciles its resources", async () => {
    const { repository, resources, sessions } = setup();
    const custom = await sessions.create(creator, {
      name: "Old Name",
      teamCount: 2,
      mode: "direct",
    });

    await sessions.renameCustom(creator, custom.custom.id, "New Name");

    expect(repository.getCustom("guild", custom.custom.id)?.name).toBe(
      "New Name",
    );
    expect(resources.repairs).toEqual([custom.custom.id]);
    repository.close();
  });

  it("rejects duplicate and over-limit rendered names before saving", async () => {
    const { repository, sessions } = setup();
    const first = await sessions.create(creator, {
      name: "First",
      teamCount: 2,
      mode: "direct",
    });
    await sessions.create(creator, {
      name: "Second",
      teamCount: 2,
      mode: "direct",
    });

    await expect(
      sessions.renameCustom(creator, first.custom.id, "Second"),
    ).rejects.toThrow(/already exists/);
    repository.setNamingFormats(
      "guild",
      `1234567890{custom}{custom}`,
      "T{number:02} • {team}",
    );
    await expect(
      sessions.renameCustom(
        creator,
        first.custom.id,
        "123456789012345678901234567890123456789012345678",
      ),
    ).rejects.toThrow(/100-character/);
    expect(repository.getCustom("guild", first.custom.id)?.name).toBe("First");
    repository.close();
  });
});

describe("custom ownership", () => {
  it("does not let another configured host edit the roster", async () => {
    const { repository, sessions } = setup();
    repository.addHostGrant("guild", "user", "other-host");
    const custom = await sessions.create(creator, {
      name: "Owned Custom",
      teamCount: 2,
      mode: "direct",
    });
    const otherHost: Actor = {
      ...creator,
      userId: "other-host",
      isOwner: false,
    };

    await expect(
      sessions.updateMembers(
        otherHost,
        custom.custom.id,
        1,
        ["player"],
        "add",
      ),
    ).rejects.toThrow(/only manage a team that you lead/);
    repository.close();
  });

  it("does not start the same custom twice", async () => {
    const { repository, sessions } = setup();
    const custom = await sessions.create(creator, {
      name: "Start Once",
      teamCount: 2,
      mode: "direct",
    });
    await sessions.assignLeader(creator, custom.custom.id, 1, "leader-1");
    await sessions.assignLeader(creator, custom.custom.id, 2, "leader-2");

    await sessions.startCustom(creator, custom.custom.id);
    await expect(
      sessions.startCustom(creator, custom.custom.id),
    ).rejects.toThrow(/already started/);
    repository.close();
  });
});
