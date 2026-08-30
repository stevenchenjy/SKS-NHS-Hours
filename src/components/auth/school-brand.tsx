import { MountainSnow } from "lucide-react";

import { cn } from "@/lib/utils";

export function SchoolBrand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("flex items-center", compact ? "gap-3" : "flex-col gap-5 text-center")}>
      <span
        className={cn(
          "flex items-center justify-center rounded-full border border-current/35",
          compact ? "size-10" : "size-20",
        )}
        aria-label="Storm King School badge"
      >
        <MountainSnow className={compact ? "size-5" : "size-9"} aria-hidden="true" />
      </span>
      <span className={cn("font-bold tracking-tight", compact ? "text-sm" : "text-4xl")}>
        SKS NHS Hours Log
      </span>
    </div>
  );
}
