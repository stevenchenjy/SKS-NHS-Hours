import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  History,
  Plus,
  Tag,
  UserRound,
} from "lucide-react";

import { HourRequestForm } from "@/components/hours/hour-request-form";
import { AppShell } from "@/components/portal/app-shell";
import { MetricRail } from "@/components/portal/metric-rail";
import { PageHeader } from "@/components/portal/page-header";
import { ProgressSummary, formatHours } from "@/components/portal/progress-summary";
import { StatusBadge } from "@/components/portal/status-badge";
import { ReviewDecisionPanel } from "@/components/review/review-decision-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requirePlatformOwner } from "@/lib/dal/access";
import type {
  HourRequestStatus,
  ProgressRecord,
  ReviewerOption,
  ServiceCategory,
  Viewer,
} from "@/lib/types";

export const metadata: Metadata = { title: "Role preview", robots: { index: false } };

const memberViewer: Viewer = {
  id: "10000000-0000-4000-8000-000000000001",
  email: "maya.chen@example.edu",
  profile: {
    id: "10000000-0000-4000-8000-000000000001",
    email: "maya.chen@example.edu",
    full_name: "Maya Chen",
    status: "active",
    deactivated_at: null,
    created_at: "2026-08-01T12:00:00Z",
    updated_at: "2026-08-01T12:00:00Z",
  },
  activeMembership: {
    id: "20000000-0000-4000-8000-000000000001",
    profile_id: "10000000-0000-4000-8000-000000000001",
    school_year_id: "30000000-0000-4000-8000-000000000001",
    status: "active",
    expiration_date: "2027-06-30",
    target_hours_override: null,
    renewed_from_membership_id: null,
    created_at: "2026-08-01T12:00:00Z",
    school_year: {
      id: "30000000-0000-4000-8000-000000000001",
      label: "2026–2027",
      start_date: "2026-07-01",
      end_date: "2027-06-30",
      default_target_hours: 20,
      status: "active",
      created_at: "2026-06-01T12:00:00Z",
      closed_at: null,
    },
    roles: ["member"],
  },
  memberships: [],
  roles: ["member"],
  globalAccessLevel: null,
  isMember: true,
  canReview: false,
  isTeacherAdmin: false,
  isPlatformOwner: false,
};
memberViewer.memberships = memberViewer.activeMembership ? [memberViewer.activeMembership] : [];

const committeeHeadViewer: Viewer = {
  ...memberViewer,
  activeMembership: memberViewer.activeMembership
    ? { ...memberViewer.activeMembership, roles: ["member", "committee_head"] }
    : null,
  roles: ["member", "committee_head"],
  canReview: true,
};
committeeHeadViewer.memberships = committeeHeadViewer.activeMembership
  ? [committeeHeadViewer.activeMembership]
  : [];

const presidentViewer: Viewer = {
  ...memberViewer,
  activeMembership: memberViewer.activeMembership
    ? { ...memberViewer.activeMembership, roles: ["member", "president_vice_president"] }
    : null,
  roles: ["member", "president_vice_president"],
  canReview: true,
};
presidentViewer.memberships = presidentViewer.activeMembership
  ? [presidentViewer.activeMembership]
  : [];

const adminViewer: Viewer = {
  ...memberViewer,
  id: "10000000-0000-4000-8000-000000000008",
  email: "avery.morgan@example.edu",
  profile: {
    ...memberViewer.profile,
    id: "10000000-0000-4000-8000-000000000008",
    email: "avery.morgan@example.edu",
    full_name: "Avery Morgan",
  },
  activeMembership: null,
  memberships: [],
  roles: [],
  globalAccessLevel: "teacher_admin",
  isMember: false,
  canReview: true,
  isTeacherAdmin: true,
  isPlatformOwner: false,
};

const progress: ProgressRecord = {
  membership_id: "20000000-0000-4000-8000-000000000001",
  profile_id: "10000000-0000-4000-8000-000000000001",
  school_year_id: "30000000-0000-4000-8000-000000000001",
  full_name: "Maya Chen",
  email: "maya.chen@example.edu",
  membership_status: "active",
  target_hours: 20,
  approved_hours: 14.5,
  pending_hours: 3.25,
  changes_requested_hours: 1.5,
  rejected_hours: 0,
  remaining_hours: 5.5,
  over_goal_hours: 0,
  actual_percentage: 72.5,
  approved_count: 5,
  pending_count: 2,
  changes_requested_count: 1,
  rejected_count: 0,
  draft_count: 1,
  withdrawn_count: 0,
  last_activity_at: "2026-08-27T15:20:00Z",
  roles: ["member"],
};

