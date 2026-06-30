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
});
