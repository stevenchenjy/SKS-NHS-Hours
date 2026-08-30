import { serializeCsv, type CsvCell } from "@/lib/domain";
import { getViewer } from "@/lib/dal/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "zod";

const exportTypes = [
  "progress",
  "hours",
  "pending",
  "approved",
  "categories",
  "directory",
  "archive",
] as const;
type ExportType = (typeof exportTypes)[number];

function isExportType(value: string): value is ExportType {
  return exportTypes.includes(value as ExportType);
}

function cells(row: Record<string, unknown>, columns: readonly string[]): CsvCell[] {
  return columns.map((column) => {
    const value = row[column];
    if (value === null || value === undefined) return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
      return value;
    return JSON.stringify(value);
  });
}

const configurations: Record<
  ExportType,
  { source: string; columns: readonly string[]; status?: string; sortColumns: readonly string[] }
> = {
  progress: {
    source: "member_progress",
    sortColumns: ["membership_id"],
    columns: [
      "membership_id",
      "profile_id",
      "school_year_label",
      "full_name",
      "email",
      "membership_status",
      "expiration_date",
      "role_keys",
      "target_hours",
      "approved_hours",
      "pending_hours",
      "changes_requested_hours",
      "rejected_hours",
      "remaining_hours",
      "over_goal_hours",
      "actual_percentage",
    ],
  },
  directory: {
    source: "member_progress",
    sortColumns: ["membership_id"],
    columns: [
      "membership_id",
      "profile_id",
      "school_year_label",
      "full_name",
      "email",
      "membership_status",
      "expiration_date",
      "role_keys",
      "target_hours",
    ],
  },
  hours: {
    source: "export_service_records",
    sortColumns: ["request_id"],
    columns: [
      "request_id",
      "school_year_id",
      "school_year_label",
      "member_membership_id",
      "member_profile_id",
      "member_name",
      "member_email",
      "category_id",
      "category_name",
      "title",
      "description",
      "service_date",
      "hours",
      "status",
      "revision",
      "requested_approver_membership_id",
      "requested_approver_name",
      "actual_reviewer_membership_id",
      "actual_reviewer_name",
      "latest_review_comment",
      "created_at",
      "submitted_at",
      "decided_at",
      "withdrawn_at",
    ],
  },
  pending: {
    source: "export_service_records",
    status: "pending",
    sortColumns: ["request_id"],
    columns: [
      "request_id",
      "member_profile_id",
      "member_name",
      "member_email",
      "title",
      "category_name",
      "service_date",
      "hours",
      "status",
      "requested_approver_name",
      "latest_review_comment",
      "submitted_at",
    ],
  },
  approved: {
    source: "export_service_records",
    status: "approved",
    sortColumns: ["request_id"],
    columns: [
      "request_id",
      "member_profile_id",
      "member_name",
      "member_email",
      "title",
      "category_name",
      "service_date",
      "hours",
      "status",
      "requested_approver_name",
      "actual_reviewer_name",
      "latest_review_comment",
      "submitted_at",
      "decided_at",
    ],
  },
  categories: {
    source: "category_totals",
    sortColumns: ["member_membership_id", "category_id"],
    columns: [
      "member_membership_id",
      "profile_id",
      "school_year_id",
      "category_id",
      "category_name",
      "approved_hours",
      "pending_hours",
    ],
  },
  archive: {
    source: "export_service_records",
    sortColumns: ["request_id"],
    columns: [
      "request_id",
      "school_year_id",
      "school_year_label",
      "member_membership_id",
      "member_profile_id",
      "member_name",
      "member_email",
      "category_id",
      "category_name",
      "title",
      "description",
      "service_date",
      "hours",
      "status",
      "revision",
      "requested_approver_membership_id",
      "requested_approver_name",
      "actual_reviewer_membership_id",
      "actual_reviewer_name",
      "latest_review_comment",
      "created_at",
      "submitted_at",
      "decided_at",
      "withdrawn_at",
    ],
  },
};

export async function GET(request: Request, context: { params: Promise<{ type: string }> }) {
  const viewer = await getViewer();
  if (!viewer?.activeMembership || !viewer.isTeacherAdmin) {
    return Response.json({ error: "Teacher administrator access required." }, { status: 403 });
  }
  const { type } = await context.params;
  if (!isExportType(type)) return Response.json({ error: "Unknown export type." }, { status: 404 });
  const yearId = z.uuid().safeParse(new URL(request.url).searchParams.get("year"));
  if (!yearId.success) {
    return Response.json({ error: "A valid school year is required." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const configuration = configurations[type];
  const { data: schoolYear, error: yearError } = await supabase
    .from("school_years")
    .select("label")
    .eq("id", yearId.data)
    .single();
  if (yearError || !schoolYear) {
    return Response.json(
      { error: "The authorized export could not be generated." },
      { status: 500 },
    );
  }

  const rows: Record<string, unknown>[] = [];
  const pageSize = 1_000;
  for (let offset = 0; ;) {
    let pageQuery = supabase
      .from(configuration.source)
      .select("*")
      .eq("school_year_id", yearId.data);
    if (configuration.status) pageQuery = pageQuery.eq("status", configuration.status);
    for (const column of configuration.sortColumns) {
      pageQuery = pageQuery.order(column, { ascending: true });
    }
    const { data, error } = await pageQuery.range(offset, offset + pageSize - 1);
    if (error || !data) {
      return Response.json(
        { error: "The authorized export could not be generated." },
        { status: 500 },
      );
    }
    if (data.length === 0) break;
    rows.push(...(data as unknown as Record<string, unknown>[]));
    // Hosted PostgREST may cap responses below the requested range. Advancing by the
    // rows actually returned avoids silently treating a capped page as end-of-data.
    offset += data.length;
  }

  const { error: auditError } = await supabase.rpc("record_export", {
    p_school_year_id: yearId.data,
    p_format: "csv",
    p_row_count: rows.length,
  });
  if (auditError) {
    return Response.json(
      { error: "The export was not served because its audit event failed." },
      { status: 500 },
    );
  }

  const csv = serializeCsv([
    [...configuration.columns],
    ...rows.map((row) => cells(row, configuration.columns)),
  ]);
  const safeYear = String(schoolYear.label).replace(/[^0-9A-Za-z-]/g, "-");
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="nhs-${safeYear}-${type}.csv"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
