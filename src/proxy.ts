import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { safeInternalPath } from "@/lib/safe-navigation";

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDevelopment = process.env.NODE_ENV === "development";
  const supabaseOrigin = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
    } catch {
      return "";
    }
  })();
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'${isDevelopment ? " 'unsafe-inline'" : ""}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self'${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (url && key) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });
    const { data } = await supabase.auth.getClaims();
    // Preserve emailed event links before the portal layout redirects to sign-in.
    // The data-access layer still enforces membership and event permissions.
    if (!data?.claims && /^\/events(?:\/|$)/.test(request.nextUrl.pathname)) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set(
        "next",
        safeInternalPath(`${request.nextUrl.pathname}${request.nextUrl.search}`, "/events"),
      );
      const loginResponse = NextResponse.redirect(loginUrl);
      response.cookies.getAll().forEach((cookie) => loginResponse.cookies.set(cookie));
      response = loginResponse;
    }
  }

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
