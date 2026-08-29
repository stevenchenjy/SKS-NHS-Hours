import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-col gap-5 border-b pb-7 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-2 text-sm font-semibold text-primary">{eyebrow}</div> : null}
        <h1 className="text-balance text-[2.1rem] leading-[1.08] font-bold tracking-[-0.035em] sm:text-[2.45rem]">
          {title}
        </h1>
        {description ? (
          <div className="mt-3 max-w-3xl text-base leading-7 text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