const categories: ServiceCategory[] = [
  {
    id: "40000000-0000-4000-8000-000000000001",
    name: "Community Service",
    description: "Direct service that benefits the surrounding community.",
    is_active: true,
  },
  {
    id: "40000000-0000-4000-8000-000000000002",
    name: "School Service",
    description: "Service that supports the school community.",
    is_active: true,
  },
  {
    id: "40000000-0000-4000-8000-000000000003",
    name: "Peer Tutoring",
    description: "Academic support provided without compensation.",
    is_active: true,
  },
];

const reviewers: ReviewerOption[] = [
  {
    membershipId: "20000000-0000-4000-8000-000000000006",
    userId: "10000000-0000-4000-8000-000000000006",
    fullName: "Jordan Lee",
    roles: ["committee_head"],
  },
  {
    membershipId: "20000000-0000-4000-8000-000000000007",
    userId: "10000000-0000-4000-8000-000000000007",
    fullName: "Noah Williams",
    roles: ["president_vice_president"],
  },
  {
    membershipId: "20000000-0000-4000-8000-000000000008",
    userId: "10000000-0000-4000-8000-000000000008",
    fullName: "Avery Morgan",
    roles: ["teacher_admin"],
  },
];

const historyRows: Array<{
  title: string;
  category: string;
  date: string;
  hours: number;
  status: HourRequestStatus;
}> = [
  {
    title: "Riverbank cleanup",
    category: "Community Service",
    date: "Aug 23, 2026",
    hours: 3.5,
    status: "approved",
  },
  {
    title: "Freshman orientation guide",
    category: "School Service",
    date: "Aug 19, 2026",
    hours: 2,
    status: "pending",
  },
  {
    title: "Library reading program",
    category: "Community Service",
    date: "Aug 15, 2026",
    hours: 1.5,
    status: "changes_requested",
  },
  {
    title: "Algebra tutoring session",
    category: "Peer Tutoring",
    date: "Aug 11, 2026",
    hours: 1.25,
    status: "draft",
  },
];

