import { ActivityType, type Client, type PresenceData } from "discord.js";
import type { Repository } from "../db/repository.js";
import type { Logger } from "../logger.js";

type Activity = NonNullable<PresenceData["activities"]>[number];

export interface PresenceStats {
  guilds: number;
  customs: number;
  teamChannels: number;
  assignedPlayers: number;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function buildPresenceOptions(stats: PresenceStats): Activity[] {
  return [
    {
      type: ActivityType.Watching,
      name: "captains blame the draft",
    },
    {
      type: ActivityType.Listening,
      name: "five people call mid",
    },
    {
      type: ActivityType.Competing,
      name: "absolutely no-prize customs",
    },
    {
      type: ActivityType.Watching,
      name: `${plural(stats.teamChannels, "team channel")} across ${plural(stats.guilds, "server")}`,
    },
    {
      type: ActivityType.Listening,
      name: "the “one more game” speech",
    },
    {
      type: ActivityType.Playing,
      name: plural(stats.customs, "active custom"),
    },
    {
      type: ActivityType.Watching,
      name: `${plural(stats.assignedPlayers, "assigned player")} find their team`,
    },
    {
      type: ActivityType.Playing,
      name: "customs without the chaos",
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
    const stats: PresenceStats = {
      guilds: this.client.guilds.cache.size,
      customs: customs.length,
      teamChannels: 0,
      assignedPlayers: 0,
    };
    for (const custom of customs) {
      const aggregate = this.repository.getAggregateById(custom.id);
      if (!aggregate) continue;
      stats.teamChannels += aggregate.teams.filter(
        (team) => team.voiceChannelId !== null,
      ).length;
      stats.assignedPlayers += aggregate.teams.reduce(
        (total, team) => total + team.members.length,
        0,
      );
    }
    const options = buildPresenceOptions(stats);
    const activity = options[this.rotation % options.length]!;
    this.rotation += 1;
    this.client.user.setPresence({
      status: "online",
      activities: [activity],
    });
    this.logger.debug(
      { stats, activity: activity.name },
      "Updated Discord presence",
    );
  }
}
