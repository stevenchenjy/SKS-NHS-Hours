"use client";

import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeCheck,
  CalendarDays,
  Download,
  Eye,
  FileClock,
  Home,
  LogOut,
  PencilLine,
  Settings,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";

import { signOutAction } from "@/app/actions/auth-actions";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { canViewMemberProgress } from "@/lib/domain/roles";
import { cn } from "@/lib/utils";
import type { Viewer } from "@/lib/types";

interface NavigationItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

export interface AppShellPreview {
  role: "member" | "committee_head" | "president_vice_president" | "teacher_admin";
  section: string;
}

const previewSectionsByRoute: Record<string, string> = {
  "/dashboard": "dashboard",
  "/events": "events",
  "/hours/new": "log",
  "/profile": "profile",
  "/admin/requests": "review-requests",
  "/admin/members": "member-progress",
  "/admin/accounts": "accounts",
  "/admin/exports": "exports",
  "/admin/settings/school-years": "settings",
  "/admin/audit": "audit",
};

function previewHref(preview: AppShellPreview, href: string): string {
  const section = previewSectionsByRoute[href];
  return section
    ? `/design-preview?role=${preview.role}&section=${section}`
    : "/design-preview?role=" + preview.role + "&section=" + preview.section;
}

const memberNavigation: NavigationItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/events", label: "Events", icon: CalendarDays },
  { href: "/hours/new", label: "Log Hours", icon: PencilLine },
];

const eventsNavigation = memberNavigation[1]!;

const profileNavigation: NavigationItem = {
  href: "/profile",
  label: "My Profile",
  icon: UserRound,
};

const reviewRequestsNavigation: NavigationItem = {
  href: "/admin/requests",
  label: "Review requests",
  icon: FileClock,
};

const memberProgressNavigation: NavigationItem = {
  href: "/admin/members",
  label: "Member progress",
  icon: UsersRound,
};

const auditTrailNavigation: NavigationItem = {
  href: "/admin/audit",
  label: "Audit trail",
  icon: ShieldCheck,
};

const teacherAdminNavigation: NavigationItem[] = [
  { href: "/admin/accounts", label: "Accounts", icon: BadgeCheck },
  { href: "/admin/exports", label: "Exports", icon: Download },
  { href: "/admin/settings/school-years", label: "Settings", icon: Settings },
];

