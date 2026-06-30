import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const migrations = [
  `
    CREATE TABLE guild_config (
      guild_id TEXT PRIMARY KEY,
      lobby_channel_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE host_grants (
      guild_id TEXT NOT NULL,
      grant_type TEXT NOT NULL CHECK (grant_type IN ('user', 'role')),
      grant_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, grant_type, grant_id),
      FOREIGN KEY (guild_id) REFERENCES guild_config(guild_id) ON DELETE CASCADE
    );

    CREATE TABLE customs (
      id TEXT PRIMARY KEY,
      short_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('direct', 'draft')),
      status TEXT NOT NULL CHECK (status IN ('creating', 'setup', 'drafting', 'active', 'ending')),
      category_id TEXT,
      thread_id TEXT,
      starter_message_id TEXT,
      panel_message_id TEXT,
      draft_order TEXT,
      ever_occupied INTEGER NOT NULL DEFAULT 0,
      empty_since INTEGER,
      setup_deadline INTEGER NOT NULL,
      setup_timeout_minutes INTEGER NOT NULL DEFAULT 60,
      empty_timeout_minutes INTEGER NOT NULL DEFAULT 30,
      warning_sent_for INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (guild_id, short_id),
      FOREIGN KEY (guild_id) REFERENCES guild_config(guild_id) ON DELETE CASCADE
    );

    CREATE TABLE teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      custom_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      name TEXT NOT NULL,
      leader_id TEXT,
      voice_channel_id TEXT UNIQUE,
      spectator_mode TEXT NOT NULL DEFAULT 'off'
        CHECK (spectator_mode IN ('off', 'silent', 'speak')),
      UNIQUE (custom_id, ordinal),
      FOREIGN KEY (custom_id) REFERENCES customs(id) ON DELETE CASCADE
    );

    CREATE TABLE team_members (
      custom_id TEXT NOT NULL,
      team_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (custom_id, user_id),
      FOREIGN KEY (custom_id) REFERENCES customs(id) ON DELETE CASCADE,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    CREATE TABLE draft_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      custom_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      actor_id TEXT NOT NULL,
      action_type TEXT NOT NULL CHECK (action_type IN ('pick', 'pass')),
      member_id TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE (custom_id, sequence),
      FOREIGN KEY (custom_id) REFERENCES customs(id) ON DELETE CASCADE,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    CREATE INDEX customs_guild_status_idx ON customs(guild_id, status);
    CREATE INDEX customs_thread_idx ON customs(thread_id);
    CREATE INDEX teams_voice_channel_idx ON teams(voice_channel_id);
  `,
  `
    ALTER TABLE guild_config ADD COLUMN voice_lobby_channel_id TEXT;
    ALTER TABLE customs ADD COLUMN started_at INTEGER;
  `,
];

export function openDatabase(path: string): Database.Database {
  const absolutePath = resolve(path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  const database = new Database(absolutePath);
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");

  const currentVersion = database.pragma("user_version", {
    simple: true,
  }) as number;

  for (let index = currentVersion; index < migrations.length; index += 1) {
    database.transaction(() => {
      database.exec(migrations[index]!);
      database.pragma(`user_version = ${index + 1}`);
    })();
  }

  return database;
}
