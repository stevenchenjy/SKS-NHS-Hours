import { AlertCircle, Archive, CheckCircle2, CircleDashed, Clock3, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { HourRequestStatus, MembershipStatus } from "@/lib/types";

type Status =
  | HourRequestStatus
  | MembershipStatus
  | "inactive"
  | "closed"
  | "upcoming"
  | "at_goal"
  | "below_goal";

const presentation: Record<
  Status,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  approved: {
    label: "Approved",
    className: "bg-[var(--status-approved-bg)] text-[var(--status-approved)]",
    icon: CheckCircle2,
  },
  pending: {
    label: "Pending",
    className: "bg-[var(--status-pending-bg)] text-[var(--status-pending)]",
    icon: Clock3,
  },
  changes_requested: {
    label: "Changes requested",
    className: "bg-[var(--status-pending-bg)] text-[var(--status-pending)]",
    icon: AlertCircle,
  },
  rejected: {
    label: "Rejected",
    className: "bg-destructive/10 text-destructive",
    icon: XCircle,
  },
  withdrawn: {
    label: "Withdrawn",
    className: "bg-[var(--status-neutral-bg)] text-[var(--status-neutral)]",
    icon: Archive,
  },
  draft: {
    label: "Draft",
    className: "bg-[var(--status-neutral-bg)] text-[var(--status-neutral)]",
    icon: CircleDashed,
  },
  active: {
    label: "Active",
    className: "bg-[var(--status-approved-bg)] text-[var(--status-approved)]",
    icon: CheckCircle2,
  },
  inactive: {
    label: "Inactive",
    className: "bg-destructive/10 text-destructive",
    icon: XCircle,
  },
  upcoming: {
    label: "Upcoming",
    className: "bg-[var(--status-pending-bg)] text-[var(--status-pending)]",
    icon: Clock3,
  },
  closed: {
    label: "Closed",
    className: "bg-[var(--status-neutral-bg)] text-[var(--status-neutral)]",
    icon: Archive,
  },
  expired: {
    label: "Expired",
    className: "bg-[var(--status-neutral-bg)] text-[var(--status-neutral)]",
    icon: Archive,
  },
  suspended: {
    label: "Suspended",
    className: "bg-destructive/10 text-destructive",
    icon: XCircle,
  },
  archived: {
    label: "Archived",
    className: "bg-[var(--status-neutral-bg)] text-[var(--status-neutral)]",
    icon: Archive,
  },
  at_goal: {
    label: "Requirement met",
    className: "bg-[var(--status-approved-bg)] text-[var(--status-approved)]",
    icon: CheckCircle2,
  },
  below_goal: {
    label: "Below requirement",
    className: "bg-[var(--status-pending-bg)] text-[var(--status-pending)]",
    icon: Clock3,
  },
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const item = presentation[status];
  const Icon = item.icon;
  return (
    <Badge
      variant="outline"
      className={cn("h-6 gap-1.5 border-transparent px-2.5", item.className, className)}
    >
      <Icon aria-hidden="true" data-icon="inline-start" />
      {item.label}
    </Badge>
  );
}
