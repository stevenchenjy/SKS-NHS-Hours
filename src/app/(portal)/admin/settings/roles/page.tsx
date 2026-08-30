import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Accounts" };

export default function RoleSettingsPage() {
  redirect("/admin/accounts?view=directory");
}
