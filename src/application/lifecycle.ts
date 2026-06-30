import type {
  Channel,
  Client,
  VoiceState,
} from "discord.js";
import type { Repository } from "../db/repository.js";
import type { Logger } from "../logger.js";
import type { DiscordResources } from "../discord/resources.js";
import type { SessionService } from "./session-service.js";

export class LifecycleManager {
  private interval: NodeJS.Timeout | null = null;
  private runningSweep = false;
  private readonly repairTimers = new Map<string, NodeJS.Timeout>();

  public constructor(
    private readonly client: Client,
    private readonly repository: Repository,
    private readonly resources: DiscordResources,
    private readonly sessions: SessionService,
    private readonly logger: Logger,
  ) {}

  public async start(): Promise<void> {
    await this.reconcileAll();
    this.interval = setInterval(() => {
      void this.sweep();
    }, 30_000);
    this.interval.unref();
    await this.sweep();
  }

  public stop(): void {
    if (this.interval) clearInterval(this.interval);
    for (const timer of this.repairTimers.values()) clearTimeout(timer);
    this.repairTimers.clear();
  }

  public async onVoiceState(
    oldState: VoiceState,
    newState: VoiceState,
  ): Promise<void> {
    const customIds = new Set<string>();
    if (oldState.channelId) {
      const custom = this.repository.getCustomByVoiceChannel(oldState.channelId);
      if (custom) customIds.add(custom.id);
    }
    if (newState.channelId) {
      const custom = this.repository.getCustomByVoiceChannel(newState.channelId);
      if (custom) customIds.add(custom.id);
    }
    for (const customId of customIds) {
      const occupied = await this.resources.isOccupied(customId);
      this.repository.setOccupancy(customId, occupied);
      await this.resources.refreshPanel(customId).catch(() => undefined);
    }
  }

  public onChannelDelete(channel: Channel): void {
    if (!channel.isDMBased()) {
      const custom = this.repository.getCustomByResource(channel.guildId, channel.id);
      if (!custom || custom.status === "ending") return;
      const existing = this.repairTimers.get(custom.id);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        this.repairTimers.delete(custom.id);
        void this.resources.repair(custom.id).catch((error) => {
          this.logger.error(
            { error, customId: custom.id, guildId: custom.guildId },
            "Automatic resource repair failed",
          );
        });
      }, 1_500);
      timer.unref();
      this.repairTimers.set(custom.id, timer);
    }
  }

  private async reconcileAll(): Promise<void> {
    for (const custom of this.repository.listCustoms()) {
      try {
        if (custom.status === "ending") {
          await this.resources.destroy(
            custom.id,
            "Resume interrupted SkyCustoms cleanup",
          );
          continue;
        }
        if (custom.status === "creating") {
          await this.resources.provision(custom.id);
        } else {
          await this.resources.repair(custom.id);
        }
        const occupied = await this.resources.isOccupied(custom.id);
        this.repository.setOccupancy(custom.id, occupied);
      } catch (error) {
        this.logger.error(
          { error, customId: custom.id, guildId: custom.guildId },
          "Startup reconciliation failed",
        );
      }
    }
  }

  private async sweep(): Promise<void> {
    if (this.runningSweep) return;
    this.runningSweep = true;
    try {
      const now = Date.now();
      for (const custom of this.repository.listCustoms()) {
        if (custom.status === "ending") {
          await this.resources
            .destroy(custom.id, "Retry interrupted cleanup")
            .catch((error) => {
              this.logger.warn(
                { error, customId: custom.id },
                "Cleanup retry failed",
              );
            });
          continue;
        }
        const deadline = custom.everOccupied
          ? custom.emptySince === null
            ? null
            : custom.emptySince + custom.emptyTimeoutMinutes * 60_000
          : custom.setupDeadline;
        if (deadline === null) continue;
        if (now >= deadline) {
          await this.sessions
            .endById(
              custom.id,
              custom.everOccupied
                ? "Automatically ended after all team channels were empty"
                : "Automatically ended after setup inactivity",
            )
            .catch((error) => {
              this.logger.warn(
                { error, customId: custom.id },
                "Automatic cleanup failed",
              );
            });
          continue;
        }
        const timeoutDuration =
          (custom.everOccupied
            ? custom.emptyTimeoutMinutes
            : custom.setupTimeoutMinutes) * 60_000;
        const warningAt =
          deadline - Math.min(10 * 60_000, Math.floor(timeoutDuration / 2));
        if (
          now >= warningAt &&
          custom.warningSentFor !== deadline
        ) {
          try {
            await this.resources.sendWarning(custom.id, deadline);
            this.repository.setWarningSent(custom.id, deadline);
          } catch (error) {
            this.logger.warn(
              { error, customId: custom.id },
              "Could not send cleanup warning",
            );
          }
        }
      }
    } finally {
      this.runningSweep = false;
    }
  }
}
