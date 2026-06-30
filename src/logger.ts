import pino from "pino";

export function createLogger(level: string) {
  return pino({
    name: "skycustoms",
    level,
    base: null,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type Logger = ReturnType<typeof createLogger>;
