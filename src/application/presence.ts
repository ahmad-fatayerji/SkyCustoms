import { ActivityType, type Client, type PresenceData } from "discord.js";
import type { Repository } from "../db/repository.js";
import type { Logger } from "../logger.js";

export interface PresenceSnapshot {
  guilds: number;
  customs: number;
  setup: number;
  drafting: number;
  live: number;
  ending: number;
  teams: number;
}

type Activity = NonNullable<PresenceData["activities"]>[number];

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function buildPresenceOptions(snapshot: PresenceSnapshot): Activity[] {
  if (snapshot.ending > 0) {
    return [
      {
        type: ActivityType.Playing,
        name: "Lobby Cleanup Simulator",
      },
      {
        type: ActivityType.Watching,
        name: `${plural(snapshot.ending, "custom")} pack up`,
      },
      {
        type: ActivityType.Custom,
        name: "SkyCustoms",
        state: "🧹 Sweeping up temporary channels",
      },
    ];
  }
  if (snapshot.drafting > 0) {
    return [
      {
        type: ActivityType.Competing,
        name: `${plural(snapshot.drafting, "captain draft")}`,
      },
      {
        type: ActivityType.Watching,
        name: "first-pick arguments unfold",
      },
      {
        type: ActivityType.Custom,
        name: "SkyCustoms",
        state: "🐍 Snake draft in progress",
      },
    ];
  }
  if (snapshot.live > 0) {
    return [
      {
        type: ActivityType.Watching,
        name: `${plural(snapshot.live, "live custom")}`,
      },
      {
        type: ActivityType.Competing,
        name: "for absolutely no prize",
      },
      {
        type: ActivityType.Playing,
        name: `${plural(snapshot.teams, "team channel")}`,
      },
    ];
  }
  if (snapshot.setup > 0) {
    return [
      {
        type: ActivityType.Watching,
        name: `${plural(snapshot.setup, "custom")} get ready`,
      },
      {
        type: ActivityType.Listening,
        name: "captains negotiate team names",
      },
      {
        type: ActivityType.Playing,
        name: "Pre-match Channel Tetris",
      },
    ];
  }
  return [
    {
      type: ActivityType.Custom,
      name: "SkyCustoms",
      state: "💤 Waiting for the next clutch",
    },
    {
      type: ActivityType.Listening,
      name: "for “one more game”",
    },
    {
      type: ActivityType.Watching,
      name: `${plural(snapshot.guilds, "server")} warm up`,
    },
  ];
}

export class PresenceManager {
  private timer: NodeJS.Timeout | null = null;
  private rotation = 0;

  public constructor(
    private readonly client: Client,
    private readonly repository: Repository,
    private readonly logger: Logger,
    private readonly rotationSeconds: number,
  ) {}

  public start(): void {
    this.update();
    this.timer = setInterval(() => this.update(), this.rotationSeconds * 1000);
    this.timer.unref();
  }

  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private update(): void {
    if (!this.client.user) return;
    const customs = this.repository.listCustoms();
    let teams = 0;
    for (const custom of customs) {
      teams += this.repository.getAggregateById(custom.id)?.teams.length ?? 0;
    }
    const snapshot: PresenceSnapshot = {
      guilds: this.client.guilds.cache.size,
      customs: customs.length,
      setup: customs.filter(
        (custom) =>
          custom.startedAt === null &&
          custom.status !== "drafting" &&
          custom.status !== "ending",
      ).length,
      drafting: customs.filter((custom) => custom.status === "drafting").length,
      live: customs.filter((custom) => custom.startedAt !== null).length,
      ending: customs.filter((custom) => custom.status === "ending").length,
      teams,
    };
    const options = buildPresenceOptions(snapshot);
    const activity = options[this.rotation % options.length]!;
    this.rotation += 1;
    this.client.user.setPresence({
      status: "online",
      activities: [activity],
    });
    this.logger.debug(
      { snapshot, activity: activity.name },
      "Updated Discord presence",
    );
  }
}
