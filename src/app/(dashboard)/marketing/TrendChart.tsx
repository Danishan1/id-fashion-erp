import { formatNumber } from "@/lib/currency";

/**
 * A minimal, dependency-free SVG line chart — this project has no charting
 * library installed anywhere, and a 30-point daily series doesn't justify
 * adding one (recharts/d3/etc.) for a single dashboard. Pure presentational,
 * no client-side interactivity, so it works fine inside a Server Component
 * page like /marketing.
 */
export function TrendChart({
  title,
  data,
  color = "#4f46e5",
  format = (v: number) => formatNumber(v),
}: {
  title: string;
  data: Array<{ date: string; value: number }>;
  color?: string;
  format?: (value: number) => string;
}) {
  const width = 400;
  const height = 120;
  const padding = 8;

  const max = Math.max(1, ...data.map((d) => d.value));
  const stepX = data.length > 1 ? (width - padding * 2) / (data.length - 1) : 0;

  const points = data.map((d, i) => {
    const x = padding + i * stepX;
    const y = height - padding - (d.value / max) * (height - padding * 2);
    return `${x},${y}`;
  });

  const areaPoints = `${padding},${height - padding} ${points.join(" ")} ${width - padding},${height - padding}`;
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const latest = data[data.length - 1]?.value ?? 0;

  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-medium uppercase text-zinc-500">{title}</h3>
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{format(latest)} today</span>
      </div>
      {total === 0 ? (
        <p className="flex h-[120px] items-center justify-center text-xs text-zinc-400">No data in this period.</p>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none">
          <polygon points={areaPoints} fill={color} fillOpacity={0.1} />
          <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      )}
      <div className="mt-1 flex justify-between text-xs text-zinc-400">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}
