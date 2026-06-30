# SkyCustoms

SkyCustoms creates temporary, access-controlled Discord voice channels for
custom games. It supports multiple Discord servers, direct team assignment,
snake drafts, team-managed spectator access, and inactivity cleanup.

It is designed for communities that host private matches, scrims, tournaments,
or pickup games and want temporary team rooms without manually maintaining
Discord permissions. One self-hosted SkyCustoms instance can serve several
Discord servers.

## Features

- Per-server setup with owner-managed host users and roles.
- Two to ten teams per custom.
- Each custom receives a temporary category containing channels such as
  `T01 • Rush B`.
- Direct roster assignment or randomized snake drafting.
- Visible channels with disabled, silent, or speaking spectator modes.
- Full cross-team voice access for the custom creator.
- Moves connected roster members into team channels when the custom starts.
- Returns all team-channel occupants to the configured voice lobby on cleanup.
- One-hour unused-setup and 30-minute empty-session cleanup defaults.
- Persistent SQLite state and restart-safe Discord reconciliation.
- Rotating bot activities for idle, setup, drafting, live, and cleanup states.
- Rootless Podman deployment through user-level systemd Quadlets.

## How it works

The server owner selects a text control lobby and voice return lobby inside one
Discord category. When a host creates a custom, SkyCustoms creates a temporary
category for its team voice channels and posts an interactive control thread.

The host assigns team leaders and either manages rosters directly or starts a
snake draft. Leaders can rename their team, manage their roster when permitted,
and choose whether spectators are blocked, silent, or allowed to speak.

Starting the custom moves connected roster members to their assigned channels.
Ending it returns everyone in those channels to the configured voice lobby,
then deletes the temporary channels and database records.

## Install your own SkyCustoms bot

SkyCustoms is self-hosted. Each operator creates their own Discord application,
uses its bot token for one deployment, and installs that application into the
servers they want it to manage.

