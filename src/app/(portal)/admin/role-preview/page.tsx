import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/dal/access";

export default async function RolePreviewPage() {
  await requireAdmin();
  redirect("/design-preview?role=member&section=dashboard");
}
