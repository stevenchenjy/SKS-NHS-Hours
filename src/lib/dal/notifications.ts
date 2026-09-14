import "server-only";

import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { EventNotification } from "@/lib/types";

export const unreadNotificationCount = cache(async (): Promise<number> => {
  const supabase = await createSupabaseServerClient();
  const { count, error } = await supabase
    .from("event_notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  if (error) throw new Error(`Unable to load notifications: ${error.message}`);
  return count ?? 0;
});

export async function listEventNotifications(
  page: number,
  view: "new" | "archive" = "new",
): Promise<EventNotification[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("list_event_notifications", {
    p_limit: 31,
    p_offset: (page - 1) * 30,
    p_archived: view === "archive",
  });
  if (error) throw new Error(`Unable to load notifications: ${error.message}`);
  return (data ?? []) as EventNotification[];
}
