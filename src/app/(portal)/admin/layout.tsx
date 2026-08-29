import { requireReviewer } from "@/lib/dal/access";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireReviewer();
  return children;
}
