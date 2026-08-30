import type { Metadata } from "next";

import { RecoveryLinkHandler } from "@/components/auth/recovery-link-handler";

export const metadata: Metadata = { title: "Verify password reset" };

export default async function RecoveryCallbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const code = Array.isArray(params.code) ? params.code[0] : params.code;

  return <RecoveryLinkHandler code={code} />;
}
