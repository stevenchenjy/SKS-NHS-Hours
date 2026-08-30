import { z } from "zod";

import { isoTimestampSchema } from "./invitation";

export const AUDIT_ACTION_ENTITY = {
  "invitation.created": "invitation",
  "invitation.sent": "invitation",
  "invitation.resent": "invitation",
  "invitation.revoked": "invitation",
  "invitation.accepted": "invitation",
  "profile.status_changed": "profile",
  "membership.renewed": "school_year_membership",
  "membership.status_changed": "school_year_membership",
  "role.assigned": "school_year_membership",
  "role.removed": "school_year_membership",
  "school_year.created": "school_year",
  "school_year.activated": "school_year",
  "school_year.closed": "school_year",
  "school_year.dates_updated": "school_year",
  "category.created": "service_category",
  "category.updated": "service_category",
  "school_year.target_updated": "school_year",
  "membership.target_updated": "school_year_membership",
  "hour_request.draft_created": "hour_request",
  "hour_request.draft_saved": "hour_request",
  "hour_request.submitted": "hour_request",
  "hour_request.resubmitted": "hour_request",
  "hour_request.withdrawn": "hour_request",
  "hour_request.reassigned": "hour_request",
  "hour_request.approved": "hour_request",
  "hour_request.changes_requested": "hour_request",
  "hour_request.rejected": "hour_request",
  "hour_request.corrected": "hour_request",
  "export.generated": "export",
  "teacher_admin.bootstrapped": "school_year_membership",
} as const;

export const AUDIT_ACTIONS = Object.keys(AUDIT_ACTION_ENTITY) as [
  keyof typeof AUDIT_ACTION_ENTITY,
  ...(keyof typeof AUDIT_ACTION_ENTITY)[],
];

export const AUDIT_ENTITY_TYPES = [
  "invitation",
  "profile",
  "school_year_membership",
  "school_year",
  "service_category",
  "hour_request",
  "export",
] as const;

export const auditActionSchema = z.enum(AUDIT_ACTIONS);
export const auditEntityTypeSchema = z.enum(AUDIT_ENTITY_TYPES);

export type AuditAction = z.infer<typeof auditActionSchema>;
export type AuditEntityType = z.infer<typeof auditEntityTypeSchema>;

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const auditMetadataSchema = z
  .record(z.string().min(1).max(100), jsonValueSchema)
  .superRefine((metadata, context) => {
    if (Object.keys(metadata).length > 50) {
      context.addIssue({
        code: "custom",
        message: "Audit metadata cannot contain more than 50 top-level keys.",
      });
    }

    if (JSON.stringify(metadata).length > 32_768) {
      context.addIssue({
        code: "custom",
        message: "Audit metadata cannot exceed 32 KiB.",
      });
    }
  });

export const auditEventInputSchema = z
  .object({
    actorProfileId: z.string().uuid().nullable(),
    actorMembershipId: z.string().uuid().nullable(),
    action: auditActionSchema,
    entityType: auditEntityTypeSchema,
    entityId: z.string().trim().min(1).max(200),
    schoolYearId: z.string().uuid().nullable().optional(),
    occurredAt: isoTimestampSchema,
    oldValues: auditMetadataSchema.nullable().optional(),
    newValues: auditMetadataSchema.nullable().optional(),
    metadata: auditMetadataSchema.default({}),
  })
  .strict()
  .superRefine((event, context) => {
    const expectedEntityType = AUDIT_ACTION_ENTITY[event.action];
    if (event.entityType !== expectedEntityType) {
      context.addIssue({
        code: "custom",
        path: ["entityType"],
        message: `Action "${event.action}" must target "${expectedEntityType}".`,
      });
    }
  });

export type AuditEventInput = z.infer<typeof auditEventInputSchema>;

export function auditEntityTypeForAction(actionInput: AuditAction): AuditEntityType {
  const action = auditActionSchema.parse(actionInput);
  return AUDIT_ACTION_ENTITY[action];
}

export function parseAuditEvent(input: unknown): AuditEventInput {
  return auditEventInputSchema.parse(input);
}
