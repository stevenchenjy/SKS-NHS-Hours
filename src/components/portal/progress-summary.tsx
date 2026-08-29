import { Progress, ProgressLabel } from "@/components/ui/progress";
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

export function ProgressSummary({
  progress,
  compact = false,
}: {
  progress: ProgressRecord;
  compact?: boolean;
}) {
  const approved = number(progress.approved_hours);
  const pending = number(progress.pending_hours);
  const target = number(progress.target_hours);
  const remaining = number(progress.remaining_hours);
  const over = number(progress.over_goal_hours);
  const actual = number(progress.actual_percentage);
  const visual = Math.min(Math.max(actual, 0), 100);
  const summary = [
    `${hours(approved)} of ${hours(target)} approved`,
    `${hours(actual)}% complete`,
    pending > 0 ? `${hours(pending)} pending` : null,
    remaining > 0 ? `${hours(remaining)} approved hours remaining` : null,
    over > 0 ? `${hours(over)} hours over goal` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={compact ? "space-y-2" : "space-y-4"}>
      <Progress value={visual} aria-label={summary} className="gap-2">
        <ProgressLabel className={compact ? "text-sm" : "text-base"}>
          Approved progress
        </ProgressLabel>
        <span
          className={
            compact
              ? "ml-auto text-sm text-muted-foreground"
              : "ml-auto text-base text-muted-foreground"
          }
        >
          {hours(actual)}%
        </span>
      </Progress>
      <p className={compact ? "text-sm text-muted-foreground" : "text-base text-muted-foreground"}>
        {summary}
      </p>
    </div>
  );
}

export { hours as formatHours };
