import type { ReactNode } from "react";

export interface MetricItem {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}

export function MetricRail({ items }: { items: MetricItem[] }) {
  return (
    <dl className="grid border-y bg-background sm:grid-cols-2 xl:grid-cols-5">
      {items.map((item) => (
        <div
          key={item.label}
          className="border-b px-5 py-5 last:border-b-0 sm:even:border-l sm:[&:nth-last-child(-n+2)]:border-b-0 xl:border-b-0 xl:border-l xl:first:border-l-0"
        >
          <dt className="text-sm font-medium text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 text-3xl font-bold tracking-tight text-foreground">{item.value}</dd>
          {item.detail ? (
            <dd className="mt-1 text-sm text-muted-foreground">{item.detail}</dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
