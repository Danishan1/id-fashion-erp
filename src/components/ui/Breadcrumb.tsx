import Link from "next/link";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-zinc-300 dark:text-zinc-700">/</span>}
            {item.href && !isLast ? (
              <Link href={item.href} className="text-zinc-500 hover:text-indigo-600 dark:text-zinc-400 dark:hover:text-indigo-400">
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? "font-medium text-zinc-700 dark:text-zinc-200" : "text-zinc-500 dark:text-zinc-400"}>
                {item.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
