import {
  Client,
  Events,
  GatewayIntentBits,
} from "discord.js";
import { LifecycleManager } from "./application/lifecycle.js";
import { PresenceManager } from "./application/presence.js";
import { SessionService } from "./application/session-service.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db/database.js";
import { Repository } from "./db/repository.js";
import { InteractionHandler } from "./discord/interactions.js";
import { DiscordResources } from "./discord/resources.js";
import { createLogger } from "./logger.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const database = openDatabase(config.databasePath);
  const repository = new Repository(database);
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });
  const resources = new DiscordResources(client, repository, logger);
  const sessions = new SessionService(repository, resources);
  const interactions = new InteractionHandler(
    client,
    config,
    repository,
    sessions,
    logger,
  );
  const lifecycle = new LifecycleManager(
    client,
    repository,
    resources,
    sessions,
    logger,
  );
  const presence = new PresenceManager(
    client,
    repository,
    logger,
    config.presenceRotationSeconds,
  );

  client.on(Events.InteractionCreate, (interaction) => {
    void interactions.handle(interaction);
  });
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    void lifecycle.onVoiceState(oldState, newState);
  });
  client.on(Events.ChannelDelete, (channel) => {
    lifecycle.onChannelDelete(channel);
  });
  client.on(Events.GuildDelete, (guild) => {
    repository.deleteGuild(guild.id);
    logger.info({ guildId: guild.id }, "Removed data for departed guild");
  });
  client.once(Events.ClientReady, async (readyClient) => {
    logger.info(
      { user: readyClient.user.tag, guildCount: readyClient.guilds.cache.size },
      "SkyCustoms connected",
    );
    try {
      await interactions.registerCommands();
      await lifecycle.start();
      presence.start();
    } catch (error) {
      logger.fatal({ error }, "SkyCustoms startup failed");
      process.exitCode = 1;
      client.destroy();
    }
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down SkyCustoms");
    lifecycle.stop();
    presence.stop();
    client.destroy();
    repository.close();
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  await client.login(config.token);
}

main().catch((error) => {
  const logger = createLogger(process.env.LOG_LEVEL ?? "info");
  logger.fatal({ error }, "SkyCustoms terminated unexpectedly");
  process.exitCode = 1;
});
