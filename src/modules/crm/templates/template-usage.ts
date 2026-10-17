import { prisma } from "@/core/db/client";

/**
 * Where a template is used. Each consumer registers one provider: Phase 12
 * registers "Conversation messages"; future sequences / workflows / reminders
 * register theirs (counting their own references), without the template
 * tables knowing about them.
 *
 * `activeReferences` are live uses (an active workflow step, a running
 * sequence). A template with active references can't be archived — the
 * consumer must stop using it first. Templates are never hard-deleted.
 */
export interface TemplateUsageReference {
  label: string;
  href?: string | null;
}

export interface TemplateUsageSummary {
  key: string;
  label: string;
  /** Total uses (e.g. messages sent). */
  count: number;
  lastUsedAt: Date | null;
  /** Uses per template version number. */
  byVersion: Record<number, number>;
  /** Live references that block archiving. */
  activeReferences: TemplateUsageReference[];
}

export interface TemplateUsageProvider {
  key: string;
  label: string;
  summarize(companyId: string, templateId: string): Promise<Omit<TemplateUsageSummary, "key" | "label">>;
  /** Total uses for many templates at once (list pages) — one query. */
  countMany?(companyId: string, templateIds: string[]): Promise<Map<string, number>>;
}

const providers: TemplateUsageProvider[] = [];

export function registerTemplateUsageProvider(provider: TemplateUsageProvider) {
  const i = providers.findIndex((p) => p.key === provider.key);
  if (i >= 0) providers[i] = provider;
  else providers.push(provider);
}

export function templateUsageProviders(): readonly TemplateUsageProvider[] {
  return providers;
}

export async function templateUsage(companyId: string, templateId: string): Promise<TemplateUsageSummary[]> {
  return Promise.all(providers.map(async (p) => ({ key: p.key, label: p.label, ...(await p.summarize(companyId, templateId)) })));
}

export async function templateUsageCounts(companyId: string, templateIds: string[]): Promise<Map<string, number>> {
  const total = new Map<string, number>();
  if (!templateIds.length) return total;
  for (const p of providers) {
    if (!p.countMany) continue;
    for (const [id, n] of await p.countMany(companyId, templateIds)) total.set(id, (total.get(id) ?? 0) + n);
  }
  return total;
}

// ── Phase 12: messages sent from a template in Unified Conversations ──

registerTemplateUsageProvider({
  key: "conversation_messages",
  label: "Messages sent from the Inbox",
  async summarize(companyId, templateId) {
    const [agg, versions] = await Promise.all([
      prisma.crmMessage.aggregate({ where: { companyId, templateId }, _count: { _all: true }, _max: { occurredAt: true } }),
      prisma.crmMessage.groupBy({ by: ["templateVersionId"], where: { companyId, templateId }, _count: { _all: true } }),
    ]);
    const numbers = versions.length ? await prisma.crmMessageTemplateVersion.findMany({ where: { id: { in: versions.map((v) => v.templateVersionId!).filter(Boolean) } }, select: { id: true, versionNumber: true } }) : [];
    const byVersion: Record<number, number> = {};
    for (const v of versions) {
      const n = numbers.find((x) => x.id === v.templateVersionId)?.versionNumber;
      if (n) byVersion[n] = v._count._all;
    }
    // A sent message is history, not a live reference: it never blocks archiving.
    return { count: agg._count._all, lastUsedAt: agg._max.occurredAt, byVersion, activeReferences: [] };
  },
  async countMany(companyId, templateIds) {
    const rows = await prisma.crmMessage.groupBy({ by: ["templateId"], where: { companyId, templateId: { in: templateIds } }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.templateId!, r._count._all]));
  },
});
