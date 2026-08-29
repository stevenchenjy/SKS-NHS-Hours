const SAFE_NAVIGATION_ORIGIN = "https://nhs-portal.invalid";

/**
 * Returns a same-origin application path, never an absolute or scheme-relative URL.
 * Backslashes are rejected because URL parsers normalize them as path separators.
 */
export function safeInternalPath(value: unknown, fallback = "/dashboard"): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /%5c/i.test(value) ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return fallback;
  }

  try {
    const resolved = new URL(value, SAFE_NAVIGATION_ORIGIN);
    if (resolved.origin !== SAFE_NAVIGATION_ORIGIN) return fallback;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}
