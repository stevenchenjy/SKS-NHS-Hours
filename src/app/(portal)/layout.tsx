import { AppShell } from "@/components/portal/app-shell";
import { PortalVisitTracker } from "@/components/portal/portal-visit-tracker";
import { requirePortalViewer } from "@/lib/dal/access";
import { unreadNotificationCount } from "@/lib/dal/notifications";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requirePortalViewer();
  const unread = await unreadNotificationCount();
  return (
    <AppShell viewer={viewer} unreadNotifications={unread}>
      <PortalVisitTracker />
      {children}
    </AppShell>
  );
}
