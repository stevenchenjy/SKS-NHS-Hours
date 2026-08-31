import Link from "next/link";
import { CalendarDays, Mail, MapPin, UserRound, UsersRound } from "lucide-react";

import {
  dropServiceEventSignupAction,
  signupForServiceEventAction,
} from "@/app/actions/event-actions";
import { EventActionSubmit } from "@/components/events/event-action-submit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import { formatServiceEventSchedule } from "@/lib/domain/events";
import { cn } from "@/lib/utils";
import type { ServiceEvent } from "@/lib/types";

function registrationBadge(event: ServiceEvent) {
  if (event.my_registration_status === "confirmed") {
    return <Badge variant="secondary">You’re confirmed</Badge>;
  }
  if (event.my_registration_status === "waitlisted") {
    return (
      <Badge variant="outline">
        Waitlist{event.my_waitlist_position ? ` #${event.my_waitlist_position}` : ""}
      </Badge>
    );
  }
  if (!event.is_expired && event.spots_remaining === 0) {
    return <Badge variant="outline">Waitlist open</Badge>;
  }
  return null;
}

export function ServiceEventCard({
  event,
  viewerCanSignUp,
  returnPath = "/events",
  showDetailsLink = true,
}: {
  event: ServiceEvent;
  viewerCanSignUp: boolean;
  returnPath?: string;
  showDetailsLink?: boolean;
}) {
  const schedule = formatServiceEventSchedule(event.starts_at, event.ends_at);
  const filledPercent = Math.min((event.confirmed_count / event.capacity) * 100, 100);
  const signupAction = signupForServiceEventAction.bind(null, event.id, returnPath);
  const dropAction = dropServiceEventSignupAction.bind(null, event.id, returnPath);
  const activeRegistration =
    event.my_registration_status === "confirmed" || event.my_registration_status === "waitlisted";

  return (
    <Card className="h-full">
      <CardHeader className="border-b">
        <CardTitle as="h2" className="pr-3 text-xl font-bold tracking-tight">
          {event.title}
        </CardTitle>
        <CardDescription>
          Organized by {event.organizer_name} · {event.school_year_label}
        </CardDescription>
        <CardAction>
          <Badge variant={event.is_expired ? "outline" : "secondary"}>
            {event.is_expired ? "Past" : "Active"}
          </Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-5">
        <p
          className={cn(
            "whitespace-pre-wrap leading-6 text-muted-foreground",
            showDetailsLink && "line-clamp-3",
          )}
        >
          {event.description}
        </p>

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="flex gap-2.5">
            <CalendarDays className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <dt className="sr-only">When</dt>
              <dd className="font-medium">{schedule.date}</dd>
              <dd className="text-muted-foreground">{schedule.time}</dd>
            </div>
          </div>
          <div className="flex gap-2.5">
            <MapPin className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <dt className="sr-only">Where</dt>
              <dd className="font-medium">{event.location}</dd>
            </div>
          </div>
          <div className="flex gap-2.5">
            <UsersRound className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <dt className="sr-only">Who should volunteer</dt>
              <dd className="font-medium">{event.volunteer_audience}</dd>
            </div>
          </div>
          <div className="flex gap-2.5">
            <Mail className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0">
              <dt className="sr-only">Contact</dt>
              <dd className="font-medium">{event.contact_name}</dd>
              <dd className="truncate">
                <a
                  className="text-primary underline-offset-4 hover:underline"
                  href={`mailto:${event.contact_email}`}
                >
                  {event.contact_email}
                </a>
              </dd>
            </div>
          </div>
        </dl>

        <Progress
          value={filledPercent}
          aria-label={`${event.confirmed_count} of ${event.capacity} volunteer spots filled`}
        >
          <ProgressLabel>
            {event.capacity} {event.capacity === 1 ? "person" : "people"} needed
          </ProgressLabel>
          <span className="ml-auto text-sm tabular-nums text-muted-foreground">
            {event.spots_remaining > 0
              ? `${event.spots_remaining} ${event.spots_remaining === 1 ? "spot" : "spots"} left`
              : "Full"}
          </span>
        </Progress>

        <div className="flex min-h-5 flex-wrap items-center gap-2">
          {registrationBadge(event)}
          {event.waitlist_count > 0 ? (
            <span className="text-xs text-muted-foreground">
              {event.waitlist_count} on the waitlist
            </span>
          ) : null}
        </div>
      </CardContent>

      <CardFooter className="flex-wrap justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <UserRound className="size-4" aria-hidden="true" />
          {event.confirmed_count} confirmed
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {showDetailsLink ? (
            <Button
              render={<Link href={`/events/${event.id}`} />}
              variant="outline"
              aria-label={`${event.can_manage ? "Manage roster for" : "View details for"} ${event.title}`}
            >
              {event.can_manage ? "Manage roster" : "View details"}
            </Button>
          ) : null}
          {!event.is_expired && viewerCanSignUp ? (
            activeRegistration ? (
              <form action={dropAction}>
                <EventActionSubmit
                  label={
                    event.my_registration_status === "waitlisted" ? "Leave waitlist" : "Drop spot"
                  }
                  pendingLabel="Updating…"
                  variant="destructive"
                />
              </form>
            ) : (
              <form action={signupAction}>
                <EventActionSubmit
                  label={event.spots_remaining > 0 ? "Sign up" : "Join waitlist"}
                  pendingLabel="Joining…"
                />
              </form>
            )
          ) : null}
        </div>
      </CardFooter>
    </Card>
  );
}
