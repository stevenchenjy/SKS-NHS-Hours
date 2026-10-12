import { getServerEnvironment } from "@/lib/env";

export function BetaNotice() {
  if (getServerEnvironment().googleAuthMode !== "beta") return null;
  return (
    <p
      role="status"
      className="mb-5 rounded-lg border border-primary/25 bg-primary/5 p-3 text-sm text-primary"
    >
      Closed beta · Volunteer testers only. This is a separate test portal; hours entered here do
      not count toward your NHS record.
    </p>
  );
}
