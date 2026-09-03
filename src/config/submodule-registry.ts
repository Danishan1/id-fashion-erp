/**
 * Client-safe registry of tabbed-masters "submodules" a Super Admin can hide
 * per company (see SubmoduleVisibilityService). Onboarding a future group
 * (e.g. Garment Attributes' tabs) means adding entries here plus one
 * existence-check function in submodule-data-checks.ts -- nothing else in
 * the mechanism changes. Deliberately zero Prisma/server imports so client
 * components (FabricConfigClient, the consumer forms) can import this
 * directly.
 */
export const SUBMODULE_REGISTRY = {
  FABRIC_GSM: { label: "GSM", group: "Fabric Configuration" },
  FABRIC_DYE: { label: "Dye", group: "Fabric Configuration" },
  FABRIC_WEAVE_TYPE: { label: "Weave Type", group: "Fabric Configuration" },
  FABRIC_WIDTH: { label: "Width", group: "Fabric Configuration" },
  FABRIC_COMPOSITION: { label: "Composition", group: "Fabric Configuration" },
} as const;

export type SubmoduleKey = keyof typeof SUBMODULE_REGISTRY;

export const SUBMODULE_KEYS = Object.keys(SUBMODULE_REGISTRY) as SubmoduleKey[];

export function isSubmoduleKey(value: string): value is SubmoduleKey {
  return Object.prototype.hasOwnProperty.call(SUBMODULE_REGISTRY, value);
}
