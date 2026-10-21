import { z } from "zod";

export const MATERIAL_SUBSTITUTION_REASONS = ["ORIGINAL_MATERIAL_NOT_AVAILABLE", "QUALITY_ISSUE", "OTHER"] as const;

export const proposeMaterialSubstitutionSchema = z.object({
  substituteMaterialId: z.string().uuid(),
  // Colour of the substitute stock (2026-10-21); null/empty = "No colour"
  // stock. The same material is a valid substitute in a different colour.
  substituteColorId: z.string().uuid().nullable().optional().or(z.literal("")),
  quantity: z.number().positive(),
  uomId: z.string().uuid(),
  reason: z.enum(MATERIAL_SUBSTITUTION_REASONS).default("OTHER"),
  remarks: z.string().trim().max(1000).nullable().optional(),
  // Authorized Production Manager/Supervisor fast path ("Substitute +
  // Approve + Issue in one controlled action" — the user's own explicit
  // decision #3): still creates the SAME complete PENDING-then-decided
  // record, just in one call. Requires `production`/`approve` — rejected
  // outright for anyone without it, never silently downgraded to a plain
  // PENDING propose, so a direct API call can't quietly bypass the fast
  // path's own authorization gate.
  autoApprove: z.boolean().default(false),
});

export type ProposeMaterialSubstitutionInput = z.infer<typeof proposeMaterialSubstitutionSchema>;

export const decideMaterialSubstitutionSchema = z.object({
  approvalRemark: z.string().trim().max(1000).nullable().optional(),
});

export type DecideMaterialSubstitutionInput = z.infer<typeof decideMaterialSubstitutionSchema>;

export const issueSubstituteMaterialSchema = z.object({
  warehouseLocationId: z.string().uuid().optional().or(z.literal("")),
  issueWarehouseId: z.string().uuid().optional().or(z.literal("")),
});

export type IssueSubstituteMaterialInput = z.infer<typeof issueSubstituteMaterialSchema>;
