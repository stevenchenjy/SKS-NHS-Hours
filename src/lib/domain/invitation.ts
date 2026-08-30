import { z } from "zod";

import { schoolYearRoleSchema } from "./roles";

export const INVITATION_STATUSES = ["pending", "accepted", "expired", "revoked"] as const;

export const invitationStatusSchema = z.enum(INVITATION_STATUSES);
export type InvitationStatus = z.infer<typeof invitationStatusSchema>;

export const invitationEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email("Enter a valid email address.");

export const invitationFullNameSchema = z
  .string()
  .trim()
  .min(1, "Enter the invited user's full name.")
  .max(200);

export const emailDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
    "Enter a valid email domain without @ or a wildcard.",
  );

export const isoTimestampSchema = z.string().datetime({ offset: true });

export const invitationInputSchema = z
  .object({
    email: invitationEmailSchema,
    fullName: invitationFullNameSchema,
    schoolYearId: z.string().uuid(),
    roles: z.array(schoolYearRoleSchema).length(1, "Choose one initial access level."),
    expiresAt: isoTimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.roles[0] === "teacher_admin" && value.roles.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["roles"],
        message: "Teacher administrator access cannot be combined with a member role.",
      });
    }
  });

export type InvitationInput = z.infer<typeof invitationInputSchema>;

export type AllowedEmailDomainsInput = string | readonly string[];

export interface InvitationPolicy {
  allowedEmailDomains: AllowedEmailDomainsInput;
  now: Date;
  maximumValidityDays?: number;
}

export const allowedEmailDomainsSchema = z
  .preprocess((value) => {
    const raw = typeof value === "string" ? value.split(",") : value;
    if (!Array.isArray(raw)) {
      return raw;
    }

    return raw.map((domain) => (typeof domain === "string" ? domain.trim().toLowerCase() : domain));
  }, z.array(emailDomainSchema).max(50))
  .transform((domains) => [...new Set(domains)]);

export function parseAllowedEmailDomains(input: AllowedEmailDomainsInput): string[] {
  return allowedEmailDomainsSchema.parse(input);
}

export function emailDomain(emailInput: string): string {
  const email = invitationEmailSchema.parse(emailInput);
  return email.slice(email.lastIndexOf("@") + 1);
}

export function isEmailDomainAllowed(
  emailInput: string,
  allowedDomainsInput: AllowedEmailDomainsInput,
): boolean {
  const allowedDomains = parseAllowedEmailDomains(allowedDomainsInput);
  return allowedDomains.length === 0 || allowedDomains.includes(emailDomain(emailInput));
}

export function invitationSchemaForPolicy(policy: InvitationPolicy) {
  const allowedDomains = parseAllowedEmailDomains(policy.allowedEmailDomains);
  const now = z
    .date()
    .refine((date) => !Number.isNaN(date.getTime()), {
      message: "The policy clock must be a valid date.",
    })
    .parse(policy.now);
  const maximumValidityDays = z
    .number()
    .int()
    .positive()
    .max(365)
    .optional()
    .parse(policy.maximumValidityDays);

  return invitationInputSchema.superRefine((invitation, context) => {
    if (allowedDomains.length > 0 && !allowedDomains.includes(emailDomain(invitation.email))) {
      context.addIssue({
        code: "custom",
        path: ["email"],
        message: "The email domain is not permitted for this portal.",
      });
    }

    const expirationTime = Date.parse(invitation.expiresAt);
    if (expirationTime <= now.getTime()) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "An invitation must expire in the future.",
      });
    }

    if (maximumValidityDays !== undefined) {
      const latestExpiration = now.getTime() + maximumValidityDays * 24 * 60 * 60 * 1_000;
      if (expirationTime > latestExpiration) {
        context.addIssue({
          code: "custom",
          path: ["expiresAt"],
          message: `An invitation cannot remain valid for more than ${maximumValidityDays} days.`,
        });
      }
    }
  });
}

export function validateInvitation(input: unknown, policy: InvitationPolicy): InvitationInput {
  return invitationSchemaForPolicy(policy).parse(input);
}

export function deriveInvitationStatus(
  currentStatusInput: InvitationStatus,
  expiresAtInput: string,
  now: Date,
): InvitationStatus {
  const currentStatus = invitationStatusSchema.parse(currentStatusInput);
  const expiresAt = isoTimestampSchema.parse(expiresAtInput);
  const currentTime = z.date().parse(now).getTime();

  if (currentStatus !== "pending") {
    return currentStatus;
  }

  return Date.parse(expiresAt) <= currentTime ? "expired" : "pending";
}
