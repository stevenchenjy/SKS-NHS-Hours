"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePortalViewer } from "@/lib/dal/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { unreadNotificationCount } from "@/lib/dal/notifications";

export async function getUnreadNotificationCountAction() {
  await requirePortalViewer();
  return unreadNotificationCount();
}

export async function markNotificationsReadAction(notificationId: string | null) {
  await requirePortalViewer();
  if (notificationId !== null && !z.uuid().safeParse(notificationId).success) {
    redirect("/notifications?notice=read-failed");
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("mark_event_notifications_read", {
    p_notification_id: notificationId,
  });
  if (error) redirect("/notifications?notice=read-failed");
  revalidatePath("/", "layout");
  redirect("/notifications?notice=archived");
}
