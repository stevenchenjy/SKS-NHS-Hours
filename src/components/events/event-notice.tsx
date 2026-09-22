const notices: Record<string, string> = {
  created:
    "The event is live and visible to everyone in the portal. Use Copy signup link to share it in your volunteer email.",
  updated: "Event changes saved. Affected volunteers have been notified.",
  ended: "The event has ended and moved to Past. Volunteers have been notified.",
  deleted: "The event was deleted and its signups cancelled. Volunteers have been notified.",
  "signup-closed": "The signup deadline has passed. New signups and waitlist entries are closed.",
  "event-changed":
    "This event changed since you opened it. Review the latest details and try again.",
  "event-ended": "This event has ended and can no longer be edited.",
  "manage-failed": "The event could not be changed. Refresh the page and try again.",
  "manager-required": "Only the organizer or a teacher administrator can manage this event.",
  confirmed: "You’re confirmed. Your spot has been added to the event roster.",
  waitlisted: "The event is full, so you’ve been added to the waitlist.",
  dropped: "You’ve left this event. Any waiting volunteer can now take the open spot.",
  "signup-unconfirmed":
    "The signup response could not be confirmed. Refresh the event to check your status before trying again.",
  "signup-failed": "Your signup could not be completed. The event may have just ended.",
  "drop-failed": "Your signup could not be changed. Refresh the page and try again.",
  "invalid-event": "That event could not be found.",
  "not-authorized": "An active NHS member role is required to sign up.",
  "publisher-required":
    "Only committee heads and teacher administrators can publish service events.",
};

export function EventNotice({ notice }: { notice?: string }) {
  const message = notice ? notices[notice] : undefined;
  if (!message) return null;
  const isError =
    notice?.endsWith("failed") ||
    notice === "signup-unconfirmed" ||
    notice === "invalid-event" ||
    notice === "not-authorized" ||
    notice === "publisher-required" ||
    notice === "manager-required" ||
    notice === "event-changed";
  return (
    <p
      role={isError ? "alert" : "status"}
      className={
        isError
          ? "mb-6 rounded-lg bg-destructive/10 p-4 text-sm text-destructive"
          : "mb-6 rounded-lg bg-secondary p-4 text-sm text-secondary-foreground"
      }
    >
      {message}
    </p>
  );
}
