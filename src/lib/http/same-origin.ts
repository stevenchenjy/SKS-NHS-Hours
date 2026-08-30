export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) return false;

  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    const protocol =
      request.headers.get("x-forwarded-proto") ?? requestUrl.protocol.replace(/:$/, "");
    return originUrl.host === host && originUrl.protocol === `${protocol}:`;
  } catch {
    return false;
  }
}
