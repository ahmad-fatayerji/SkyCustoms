import { UserError } from "../domain/errors.js";
import type { Repository } from "../db/repository.js";
import type { Custom } from "../domain/types.js";

export interface Actor {
  guildId: string;
  userId: string;
  roleIds: string[];
  isOwner: boolean;
  isAdministrator: boolean;
}

export class Authorizer {
  public constructor(private readonly repository: Repository) {}

  public requireOwner(actor: Actor): void {
    if (!actor.isOwner) {
      throw new UserError("Only the Discord server owner can do that.");
    }
  }

  public requireHost(actor: Actor): void {
    if (
      actor.isOwner ||
      actor.isAdministrator ||
      this.repository.isHost(actor.guildId, actor.userId, actor.roleIds)
    ) {
      return;
    }
    throw new UserError("You are not configured as a SkyCustoms host.");
  }

  public requireCustomCreatorOrOverride(actor: Actor, custom: Custom): void {
    if (
      actor.userId === custom.creatorId ||
      actor.isOwner ||
      actor.isAdministrator
    ) {
      return;
    }
    throw new UserError("Only this custom’s creator can do that.");
  }
}
