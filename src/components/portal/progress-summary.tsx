import type { ProgressRecord } from "@/lib/types";

function number(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hours(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function getProgressPresentation(progress: ProgressRecord) {
  const approved = number(progress.approved_hours);
  const pending = number(progress.pending_hours);
  const changesRequested = number(progress.changes_requested_hours);
  const target = number(progress.target_hours);
  const remaining = number(progress.remaining_hours);
  const over = number(progress.over_goal_hours);
  const actual = number(progress.actual_percentage);
  const approvedVisual = Math.min(Math.max(actual, 0), 100);
  const pendingPercentage = target > 0 ? Math.max((pending / target) * 100, 0) : 0;
  const pendingVisual =
    target > 0 ? Math.min(pendingPercentage, Math.max(100 - approvedVisual, 0)) : 0;
  const changesRequestedPercentage =
    target > 0 ? Math.max((changesRequested / target) * 100, 0) : 0;
  const changesRequestedVisual =
    target > 0
      ? Math.min(changesRequestedPercentage, Math.max(100 - approvedVisual - pendingVisual, 0))
      : 0;
  const summary = `${hours(approved)} of ${hours(target)} approved · ${hours(pending)} pending · ${hours(changesRequested)} changes requested · ${
    over > 0
      ? `${hours(over)} approved hours over requirement`
      : `${hours(Math.max(remaining, 0))} approved hours remaining`
  }`;

  return {
    actual,
    approved,
    approvedVisual,
    changesRequested,
    changesRequestedPercentage,
    changesRequestedVisual,
    pending,
    pendingPercentage,
    pendingVisual,
    summary,
    target,
    total: approved + pending + changesRequested,
  };
}

export function ProgressSummary({
  progress,
  compact = false,
}: {
  progress: ProgressRecord;
  compact?: boolean;
}) {
  const {
    actual,
    approved,
    approvedVisual,
    changesRequested,
    changesRequestedPercentage,
    changesRequestedVisual,
    pending,
    pendingPercentage,
    pendingVisual,
    summary,
    target,
    total,
  } = getProgressPresentation(progress);

  return (
    <div className={compact ? "min-w-0 space-y-2" : "space-y-4"}>
      {!compact && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-base font-medium">Service-hour progress</p>
          <span className="text-base text-muted-foreground">
            {hours(actual)}% approved · {hours(pendingPercentage)}% pending ·{" "}
            {hours(changesRequestedPercentage)}% changes requested
          </span>
        </div>
      )}
      <div
        role="progressbar"
        aria-label="Approved service-hour progress"
        aria-valuemin={0}
        aria-valuemax={target > 0 ? target : 100}
        aria-valuenow={Math.min(Math.max(approved, 0), target > 0 ? target : 100)}
        aria-valuetext={summary}
        className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--status-neutral-bg)]"
      >
        <span
          data-progress-segment="approved"
          className="h-full shrink-0 bg-[var(--status-approved)] transition-[width]"
          style={{ width: `${approvedVisual}%` }}
        />
        <span
          data-progress-segment="pending"
          className="h-full shrink-0 bg-[var(--status-pending)] transition-[width]"
          style={{ width: `${pendingVisual}%` }}
        />
        <span
          data-progress-segment="changes-requested"
          className="h-full shrink-0 bg-[var(--status-pending)] opacity-50 transition-[width]"
          style={{ width: `${changesRequestedVisual}%` }}
        />
      </div>
      <dl
        aria-label="Progress legend"
        className={
          compact
            ? "flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"
            : "flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground"
        }
      >
        <div className={compact ? "flex items-center gap-1.5" : "flex items-center gap-2"}>
          <span className="size-2.5 rounded-full bg-[var(--status-approved)]" aria-hidden="true" />
          <dt>Approved</dt>
          <dd className="font-semibold text-foreground">{hours(approved)}</dd>
        </div>
        <div className={compact ? "flex items-center gap-1.5" : "flex items-center gap-2"}>
          <span className="size-2.5 rounded-full bg-[var(--status-pending)]" aria-hidden="true" />
          <dt>Pending</dt>
          <dd className="font-semibold text-foreground">{hours(pending)}</dd>
        </div>
        <div className={compact ? "flex items-center gap-1.5" : "flex items-center gap-2"}>
          <span
            className="size-2.5 rounded-full bg-[var(--status-pending)] opacity-50"
            aria-hidden="true"
          />
          <dt>Changes requested</dt>
          <dd className="font-semibold text-foreground">{hours(changesRequested)}</dd>
        </div>
        <div className={compact ? "flex items-center gap-1.5" : "flex items-center gap-2"}>
          <span className="size-2.5 rounded-full bg-[var(--status-neutral)]" aria-hidden="true" />
          <dt title="Approved, pending, and changes requested hours">Total</dt>
          <dd className="font-semibold text-foreground">{hours(total)}</dd>
        </div>
      </dl>
    </div>
  );
}

export { hours as formatHours };
