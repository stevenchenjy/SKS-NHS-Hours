import Link from "next/link";
import { SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function NotFoundPage() {
  return (
    <main
      id="main-content"
      className="flex min-h-dvh items-center justify-center bg-muted px-5 py-12"
    >
      <div className="w-full max-w-xl rounded-xl border bg-background p-7 text-center">
        <SearchX className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
        <h1 className="mt-5 text-2xl font-bold">Record not found</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          It may not exist, or your active school-year role may not permit access.
        </p>
        <Button render={<Link href="/dashboard" />} className="mt-6">
          Return to dashboard
        </Button>
      </div>
    </main>
  );
}
