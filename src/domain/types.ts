export type CustomMode = "direct" | "draft";
export type CustomStatus =
  | "creating"
  | "setup"
  | "drafting"
  | "active"
  | "ending";
export type SpectatorMode = "off" | "silent" | "speak";
export type GrantType = "user" | "role";

export interface GuildConfig {
  guildId: string;
  lobbyChannelId: string;
  voiceLobbyChannelId: string | null;
  categoryFormat: string;
  channelFormat: string;
  createdAt: number;
  updatedAt: number;
}

export interface Custom {
  id: string;
  shortId: string;
  guildId: string;
  creatorId: string;
  name: string;
  mode: CustomMode;
  status: CustomStatus;
  categoryId: string | null;
  threadId: string | null;
  starterMessageId: string | null;
  panelMessageId: string | null;
  draftOrder: number[] | null;
  everOccupied: boolean;
  emptySince: number | null;
  setupDeadline: number;
  setupTimeoutMinutes: number;
  emptyTimeoutMinutes: number;
  warningSentFor: number | null;
  startedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Team {
  id: number;
  customId: string;
  ordinal: number;
  name: string;
  leaderId: string | null;
  voiceChannelId: string | null;
  leaderPromptMessageId: string | null;
  spectatorMode: SpectatorMode;
}

export interface TeamMember {
  guildId: string;
  customId: string;
  teamId: number;
  userId: string;
  createdAt: number;
}

export interface DraftAction {
  id: number;
  customId: string;
  sequence: number;
  teamId: number;
  actorId: string;
  actionType: "pick" | "pass";
  memberId: string | null;
  createdAt: number;
}

export interface CustomAggregate {
  custom: Custom;
  teams: Array<Team & { members: TeamMember[] }>;
  draftActions: DraftAction[];
}