function MemberDashboardPreview() {
  return (
    <div className="page-container">
      <PageHeader
        eyebrow="2026–2027"
        title="Your service progress"
        description="Welcome, Maya Chen. Only approved hours count toward your annual requirement."
        actions={
          <Button render={<Link href="/hours/new" />} size="lg">
            <Plus data-icon="inline-start" aria-hidden="true" /> Log Hours
          </Button>
        }
      />
      <section className="grid gap-6 border-b pb-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="rounded-xl border bg-background p-5 shadow-[0_1px_8px_rgba(11,23,54,0.05)] sm:p-7">
          <div className="mb-6 flex items-end justify-between gap-5">
            <div>
              <p className="text-sm font-semibold text-muted-foreground">Approved hours</p>
              <p className="mt-1 text-5xl font-bold tracking-tight">
                14.5 <span className="text-xl font-medium text-muted-foreground">/ 20</span>
              </p>
            </div>
            <StatusBadge status="below_goal" className="hidden sm:inline-flex" />
          </div>
          <ProgressSummary progress={progress} />
        </div>
        <dl className="grid grid-cols-2 divide-x rounded-xl border lg:min-w-[310px]">
          <div className="p-5">
            <dt className="text-sm text-muted-foreground">Pending</dt>
            <dd className="mt-1 text-3xl font-bold text-[var(--status-pending)]">3.25</dd>
          </div>
          <div className="p-5">
            <dt className="text-sm text-muted-foreground">Remaining</dt>
            <dd className="mt-1 text-3xl font-bold">5.5</dd>
          </div>
        </dl>
      </section>
      <section className="my-7 flex flex-col gap-4 rounded-xl border border-[var(--status-pending)]/30 bg-[var(--status-pending-bg)] p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold">1 request needs your changes</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Review the leader’s comment, update the activity, and resubmit it.
          </p>
        </div>
        <Button variant="outline">Review feedback</Button>
      </section>
      <section className="mt-8" aria-labelledby="preview-history-heading">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 id="preview-history-heading" className="text-2xl font-bold tracking-tight">
              Service history
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Draft, pending, reviewed, and withdrawn requests remain visible.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            <select
              aria-label="School year"
              className="h-10 rounded-lg border bg-background px-3 text-sm"
            >
              <option>2026–2027</option>
            </select>
            <select
              aria-label="Status"
              className="h-10 rounded-lg border bg-background px-3 text-sm"
            >
              <option>All statuses</option>
            </select>
            <select
              aria-label="Category"
              className="h-10 rounded-lg border bg-background px-3 text-sm"
            >
              <option>All categories</option>
            </select>
            <Button variant="outline">Apply filters</Button>
          </div>
        </div>
        <div className="hidden overflow-hidden rounded-xl border md:block">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60 hover:bg-muted/60">
                <TableHead className="pl-5">Activity</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Service date</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {historyRows.map((row) => (
                <TableRow key={row.title}>
                  <TableCell className="pl-5 font-semibold">{row.title}</TableCell>
                  <TableCell>{row.category}</TableCell>
                  <TableCell>{row.date}</TableCell>
                  <TableCell>{formatHours(row.hours)}</TableCell>
                  <TableCell>
                    <StatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost">
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="space-y-3 md:hidden">
          {historyRows.map((row) => (
            <article key={row.title} className="rounded-xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{row.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {row.category} · {row.date}
                  </p>
                </div>
                <StatusBadge status={row.status} />
              </div>
              <p className="mt-4 text-sm font-semibold">{formatHours(row.hours)} hours</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

const adminMembers = [
  ["Maya Chen", "14.5", "20", "72.5%", "5.5 hours remaining"],
  ["Eli Thompson", "20", "20", "100%", "Requirement met"],
  ["Sofia Patel", "8.25", "20", "41.25%", "11.75 hours remaining"],
  ["Liam Rivera", "22.5", "20", "112.5%", "2.5 hours over goal"],
];

function AdminDashboardPreview() {
  return (
    <div className="page-container">
      <PageHeader
        eyebrow="2026–2027"
        title="NHS overview"
        description="Review current service activity and member progress for the active school year."
        actions={
          <Button>
            Review requests <ArrowRight data-icon="inline-end" aria-hidden="true" />
          </Button>
        }
      />
      <MetricRail
        items={[
          { label: "Active members", value: 84 },
          { label: "Requirement met", value: 31 },
          { label: "Below requirement", value: 53 },
          { label: "Pending requests", value: 17, detail: "6 assigned to you" },
          { label: "Approved hours", value: "1,126.5", detail: "Across this school year" },
        ]}
      />
      <section className="mt-10" aria-labelledby="queue-preview-heading">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h2 id="queue-preview-heading" className="text-2xl font-bold">
              Requests waiting longest
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Any active leader can process an eligible pending request.
            </p>
          </div>
          <Button variant="ghost">View queue</Button>
        </div>
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60 hover:bg-muted/60">
                <TableHead className="pl-5">Member</TableHead>
                <TableHead>Activity</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Waiting</TableHead>
                <TableHead>Assignment</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ["Sofia Patel", "Community garden shift", "4", "8 days", "Jordan Lee"],
                ["Maya Chen", "Freshman orientation guide", "2", "5 days", "Assigned to you"],
                ["Owen Brooks", "Food pantry inventory", "3.25", "4 days", "Noah Williams"],
              ].map((row) => (
                <TableRow key={row[1]}>
                  <TableCell className="pl-5 font-semibold">{row[0]}</TableCell>
                  <TableCell>{row[1]}</TableCell>
                  <TableCell>{row[2]}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5">
                      <Clock3 className="size-4 text-muted-foreground" />
                      {row[3]}
                    </span>
                  </TableCell>
                  <TableCell>{row[4]}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost">
                      Review
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
      <section className="mt-10" aria-labelledby="members-preview-heading">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h2 id="members-preview-heading" className="text-2xl font-bold">
              Member progress
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Approved progress only. Pending hours remain separate.
            </p>
          </div>
          <Input aria-label="Search members" className="max-w-64" placeholder="Search members" />
        </div>
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/60 hover:bg-muted/60">
                <TableHead className="pl-5">Member</TableHead>
                <TableHead>Approved</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adminMembers.map((row) => (
                <TableRow key={row[0]}>
                  <TableCell className="pl-5 font-semibold">{row[0]}</TableCell>
                  <TableCell>{row[1]}</TableCell>
                  <TableCell>{row[2]}</TableCell>
                  <TableCell>{row[3]}</TableCell>
                  <TableCell>{row[4]}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function ReviewRequestPreview() {
  return (
    <div className="page-container">
      <PageHeader
        eyebrow="Pending review · submitted Aug 24, 2026"
        title="Community garden shift"
        description="Review the service record, member context, and immutable history before deciding."
      />
      <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-7">
          <section className="rounded-xl border">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b px-6 py-5">
              <div>
                <p className="text-sm font-semibold text-primary">Service request</p>
                <h2 className="mt-1 text-2xl font-bold">Community garden shift</h2>
                <p className="mt-1 text-sm text-muted-foreground">Submitted Aug 24, 2026</p>
              </div>
              <StatusBadge status="pending" />
            </div>
            <div className="p-6">
              <p className="text-base leading-7">
                Prepared planting beds, moved compost, and helped the garden coordinator label
                produce for the neighborhood distribution table.
              </p>
              <dl className="mt-7 grid gap-5 border-t pt-6 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Tag className="size-4" />
                    Category
                  </dt>
                  <dd className="mt-1 font-semibold">Community Service</dd>
                </div>
                <div>
                  <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CalendarDays className="size-4" />
                    Service date
                  </dt>
                  <dd className="mt-1 font-semibold">Aug 23, 2026</dd>
                </div>
                <div>
                  <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock3 className="size-4" />
                    Hours
                  </dt>
                  <dd className="mt-1 font-semibold">4</dd>
                </div>
                <div>
                  <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                    <UserRound className="size-4" />
                    Requested approver
                  </dt>
                  <dd className="mt-1 font-semibold">Jordan Lee</dd>
                </div>
              </dl>
            </div>
          </section>
          <section className="rounded-xl border">
            <div className="border-b px-6 py-5">
              <h2 className="flex items-center gap-2 text-xl font-bold">
                <History className="size-5" />
                Immutable review history
              </h2>
            </div>
            <ol className="divide-y">
              <li className="p-6">
                <div className="flex justify-between gap-3">
                  <p className="font-semibold">Submitted</p>
                  <time className="text-sm text-muted-foreground">Aug 24, 2026</time>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">Requested approver: Jordan Lee</p>
              </li>
            </ol>
          </section>
        </div>
        <aside className="space-y-6">
          <section className="rounded-xl border p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Member</p>
                <h2 className="mt-1 text-xl font-bold">Sofia Patel</h2>
                <p className="mt-1 text-sm text-muted-foreground">sofia.patel@example.edu</p>
              </div>
              <Button variant="ghost" size="sm">
                Profile
              </Button>
            </div>
            <div className="mt-6 border-t pt-5">
              <ProgressSummary
                progress={{
                  ...progress,
                  full_name: "Sofia Patel",
                  approved_hours: 8.25,
                  pending_hours: 4,
                  remaining_hours: 11.75,
                  actual_percentage: 41.25,
                }}
                compact
              />
            </div>
          </section>
          <section className="rounded-xl border p-5 shadow-[0_1px_8px_rgba(11,23,54,0.05)]">
            <h2 className="mb-1 text-xl font-bold">Record a decision</h2>
            <p className="mb-5 text-sm leading-6 text-muted-foreground">
              Your identity becomes the actual reviewer, even when someone else was requested.
            </p>
            <ReviewDecisionPanel
              requestId="50000000-0000-4000-8000-000000000001"
              reviewers={reviewers}
              currentReviewerMembershipId={reviewers[0]?.membershipId ?? null}
            />
          </section>
        </aside>
      </div>
    </div>
  );
}

function LogHoursPreview() {
  return (
    <div className="page-container max-w-[1180px]">
      <PageHeader
        eyebrow="2026–2027"
        title="Log service hours"
        description="Save a draft at any time, or submit a complete activity for leader review."
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_310px]">
        <div className="rounded-xl border bg-background p-5 sm:p-7">
          <HourRequestForm
            schoolYearId="30000000-0000-4000-8000-000000000001"
            schoolYearLabel="2026–2027"
            categories={categories}
            reviewers={reviewers}
            submissionKey="60000000-0000-4000-8000-000000000001"
          />
        </div>
        <aside className="space-y-4">
          <section className="rounded-xl border bg-muted/40 p-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="size-5 text-primary" />
              Before you submit
            </h2>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
              <li>Use one request for one service date.</li>
              <li>Enter time in quarter-hour increments.</li>
              <li>Choose an active leader who can verify the activity.</li>
              <li>Approved hours—not pending hours—count toward the annual target.</li>
            </ul>
          </section>
          <section className="rounded-xl border p-5">
            <p className="text-sm text-muted-foreground">Current approved progress</p>
            <p className="mt-1 text-3xl font-bold">14.5 / 20</p>
            <p className="mt-2 text-sm text-muted-foreground">3.25 hours are pending review.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function localDesignPreviewEnabled(): boolean {
  if (process.env.NHS_DESIGN_PREVIEW !== "true") return false;
  if (process.env.NODE_ENV !== "production") return true;

  try {
    const hostname = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "").hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

function RolePreviewToolbar({ screen, role }: { screen: string; role: string | undefined }) {
  const items = [
    {
      href: "/design-preview?screen=dashboard",
      label: "Member",
      active: screen === "dashboard" || screen === "log",
    },
    {
      href: "/design-preview?screen=review&role=committee_head",
      label: "Committee head",
      active: screen === "review" && role !== "president_vice_president",
    },
    {
      href: "/design-preview?screen=review&role=president_vice_president",
      label: "President / Vice President",
      active: screen === "review" && role === "president_vice_president",
    },
    {
      href: "/design-preview?screen=admin",
      label: "Teacher administrator",
      active: screen === "admin",
    },
  ];

  return (
    <aside
      aria-label="Read-only role preview"
      className="fixed inset-x-3 top-24 z-50 rounded-xl border bg-background/96 p-3 shadow-xl backdrop-blur sm:left-auto sm:right-4 sm:w-64"
    >
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
        Read-only role preview
      </p>
      <nav aria-label="Preview a role" className="mt-2 flex gap-2 overflow-x-auto sm:flex-col">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.active ? "page" : undefined}
            className={
              item.active
                ? "shrink-0 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
                : "shrink-0 rounded-md bg-muted px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
            }
          >
            {item.label}
          </Link>
        ))}
        <Link
          href="/admin/members"
          className="shrink-0 rounded-md border px-3 py-2 text-sm font-semibold hover:bg-accent"
        >
          Back to administration
        </Link>
      </nav>
    </aside>
  );
}

export default async function DesignPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ screen?: string; role?: string }>;
}) {
  const localPreview = localDesignPreviewEnabled();
  if (!localPreview) await requirePlatformOwner();

  const { screen = "dashboard", role } = await searchParams;
  const viewer =
    screen === "admin"
      ? adminViewer
      : screen === "review" && role === "president_vice_president"
        ? presidentViewer
        : screen === "review"
          ? committeeHeadViewer
          : memberViewer;
  const previewName =
    screen === "admin"
      ? "Teacher administrator"
      : screen === "review" && role === "president_vice_president"
        ? "President / Vice President"
        : screen === "review"
          ? "Committee head"
          : "Member";

  return (
    <>
      <RolePreviewToolbar screen={screen} role={role} />
      {!localPreview ? (
        <p className="sr-only" aria-live="polite">
          Current synthetic preview: {previewName}. Interactive controls inside the preview are
          disabled.
        </p>
      ) : null}
      <div
        inert={!localPreview}
        className={localPreview ? "pt-24 sm:pt-0" : "pointer-events-none pt-24 sm:pt-0"}
      >
        <AppShell viewer={viewer}>
          {screen === "admin" ? (
            <AdminDashboardPreview />
          ) : screen === "review" ? (
            <ReviewRequestPreview />
          ) : screen === "log" ? (
            <LogHoursPreview />
          ) : (
            <MemberDashboardPreview />
          )}
        </AppShell>
      </div>
    </>
  );
}
