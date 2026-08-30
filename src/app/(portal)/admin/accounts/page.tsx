import type { Metadata } from "next";
import Link from "next/link";
import { Download, MoreHorizontal, Search, X } from "lucide-react";

import {
  assignRoleAction,
  grantTeacherAdminAction,
  removeRoleAction,
  resendInvitationAction,
  revokeInvitationAction,
  revokeTeacherAdminAction,
  setMembershipStatusAction,
  setProfileStatusAction,
  transferPlatformOwnerAction,
} from "@/app/actions/admin-actions";
import {
  AddExistingAccountForm,
  InviteAccountForm,
  RosterImportForm,
} from "@/components/admin/account-forms";
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
import { requireTeacherAdmin } from "@/lib/dal/access";
import { listAccountDirectory, listInvitations, listSchoolYears } from "@/lib/dal/portal";
import {
  deriveAnnualAccessStatus,
  deriveInvitationStatus,
  type AnnualAccessStatus,
} from "@/lib/domain";
import type { AccountDirectoryRecord } from "@/lib/types";

export const metadata: Metadata = { title: "Accounts" };

type AccountView = "directory" | "add" | "invitations";

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

const accountViews: Array<{ value: AccountView; label: string }> = [
  { value: "directory", label: "Accounts" },
  { value: "add", label: "Add accounts" },
  { value: "invitations", label: "Invitations" },
];

const leadershipRoles = [
  ["committee_head", "Committee head"],
  ["president_vice_president", "President / Vice President"],
] as const;

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function accountView(value: string): AccountView {
  return accountViews.some((item) => item.value === value) ? (value as AccountView) : "directory";
}

function accountsHref(
  view: AccountView,
  schoolYearId: string,
  extra: Record<string, string> = {},
): string {
  const search = new URLSearchParams({ view, year: schoolYearId, ...extra });
  return `/admin/accounts?${search.toString()}`;
}

function roleLabel(role: string): string {
  if (role === "president_vice_president") return "President / Vice President";
  if (role === "committee_head") return "Committee head";
  if (role === "teacher_admin") return "Teacher administrator";
  if (role === "platform_owner") return "Platform owner";
  return "Member";
}

