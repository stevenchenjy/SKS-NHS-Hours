import type { Metadata } from "next";
import Link from "next/link";
import { Download, MoreHorizontal, Search } from "lucide-react";

import {
  resendInvitationAction,
  revokeInvitationAction,
  setMembershipStatusAction,
  setProfileStatusAction,
} from "@/app/actions/admin-actions";
import { InviteAccountForm, RosterImportForm } from "@/components/admin/account-forms";
import { PageHeader } from "@/components/portal/page-header";
import { StatusBadge } from "@/components/portal/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireTeacherAdmin } from "@/lib/dal/access";
import { listAccountDirectory, listInvitations, listSchoolYears } from "@/lib/dal/portal";

export const metadata: Metadata = { title: "Accounts" };

interface InvitationRow {
  id: string;
  email: string;
  full_name: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expires_at: string;
  sent_at: string | null;
  send_count: number;
  invitation_roles?: Array<{
    roles:
      | { role_key: string; display_name: string }
      | Array<{ role_key: string; display_name: string }>;
  }>;
}

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireTeacherAdmin();
  const params = await searchParams;
  const years = await listSchoolYears();
  const selectedYearId = param(params.year) || viewer.activeMembership.school_year_id;
  const search = param(params.search).toLowerCase().trim();
  const notice = param(params.notice);
  const [directory, invitationData] = await Promise.all([
    listAccountDirectory(selectedYearId),
    listInvitations(selectedYearId),
  ]);
  const invitations = invitationData as unknown as InvitationRow[];
  const filtered = directory.filter(
    ({ profile }) =>
      !search ||
      profile.full_name.toLowerCase().includes(search) ||
      profile.email.toLowerCase().includes(search),
  );

  return (
    <div className="page-container">
      <PageHeader
        eyebrow={years.find((year) => year.id === selectedYearId)?.label}
        title="Accounts"
        description="Invitation-only identity provisioning, access status, roster import, and school-year memberships."
        actions={
          <Button
            render={<Link href={`/api/exports/directory?year=${selectedYearId}`} />}
            variant="outline"
          >
            <Download data-icon="inline-start" aria-hidden="true" />
            Export directory
          </Button>
        }
      />

      {notice ? (
        <p
          role="status"
          className="mb-6 rounded-lg bg-secondary p-4 text-sm text-secondary-foreground"
        >
          {decodeURIComponent(notice).replaceAll("-", " ")}
        </p>
      ) : null}

      <Tabs defaultValue="directory">
        <TabsList className="mb-6 flex w-full justify-start overflow-x-auto">
          <TabsTrigger value="directory">Directory</TabsTrigger>
          <TabsTrigger value="invite">Invite one</TabsTrigger>
          <TabsTrigger value="import">Import roster</TabsTrigger>
          <TabsTrigger value="invitations">Invitations</TabsTrigger>
        </TabsList>

        <TabsContent value="directory">
          <form className="mb-5 flex flex-col gap-3 sm:flex-row">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search accounts</span>
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                name="search"
                defaultValue={search}
                placeholder="Search name or email"
                className="h-10 pl-9"
              />
            </label>
            <label>
              <span className="sr-only">School year</span>
              <select
                name="year"
                defaultValue={selectedYearId}
                className="h-10 rounded-lg border bg-background px-3 text-sm"
              >
                {years.map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.label}
                  </option>
                ))}
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
                  <TableHead className="pl-5">Account</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Membership</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Account status</TableHead>
                  <TableHead className="pr-5 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length ? (
                  filtered.map(({ profile, membership }) => {
                    const profileAction = setProfileStatusAction.bind(
                      null,
                      profile.id,
                      profile.status === "active" ? "inactive" : "active",
                    );
                    const membershipAction = setMembershipStatusAction.bind(
                      null,
                      membership.id,
                      membership.status === "active" ? "suspended" : "active",
                    );
                    return (
                      <TableRow key={membership.id}>
                        <TableCell className="pl-5">
                          <p className="font-semibold">{profile.full_name}</p>
                          <p className="text-xs text-muted-foreground">{profile.email}</p>
                        </TableCell>
                        <TableCell>
                          <div className="flex max-w-[260px] flex-wrap gap-1">
                            {membership.roles.map((role) => (
                              <Badge key={role} variant="outline" className="capitalize">
                                {role.replaceAll("_", " ")}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={membership.status} />
                        </TableCell>
                        <TableCell>{membership.expiration_date}</TableCell>
                        <TableCell>
                          <StatusBadge
                            status={profile.status === "active" ? "active" : "suspended"}
                          />
                        </TableCell>
                        <TableCell className="pr-5 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
                              <MoreHorizontal aria-hidden="true" />
                              <span className="sr-only">
                                Account actions for {profile.full_name}
                              </span>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                render={<Link href={`/admin/members/${profile.id}`} />}
                              >
                                Open member profile
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                render={
                                  <Link href={`/admin/settings/roles?member=${membership.id}`} />
                                }
                              >
                                Manage roles
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                render={
                                  <form action={membershipAction}>
                                    <button type="submit" className="w-full text-left">
                                      {membership.status === "active"
                                        ? "Suspend membership"
                                        : "Reactivate membership"}
                                    </button>
                                  </form>
                                }
                              />
                              <DropdownMenuItem
                                render={
                                  <form action={profileAction}>
                                    <button type="submit" className="w-full text-left">
                                      {profile.status === "active"
                                        ? "Deactivate account"
                                        : "Reactivate account"}
                                    </button>
                                  </form>
                                }
                              />
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="h-36 text-center text-muted-foreground">
                      No accounts match this view.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="invite">
          <section className="max-w-3xl rounded-xl border p-6">
            <h2 className="text-xl font-bold">Invite one account</h2>
            <p className="mb-6 mt-1 text-sm text-muted-foreground">
              The user receives a Supabase invitation link. Domain matching alone never grants
              access.
            </p>
            <InviteAccountForm schoolYears={years} />
          </section>
        </TabsContent>

        <TabsContent value="import">
          <section className="max-w-3xl rounded-xl border p-6">
            <h2 className="text-xl font-bold">Import a roster CSV</h2>
            <p className="mb-6 mt-1 text-sm text-muted-foreground">
              Every row is validated before its invitation is created. The result reports partial
              failures safely.
            </p>
            <RosterImportForm schoolYears={years} />
          </section>
        </TabsContent>

        <TabsContent value="invitations">
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <TableHead className="pl-5">Invitee</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Accepted sends</TableHead>
                  <TableHead className="pr-5 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.length ? (
                  invitations.map((invitation) => {
                    const resend = resendInvitationAction.bind(null, invitation.id);
                    const revoke = revokeInvitationAction.bind(null, invitation.id);
                    const invitationRoles =
                      invitation.invitation_roles?.flatMap((assignment) => {
                        const relation = assignment.roles;
                        return Array.isArray(relation) ? relation : [relation];
                      }) ?? [];
                    return (
                      <TableRow key={invitation.id}>
                        <TableCell className="pl-5">
                          <p className="font-semibold">{invitation.full_name}</p>
                          <p className="text-xs text-muted-foreground">{invitation.email}</p>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {invitationRoles.map((role) => (
                              <Badge key={role.role_key} variant="outline">
                                {role.display_name}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {invitation.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {new Date(invitation.expires_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>{invitation.send_count}</TableCell>
                        <TableCell className="pr-5 text-right">
                          {invitation.status === "pending" ? (
                            <div className="inline-flex gap-2">
                              <form action={resend}>
                                <Button type="submit" size="sm" variant="outline">
                                  Resend
                                </Button>
                              </form>
                              <form action={revoke}>
                                <Button type="submit" size="sm" variant="destructive">
                                  Revoke
                                </Button>
                              </form>
                            </div>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="h-36 text-center text-muted-foreground">
                      No invitations for this school year.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
