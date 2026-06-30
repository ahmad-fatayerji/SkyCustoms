import { ApplicationCommandOptionType } from "discord.js";
import { describe, expect, it } from "vitest";
import { commandDefinitions } from "../src/discord/commands.js";

describe("command definitions", () => {
  it("uses a multi-user selector for host-user setup", () => {
    const setup = commandDefinitions.find(
      (command) => command.name === "setup",
    );
    const hostUser = setup?.options?.find(
      (option) =>
        option.type === ApplicationCommandOptionType.Subcommand &&
        option.name === "host-user",
    );

    expect(hostUser).toBeDefined();
    expect(hostUser?.options?.map((option) => option.name)).toEqual(["action"]);
  });

  it("uses autocompleted team targets and interactive bulk rosters", () => {
    const team = commandDefinitions.find((command) => command.name === "team");
    const rename = team?.options?.find((option) => option.name === "rename");
    const add = team?.options?.find((option) => option.name === "add");
    const teamOption = rename?.options?.find(
      (option) => option.name === "team",
    );

    expect(teamOption?.type).toBe(ApplicationCommandOptionType.String);
    expect("autocomplete" in (teamOption ?? {}) && teamOption.autocomplete).toBe(
      true,
    );
    expect(add?.options?.map((option) => option.name)).toEqual(["team"]);
  });

  it("registers custom renaming", () => {
    const custom = commandDefinitions.find(
      (command) => command.name === "custom",
    );
    expect(custom?.options?.some((option) => option.name === "rename")).toBe(
      true,
    );
  });
});
