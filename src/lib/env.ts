import "server-only";

import { z } from "zod";

const serverEnvironmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  NEXT_PUBLIC_APP_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(20).optional(),
  PASSWORD_UPDATE_CONTEXT_SECRET: z.string().min(32).optional(),
  ALLOWED_EMAIL_DOMAINS: z.string().default(""),
  NEXT_PUBLIC_GOOGLE_AUTH_ENABLED: z.enum(["true", "false"]).default("false"),
  NHS_DESIGN_PREVIEW: z.enum(["true", "false"]).default("false"),
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema> & {
  allowedEmailDomains: string[];
  googleAuthEnabled: boolean;
  designPreviewEnabled: boolean;
};

let cachedEnvironment: ServerEnvironment | undefined;

export function getServerEnvironment(): ServerEnvironment {
  if (cachedEnvironment) return cachedEnvironment;

  const parsed = serverEnvironmentSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((issue) => issue.path.join("."))
      .filter(Boolean)
      .join(", ");
    throw new Error(`Server configuration is incomplete: ${missing}`);
  }

  cachedEnvironment = {
    ...parsed.data,
    allowedEmailDomains: parsed.data.ALLOWED_EMAIL_DOMAINS.split(",")
      .map((domain) => domain.trim().toLowerCase())
      .filter(Boolean),
    googleAuthEnabled: parsed.data.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === "true",
    designPreviewEnabled: parsed.data.NHS_DESIGN_PREVIEW === "true",
  };

  return cachedEnvironment;
}

export function hasSupabaseEnvironment(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function assertAllowedEmail(email: string, domains: string[]): void {
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain || (domains.length > 0 && !domains.includes(domain))) {
    throw new Error("This email address is not in an allowed school domain.");
  }
}

export function getPasswordUpdateContextSecret(): string {
  const environment = getServerEnvironment();
  const secret = environment.PASSWORD_UPDATE_CONTEXT_SECRET ?? environment.SUPABASE_SECRET_KEY;
  if (!secret || secret.length < 32) {
    throw new Error(
      "PASSWORD_UPDATE_CONTEXT_SECRET or a sufficiently long SUPABASE_SECRET_KEY is required.",
    );
  }
  return secret;
}
