import "server-only";

import { cache } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ServiceEvent, ServiceEventRosterEntry } from "@/lib/types";

function normalizeEvent(row: Record<string, unknown>): ServiceEvent {
  const status = row.my_registration_status;
  return {
    ...(row as unknown as ServiceEvent),
    capacity: Number(row.capacity),
    confirmed_count: Number(row.confirmed_count),
    waitlist_count: Number(row.waitlist_count),
    spots_remaining: Number(row.spots_remaining),
    is_expired: Boolean(row.is_expired),
    my_registration_status:
      status === "confirmed" || status === "waitlisted" || status === "withdrawn" ? status : null,
    my_waitlist_position:
      row.my_waitlist_position == null ? null : Number(row.my_waitlist_position),
    can_manage: Boolean(row.can_manage),
  };
}

export const listServiceEvents = cache(async (eventId?: string): Promise<ServiceEvent[]> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_service_events", {
    p_event_id: eventId ?? null,
  });
  if (error) throw new Error(`Unable to load service events: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeEvent);
});

export async function getServiceEvent(eventId: string): Promise<ServiceEvent | null> {
  const events = await listServiceEvents(eventId);
  return events[0] ?? null;
}

export const listServiceEventRoster = cache(
  async (eventId: string): Promise<ServiceEventRosterEntry[]> => {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("list_service_event_roster", {
      p_event_id: eventId,
    });
    if (error) throw new Error(`Unable to load the event roster: ${error.message}`);
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      ...(row as unknown as ServiceEventRosterEntry),
      registration_id: Number(row.registration_id),
      waitlist_position: row.waitlist_position == null ? null : Number(row.waitlist_position),
    }));
  },
);
