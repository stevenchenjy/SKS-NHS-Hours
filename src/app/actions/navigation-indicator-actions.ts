"use server";

import { requirePortalViewer } from "@/lib/dal/access";
import {
  getNavigationIndicators,
  type NavigationIndicators,
} from "@/lib/dal/navigation-indicators";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getNavigationIndicatorsAction(): Promise<NavigationIndicators> {
  await requirePortalViewer();
  return getNavigationIndicators();
}

export async function markNavigationSectionSeenAction(
  section: "events" | "notifications",
): Promise<void> {
  await requirePortalViewer();
  if (section !== "events" && section !== "notifications") {
    throw new Error("Invalid navigation section");
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("mark_portal_navigation_seen", {
    p_section: section,
  });
  if (error) throw new Error(`Unable to mark navigation section seen: ${error.message}`);
}
