import { ShieldCheck } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-muted lg:grid-cols-[minmax(0,1fr)_minmax(480px,0.72fr)]">
      <aside className="hidden border-r bg-primary p-12 text-primary-foreground lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3 text-sm font-semibold tracking-wide">
          <span className="flex size-10 items-center justify-center rounded-full border border-white/30">
            <ShieldCheck className="size-5" aria-hidden="true" />
          </span>
          NHS Service Hours
        </div>
        <div className="max-w-xl">
          <p className="text-4xl leading-tight font-bold tracking-tight">
            Service records that are clear, accountable, and ready for the school year.
          </p>
          <p className="mt-5 max-w-lg text-base leading-7 text-white/78">
            Members submit service. School leaders review it. Progress is calculated only from
            approved records.
          </p>
        </div>
        <p className="text-sm text-white/70">Private school administration system</p>
      </aside>
      <main id="main-content" className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-[460px]">{children}</div>
      </main>
    </div>
  );
}
