import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, UsersRound } from "lucide-react";
import { z } from "zod";

import { EventNotice } from "@/components/events/event-notice";
import { ServiceEventCard } from "@/components/events/service-event-card";
import { PageHeader } from "@/components/portal/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requirePortalViewer } from "@/lib/dal/access";
import { getServiceEvent, listServiceEventRoster } from "@/lib/dal/events";

export const metadata: Metadata = { title: "Volunteer event" };

function value(input: string | string[] | undefined): string {
  return Array.isArray(input) ? (input[0] ?? "") : (input ?? "");
}

function joinedDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

export default async function ServiceEventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, viewer, query] = await Promise.all([params, requirePortalViewer(), searchParams]);
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) notFound();
  const event = await getServiceEvent(parsedId.data);
  if (!event) notFound();
  const roster = event.can_manage ? await listServiceEventRoster(event.id) : [];
  const confirmed = roster.filter((entry) => entry.status === "confirmed");
  const waitlisted = roster.filter((entry) => entry.status === "waitlisted");

  return (
    <div className="page-container">
      <PageHeader
        eyebrow={
          <Link href="/events" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-4" aria-hidden="true" />
            All events
          </Link>
        }
        title={event.can_manage ? "Event roster" : "Event details"}
        description={
          event.can_manage
            ? "Monitor confirmed volunteers and the first-come waitlist. Open spots are filled automatically when someone drops."
            : "Review the opportunity details and manage your signup."
        }
      />

      <EventNotice notice={value(query.notice)} />
      <div className="max-w-5xl">
        <ServiceEventCard
          event={event}
          viewerCanSignUp={viewer.isMember}
          returnPath={`/events/${event.id}`}
          showDetailsLink={false}
        />
      </div>

      {event.can_manage ? (
        <section aria-labelledby="roster-heading" className="mt-10">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="roster-heading" className="text-2xl font-bold tracking-tight">
                Signup roster
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {confirmed.length} confirmed · {waitlisted.length} waiting
              </p>
            </div>
            <Badge variant="outline">{event.spots_remaining} spots left</Badge>
          </div>

          {roster.length ? (
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/60 hover:bg-muted/60">
                    <TableHead className="pl-5">Student</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roster.map((entry) => (
                    <TableRow key={entry.registration_id}>
                      <TableCell className="pl-5 font-semibold">{entry.full_name}</TableCell>
                      <TableCell>
                        <a
                          href={`mailto:${entry.email}`}
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          {entry.email}
                        </a>
                      </TableCell>
                      <TableCell>
                        <Badge variant={entry.status === "confirmed" ? "secondary" : "outline"}>
                          {entry.status === "confirmed"
                            ? "Confirmed"
                            : `Waitlist #${entry.waitlist_position ?? "—"}`}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {joinedDate(entry.joined_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <Empty className="min-h-64 border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <UsersRound />
                </EmptyMedia>
                <EmptyTitle>No signups yet</EmptyTitle>
                <EmptyDescription>
                  Confirmed volunteers and waitlisted students will appear here.
                </EmptyDescription>
              </EmptyHeader>
              <Button render={<Link href="/events" />} variant="outline">
                Back to events
              </Button>
            </Empty>
          )}
        </section>
      ) : null}
    </div>
  );
}
