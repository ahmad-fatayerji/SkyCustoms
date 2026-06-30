# SkyCustoms

SkyCustoms is a self-hosted Discord bot for creating temporary, private team
voice channels for custom games.

## Features

- Supports multiple Discord servers.
- Creates 2–10 teams in a temporary category.
- Direct roster assignment or randomized snake drafts.
- Prepared leader-assignment prompts and role-aware private controls.
- Bulk roster changes with one active custom per player in each server.
- Creators can rename customs; leaders can rename and manage their teams.
- Spectators can be disabled, silent, or allowed to speak.
- Moves connected players into team channels when a custom starts.
- Returns everyone to a configured voice lobby when the custom ends.
- Manual ending and automatic inactivity cleanup.
- Persistent SQLite state with restart recovery and channel repair.
- Configurable category and channel names.
- Rotating Discord bot presence based on setup, draft, live, and cleanup states.

## Create and install the Discord bot

1. Create an application in the
   [Discord Developer Portal](https://discord.com/developers/applications).
2. Open **Bot**, create a bot token, and keep it private.
3. Copy the **Application ID** from **General Information**.
4. Under **Installation**, enable a Guild Install with the `bot` and
   `applications.commands` scopes.
5. Grant these bot permissions:
   - View Channels
   - Send Messages and Send Messages in Threads
   - Read Message History
   - Create and Manage Threads
   - Manage Channels and Manage Roles
   - Move Members
   - Connect, Speak, Video, Use Soundboard, Use External Sounds, and Send Voice
     Messages
6. Use the generated installation link to add the bot to your Discord servers.

The client secret is not used. SkyCustoms only needs the bot token and
Application ID.

## Docker

Copy the environment template and fill in the bot token and Application ID:

```sh
cp .env.example .env
```

Build and run:

```sh
docker build -t skycustoms -f Containerfile .
docker volume create skycustoms-data
docker run -d \
  --name skycustoms \
  --restart unless-stopped \
  --env-file .env \
  -e DATABASE_PATH=/data/skycustoms.sqlite \
  -v skycustoms-data:/data \
  skycustoms
```

View logs with:

```sh
docker logs -f skycustoms
```

SkyCustoms writes logs to standard output and does not set a retention period.
Docker, Podman, or systemd keeps and rotates them according to the host's
logging configuration. For the Quadlet deployment, inspect retained logs with
`journalctl --user -u skycustoms.service`; configure `journald.conf` on the
server if a fixed retention limit is required.

For development with automatic TypeScript restarts:

```sh
docker compose -f compose.dev.yaml up --build
```

The named data volumes contain `/data/skycustoms.sqlite`, including every
server's setup and active customs. Replacing or deleting only a container keeps
this data. Removing `skycustoms-data`, or running `docker compose down -v` for
development, permanently removes the corresponding database.

## Rootless Podman with systemd

Build the image and create the token secret:

```sh
podman build -t localhost/skycustoms:latest -f Containerfile .
read -rsp "Discord token: " TOKEN
printf '%s' "$TOKEN" | podman secret create skycustoms-discord-token -
unset TOKEN
```

Install the included Quadlets:

```sh
mkdir -p ~/.config/skycustoms ~/.config/containers/systemd
cp deploy/skycustoms.env.example ~/.config/skycustoms/skycustoms.env
cp deploy/skycustoms.container deploy/skycustoms-data.volume \
  ~/.config/containers/systemd/
chmod 600 ~/.config/skycustoms/skycustoms.env
```

Set `DISCORD_CLIENT_ID` in
`~/.config/skycustoms/skycustoms.env`, then start the user service:

```sh
sudo loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user start skycustoms.service
journalctl --user -u skycustoms.service -f
```

## Discord setup

Create a Discord category containing:

- A text channel for SkyCustoms control threads.
- A voice channel where players return after customs.

The server owner then runs:

```text
/setup lobby text-channel:#customs-lobby voice-channel:Custom Lobby
/setup host-user action:Add
/setup host-role action:Add role:@Custom Hosts
/setup status
```

The `host-user` command opens a private selector where the server owner can add
or remove up to 25 users at once.

Create and start a custom:

```text
/custom create name:CS2 5v5 teams:2 mode:Direct assignment
```

SkyCustoms immediately posts one leader selector for each team. After assigning
the leaders, use the control panel's **Manage** button. Creators see custom
controls, while leaders see only their team controls. Adding and removing
players opens a selector for up to 25 users.

Direct slash commands remain available as shortcuts. Team arguments use
autocomplete labels instead of team numbers:

```text
/team leader team:<choose a team> user:@LeaderOne
/team add team:<choose a team>
/custom rename name:Friday 5v5
/custom start
```

For managed drafts, choose `Managed draft`, assign every leader, then use
`/draft start`, `/draft pick`, and `/draft finish`.

End a custom with `/custom end`. Successful cleanup deletes its temporary
category, channels, rosters, and draft data. Server configuration and host
grants remain in SQLite.

Optional naming templates:

```text
/setup naming category-format:🎮 {custom} channel-format:T{number:02} • {team}
```

Supported placeholders are `{custom}`, `{team}`, `{number}`, and
`{number:02}`.

## Automatic deployment

The included GitHub Actions workflow deploys `main` over SSH using rootless
Podman and the supplied Quadlets.

Prepare the server once as the deployment user:

```sh
sudo mkdir -p /opt/skycustoms
sudo chown "$USER:$USER" /opt/skycustoms
git clone https://github.com/ahmad-fatayerji/SkyCustoms.git /opt/skycustoms
sudo loginctl enable-linger "$USER"
```

Add these GitHub Actions repository secrets:

- `SSH_HOST`
- `SSH_USER`
- `SSH_PRIVATE_KEY`
- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`

Optional repository variables:

- `LOG_LEVEL` (default: `info`)
- `PRESENCE_ROTATION_SECONDS` (default: `45`)

Every push to `main` fast-forwards the server checkout, builds
`localhost/skycustoms:latest`, updates the Podman secret and environment,
installs the Quadlets, and restarts `skycustoms.service`.
