/**
 * Fixed, built-in catalog for AI Designer's Model screen (Step 7 — gender,
 * body type, pose) — genuinely new content with no equivalent anywhere else
 * in this codebase.
 */

export const MODEL_GENDERS = ["Male", "Female", "Kid", "Baby"] as const;
export type ModelGender = (typeof MODEL_GENDERS)[number];

export const BODY_TYPES = ["Slim", "Regular", "Athletic", "Plus Size"] as const;
export type BodyType = (typeof BODY_TYPES)[number];

export const POSES = ["Front", "Back", "Side", "Walking", "Standing"] as const;
export type Pose = (typeof POSES)[number];

export function isModelGender(value: string): value is ModelGender {
  return (MODEL_GENDERS as readonly string[]).includes(value);
}
export function isBodyType(value: string): value is BodyType {
  return (BODY_TYPES as readonly string[]).includes(value);
}
export function isPose(value: string): value is Pose {
  return (POSES as readonly string[]).includes(value);
}
