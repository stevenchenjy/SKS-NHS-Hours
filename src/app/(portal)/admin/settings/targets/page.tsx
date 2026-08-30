import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Accounts" };

export default function TargetSettingsPage() {
  redirect("/admin/accounts?view=directory");
}
