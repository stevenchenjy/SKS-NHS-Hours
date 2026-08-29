import { AppShell } from "@/components/portal/app-shell";
import { requireActiveViewer } from "@/lib/dal/access";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requireActiveViewer();
  return <AppShell viewer={viewer}>{children}</AppShell>;
}
