import { formatServiceEventDeadline } from "@/lib/domain/events";

export const notificationKindLabels: Record<string, string> = {
  event_updated: "Event updated",
  event_ended: "Event ended",
  event_deleted: "Event deleted",
  signup_confirmed: "Signup confirmed",
  signup_waitlisted: "Joined waitlist",
  signup_withdrawn: "Signup cancelled",
  waitlist_promoted: "Spot confirmed",
};

export const eventChangeLabels: Record<string, string> = {
  title: "Title",
  description: "Description",
  location: "Location",
  volunteer_audience: "Who should volunteer",
  starts_at: "Starts",
  ends_at: "Ends",
  signup_deadline: "Signup deadline",
  contact_name: "Contact person",
  contact_email: "Contact email",
  capacity: "People needed",
};

export function formatEventChange(field: string, value: string | number | null): string {
  if (value === null) return "Not set";
  if (["starts_at", "ends_at", "signup_deadline"].includes(field))
    return formatServiceEventDeadline(String(value));
  return String(value);
}
