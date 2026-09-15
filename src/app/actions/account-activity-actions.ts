"use server";

import { requirePortalViewer } from "@/lib/dal/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function recordPortalVisitAction(): Promise<void> {
  await requirePortalViewer();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("record_portal_visit");
  if (error) {
    console.error("Unable to record first portal visit", { code: error.code });
    throw new Error("Unable to record portal visit");
  }
}