const rolePreviewNavigation: NavigationItem = {
  href: "/admin/role-preview",
  label: "Role preview",
  icon: Eye,
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function NavLink({
  item,
  compact = false,
  preview,
}: {
  item: NavigationItem;
  compact?: boolean;
  preview?: AppShellPreview;
}) {
  const pathname = usePathname();
  const active = preview
    ? previewSectionsByRoute[item.href] === preview.section
    : pathname === item.href ||
      (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
  const Icon = item.icon;
  return (
    <Link
      href={preview ? previewHref(preview, item.href) : item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        compact
          ? "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 px-2 text-[0.72rem] font-medium"
          : "relative flex min-h-11 items-center gap-3 rounded-md px-4 py-2 text-sm font-medium",
        active
          ? compact
            ? "text-primary"
            : "bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-full before:bg-primary"
          : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
      )}
    >
      <Icon className={compact ? "size-5" : "size-[1.1rem]"} aria-hidden={true} />
      <span>{item.label}</span>
    </Link>
  );
}

export function AppShell({
  viewer,
  children,
  preview,
  previewControls,
}: {
  viewer: Viewer;
  children: ReactNode;
  preview?: AppShellPreview;
  previewControls?: ReactNode;
}) {
  const adminOnly = viewer.isTeacherAdmin && !viewer.isMember;
  const progressAccess = canViewMemberProgress(viewer);
  const teacherAdministrationNavigation = [
    teacherAdminNavigation[0]!,
    ...(viewer.isPlatformOwner ? [auditTrailNavigation] : []),
    ...teacherAdminNavigation.slice(1),
  ];
  const navigation = [
    ...(viewer.isMember ? memberNavigation : [eventsNavigation]),
    ...(viewer.canReview ? [reviewRequestsNavigation] : []),
    ...(progressAccess ? [memberProgressNavigation] : []),
    ...(viewer.isTeacherAdmin ? teacherAdministrationNavigation : []),
    ...(viewer.isPlatformOwner ? [rolePreviewNavigation] : []),
  ];
  const bottomNavigation = adminOnly
    ? [
        eventsNavigation,
        reviewRequestsNavigation,
        ...(progressAccess ? [memberProgressNavigation] : []),
        teacherAdminNavigation[0]!,
        ...(viewer.isPlatformOwner ? [auditTrailNavigation] : []),
      ]
    : viewer.canReview
      ? [
          memberNavigation[0],
          eventsNavigation,
          memberNavigation[2],
          reviewRequestsNavigation,
          ...(progressAccess ? [memberProgressNavigation] : []),
        ]
      : [
          memberNavigation[0],
          eventsNavigation,
          memberNavigation[2],
          ...(progressAccess ? [memberProgressNavigation] : []),
          profileNavigation,
        ];
  const safeBottomNavigation = bottomNavigation.filter((item): item is NavigationItem =>
    Boolean(item),
  );

  return (
    <div className="min-h-dvh bg-background">
      <header className="fixed inset-x-0 top-0 z-40 flex h-20 items-center justify-between border-b bg-background/96 px-5 backdrop-blur sm:px-7 lg:px-8">
        <Link
          href={
            preview
              ? previewHref(preview, adminOnly ? "/admin/members" : "/dashboard")
              : adminOnly
                ? "/admin/members"
                : "/dashboard"
          }
          className="flex items-center gap-3 font-bold tracking-tight"
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
            NHS
          </span>
          <span>NHS Service Hours</span>
        </Link>
        <Link
          href={preview ? previewHref(preview, "/profile") : "/profile"}
          aria-label="Open My Profile"
          className="flex items-center gap-3 rounded-md p-1 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="hidden text-right sm:block">
            <p className="text-sm font-semibold">{viewer.profile.full_name}</p>
          </div>
          <Avatar className="size-9">
            <AvatarFallback className="bg-secondary text-xs font-bold text-secondary-foreground">
              {initials(viewer.profile.full_name)}
            </AvatarFallback>
          </Avatar>
        </Link>
      </header>

      <aside className="fixed bottom-0 left-0 top-20 z-30 hidden w-[292px] flex-col border-r bg-sidebar lg:flex">
        <nav aria-label="Primary navigation" className="flex-1 space-y-1 overflow-y-auto px-4 py-6">
          {navigation.map((item, index) => (
            <div key={item.href}>
              {item.href === "/admin/accounts" && index > 0 ? (
                <p className="mb-2 mt-6 px-4 text-[0.7rem] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Administration
                </p>
              ) : null}
              <NavLink item={item} preview={preview} />
            </div>
          ))}
        </nav>
        <div className="border-t p-4">
          {viewer.isMember ? <NavLink item={profileNavigation} preview={preview} /> : null}
          {preview ? (
            <Button type="button" variant="ghost" className="w-full justify-start" disabled>
              <LogOut data-icon="inline-start" aria-hidden="true" />
              Sign out
            </Button>
          ) : (
            <form action={signOutAction}>
              <Button type="submit" variant="ghost" className="w-full justify-start">
                <LogOut data-icon="inline-start" aria-hidden="true" />
                Sign out
              </Button>
            </form>
          )}
        </div>
      </aside>

      <main id="main-content" className="min-h-dvh pb-20 pt-20 lg:ml-[292px] lg:pb-0">
        {preview ? (
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_18rem]">
            <div inert className="pointer-events-none order-2 min-w-0 xl:order-1">
              {children}
            </div>
            {previewControls ? (
              <div className="order-1 min-w-0 border-b p-4 sm:px-7 xl:order-2 xl:sticky xl:top-20 xl:h-[calc(100dvh-5rem)] xl:border-b-0 xl:border-l xl:p-4">
                {previewControls}
              </div>
            ) : null}
          </div>
        ) : (
          children
        )}
      </main>

      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-background/97 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {safeBottomNavigation.map((item) => (
          <NavLink key={item.href} item={item} compact preview={preview} />
        ))}
      </nav>
    </div>
  );
}
