"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireActiveViewer, requirePortalViewer } from "@/lib/dal/access";
import { getServiceEvent } from "@/lib/dal/events";
import { canPublishServiceEvents, serviceEventSchema } from "@/lib/domain/events";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface ServiceEventFormState {
  error?: string;
  values?: Record<string, string>;
  fieldErrors?: Record<string, string[]>;
}

function eventRpcError(error: { message: string; code?: string } | null): string {
  const message = error?.message ?? "";
  if (error?.code === "40001")
    return "This event changed while you were editing. Reload the page to see the latest version before saving.";
  if (message.includes("confirmed signup count"))
    return "People needed cannot be less than the number of confirmed volunteers.";
  if (message.includes("deadline"))
    return "The signup deadline must be at or before the event starts.";
  if (message.includes("Past events")) return "This event has ended and can no longer be edited.";
  if (message.includes("future")) return "The event must end in the future.";
  if (message.includes("school year")) return "Keep the event inside the selected school year.";
  if (error?.code === "42501") return "You do not have permission to change this event.";
  return "The event could not be saved. Review the details and try again.";
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
  return saveServiceEvent(formData, false);
}

export async function updateServiceEventAction(
  _previous: ServiceEventFormState,
  formData: FormData,
): Promise<ServiceEventFormState> {
  return saveServiceEvent(formData, true);
}

async function saveServiceEvent(
  formData: FormData,
  editing: boolean,
): Promise<ServiceEventFormState> {
  const viewer = await requirePortalViewer();
  const values = Object.fromEntries(
    Array.from(formData.entries()).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && !entry[0].startsWith("$"),
    ),
  );
  const parsed = serviceEventSchema.safeParse(values);
  if (!parsed.success) return { values, fieldErrors: parsed.error.flatten().fieldErrors };

  let eventId: string | null = null;
  if (editing) {
    const id = z.uuid().safeParse(formData.get("event_id"));
    if (!id.success) return { values, error: "That event could not be found." };
    const event = await getServiceEvent(id.data);
    if (!event?.can_manage || event.school_year_id !== parsed.data.school_year_id) {
      return { values, error: "You do not have permission to edit this event." };
    }
    if (!z.iso.datetime({ offset: true }).safeParse(values.updated_at).success) {
      return { values, error: "Reload the event before editing." };
    }
    eventId = event.id;
  } else {
    if (!canPublishServiceEvents(viewer)) {
      return {
        values,
        error: "Only committee heads and teacher administrators can publish events.",
      };
    }
    if (parsed.data.school_year_id !== viewer.activeMembership.school_year_id) {
      return { values, error: "Publish events only for your current school year." };
    }
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc(
    editing ? "update_service_event" : "create_service_event",
    {
      ...(editing
        ? { p_event_id: eventId, p_expected_updated_at: values.updated_at }
        : { p_school_year_id: parsed.data.school_year_id }),
      p_title: parsed.data.title,
      p_description: parsed.data.description,
      p_location: parsed.data.location,
      p_volunteer_audience: parsed.data.volunteer_audience,
      p_starts_at: parsed.data.starts_at,
      p_ends_at: parsed.data.ends_at,
      p_signup_deadline: parsed.data.signup_deadline,
      p_contact_name: parsed.data.contact_name,
      p_contact_email: parsed.data.contact_email,
      p_capacity: parsed.data.capacity,
    },
  );
  if (error) return { values, error: eventRpcError(error) };

  eventId = returnedId(data);
  if (!eventId)
    return { error: "The event was saved but could not be opened. Return to Events to check it." };
  revalidatePath("/events");
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/notifications");
  redirect(`/events/${eventId}?notice=${editing ? "updated" : "created"}`);
}

export async function closeServiceEventAction(
  eventId: string,
  operation: "end" | "delete",
  updatedAt: string,
) {
  await requirePortalViewer();
  if (
    !z.uuid().safeParse(eventId).success ||
    !["end", "delete"].includes(operation) ||
    !z.iso.datetime({ offset: true }).safeParse(updatedAt).success
  ) {
    redirect("/events?notice=invalid-event");
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("close_service_event", {
    p_event_id: eventId,
    p_operation: operation,
    p_expected_updated_at: updatedAt,
  });
  if (error)
    redirect(
      `/events/${eventId}?notice=${error.code === "40001" ? "event-changed" : "manage-failed"}`,
    );
  revalidatePath("/events");
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/notifications");
  redirect(operation === "end" ? "/events?view=past&notice=ended" : "/events?notice=deleted");
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
  if (error)
    redirect(
      `${destination}?notice=${error.message.includes("deadline") ? "signup-closed" : "signup-failed"}`,
    );

  revalidatePath("/events");
  revalidatePath(`/events/${parsedId.data}`);
  const status = returnedStatus(data);
  if (!status) redirect(`${destination}?notice=signup-unconfirmed`);
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
