import { redirect } from "next/navigation";

import { requirePlatformOwner } from "@/lib/dal/access";

export default async function RolePreviewPage() {
  await requirePlatformOwner();
  redirect("/design-preview?role=member&section=dashboard");
}
