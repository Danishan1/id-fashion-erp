import { CrmBadge, type CrmBadgeTone } from "@/components/crm/CrmBadge";

const TONES = new Set(["neutral", "indigo", "green", "amber", "red"]);

export function LeadStatusBadge({ status }: { status: { name: string; color: string | null; kind?: string } }) {
  const tone = (status.color && TONES.has(status.color) ? status.color : "neutral") as CrmBadgeTone;
  return <CrmBadge label={status.name} tone={tone} />;
}

const TEMPERATURE: Record<string, { label: string; tone: CrmBadgeTone }> = {
  HOT: { label: "Hot", tone: "red" },
  WARM: { label: "Warm", tone: "amber" },
  COLD: { label: "Cold", tone: "indigo" },
};

export function LeadTemperatureBadge({ temperature }: { temperature: string | null }) {
  if (!temperature || !TEMPERATURE[temperature]) return <span className="text-zinc-400">—</span>;
  return <CrmBadge label={TEMPERATURE[temperature].label} tone={TEMPERATURE[temperature].tone} />;
}

export function OwnerName({ owner, inactive }: { owner: { fullName: string } | null; inactive?: boolean }) {
  if (!owner) return <span className="text-zinc-500 dark:text-zinc-400">Unassigned</span>;
  return (
    <span>
      {owner.fullName}
      {inactive && <span className="ml-1 text-xs text-amber-600 dark:text-amber-400">(inactive)</span>}
    </span>
  );
}
