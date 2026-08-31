const notices: Record<string, string> = {
  created: "The event is live and visible to everyone in the portal.",
  confirmed: "You’re confirmed. Your spot has been added to the event roster.",
  waitlisted: "The event is full, so you’ve been added to the waitlist.",
  dropped: "You’ve left this event. If you held a spot, the next student was promoted.",
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
  const isError = notice?.endsWith("failed") || notice === "invalid-event";
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
