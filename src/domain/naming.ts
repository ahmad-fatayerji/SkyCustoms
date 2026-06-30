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

function normalizeTemplate(input: string, label: string): string {
  const template = input
    .normalize("NFKC")
    .replace(CONTROL_CHARACTERS, "")
    .trim();
  if (!template) throw new UserError(`${label} cannot be empty.`);
  if (template.length > 100) {
    throw new UserError(`${label} must be 100 characters or fewer.`);
  }
  return template;
}

function rejectUnknownPlaceholders(
  template: string,
  allowed: readonly string[],
): void {
  const placeholders = template.match(/\{[^{}]*\}/gu) ?? [];
  const unknown = placeholders.find(
    (placeholder) => !allowed.includes(placeholder),
  );
  if (unknown || /[{}]/u.test(template.replace(/\{[^{}]*\}/gu, ""))) {
    throw new UserError(
      `Unknown naming placeholder${unknown ? ` ${unknown}` : ""}.`,
    );
  }
}

export function validateCategoryFormat(input: string): string {
  const template = normalizeTemplate(input, "Category format");
  rejectUnknownPlaceholders(template, ["{custom}"]);
  if (!template.includes("{custom}")) {
    throw new UserError("Category format must include {custom}.");
  }
  return template;
}

export function validateChannelFormat(input: string): string {
  const template = normalizeTemplate(input, "Channel format");
  rejectUnknownPlaceholders(template, [
    "{custom}",
    "{team}",
    "{number}",
    "{number:02}",
  ]);
  if (!template.includes("{team}")) {
    throw new UserError("Channel format must include {team}.");
  }
  return template;
}

export function renderCategoryName(
  format: string,
  customName: string,
): string {
  const rendered = validateCategoryFormat(format).replaceAll(
    "{custom}",
    customName,
  );
  if (rendered.length > 100) {
    throw new UserError(
      "The configured category format exceeds Discord’s 100-character limit for this custom name.",
    );
  }
  return rendered;
}

export function renderTeamChannelName(
  format: string,
  customName: string,
  ordinal: number,
  teamName: string,
): string {
  const rendered = validateChannelFormat(format)
    .replaceAll("{custom}", customName)
    .replaceAll("{number:02}", String(ordinal).padStart(2, "0"))
    .replaceAll("{number}", String(ordinal))
    .replaceAll("{team}", teamName);
  if (rendered.length > 100) {
    throw new UserError(
      "The configured channel format exceeds Discord’s 100-character limit for this team.",
    );
  }
  return rendered;
}

export function normalizedNameKey(name: string): string {
  return name.normalize("NFKC").toLocaleLowerCase("en-US");
}
