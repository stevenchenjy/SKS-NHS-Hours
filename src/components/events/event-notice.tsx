const notices: Record<string, string> = {
  created: "Event published.",
  updated: "Event updated. Volunteers notified.",
  ended: "Event ended. Volunteers notified.",
  deleted: "Event deleted. Volunteers notified.",
  "signup-closed": "Signups are closed.",
  "event-changed": "This event has changed. Refresh the page and try again.",
  "event-ended": "This event has ended.",
  "manage-failed": "Event not changed. Refresh the page and try again.",
  "manager-required": "The organizer or a teacher administrator must make this change.",
  confirmed: "Signup confirmed.",
  waitlisted: "Added to the waitlist.",
  dropped: "You’ve left this event.",
  "signup-unconfirmed": "Signup unconfirmed. Refresh the page to check your status.",
  "signup-failed": "Signup not completed. Check that the event is still open.",
  "drop-failed": "Signup not changed. Refresh the page and try again.",
  "invalid-event": "Event not found.",
  "not-authorized": "Active NHS membership is required to sign up.",
  "publisher-required": "A committee head or teacher administrator must publish this event.",
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
