import { Skeleton } from "@/components/ui/skeleton";

export default function GlobalLoading() {
  return (
    <div className="page-container" role="status" aria-label="Loading page">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-4 h-12 w-full max-w-xl" />
      <Skeleton className="mt-3 h-6 w-full max-w-3xl" />
      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        <Skeleton className="h-52 lg:col-span-2" />
        <Skeleton className="h-52" />
      </div>
      <Skeleton className="mt-8 h-80 w-full" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
