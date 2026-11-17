// Who performed an action. AI and system actors are never users and never hold roles (spec FR-009);
// they appear only as the actor type on audit and outbox rows.
export const ACTOR_TYPES = ["human", "ai", "system"] as const;

export type ActorType = (typeof ACTOR_TYPES)[number];

export function isActorType(value: unknown): value is ActorType {
  return typeof value === "string" && (ACTOR_TYPES as readonly string[]).includes(value);
}

export function isHumanActor(actorType: ActorType): boolean {
  return actorType === "human";
}
