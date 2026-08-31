import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Plus } from "lucide-react";

import { EventNotice } from "@/components/events/event-notice";
import { ServiceEventCard } from "@/components/events/service-event-card";
import { PageHeader } from "@/components/portal/page-header";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { requirePortalViewer } from "@/lib/dal/access";
import { listServiceEvents } from "@/lib/dal/events";
import { canPublishServiceEvents } from "@/lib/domain/events";

export const metadata: Metadata = { title: "Volunteer events" };

function value(input: string | string[] | undefined): string {
  return Array.isArray(input) ? (input[0] ?? "") : (input ?? "");
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [viewer, events, params] = await Promise.all([
    requirePortalViewer(),
    listServiceEvents(),
    searchParams,
  ]);
  const active = events.filter((event) => !event.is_expired);
  const past = events
    .filter((event) => event.is_expired)
    .sort((left, right) => right.starts_at.localeCompare(left.starts_at));
  const selectedView = value(params.view) === "past" ? "past" : "active";
  const visibleEvents = selectedView === "past" ? past : active;
  const notice = value(params.notice);
  const canPublish = canPublishServiceEvents(viewer);

  return (
    <div className="page-container">
      <PageHeader
        eyebrow={viewer.activeMembership.school_year.label}
        title="Volunteer events"
        description="Find open opportunities, see remaining spots, and manage your signup. Full events use a first-come waitlist that promotes the next student automatically."
        actions={
          canPublish ? (
            <Button render={<Link href="/events/new" />}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              Publish event
            </Button>
          ) : undefined
        }
      />

      <EventNotice notice={notice} />

      <div className="mb-6 inline-flex rounded-lg bg-muted p-1" aria-label="Event views">
        <Button
          render={<Link href="/events" />}
          variant={selectedView === "active" ? "default" : "ghost"}
          size="sm"
          aria-current={selectedView === "active" ? "page" : undefined}
        >
          Active <span className="ml-1 tabular-nums">({active.length})</span>
        </Button>
        <Button
          render={<Link href="/events?view=past" />}
          variant={selectedView === "past" ? "default" : "ghost"}
          size="sm"
          aria-current={selectedView === "past" ? "page" : undefined}
        >
          Past <span className="ml-1 tabular-nums">({past.length})</span>
        </Button>
      </div>

      {visibleEvents.length ? (
        <section
          aria-label={selectedView === "active" ? "Active volunteer events" : "Past events"}
          className="grid items-stretch gap-5 xl:grid-cols-2"
        >
          {visibleEvents.map((event) => (
            <ServiceEventCard key={event.id} event={event} viewerCanSignUp={viewer.isMember} />
          ))}
        </section>
      ) : (
        <Empty className="min-h-80 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarDays />
            </EmptyMedia>
            <EmptyTitle>
              {selectedView === "active" ? "No active events yet" : "No past events yet"}
            </EmptyTitle>
            <EmptyDescription>
              {selectedView === "active"
                ? canPublish
                  ? "Publish an opportunity when your committee or school needs volunteers."
                  : "New volunteer opportunities will appear here as soon as they are published."
                : "Expired opportunities remain here for the whole portal to reference."}
            </EmptyDescription>
          </EmptyHeader>
          {selectedView === "active" && canPublish ? (
            <Button render={<Link href="/events/new" />}>Publish event</Button>
          ) : null}
        </Empty>
      )}
    </div>
  );
}
