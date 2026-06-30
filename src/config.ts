import { z } from "zod";

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_DEV_GUILD_ID: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(1).optional(),
  ),
  DATABASE_PATH: z.string().min(1).default("./data/skycustoms.sqlite"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type Config = {
  token: string;
  clientId: string;
  devGuildId?: string;
  databasePath: string;
  logLevel: z.infer<typeof schema>["LOG_LEVEL"];
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.parse(environment);
  return {
    token: parsed.DISCORD_TOKEN,
    clientId: parsed.DISCORD_CLIENT_ID,
    ...(parsed.DISCORD_DEV_GUILD_ID
      ? { devGuildId: parsed.DISCORD_DEV_GUILD_ID }
      : {}),
    databasePath: parsed.DATABASE_PATH,
    logLevel: parsed.LOG_LEVEL,
  };
}
