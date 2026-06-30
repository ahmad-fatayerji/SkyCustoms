import { UserError } from "./errors.js";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/gu;
const REPEATED_WHITESPACE = /\s+/gu;
const RESERVED_SEPARATOR = "•";

export function normalizeDisplayName(input: string, label: string): string {
  const normalized = input
    .normalize("NFKC")
    .replace(CONTROL_CHARACTERS, "")
    .replace(REPEATED_WHITESPACE, " ")
    .trim();

  if (!normalized) {
    throw new UserError(`${label} cannot be empty.`);
  }
  if (normalized.includes(RESERVED_SEPARATOR)) {
    throw new UserError(`${label} cannot contain the reserved “•” separator.`);
  }
  return normalized;
}

export function normalizeTeamName(input: string): string {
  const name = normalizeDisplayName(input, "Team name");
  if (name.length > 64) {
    throw new UserError("Team name must be 64 characters or fewer.");
  }
  return name;
}

export function normalizeCustomName(input: string): string {
  const name = normalizeDisplayName(input, "Custom name");
  if (name.length > 48) {
    throw new UserError("Custom name must be 48 characters or fewer.");
  }
  return name;
}

export function renderTeamChannelName(
  customName: string,
  ordinal: number,
  teamName: string,
): string {
  const rendered = `${customName} • T${String(ordinal).padStart(2, "0")} • ${teamName}`;
  if (rendered.length > 100) {
    throw new UserError(
      "The custom name and team name together exceed Discord’s 100-character channel-name limit.",
    );
  }
  return rendered;
}

export function normalizedNameKey(name: string): string {
  return name.normalize("NFKC").toLocaleLowerCase("en-US");
}