1. Create an application and bot in the
   [Discord Developer Portal](https://discord.com/developers/applications).
2. Name the application `SkyCustoms`, open **Bot**, and create or reset the bot
   token. Store it securely; never commit it or paste it into an install URL.
3. Copy the **Application ID** from **General Information**. This is the
   `DISCORD_CLIENT_ID`; the client secret is not used.
4. Open **Installation** and configure a **Guild Install** with the `bot` and
   `applications.commands` scopes.
5. Grant the bot:
   - View Channels
   - Send Messages
   - Read Message History
   - Create Public Threads
   - Send Messages in Threads
   - Manage Threads
   - Manage Channels
   - Manage Roles
   - Move Members
   - Connect
   - Speak
   - Video
   - Use Soundboard
   - Use External Sounds
   - Send Voice Messages
6. Copy the installation link, open it in a browser, and add the application to
   a Discord server where you have permission to manage applications.
7. Repeat the same installation link for every server this deployment should
   serve.

SkyCustoms uses only the Guilds and Guild Voice States gateway intents. It
does not require the Message Content or Guild Members privileged intents.

### Required environment

The process needs:

```env
DISCORD_TOKEN=the-bot-token
DISCORD_CLIENT_ID=the-application-id
DATABASE_PATH=/data/skycustoms.sqlite
LOG_LEVEL=info
PRESENCE_ROTATION_SECONDS=45
```

`DISCORD_DEV_GUILD_ID` is optional and should normally be unset. It registers
commands immediately in one test server instead of registering global commands
for every installed server.

For local Docker development, place these values in the ignored `.env` file.
For rootless Podman production, store the token in the documented Podman secret
and keep only non-secret configuration in the Quadlet environment file.

### Bot presence

SkyCustoms rotates playful Discord activities based on aggregate bot state,
including waiting for a clutch, captain drafts, live customs, team-channel
counts, and cleanup. `PRESENCE_ROTATION_SECONDS` controls the interval and must
be between 15 and 3600 seconds.

Discord bots have one global presence across every server, so SkyCustoms uses
only aggregate counts and never exposes custom, server, team, or player names.
Bot gateway presence does not support the full game Rich Presence surface with
artwork, parties, and interactive buttons.

## First-time server setup

1. Create or choose one Discord category, for example `Customs`.
2. Put a text channel such as `#customs-lobby` and a voice channel such as
   `Custom Lobby` inside that same category.
3. As the Discord server owner, run:

   ```text
   /setup lobby text-channel:#customs-lobby voice-channel:Custom Lobby
   ```

4. Grant hosting access to individual users or existing Discord roles:

   ```text
   /setup host-user action:Add user:@User
   /setup host-role action:Add role:@Custom Hosts
   ```

5. Check configuration and bot permissions:

   ```text
   /setup status
   ```

6. Optionally customize category and team-channel names:

   ```text
   /setup naming category-format:🎮 {custom} channel-format:T{number:02} • {team}
   ```

   Category formats must contain `{custom}`. Channel formats must contain
   `{team}` and may also use `{custom}`, `{number}`, or `{number:02}`. The
   defaults are `{custom}` and `T{number:02} • {team}`.

Only the Discord server owner can change setup. Configured hosts can create
customs. The creator manages their custom, while the server owner and Discord
administrators retain recovery overrides.

## Run a custom

Create a direct-assignment custom:

```text
/custom create name:CS2 5v5 teams:2 mode:Direct assignment
```

Use the generated control thread or commands to assign leaders, rename teams,
and add players:

```text
/team leader team:1 user:@LeaderOne
/team leader team:2 user:@LeaderTwo
/team rename team:1 name:Rush B
/team add team:1 user:@Player
```

For a managed draft, create the custom with `Managed draft`, assign every
leader, then run `/draft start`. Discord shows the current leader; leaders use
`/draft pick` or `/draft pass`, and the creator completes it with
`/draft finish`.

When rosters are ready:

```text
/custom start
```

Only connected members can be moved. A player who is not in a voice channel is
reported as disconnected and can join their team channel later.

End manually with `/custom end`, or let inactivity cleanup end it
automatically. Never-used customs expire after one hour; after first voice use,
customs expire after all managed channels remain empty for 30 minutes. The
creator can change these values with `/custom timeout`.

## Commands

- `/setup lobby|naming|host-user|host-role|status`
- `/custom create|list|start|timeout|repair|end`
- `/team create|delete|leader|rename|add|remove|spectators`
- `/draft start|pick|pass|undo|finish`

When a command is used in a custom's control thread, its `custom` option may
be omitted. Elsewhere, select the custom by name from Discord autocomplete.
Routine leader actions are also available through the panel's buttons,
member selectors, and rename modal.

The custom creator may add or remove teams outside an active draft. Customs
must keep 2–10 teams. Removing a team first moves its connected occupants to
the configured voice lobby, then deletes its voice channel and roster.

### Spectator access

Each leader controls their own channel:

- `off`: everyone can see the channel, but only the roster and custom creator
  can connect.
- `silent`: spectators can connect but cannot speak, stream, or use soundboards.
- `speak`: spectators can connect and speak; streaming and soundboards remain
  restricted.

Discord administrators can bypass channel overwrites by Discord design.

### Repair and persistence

`/custom repair` reconciles Discord with SQLite. It recreates missing team
channels or control threads, restores canonical names and placement, reapplies
permissions, and rebuilds the control panel. Startup recovery and deleted
channel recovery are automatic, so manual repair is mainly useful after fixing
bot permissions or accidental server edits.

Active custom state survives process restarts. Successfully ended customs,
teams, rosters, and draft actions are deleted from SQLite. Server lobby
configuration and host grants remain until changed or the bot leaves that
server.

## Local development

Requirements are Node.js 22.12 or newer and npm.

```sh
npm install
cp .env.example .env
npm run dev
```

The process reads environment variables directly. Load `.env` with your
preferred shell or environment manager; the application intentionally does
not load dotenv files itself.

Useful checks:

```sh
npm run typecheck
npm test
npm run build
```

Set `DISCORD_DEV_GUILD_ID` during development for immediate guild-scoped
command updates. Without it, SkyCustoms registers global commands, whose
updates can take time to propagate.

### Development with Docker Compose

Copy `.env.example` to `.env` and provide a development bot token, application
ID, and development guild ID. Then start the source-watching container:

```sh
docker compose -f compose.dev.yaml up --build
```

The source tree is bind-mounted, so edits under `src/` restart the TypeScript
process automatically. Linux-native npm dependencies and development SQLite
data use separate named volumes rather than the host's `node_modules` or
production database.

Stop the environment with:

```sh
docker compose -f compose.dev.yaml down
```

Add `--volumes` only when intentionally deleting the development database and
dependency volume.

## Rootless Podman deployment

The host needs a current Podman release with Quadlet, systemd user services,
cgroup v2, and a normal unprivileged deployment account. Commands in this
section run as that account unless explicitly prefixed with `sudo`.

Build the image:

```sh
podman build -t localhost/skycustoms:latest -f Containerfile .
```

Create the token as a rootless Podman secret without putting it in shell
history:

```sh
read -rsp "Discord token: " TOKEN
printf '%s' "$TOKEN" | podman secret create skycustoms-discord-token -
unset TOKEN
```

Install configuration and Quadlets:

```sh
mkdir -p ~/.config/skycustoms ~/.config/containers/systemd
cp deploy/skycustoms.env.example ~/.config/skycustoms/skycustoms.env
cp deploy/skycustoms.container deploy/skycustoms-data.volume \
  ~/.config/containers/systemd/
chmod 600 ~/.config/skycustoms/skycustoms.env
```

Edit `~/.config/skycustoms/skycustoms.env` and set the Discord application
ID. Do not place the bot token in that file.

Allow the user service to run without an interactive login. This is the one
host-administrator step:

```sh
sudo loginctl enable-linger "$USER"
```

Generate and start the service:

```sh
systemctl --user daemon-reload
systemctl --user start skycustoms.service
systemctl --user status skycustoms.service
```

The Quadlet's `[Install]` section attaches the generated service to
`default.target`, so it starts with the user's systemd manager. Do not run
`systemctl --user enable` on the generated service.

Follow logs with:

```sh
journalctl --user -u skycustoms.service -f
```

### Updating

Build the new local image and restart the service intentionally:

```sh
podman build -t localhost/skycustoms:latest -f Containerfile .
systemctl --user restart skycustoms.service
```

Database migrations run automatically before Discord login.

### Backups

Stop the service to obtain a consistent offline SQLite backup, export the
named volume, and start it again:

```sh
systemctl --user stop skycustoms.service
podman volume export skycustoms-data > "skycustoms-$(date +%F).tar"
systemctl --user start skycustoms.service
```

Protect backups because they contain Discord IDs and server configuration.
The Discord token is stored separately in Podman's secret store.

## Runtime model

SQLite is opened in WAL mode with foreign keys enabled. Every record and
operation is scoped by Discord guild ID. One SkyCustoms process is supported;
running multiple replicas would require shared persistence and distributed
locking.

The database is the desired state. On startup SkyCustoms restores missing
temporary categories, voice channels, canonical names, permission
overwrites, control threads, occupancy state, and cleanup deadlines. Manual
deletion of an active managed channel causes it to be recreated; end the custom
through its command or control panel instead.
