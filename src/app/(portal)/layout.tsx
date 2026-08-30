import { AppShell } from "@/components/portal/app-shell";
import { requirePortalViewer } from "@/lib/dal/access";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requirePortalViewer();
  return <AppShell viewer={viewer}>{children}</AppShell>;
}
