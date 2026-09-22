import { requirePortalViewer } from "@/lib/dal/access";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePortalViewer();
  return children;
}
