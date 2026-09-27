import { AppShell } from "@/components/portal/app-shell";
import { PortalVisitTracker } from "@/components/portal/portal-visit-tracker";
import { requirePortalViewer } from "@/lib/dal/access";
import { getNavigationIndicators } from "@/lib/dal/navigation-indicators";
import { unreadNotificationCount } from "@/lib/dal/notifications";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requirePortalViewer();
  const [unread, navigationIndicators] = await Promise.all([
    unreadNotificationCount(),
    getNavigationIndicators(),
  ]);
  return (
    <AppShell
      viewer={viewer}
      unreadNotifications={unread}
      initialNavigationIndicators={navigationIndicators}
    >
      <PortalVisitTracker />
      {children}
    </AppShell>
  );
}
