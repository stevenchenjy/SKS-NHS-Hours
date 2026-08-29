const TOKEN_VERSION = 1;
export const PASSWORD_UPDATE_CONTEXT_COOKIE = "nhs-password-update-context";
export const PASSWORD_UPDATE_CONTEXT_MAX_AGE_SECONDS = 30 * 60;

export type PasswordUpdatePurpose = "invite" | "recovery";

interface PasswordUpdateContextPayload {
  version: typeof TOKEN_VERSION;
  subject: string;
  purpose: PasswordUpdatePurpose;
  expiresAt: number;
  nonce: string;
}

function encodeBase64Url(value: string | Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

async function importSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function isPayload(value: unknown): value is PasswordUpdateContextPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<PasswordUpdateContextPayload>;
  return (
    payload.version === TOKEN_VERSION &&
    typeof payload.subject === "string" &&
    payload.subject.length > 0 &&
    (payload.purpose === "invite" || payload.purpose === "recovery") &&
    typeof payload.expiresAt === "number" &&
    Number.isSafeInteger(payload.expiresAt) &&
    typeof payload.nonce === "string" &&
    payload.nonce.length >= 16
  );
}

export async function createPasswordUpdateContext(
  input: {
    subject: string;
    purpose: PasswordUpdatePurpose;
    expiresAt?: number;
  },
  secret: string,
): Promise<string> {
  if (secret.length < 32) throw new Error("Password-update signing secret is too short.");
  const payload: PasswordUpdateContextPayload = {
    version: TOKEN_VERSION,
    subject: input.subject,
    purpose: input.purpose,
    expiresAt:
      input.expiresAt ?? Math.floor(Date.now() / 1_000) + PASSWORD_UPDATE_CONTEXT_MAX_AGE_SECONDS,
    nonce: crypto.randomUUID(),
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await importSigningKey(secret),
    new TextEncoder().encode(encodedPayload),
  );
  return `${encodedPayload}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifyPasswordUpdateContext(
  token: string | undefined,
  input: { subject: string; now?: number },
  secret: string,
): Promise<PasswordUpdateContextPayload | null> {
  if (!token || secret.length < 32) return null;
  const segments = token.split(".");
  if (segments.length !== 2) return null;
  const [encodedPayload, encodedSignature] = segments;
  if (!encodedPayload || !encodedSignature) return null;

  try {
    const verified = await crypto.subtle.verify(
      "HMAC",
      await importSigningKey(secret),
      Buffer.from(encodedSignature, "base64url"),
      new TextEncoder().encode(encodedPayload),
    );
    if (!verified) return null;
    const payload: unknown = JSON.parse(decodeBase64Url(encodedPayload));
    if (!isPayload(payload)) return null;
    const now = input.now ?? Math.floor(Date.now() / 1_000);
    if (payload.subject !== input.subject || payload.expiresAt <= now) return null;
    return payload;
  } catch {
    return null;
  }
}