function dateTime(value: string | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function accessLabel(record: AccountDirectoryRecord): string | null {
  if (record.globalAccessLevel === "platform_owner") return "Platform owner";
  if (record.globalAccessLevel === "teacher_admin") return "Teacher administrator";
  return null;
}

function annualAccessStatus(
  record: AccountDirectoryRecord,
  selectedYear: NonNullable<AccountDirectoryRecord["membership"]>["school_year"] | undefined,
  today: string,
): AnnualAccessStatus | null {
  const { membership, profile } = record;
  if (!membership || !selectedYear) return null;
  return deriveAnnualAccessStatus({
    profileStatus: profile.status,
    membershipStatus: membership.status,
    membershipExpirationDate: membership.expiration_date,
    schoolYearStatus: selectedYear.status,
    schoolYearStartDate: selectedYear.start_date,
    schoolYearEndDate: selectedYear.end_date,
    onDate: today,
  });
}

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [viewer, params] = await Promise.all([requireTeacherAdmin(), searchParams]);
  const years = await listSchoolYears();
  const fallbackYearId =
    viewer.activeMembership?.school_year_id ??
    years.find((year) => year.status === "active")?.id ??
    years[0]?.id ??
    "";
  const requestedYearId = param(params.year);
  const selectedYearId = years.some((year) => year.id === requestedYearId)
    ? requestedYearId
    : fallbackYearId;
  const view = accountView(param(params.view));
  const search = param(params.search).toLowerCase().trim();
  const notice = param(params.notice);
  const defaultProfileId = param(params.profile);
  const confirmTransferProfileId = param(params.confirm_transfer);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  let directory: AccountDirectoryRecord[] = [];
  let invitations: InvitationRow[] = [];
  if (selectedYearId && (view === "directory" || view === "add")) {
    directory = await listAccountDirectory(selectedYearId);
  } else if (selectedYearId && view === "invitations") {
    invitations = (await listInvitations(selectedYearId)) as unknown as InvitationRow[];
  }

  const filtered = directory.filter(
    ({ profile }) =>
      !search ||
      profile.full_name.toLowerCase().includes(search) ||
      profile.email.toLowerCase().includes(search),
  );
  const selectedYear = years.find((year) => year.id === selectedYearId);
  const defaultOpenSchoolYearId =
    years.find((year) => year.id === selectedYearId && ["draft", "active"].includes(year.status))
      ?.id ?? years.find((year) => ["draft", "active"].includes(year.status))?.id;
  const destinationSchoolYear = years.find(
    (year) => year.id !== selectedYearId && ["draft", "active"].includes(year.status),
  );
  const hasOpenSchoolYear = Boolean(defaultOpenSchoolYearId);
  const transferTarget = viewer.isPlatformOwner
    ? directory.find(
        (record) =>
          record.profile.id === confirmTransferProfileId &&
          record.globalAccessLevel === "teacher_admin",
      )
    : undefined;

  return (
    <div className="page-container">
      <PageHeader
        eyebrow={selectedYear?.label}
        title="Accounts"
        description="Manage identities, school-year access, roles, and invitations from one place."
        actions={
          view === "directory" && selectedYearId ? (
            <Button
              render={<Link href={`/api/exports/directory?year=${selectedYearId}`} />}
              variant="outline"
            >
              <Download data-icon="inline-start" aria-hidden="true" />
              Export directory
            </Button>
          ) : undefined
        }
      />

      {notice ? (
        <p
          role="status"
          className="mb-6 rounded-lg bg-secondary p-4 text-sm text-secondary-foreground"
        >
          {notice.replaceAll("-", " ")}
        </p>
      ) : null}

      {transferTarget ? (
        <section
          aria-labelledby="confirm-owner-transfer-heading"
          className="mb-6 rounded-xl border border-[var(--status-pending)]/35 bg-[var(--status-pending-bg)] p-5"
        >
          <h2 id="confirm-owner-transfer-heading" className="font-semibold">
            Transfer platform ownership to {transferTarget.profile.full_name}?
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            This immediately gives that account the only platform-owner grant and changes your
            account to a teacher administrator. Only the new owner can transfer ownership back.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <form
              action={transferPlatformOwnerAction.bind(
                null,
                transferTarget.profile.id,
                selectedYearId,
              )}
            >
              <Button type="submit" variant="destructive">
                Confirm ownership transfer
              </Button>
            </form>
            <Button
              render={<Link href={accountsHref("directory", selectedYearId)} />}
              variant="outline"
            >
              Cancel
            </Button>
          </div>
        </section>
      ) : null}

      <div className="mb-6 flex flex-col gap-4 border-b pb-4 lg:flex-row lg:items-center lg:justify-between">
        <nav aria-label="Account views" className="flex flex-wrap gap-2">
          {accountViews.map((item) => (
            <Button
              key={item.value}
              render={
                <Link
                  href={accountsHref(item.value, selectedYearId)}
                  aria-current={view === item.value ? "page" : undefined}
                />
              }
              variant={view === item.value ? "default" : "ghost"}
              size="sm"
            >
              {item.label}
            </Button>
          ))}
        </nav>
        <form className="flex items-center gap-2">
          <input type="hidden" name="view" value={view} />
          <label htmlFor="accounts-year" className="sr-only">
            School year
          </label>
          <select
            id="accounts-year"
            name="year"
            defaultValue={selectedYearId}
            disabled={!years.length}
            className="h-10 rounded-lg border bg-background px-3 text-sm"
          >
            {years.map((year) => (
              <option key={year.id} value={year.id}>
                {year.label}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline" className="h-10" disabled={!years.length}>
            View
          </Button>
        </form>
      </div>

      {!selectedYearId ? (
        <section className="rounded-xl border border-dashed p-8 text-center">
          <h2 className="text-xl font-bold">Create a school year first</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Accounts need a school year context before invitations, member access, or leadership
            roles can be managed.
          </p>
          <Button
            render={<Link href="/admin/settings/school-years" />}
            className="mt-5"
            variant="outline"
          >
            Open school-year settings
          </Button>
        </section>
      ) : null}

      {view === "directory" && selectedYearId ? (
        <section aria-labelledby="account-directory-heading">
          <h2 id="account-directory-heading" className="sr-only">
            Account directory
          </h2>
          <form className="mb-5 flex flex-col gap-3 sm:flex-row">
            <input type="hidden" name="view" value="directory" />
            <input type="hidden" name="year" value={selectedYearId} />
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
            <Button type="submit" variant="outline" className="h-10">
              Search
            </Button>
          </form>

          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <TableHead className="pl-5">Account</TableHead>
                  <TableHead className="min-w-[280px]">Access and roles</TableHead>
                  <TableHead>School-year access</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Account status</TableHead>
                  <TableHead className="pr-5 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length ? (
                  filtered.map((record) => {
                    const { profile, membership } = record;
                    const globalLabel = accessLabel(record);
                    const membershipRoles = globalLabel ? [] : (membership?.roles ?? []);
                    const selectedYearIsOpen = Boolean(
                      selectedYear && ["draft", "active"].includes(selectedYear.status),
                    );
                    const membershipIsUnexpired = Boolean(
                      membership &&
                      selectedYear &&
                      membership.expiration_date >= today &&
                      selectedYear.end_date >= today,
                    );
                    const canManageMembership = Boolean(
                      membership &&
                      profile.status === "active" &&
                      selectedYearIsOpen &&
                      membershipIsUnexpired &&
                      ["active", "suspended"].includes(membership.status),
                    );
                    const canEditRoles = canManageMembership && membership?.status === "active";
                    const displayedAccessStatus = annualAccessStatus(record, selectedYear, today);
                    const isHistoricalMembership = Boolean(
                      membership &&
                      (displayedAccessStatus === "closed" ||
                        displayedAccessStatus === "expired" ||
                        displayedAccessStatus === "archived"),
                    );
                    const isFormerAdminAnchor = Boolean(
                      membership &&
                      membership.status === "archived" &&
                      membershipRoles.length === 0,
                    );
                    const isObviousMember = Boolean(membership && !isFormerAdminAnchor);
                    const canGrantTeacherAdmin = Boolean(
                      viewer.isPlatformOwner &&
                      record.globalAccessLevel === null &&
                      profile.status === "active" &&
                      (!membership || isFormerAdminAnchor),
                    );
                    const canChangeProfileStatus =
                      record.globalAccessLevel === null ||
                      (viewer.isPlatformOwner && record.globalAccessLevel === "teacher_admin");
                    const missingLeadershipRoles = leadershipRoles.filter(
                      ([role]) => !membershipRoles.includes(role),
                    );
                    const profileAction = setProfileStatusAction.bind(
                      null,
                      profile.id,
                      profile.status === "active" ? "inactive" : "active",
                      selectedYearId,
                    );
                    const membershipAction =
                      membership && canManageMembership
                        ? setMembershipStatusAction.bind(
                            null,
                            membership.id,
                            membership.status === "active" ? "suspended" : "active",
                            selectedYearId,
                          )
                        : null;
                    const grantAdmin = grantTeacherAdminAction.bind(
                      null,
                      profile.id,
                      selectedYearId,
                    );
                    const revokeAdmin = revokeTeacherAdminAction.bind(
                      null,
                      profile.id,
                      selectedYearId,
                    );
                    return (
                      <TableRow key={profile.id}>
                        <TableCell className="pl-5 align-top">
                          <p className="font-semibold">{profile.full_name}</p>
                          <p className="text-xs text-muted-foreground">{profile.email}</p>
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="flex max-w-[320px] flex-wrap gap-1.5">
                            {globalLabel ? <Badge variant="secondary">{globalLabel}</Badge> : null}
                            {membershipRoles.map((role) => {
                              const removable = leadershipRoles.some(([value]) => value === role);
                              const remove =
                                removable && membership && canEditRoles
                                  ? removeRoleAction.bind(null, membership.id, role, selectedYearId)
                                  : null;
                              return (
                                <Badge key={role} variant="outline" className="h-7 gap-1.5">
                                  {roleLabel(role)}
                                  {remove ? (
                                    <form action={remove} className="inline-flex">
                                      <button
                                        type="submit"
                                        aria-label={`Remove ${roleLabel(role)} from ${profile.full_name}`}
                                        className="rounded-sm p-0.5 hover:bg-muted"
                                      >
                                        <X className="size-3" aria-hidden="true" />
                                      </button>
                                    </form>
                                  ) : null}
                                </Badge>
                              );
                            })}
                          </div>
                          {membership &&
                          !globalLabel &&
                          canEditRoles &&
                          missingLeadershipRoles.length ? (
                            <form
                              action={assignRoleAction.bind(null, membership.id, selectedYearId)}
                              className="mt-2 flex flex-wrap gap-2"
                            >
                              <label className="sr-only" htmlFor={`assign-${membership.id}`}>
                                Add school-year role to {profile.full_name}
                              </label>
                              <select
                                id={`assign-${membership.id}`}
                                name="role"
                                className="h-8 rounded-lg border bg-background px-2 text-xs"
                              >
                                {missingLeadershipRoles.map(([role, label]) => (
                                  <option key={role} value={role}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                              <Button type="submit" variant="outline" size="xs">
                                Add role
                              </Button>
                            </form>
                          ) : null}
                        </TableCell>
                        <TableCell className="align-top">
                          {globalLabel ? (
                            <span className="text-sm font-medium">All school years</span>
                          ) : isFormerAdminAnchor ? (
                            <span className="text-sm text-muted-foreground">No member access</span>
                          ) : membership && displayedAccessStatus ? (
                            <div>
                              <StatusBadge status={displayedAccessStatus} />
                              {isHistoricalMembership ? (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Read-only history
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">Not assigned</span>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          {globalLabel
                            ? "Never"
                            : isFormerAdminAnchor
                              ? "—"
                              : (membership?.expiration_date ?? "—")}
                        </TableCell>
                        <TableCell className="align-top">
                          <StatusBadge status={profile.status} />
                        </TableCell>
                        <TableCell className="pr-5 text-right align-top">
                          <DropdownMenu>
                            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
                              <MoreHorizontal aria-hidden="true" />
                              <span className="sr-only">
                                Account actions for {profile.full_name}
                              </span>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {membership && !globalLabel && !isFormerAdminAnchor ? (
                                <DropdownMenuItem
                                  render={
                                    <Link
                                      href={`/admin/members/${profile.id}?year=${encodeURIComponent(selectedYearId)}`}
                                    />
                                  }
                                >
                                  Open service profile
                                </DropdownMenuItem>
                              ) : !membership &&
                                !globalLabel &&
                                profile.status === "active" &&
                                defaultOpenSchoolYearId ? (
                                <DropdownMenuItem
                                  render={
                                    <Link
                                      href={accountsHref("add", defaultOpenSchoolYearId, {
                                        profile: profile.id,
                                      })}
                                    />
                                  }
                                >
                                  Add to school year
                                </DropdownMenuItem>
                              ) : null}
                              {membership &&
                              !globalLabel &&
                              isHistoricalMembership &&
                              !isFormerAdminAnchor &&
                              profile.status === "active" &&
                              destinationSchoolYear ? (
                                <DropdownMenuItem
                                  render={
                                    <Link
                                      href={accountsHref("add", destinationSchoolYear.id, {
                                        profile: profile.id,
                                      })}
                                    />
                                  }
                                >
                                  Assign access in {destinationSchoolYear.label}
                                </DropdownMenuItem>
                              ) : null}
                              {membership &&
                              !globalLabel &&
                              isHistoricalMembership &&
                              !isFormerAdminAnchor &&
                              profile.status === "active" &&
                              !destinationSchoolYear ? (
                                <DropdownMenuItem
                                  render={<Link href="/admin/settings/school-years" />}
                                >
                                  Open a destination school year
                                </DropdownMenuItem>
                              ) : null}
                              {membership &&
                              !globalLabel &&
                              isHistoricalMembership &&
                              !isFormerAdminAnchor &&
                              profile.status === "inactive" ? (
                                <DropdownMenuItem disabled>
                                  Reactivate account before assigning a new year
                                </DropdownMenuItem>
                              ) : null}
                              {canGrantTeacherAdmin ? (
                                <DropdownMenuItem
                                  render={
                                    <form action={grantAdmin}>
                                      <button type="submit" className="w-full text-left">
                                        Grant teacher administrator
                                      </button>
                                    </form>
                                  }
                                />
                              ) : null}
                              {viewer.isPlatformOwner &&
                              record.globalAccessLevel === null &&
                              isObviousMember ? (
                                <DropdownMenuItem disabled>
                                  Member accounts cannot become global admins
                                </DropdownMenuItem>
                              ) : null}
                              {viewer.isPlatformOwner &&
                              record.globalAccessLevel === null &&
                              profile.status === "inactive" &&
                              (!membership || isFormerAdminAnchor) ? (
                                <DropdownMenuItem disabled>
                                  Reactivate account before granting administrator access
                                </DropdownMenuItem>
                              ) : null}
                              {viewer.isPlatformOwner &&
                              record.globalAccessLevel === "teacher_admin" ? (
                                <>
                                  <DropdownMenuItem
                                    render={
                                      <Link
                                        href={accountsHref("directory", selectedYearId, {
                                          confirm_transfer: profile.id,
                                        })}
                                      />
                                    }
                                  >
                                    Transfer platform ownership
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    render={
                                      <form action={revokeAdmin}>
                                        <button type="submit" className="w-full text-left">
                                          Revoke teacher administrator
                                        </button>
                                      </form>
                                    }
                                  />
                                </>
                              ) : null}
                              {record.globalAccessLevel === "platform_owner" ? (
                                <DropdownMenuItem disabled>
                                  Protected platform owner
                                </DropdownMenuItem>
                              ) : null}
                              {!viewer.isPlatformOwner &&
                              record.globalAccessLevel === "teacher_admin" ? (
                                <DropdownMenuItem disabled>
                                  Managed by the platform owner
                                </DropdownMenuItem>
                              ) : null}
                              {(membershipAction && !globalLabel) || canChangeProfileStatus ? (
                                <DropdownMenuSeparator />
                              ) : null}
                              {membershipAction && !globalLabel ? (
                                <DropdownMenuItem
                                  render={
                                    <form action={membershipAction}>
                                      <button type="submit" className="w-full text-left">
                                        {membership?.status === "active"
                                          ? `Suspend ${selectedYear?.label ?? "school-year"} access`
                                          : `Reactivate ${selectedYear?.label ?? "school-year"} access`}
                                      </button>
                                    </form>
                                  }
                                />
                              ) : null}
                              {canChangeProfileStatus ? (
                                <DropdownMenuItem
                                  render={
                                    <form action={profileAction}>
                                      <button type="submit" className="w-full text-left">
                                        {profile.status === "active"
                                          ? "Deactivate account everywhere"
                                          : "Reactivate account"}
                                      </button>
                                    </form>
                                  }
                                />
                              ) : null}
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
        </section>
      ) : null}

      {view === "add" && selectedYearId && hasOpenSchoolYear ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <section aria-labelledby="invite-one-heading" className="rounded-xl border p-6">
            <h2 id="invite-one-heading" className="text-xl font-bold">
              Invite one new account
            </h2>
            <p className="mb-6 mt-1 text-sm leading-6 text-muted-foreground">
              Use this for someone who has never had an account. Track delivery and activation in
              Invitations.
            </p>
            <InviteAccountForm
              schoolYears={years}
              allowTeacherAdmin={viewer.isPlatformOwner}
              defaultSchoolYearId={defaultOpenSchoolYearId}
            />
          </section>

          <section aria-labelledby="existing-account-heading" className="rounded-xl border p-6">
            <h2 id="existing-account-heading" className="text-xl font-bold">
              Add an existing account to a school year
            </h2>
            <p className="mb-6 mt-1 text-sm leading-6 text-muted-foreground">
              Use this when the person already has an account. Their previous service history stays
              unchanged.
            </p>
            <AddExistingAccountForm
              schoolYears={years}
              accounts={directory}
              defaultProfileId={defaultProfileId || undefined}
              defaultSchoolYearId={defaultOpenSchoolYearId}
            />
          </section>

          <section
            aria-labelledby="import-roster-heading"
            className="rounded-xl border p-6 xl:col-span-2"
          >
            <h2 id="import-roster-heading" className="text-xl font-bold">
              Import a roster CSV
            </h2>
            <p className="mb-6 mt-1 text-sm leading-6 text-muted-foreground">
              Every row is validated before new invitations are created. Existing accounts should be
              added individually above.
            </p>
            <RosterImportForm schoolYears={years} defaultSchoolYearId={defaultOpenSchoolYearId} />
          </section>
        </div>
      ) : null}

      {view === "add" && selectedYearId && !hasOpenSchoolYear ? (
        <section className="rounded-xl border border-dashed p-8 text-center">
          <h2 className="text-xl font-bold">No school year is open for new access</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Create a draft year or activate an existing one before inviting people or adding
            school-year access.
          </p>
          <Button
            render={<Link href="/admin/settings/school-years" />}
            className="mt-5"
            variant="outline"
          >
            Open school-year settings
          </Button>
        </section>
      ) : null}

      {view === "invitations" && selectedYearId ? (
        <section aria-labelledby="invitations-heading">
          <div className="mb-5 rounded-xl border bg-muted/35 p-5">
            <h2 id="invitations-heading" className="font-semibold">
              Invitation activity
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Invitations are for people who have not activated an account. Once accepted, the
              person appears under Accounts. Pending or expired invitations can be resent or revoked
              here.
            </p>
          </div>
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <TableHead className="pl-5">Invitee</TableHead>
                  <TableHead>Initial access</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last sent</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Send count</TableHead>
                  <TableHead className="pr-5 text-right">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.length ? (
                  invitations.map((invitation) => {
                    const resend = resendInvitationAction.bind(null, invitation.id, selectedYearId);
                    const revoke = revokeInvitationAction.bind(null, invitation.id, selectedYearId);
                    const invitationRoles =
                      invitation.invitation_roles?.flatMap((assignment) => {
                        const relation = assignment.roles;
                        return Array.isArray(relation) ? relation : [relation];
                      }) ?? [];
                    const visibleRoles = invitationRoles.filter(
                      (role) =>
                        role.role_key !== "member" ||
                        !invitationRoles.some((candidate) => candidate.role_key !== "member"),
                    );
                    const effectiveInvitationStatus = deriveInvitationStatus(
                      invitation.status,
                      invitation.expires_at,
                      now,
                    );
                    const isTeacherAdminInvitation = invitationRoles.some(
                      (role) => role.role_key === "teacher_admin",
                    );
                    const canManageInvitation =
                      invitation.status === "pending" &&
                      (!isTeacherAdminInvitation || viewer.isPlatformOwner);
                    return (
                      <TableRow key={invitation.id}>
                        <TableCell className="pl-5">
                          <p className="font-semibold">{invitation.full_name}</p>
                          <p className="text-xs text-muted-foreground">{invitation.email}</p>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {visibleRoles.map((role) => (
                              <Badge key={role.role_key} variant="outline">
                                {roleLabel(role.role_key)}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {effectiveInvitationStatus}
                          </Badge>
                        </TableCell>
                        <TableCell>{dateTime(invitation.sent_at)}</TableCell>
                        <TableCell>{dateTime(invitation.expires_at)}</TableCell>
                        <TableCell>{invitation.send_count}</TableCell>
                        <TableCell className="pr-5 text-right">
                          {canManageInvitation ? (
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
                          ) : invitation.status === "pending" &&
                            isTeacherAdminInvitation &&
                            !viewer.isPlatformOwner ? (
                            <span className="text-xs text-muted-foreground">
                              Platform owner managed
                            </span>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="h-36 text-center text-muted-foreground">
                      No invitations for this school year.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
