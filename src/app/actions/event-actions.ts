"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireActiveViewer, requirePortalViewer } from "@/lib/dal/access";
import { canPublishServiceEvents } from "@/lib/domain/events";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface ServiceEventFormState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

const localDateTimeSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Enter a valid date and time.");

const createServiceEventSchema = z
  .object({
    school_year_id: z.uuid(),
    title: z.string().trim().min(1, "Enter an event title.").max(160),
    description: z.string().trim().min(1, "Describe the help that is needed.").max(5_000),
    location: z.string().trim().min(1, "Enter the event location.").max(300),
    volunteer_audience: z.string().trim().min(1, "Explain who should volunteer.").max(500),
    starts_at: localDateTimeSchema,
    ends_at: localDateTimeSchema,
    contact_name: z.string().trim().min(1, "Enter a contact name.").max(200),
    contact_email: z.email("Enter a valid contact email.").max(320),
    capacity: z.coerce
      .number()
      .int("People needed must be a whole number.")
      .min(1, "At least one person is needed.")
      .max(500, "Capacity cannot exceed 500 people."),
  })
  .refine((values) => values.ends_at > values.starts_at, {
    path: ["ends_at"],
    message: "The end time must be after the start time.",
  });

function eventRpcError(error: { message: string } | null): string {
  const message = error?.message ?? "";
  if (message.includes("future")) return "The event must end in the future.";
  if (message.includes("school year")) return "Keep the event inside the selected school year.";
  if (message.includes("committee heads")) {
    return "Only committee heads and teacher administrators can publish events.";
  }
  return "The event could not be published. Review the details and try again.";
}

function returnedId(data: unknown): string | null {
  const value = Array.isArray(data) ? data[0] : data;
  return value && typeof value === "object" && "id" in value && typeof value.id === "string"
    ? value.id
    : null;
}

function returnedStatus(data: unknown): "confirmed" | "waitlisted" | null {
  const value = Array.isArray(data) ? data[0] : data;
  if (!value || typeof value !== "object" || !("status" in value)) return null;
  return value.status === "confirmed" || value.status === "waitlisted" ? value.status : null;
}

function returnPath(eventId: string, requestedPath: string): string {
  return requestedPath === `/events/${eventId}` ? requestedPath : "/events";
}

export async function createServiceEventAction(
  _previous: ServiceEventFormState,
  formData: FormData,
): Promise<ServiceEventFormState> {
  const viewer = await requirePortalViewer();
  if (!canPublishServiceEvents(viewer)) {
    return { error: "Only committee heads and teacher administrators can publish events." };
  }

  const parsed = createServiceEventSchema.safeParse({
    school_year_id: formData.get("school_year_id"),
    title: formData.get("title"),
    description: formData.get("description"),
    location: formData.get("location"),
    volunteer_audience: formData.get("volunteer_audience"),
    starts_at: formData.get("starts_at"),
    ends_at: formData.get("ends_at"),
    contact_name: formData.get("contact_name"),
    contact_email: formData.get("contact_email"),
    capacity: formData.get("capacity"),
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
  if (parsed.data.school_year_id !== viewer.activeMembership.school_year_id) {
    return { error: "Publish events only for your current school year." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_service_event", {
    p_school_year_id: parsed.data.school_year_id,
    p_title: parsed.data.title,
    p_description: parsed.data.description,
    p_location: parsed.data.location,
    p_volunteer_audience: parsed.data.volunteer_audience,
    p_starts_at: parsed.data.starts_at,
    p_ends_at: parsed.data.ends_at,
    p_contact_name: parsed.data.contact_name,
    p_contact_email: parsed.data.contact_email,
    p_capacity: parsed.data.capacity,
  });
  if (error) return { error: eventRpcError(error) };

  const eventId = returnedId(data);
  if (!eventId) return { error: "The event was published but could not be opened." };
  revalidatePath("/events");
  redirect(`/events/${eventId}?notice=created`);
}

export async function signupForServiceEventAction(eventId: string, requestedPath: string) {
  const viewer = await requireActiveViewer();
  if (!viewer.roles.includes("member")) redirect("/events?notice=not-authorized");
  const parsedId = z.uuid().safeParse(eventId);
  if (!parsedId.success) redirect("/events?notice=invalid-event");

  const destination = returnPath(parsedId.data, requestedPath);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("signup_for_service_event", {
    p_event_id: parsedId.data,
  });
  if (error) redirect(`${destination}?notice=signup-failed`);

  revalidatePath("/events");
  revalidatePath(`/events/${parsedId.data}`);
  const status = returnedStatus(data);
  redirect(`${destination}?notice=${status === "waitlisted" ? "waitlisted" : "confirmed"}`);
}

export async function dropServiceEventSignupAction(eventId: string, requestedPath: string) {
  await requireActiveViewer();
  const parsedId = z.uuid().safeParse(eventId);
  if (!parsedId.success) redirect("/events?notice=invalid-event");

  const destination = returnPath(parsedId.data, requestedPath);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("drop_service_event_signup", {
    p_event_id: parsedId.data,
  });
  if (error) redirect(`${destination}?notice=drop-failed`);

  revalidatePath("/events");
  revalidatePath(`/events/${parsedId.data}`);
  redirect(`${destination}?notice=dropped`);
}
