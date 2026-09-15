import { Badge } from "@/components/ui/badge";
import { TableCell } from "@/components/ui/table";
import type { AccountSetupStatus } from "@/lib/dal/account-setup";

const visitDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

export function AccountSetupCells({ status }: { status: AccountSetupStatus | undefined }) {
  return (
    <>
      <TableCell className="align-top">
        {status ? (
          <Badge
            variant="outline"
            className={
              status.password_set
                ? "border-primary/25 bg-primary/5 text-primary"
                : "border-[var(--status-pending)]/30 bg-[var(--status-pending-bg)] text-[var(--status-pending)]"
            }
          >
            {status.password_set ? "Password set" : "Not set"}
          </Badge>
        ) : (
          <span className="text-sm text-muted-foreground">Unavailable</span>
        )}
      </TableCell>
      <TableCell className="align-top">
        {status?.first_portal_visit_at ? (
          <div>
            <Badge variant="outline" className="border-primary/25 bg-primary/5 text-primary">
              Entered portal
            </Badge>
            <time
              dateTime={status.first_portal_visit_at}
              className="mt-1 block text-xs text-muted-foreground"
            >
              {visitDate.format(new Date(status.first_portal_visit_at))}
            </time>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">
            {status ? "No visit recorded" : "Unavailable"}
          </span>
        )}
      </TableCell>
    </>
  );
}
