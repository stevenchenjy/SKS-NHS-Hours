import Link from "next/link";

import { requireTeacherAdmin } from "@/lib/dal/access";

const settingsNavigation = [
  ["/admin/settings/school-years", "School years"],
  ["/admin/settings/categories", "Categories"],
] as const;

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireTeacherAdmin();
  return (
    <>
      <nav
        aria-label="Administration settings"
        className="sticky top-20 z-20 border-b bg-background/97 px-5 backdrop-blur sm:px-7 lg:ml-0 lg:px-10"
      >
        <div className="mx-auto flex max-w-[1600px] gap-1 overflow-x-auto py-2">
          {settingsNavigation.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="shrink-0 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {label}
            </Link>
          ))}
        </div>
      </nav>
      {children}
    </>
  );
}
