"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { getUnreadNotificationCountAction } from "@/app/actions/notification-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function NotificationBell({ initialCount }: { initialCount: number }) {
  const [count, setCount] = useState(initialCount);
  const pathname = usePathname();
  useEffect(() => {
    let disposed = false;
    let loading = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || loading) return;
      loading = true;
      try {
        const nextCount = await getUnreadNotificationCountAction();
        if (!disposed) setCount(nextCount);
      } catch {
        // Keep the last known count during a temporary connection loss.
      } finally {
        loading = false;
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [pathname, initialCount]);

  return (
    <Button
      variant="ghost"
      size="icon"
      render={<Link href="/notifications" />}
      aria-label={`Notifications${count ? `, ${count} unread` : ""}`}
      className="relative"
    >
      <Bell />
      {count > 0 ? (
        <Badge className="absolute -right-2 -top-1" aria-hidden="true">
          {count > 99 ? "99+" : count}
        </Badge>
      ) : null}
    </Button>
  );
}
