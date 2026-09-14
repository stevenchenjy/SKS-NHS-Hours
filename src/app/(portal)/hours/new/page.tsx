import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { HourRequestForm } from "@/components/hours/hour-request-form";
import { PageHeader } from "@/components/portal/page-header";
import { Button } from "@/components/ui/button";
import { requireActiveViewer } from "@/lib/dal/access";
import { listActiveCommitteeHeads, listCategories } from "@/lib/dal/portal";

export const metadata: Metadata = { title: "Log service hours" };

export default async function NewHourRequestPage() {
  const viewer = await requireActiveViewer();
  if (!viewer.roles.includes("member")) {
    return (
      <div className="page-container">
        <PageHeader
          title="Member role required"
          description="Your current school-year roles do not include the member role needed to submit personal service hours."
        />
        <Button render={<Link href="/dashboard" />} variant="outline">
          Return to dashboard
        </Button>
      </div>
    );
  }

  const [categories, committeeHeads] = await Promise.all([
    listCategories(viewer.activeMembership.school_year_id),
    listActiveCommitteeHeads(viewer.activeMembership.school_year_id),
  ]);

  return (
    <div className="page-container max-w-5xl">
      <PageHeader
        eyebrow={
          <Link href="/dashboard" className="inline-flex items-center gap-2 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to dashboard
          </Link>
        }
        title="Log service hours"
      />
      {categories.length === 0 || committeeHeads.length === 0 ? (
        <div className="rounded-xl border border-[var(--status-pending)]/30 bg-[var(--status-pending-bg)] p-5">
          <h2 className="font-semibold">Submissions are not ready</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            An active service category and at least one active committee head are required. Contact
            the NHS adviser.
          </p>
        </div>
      ) : (
        <HourRequestForm
          schoolYearId={viewer.activeMembership.school_year_id}
          schoolYearLabel={viewer.activeMembership.school_year.label}
          categories={categories}
          reviewers={committeeHeads}
          memberMembershipId={viewer.activeMembership.id}
          submissionKey={crypto.randomUUID()}
        />
      )}
    </div>
  );
}
