import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ServiceEventForm } from "@/components/events/service-event-form";
import { PageHeader } from "@/components/portal/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requirePortalViewer } from "@/lib/dal/access";
import { getServiceEvent } from "@/lib/dal/events";

export const metadata: Metadata = { title: "Edit volunteer event" };

export default async function EditServiceEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [viewer, { id }] = await Promise.all([requirePortalViewer(), params]);
  if (!z.uuid().safeParse(id).success) notFound();
  const event = await getServiceEvent(id);
  if (!event) notFound();
  if (!event.can_manage) redirect("/events?notice=manager-required");
  if (event.is_expired) redirect(`/events/${id}?notice=event-ended`);

  return (
    <div className="page-container max-w-5xl">
      <PageHeader eyebrow={event.school_year_label} title="Edit event" />
      <Card>
        <CardContent>
          <ServiceEventForm
            schoolYearId={event.school_year_id}
            contactName={viewer.profile.full_name}
            contactEmail={viewer.email}
            event={event}
          />
        </CardContent>
      </Card>
    </div>
  );
}
