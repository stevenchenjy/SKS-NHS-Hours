"use client";

import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeCheck,
  ClipboardCheck,
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
import { cn } from "@/lib/utils";
import type { Viewer } from "@/lib/types";

interface NavigationItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

const memberNavigation: NavigationItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/hours/new", label: "Log Hours", icon: PencilLine },
  { href: "/profile", label: "My Profile", icon: UserRound },
];

const reviewerNavigation: NavigationItem[] = [
  { href: "/admin", label: "Admin overview", icon: ClipboardCheck },
  { href: "/admin/requests", label: "Review requests", icon: FileClock },
  { href: "/admin/members", label: "Member progress", icon: UsersRound },
];

const teacherAdminNavigation: NavigationItem[] = [
  { href: "/admin/accounts", label: "Accounts", icon: BadgeCheck },
  { href: "/admin/audit", label: "Audit trail", icon: ShieldCheck },
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

function roleLabel(viewer: Viewer): string {
  if (viewer.isPlatformOwner) return "Platform owner";
  if (viewer.isTeacherAdmin) return "Global teacher administrator";
  if (viewer.roles.includes("president_vice_president")) {
    return "President / Vice President";
  }
  if (viewer.roles.includes("committee_head")) return "Committee head";
  return "Member";
}

function NavLink({ item, compact = false }: { item: NavigationItem; compact?: boolean }) {
  const pathname = usePathname();
  const active =
    pathname === item.href ||
    (item.href !== "/dashboard" && item.href !== "/admin" && pathname.startsWith(`${item.href}/`));
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
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

export function AppShell({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  const adminOnly = viewer.isTeacherAdmin && !viewer.isMember;
  const navigation = [
    ...(viewer.isMember ? memberNavigation : []),
    ...(viewer.canReview ? reviewerNavigation : []),
    ...(viewer.isTeacherAdmin ? teacherAdminNavigation : []),
    ...(viewer.isPlatformOwner ? [rolePreviewNavigation] : []),
  ];
  const bottomNavigation = adminOnly
    ? [
        reviewerNavigation[0],
        reviewerNavigation[1],
        teacherAdminNavigation[0],
        ...(viewer.isPlatformOwner ? [rolePreviewNavigation] : []),
      ]
    : viewer.canReview
      ? [memberNavigation[0], memberNavigation[1], reviewerNavigation[1]]
      : memberNavigation;
  const safeBottomNavigation = bottomNavigation.filter((item): item is NavigationItem =>
    Boolean(item),
  );

  return (
    <div className="min-h-dvh bg-background">
      <header className="fixed inset-x-0 top-0 z-40 flex h-20 items-center justify-between border-b bg-background/96 px-5 backdrop-blur sm:px-7 lg:px-8">
        <Link
          href={adminOnly ? "/admin" : "/dashboard"}
          className="flex items-center gap-3 font-bold tracking-tight"
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
            NHS
          </span>
          <span>NHS Service Hours</span>
        </Link>
        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-semibold">{viewer.profile.full_name}</p>
            <p className="text-xs text-muted-foreground">{roleLabel(viewer)}</p>
          </div>
          <Avatar className="size-9">
            <AvatarFallback className="bg-secondary text-xs font-bold text-secondary-foreground">
              {initials(viewer.profile.full_name)}
            </AvatarFallback>
          </Avatar>
        </div>
      </header>

      <aside className="fixed bottom-0 left-0 top-20 z-30 hidden w-[292px] flex-col border-r bg-sidebar lg:flex">
        <nav aria-label="Primary navigation" className="flex-1 space-y-1 overflow-y-auto px-4 py-6">
          {navigation.map((item, index) => (
            <div key={item.href}>
              {(item.href === "/admin" || item.href === "/admin/accounts") && index > 0 ? (
                <p className="mb-2 mt-6 px-4 text-[0.7rem] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  {item.href === "/admin" ? "Leadership" : "Administration"}
                </p>
              ) : null}
              <NavLink item={item} />
            </div>
          ))}
        </nav>
        <div className="border-t p-4">
          <div className="mb-3 rounded-lg bg-background/70 px-4 py-3">
            <p className="text-xs text-muted-foreground">
              {viewer.isTeacherAdmin ? "Access" : "School year"}
            </p>
            <p className="mt-0.5 text-sm font-semibold">
              {viewer.isTeacherAdmin
                ? "All school years"
                : (viewer.activeMembership?.school_year.label ?? "No active year")}
            </p>
          </div>
          <form action={signOutAction}>
            <Button type="submit" variant="ghost" className="w-full justify-start">
              <LogOut data-icon="inline-start" aria-hidden="true" />
              Sign out
            </Button>
          </form>
        </div>
      </aside>

      <main id="main-content" className="min-h-dvh pb-20 pt-20 lg:ml-[292px] lg:pb-0">
        {children}
      </main>

      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-background/97 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {safeBottomNavigation.map((item) => (
          <NavLink key={item.href} item={item} compact />
        ))}
      </nav>
    </div>
  );
}
