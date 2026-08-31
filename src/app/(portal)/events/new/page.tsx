import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ServiceEventForm } from "@/components/events/service-event-form";
import { PageHeader } from "@/components/portal/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requirePortalViewer } from "@/lib/dal/access";
import { canPublishServiceEvents } from "@/lib/domain/events";

export const metadata: Metadata = { title: "Publish volunteer event" };

export default async function NewServiceEventPage() {
  const viewer = await requirePortalViewer();
  if (!canPublishServiceEvents(viewer)) redirect("/events?notice=publisher-required");

  return (
    <div className="page-container max-w-5xl">
      <PageHeader
        eyebrow={viewer.activeMembership.school_year.label}
        title="Publish a volunteer event"
        description="Share every detail students need. Signups confirm until capacity is reached, then continue on an automatic first-come waitlist."
      />
      <Card>
        <CardContent>
          <ServiceEventForm
            schoolYearId={viewer.activeMembership.school_year_id}
            contactName={viewer.profile.full_name}
            contactEmail={viewer.email}
          />
        </CardContent>
      </Card>
    </div>
  );
}
