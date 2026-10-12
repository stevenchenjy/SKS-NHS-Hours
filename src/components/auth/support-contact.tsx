import { getServerEnvironment } from "@/lib/env";

export function SupportContact() {
  const email = getServerEnvironment().NHS_SUPPORT_EMAIL;
  return email ? (
    <a
      href={`mailto:${email}?subject=NHS%20portal%20sign-in%20help`}
      className="text-sm font-medium text-primary underline-offset-4 hover:underline"
    >
      Contact NHS support ({email})
    </a>
  ) : (
    <p className="text-sm text-muted-foreground">
      Need help? Contact your NHS adviser through the school’s usual channel.
    </p>
  );
}
