/**
 * Reports tools — hit the Reports API (different base URL).
 *
 * Wraps detailed, summary, and weekly reports. Reports are POST endpoints
 * with rich filter payloads; this tool exposes the most common knobs.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { handleApiError, reportsRequest } from "../services/client.js";
import {
  enforceCharacterLimit,
  errorResult,
  fmtDate,
  fmtDuration,
  toolResult,
} from "../services/format.js";
import {
  isoDateTimeField,
  responseFormatField,
  workspaceIdField,
} from "../schemas/common.js";
import { ResponseFormat } from "../types.js";

const exportTypeField = z
  .enum(["JSON", "CSV", "XLSX", "PDF"])
  .default("JSON")
  .describe("Response format Clockify should produce. JSON is the easiest to read.");

const baseFilter = {
  workspaceId: workspaceIdField,
  dateRangeStart: isoDateTimeField.describe("Range start (ISO-8601 UTC 'Z')."),
  dateRangeEnd: isoDateTimeField.describe("Range end (exclusive)."),
  userIds: z
    .array(z.string())
    .optional()
    .describe("Restrict to these user IDs. Omit for all."),
  projectIds: z.array(z.string()).optional(),
  clientIds: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  taskIds: z.array(z.string()).optional(),
  billable: z.boolean().optional(),
  description: z.string().optional().describe("Description substring filter."),
};

function buildBasePayload(args: {
  dateRangeStart: string;
  dateRangeEnd: string;
  userIds?: string[];
  projectIds?: string[];
  clientIds?: string[];
  tagIds?: string[];
  taskIds?: string[];
  billable?: boolean;
  description?: string;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    dateRangeStart: args.dateRangeStart,
    dateRangeEnd: args.dateRangeEnd,
  };
  if (args.userIds?.length) payload.users = { ids: args.userIds, contains: "CONTAINS", status: "ALL" };
  if (args.projectIds?.length) payload.projects = { ids: args.projectIds, contains: "CONTAINS", status: "ALL" };
  if (args.clientIds?.length) payload.clients = { ids: args.clientIds, contains: "CONTAINS", status: "ALL" };
  if (args.tagIds?.length) payload.tags = { ids: args.tagIds, contains: "CONTAINS", status: "ALL" };
  if (args.taskIds?.length) payload.tasks = { ids: args.taskIds, contains: "CONTAINS", status: "ALL" };
  if (args.billable !== undefined) payload.billable = args.billable;
  if (args.description) payload.description = args.description;
  return payload;
}

interface DetailedReportEntry {
  _id: string;
  description: string;
  userId: string;
  userName: string;
  userEmail: string;
  projectId?: string;
  projectName?: string;
  clientId?: string;
  clientName?: string;
  taskId?: string;
  taskName?: string;
  tagIds?: string[];
  tags?: Array<{ _id: string; name: string }>;
  billable: boolean;
  timeInterval: { start: string; end: string; duration: number };
}

interface DetailedReportResponse {
  totals?: Array<{ totalTime?: number; entriesCount?: number; totalAmount?: number; totalBillableTime?: number }>;
  timeentries?: DetailedReportEntry[];
}

interface SummaryGroup {
  name?: string;
  _id?: string;
  duration?: number;
  amount?: number;
  children?: SummaryGroup[];
}

interface SummaryReportResponse {
  totals?: Array<{ totalTime?: number; totalAmount?: number; entriesCount?: number }>;
  groupOne?: SummaryGroup[];
}

interface WeeklyTotal {
  date: string;
  duration?: number;
  amount?: number;
}

interface WeeklyReportEntry {
  totals: WeeklyTotal[];
  user?: { _id: string; name: string; email: string };
  project?: { _id: string; name: string; clientName?: string };
  duration?: number;
}

interface WeeklyReportResponse {
  totals?: Array<{ totalTime?: number }>;
  timeentries?: WeeklyReportEntry[];
}

export function registerReportTools(server: McpServer): void {
  // -------- detailed --------
  server.registerTool(
    "clockify_detailed_report",
    {
      title: "Generate a Detailed time report",
      description: `Generate a Detailed report — one row per time entry within the date range, filtered by users/projects/clients/tags/tasks.

This is the workhorse for "show me all time logged matching X" questions.

Endpoint: POST /v1/workspaces/{workspaceId}/reports/detailed
Date format: ISO-8601 with 'Z' suffix.

Returns: totals (totalTime in seconds, entriesCount) + the entries themselves with userName, projectName, clientName, duration, billable etc.

Pagination is page-based (default page=1, page-size=50; max 200).`,
      inputSchema: {
        ...baseFilter,
        page: z.number().int().min(1).default(1).describe("1-indexed page."),
        page_size: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .default(50)
          .describe("Detailed entries per page."),
        exportType: exportTypeField,
        response_format: responseFormatField,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, page, page_size, exportType, response_format, ...filters }) => {
      try {
        const payload = buildBasePayload(filters);
        payload.detailedFilter = {
          page,
          pageSize: page_size,
          sortColumn: "DATE",
        };
        payload.exportType = exportType;
        const { data } = await reportsRequest<DetailedReportResponse>(
          `/workspaces/${workspaceId}/reports/detailed`,
          "POST",
          payload,
        );

        const totalSec = data.totals?.[0]?.totalTime ?? 0;
        const entriesCount = data.totals?.[0]?.entriesCount ?? data.timeentries?.length ?? 0;
        const entries = (data.timeentries ?? []).map((e) => ({
          id: e._id,
          description: e.description,
          userId: e.userId,
          userName: e.userName,
          projectId: e.projectId,
          projectName: e.projectName,
          clientName: e.clientName,
          taskName: e.taskName,
          billable: e.billable,
          start: e.timeInterval.start,
          end: e.timeInterval.end,
          duration_seconds: e.timeInterval.duration,
          duration_human: fmtDuration(e.timeInterval.duration),
        }));
        const structured = {
          page,
          page_size,
          entriesCount,
          totalSeconds: totalSec,
          totalDuration: fmtDuration(totalSec),
          entries,
        };
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : [
                `# Detailed Report`,
                ``,
                `Range: ${filters.dateRangeStart} → ${filters.dateRangeEnd}`,
                `Entries returned: ${entries.length} (total in filter: ${entriesCount})`,
                `Total time: **${fmtDuration(totalSec)}**`,
                ``,
                ...entries.map(
                  (e) =>
                    `- ${fmtDate(e.start)} — ${fmtDuration(e.duration_seconds)} — ${e.userName} on ${e.projectName ?? "—"}${e.taskName ? `/${e.taskName}` : ""} — ${e.description || "_no description_"}`,
                ),
              ].join("\n");
        return {
          content: [{ type: "text", text: enforceCharacterLimit(text) }],
          structuredContent: structured,
        };
      } catch (error) {
        return errorResult(handleApiError(error));
      }
    },
  );

  // -------- summary --------
  server.registerTool(
    "clockify_summary_report",
    {
      title: "Generate a Summary time report",
      description: `Generate a Summary report — totals grouped by one or two dimensions (project, user, client, tag, task, date).

Use this for "how many hours did each user log on each project" style questions.

Endpoint: POST /v1/workspaces/{workspaceId}/reports/summary`,
      inputSchema: {
        ...baseFilter,
        groupBy: z
          .array(z.enum(["PROJECT", "USER", "CLIENT", "TAG", "TASK", "DATE"]))
          .min(1)
          .max(2)
          .default(["PROJECT"])
          .describe("1 or 2 grouping dimensions. First entry is the outer group."),
        exportType: exportTypeField,
        response_format: responseFormatField,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, groupBy, exportType, response_format, ...filters }) => {
      try {
        const payload = buildBasePayload(filters);
        payload.summaryFilter = {
          groups: groupBy,
          sortColumn: "GROUP",
        };
        payload.exportType = exportType;
        const { data } = await reportsRequest<SummaryReportResponse>(
          `/workspaces/${workspaceId}/reports/summary`,
          "POST",
          payload,
        );
        const totalSec = data.totals?.[0]?.totalTime ?? 0;
        const entriesCount = data.totals?.[0]?.entriesCount ?? 0;
        const groups = (data.groupOne ?? []).map((g) => ({
          id: g._id,
          name: g.name,
          duration_seconds: g.duration ?? 0,
          duration_human: fmtDuration(g.duration ?? 0),
          amount: g.amount,
          children: (g.children ?? []).map((c) => ({
            id: c._id,
            name: c.name,
            duration_seconds: c.duration ?? 0,
            duration_human: fmtDuration(c.duration ?? 0),
            amount: c.amount,
          })),
        }));
        const structured = {
          groupBy,
          totalSeconds: totalSec,
          totalDuration: fmtDuration(totalSec),
          entriesCount,
          groups,
        };
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : [
                `# Summary Report (${groupBy.join(" → ")})`,
                ``,
                `Range: ${filters.dateRangeStart} → ${filters.dateRangeEnd}`,
                `Total: **${fmtDuration(totalSec)}** across ${entriesCount} entries`,
                ``,
                ...groups.flatMap((g) => [
                  `- **${g.name ?? g.id}**: ${g.duration_human}`,
                  ...g.children.map(
                    (c) => `   - ${c.name ?? c.id}: ${c.duration_human}`,
                  ),
                ]),
              ].join("\n");
        return {
          content: [{ type: "text", text: enforceCharacterLimit(text) }],
          structuredContent: structured,
        };
      } catch (error) {
        return errorResult(handleApiError(error));
      }
    },
  );

  // -------- weekly --------
  server.registerTool(
    "clockify_weekly_report",
    {
      title: "Generate a Weekly time report",
      description: `Generate a Weekly report — totals per day for a 7-day window.

Use for "weekly timesheet" style answers.

Endpoint: POST /v1/workspaces/{workspaceId}/reports/weekly`,
      inputSchema: {
        ...baseFilter,
        groupBy: z
          .enum(["PROJECT", "USER"])
          .default("PROJECT")
          .describe("Whether rows are projects or users."),
        exportType: exportTypeField,
        response_format: responseFormatField,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, groupBy, exportType, response_format, ...filters }) => {
      try {
        const payload = buildBasePayload(filters);
        payload.weeklyFilter = {
          group: groupBy,
          subgroup: "TIME",
        };
        payload.exportType = exportType;
        const { data } = await reportsRequest<WeeklyReportResponse>(
          `/workspaces/${workspaceId}/reports/weekly`,
          "POST",
          payload,
        );
        const totalSec = data.totals?.[0]?.totalTime ?? 0;
        const rows = (data.timeentries ?? []).map((r) => ({
          group: groupBy === "USER" ? r.user?.name : r.project?.name,
          groupId: groupBy === "USER" ? r.user?._id : r.project?._id,
          clientName: r.project?.clientName,
          total_seconds: r.duration ?? 0,
          total_human: fmtDuration(r.duration ?? 0),
          daily: r.totals.map((t) => ({
            date: t.date,
            duration_seconds: t.duration ?? 0,
            duration_human: fmtDuration(t.duration ?? 0),
          })),
        }));
        const structured = {
          groupBy,
          totalSeconds: totalSec,
          totalDuration: fmtDuration(totalSec),
          rows,
        };
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : [
                `# Weekly Report (by ${groupBy})`,
                ``,
                `Range: ${filters.dateRangeStart} → ${filters.dateRangeEnd}`,
                `Total: **${fmtDuration(totalSec)}**`,
                ``,
                ...rows.map(
                  (r) =>
                    `- **${r.group ?? r.groupId}** — ${r.total_human}\n   ${r.daily.map((d) => `${d.date.slice(0, 10)}=${d.duration_human}`).join("  ")}`,
                ),
              ].join("\n");
        return {
          content: [{ type: "text", text: enforceCharacterLimit(text) }],
          structuredContent: structured,
        };
      } catch (error) {
        return errorResult(handleApiError(error));
      }
    },
  );
}
