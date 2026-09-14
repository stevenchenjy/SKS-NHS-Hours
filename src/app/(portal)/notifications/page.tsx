import type { Metadata } from "next";
import Link from "next/link";
import { Archive, Bell } from "lucide-react";
import { markNotificationsReadAction } from "@/app/actions/notification-actions";
import { EventActionSubmit } from "@/components/events/event-action-submit";
import { NotificationRefresh } from "@/components/events/notification-refresh";
import { PageHeader } from "@/components/portal/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { requirePortalViewer } from "@/lib/dal/access";
import { listEventNotifications, unreadNotificationCount } from "@/lib/dal/notifications";
import {
  eventChangeLabels,
  formatEventChange,
  notificationKindLabels,
} from "@/lib/domain/notifications";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, params] = await Promise.all([requirePortalViewer(), searchParams]);
  const view = params.view === "archive" ? "archive" : "new";
  const archived = view === "archive";
  const requestedPage = Number(params.page);
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 10_000) : 1;
  const [notifications, unread] = await Promise.all([
    listEventNotifications(page, view),
    unreadNotificationCount(),
  ]);
  const hasMore = notifications.length > 30;

  return (
    <div className="page-container max-w-5xl">
      <NotificationRefresh />
      <PageHeader
        eyebrow={`${unread} new ${unread === 1 ? "notification" : "notifications"}`}
        title="Notifications"

        actions={
          !archived && unread > 0 ? (
            <form action={markNotificationsReadAction.bind(null, null)}>
              <EventActionSubmit
                label="Mark all as read & archive"
                pendingLabel="Archiving…"
                variant="outline"
              />
            </form>
          ) : undefined
        }
      />
      <nav aria-label="Notification views" className="mb-4 flex flex-wrap gap-2">
        <Button
          variant={archived ? "outline" : "default"}
          render={<Link href="/notifications" aria-current={!archived ? "page" : undefined} />}
        >
          <Bell className="size-4" aria-hidden="true" />
          New ({unread})
        </Button>
        <Button
          variant={archived ? "default" : "outline"}
          render={
            <Link href="/notifications?view=archive" aria-current={archived ? "page" : undefined} />
          }
        >
          <Archive className="size-4" aria-hidden="true" />
          Archive
        </Button>
      </nav>
      <p className="mb-6 text-sm text-muted-foreground">
        {archived
          ? "Notifications you’ve already read are saved here."
          : "New notifications stay here until you mark them as read and move them to Archive."}
      </p>
      {params.notice === "archived" ? (
        <p
          role="status"
          className="mb-6 rounded-lg bg-secondary p-4 text-sm text-secondary-foreground"
        >
          Marked as read and moved to Archive.
        </p>
      ) : null}
      {params.notice === "read-failed" ? (
        <p role="alert" className="mb-6 text-sm text-destructive">
          Notifications could not be marked as read. Please try again.
        </p>
      ) : null}
      {notifications.length ? (
        <section
          aria-label={archived ? "Archived notifications" : "New notifications"}
          className="flex flex-col gap-4"
        >
          {notifications.slice(0, 30).map((notification) => (
            <Card
              key={notification.id}
              className={!archived ? "border-l-4 border-l-primary bg-secondary/25" : undefined}
            >
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {notificationKindLabels[notification.kind] ?? "Event update"}
                  </Badge>
                  <Badge variant={archived ? "outline" : "default"}>
                    {archived ? "Archived · Read" : "New · Unread"}
                  </Badge>
                </div>
                <CardTitle as="h2">{notification.title}</CardTitle>
                <CardDescription>
                  System notification ·{" "}
                  {new Intl.DateTimeFormat("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    timeZone: "America/New_York",
                  }).format(new Date(notification.created_at))}{" "}
                  ET
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p>{notification.message}</p>
                {Object.keys(notification.changes).length ? (
                  <dl className="flex flex-col gap-3">
                    {Object.entries(notification.changes).map(([field, change]) => (
                      <div key={field} className="min-w-0 text-sm">
                        <dt className="font-semibold">{eventChangeLabels[field] ?? field}</dt>
                        <dd className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
                          Before: {formatEventChange(field, change.before)}
                        </dd>
                        <dd className="mt-1 whitespace-pre-wrap break-words">
                          Now: {formatEventChange(field, change.after)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </CardContent>
              <CardFooter className="flex-wrap gap-2">
                {notification.event_id ? (
                  <Button
                    variant="outline"
                    render={<Link href={`/events/${notification.event_id}`} />}
                  >
                    View event
                  </Button>
                ) : (
                  <span className="text-sm text-muted-foreground">Event removed</span>
                )}
                {!notification.read_at ? (
                  <form action={markNotificationsReadAction.bind(null, notification.id)}>
                    <EventActionSubmit
                      label="Mark as read & archive"
                      pendingLabel="Archiving…"
                      variant="outline"
                    />
                  </form>
                ) : null}
              </CardFooter>
            </Card>
          ))}
        </section>
      ) : (
        <Empty className="min-h-80 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">{archived ? <Archive /> : <Bell />}</EmptyMedia>
            <EmptyTitle>
              {archived ? "No archived notifications" : "You’re all caught up"}
            </EmptyTitle>
            <EmptyDescription>
              {archived
                ? "Notifications will appear here after you mark them as read."
                : "You have no new notifications. Previously read updates are saved in Archive."}
            </EmptyDescription>
          </EmptyHeader>
          <Button
            render={<Link href={archived ? "/notifications" : "/notifications?view=archive"} />}
          >
            {archived ? "View new notifications" : "View archive"}
          </Button>
        </Empty>
      )}
      {page > 1 || hasMore ? (
        <nav aria-label="Notification pages" className="mt-6 flex justify-between gap-3">
          {page > 1 ? (
            <Button
              variant="outline"
              render={<Link href={`/notifications?view=${view}&page=${page - 1}`} />}
            >
              Newer
            </Button>
          ) : (
            <span />
          )}
          {hasMore ? (
            <Button
              variant="outline"
              render={<Link href={`/notifications?view=${view}&page=${page + 1}`} />}
            >
              Older
            </Button>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
