"use client";

import Link from "next/link";
import { PencilLine, Square, Trash2 } from "lucide-react";
import { closeServiceEventAction } from "@/app/actions/event-actions";
import { EventActionSubmit } from "@/components/events/event-action-submit";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function EventManagementControls({
  eventId,
  title,
  isPast,
  updatedAt,
}: {
  eventId: string;
  title: string;
  isPast: boolean;
  updatedAt: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {!isPast ? (
        <Button variant="outline" render={<Link href={`/events/${eventId}/edit`} />}>
          <PencilLine data-icon="inline-start" aria-hidden="true" />
          Edit event
        </Button>
      ) : null}
      {(["end", "delete"] as const)
        .filter((operation) => operation !== "end" || !isPast)
        .map((operation) => {
          const deleting = operation === "delete";
          return (
            <AlertDialog key={operation}>
              <AlertDialogTrigger
                render={<Button variant={deleting ? "destructive" : "outline"} />}
              >
                {deleting ? (
                  <Trash2 data-icon="inline-start" aria-hidden="true" />
                ) : (
                  <Square data-icon="inline-start" aria-hidden="true" />
                )}
                {deleting ? "Delete event" : "End event"}
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {deleting ? "Delete this event?" : "End this event now?"}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {deleting
                      ? `“${title}” will be removed from Events and its signups cancelled. Confirmed and waitlisted volunteers will be notified.`
                      : `“${title}” will move to Past immediately and close to signups. The roster will stay available, and volunteers will be notified.`}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep event</AlertDialogCancel>
                  <form action={closeServiceEventAction.bind(null, eventId, operation, updatedAt)}>
                    <EventActionSubmit
                      label={deleting ? "Delete event" : "End event"}
                      pendingLabel={deleting ? "Deleting…" : "Ending…"}
                      variant={deleting ? "destructive" : "default"}
                    />
                  </form>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          );
        })}
    </div>
  );
}
