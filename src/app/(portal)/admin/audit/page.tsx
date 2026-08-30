import type { Metadata } from "next";
import { Search, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/portal/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireTeacherAdmin } from "@/lib/dal/access";
import { listAuditEvents } from "@/lib/dal/portal";

export const metadata: Metadata = { title: "Audit trail" };

interface AuditRow {
  id: number;
  actor_profile_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_values: unknown;
  new_values: unknown;
  metadata: unknown;
  occurred_at: string;
  profiles?:
    { full_name: string; email: string } | Array<{ full_name: string; email: string }> | null;
}

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireTeacherAdmin();
  const params = await searchParams;
  const search = param(params.search).trim().toLowerCase();
  const action = param(params.action).trim().toLowerCase();
  const rows = (await listAuditEvents(
    viewer.activeMembership.school_year_id,
    250,
  )) as unknown as AuditRow[];
  const filtered = rows.filter((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return (
      (!action || row.action.startsWith(action)) &&
      (!search ||
        row.action.toLowerCase().includes(search) ||
        row.entity_type.toLowerCase().includes(search) ||
        row.entity_id?.toLowerCase().includes(search) ||
        profile?.full_name.toLowerCase().includes(search) ||
        profile?.email.toLowerCase().includes(search))
    );
  });

  return (
    <div className="page-container">
      <PageHeader
        eyebrow={viewer.activeMembership.school_year.label}
        title="Audit trail"
        description="Append-only sensitive-action records. The application role cannot update or delete these events."
      />

      <form className="mb-5 grid gap-3 rounded-xl border bg-muted/35 p-4 sm:grid-cols-[minmax(220px,1fr)_220px_auto]">
        <label className="relative">
          <span className="sr-only">Search audit trail</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            name="search"
            defaultValue={search}
            placeholder="Actor, action, or record"
            className="h-10 bg-background pl-9"
          />
        </label>
        <label>
          <span className="sr-only">Action prefix</span>
          <select
            name="action"
            defaultValue={action}
            className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
          >
            <option value="">All sensitive actions</option>
            <option value="hour_request.">Request decisions</option>
            <option value="invitation.">Invitations</option>
            <option value="membership.">Memberships and roles</option>
            <option value="teacher_admin.">Teacher administrators</option>
            <option value="platform_owner.">Platform ownership</option>
            <option value="school_year.">School years</option>
            <option value="category.">Categories</option>
            <option value="export.">Exports</option>
          </select>
        </label>
        <Button type="submit" variant="outline" className="h-10">
          Apply
        </Button>
      </form>

      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/60 hover:bg-muted/60">
              <TableHead className="pl-5">Time</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead className="pr-5">Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length ? (
              filtered.map((row) => {
                const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="pl-5 align-top text-xs text-muted-foreground">
                      {new Date(row.occurred_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="align-top">
                      <p className="font-medium">{profile?.full_name ?? "System"}</p>
                      <p className="text-xs text-muted-foreground">{profile?.email}</p>
                    </TableCell>
                    <TableCell className="align-top">
                      <Badge variant="outline">{row.action}</Badge>
                    </TableCell>
                    <TableCell className="align-top">
                      <p className="font-medium">{row.entity_type}</p>
                      <p className="max-w-48 truncate text-xs text-muted-foreground">
                        {row.entity_id}
                      </p>
                    </TableCell>
                    <TableCell className="max-w-md pr-5 align-top">
                      <details>
                        <summary className="cursor-pointer text-sm font-medium text-primary">
                          Inspect before/after
                        </summary>
                        <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">
                          {JSON.stringify(
                            { old: row.old_values, new: row.new_values, metadata: row.metadata },
                            null,
                            2,
                          )}
                        </pre>
                      </details>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="h-36 text-center text-muted-foreground">
                  <ShieldCheck className="mx-auto mb-2 size-5" aria-hidden="true" />
                  No audit events match this view.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
