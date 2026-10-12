import { SchoolBrand } from "@/components/auth/school-brand";
import { BetaNotice } from "@/components/auth/beta-notice";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-muted lg:grid-cols-[minmax(0,1fr)_minmax(480px,0.72fr)]">
      <aside className="hidden border-r bg-primary p-12 text-primary-foreground lg:flex lg:items-center lg:justify-center">
        <SchoolBrand />
      </aside>
      <main id="main-content" className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-[460px]">
          <BetaNotice />
          {children}
        </div>
      </main>
    </div>
  );
}
