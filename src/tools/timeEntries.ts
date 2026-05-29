/**
 * Time entry tools — the core of Clockify.
 *
 * Includes: list, get, list-in-progress, start (create), update, stop running, delete.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { clockifyRequest, handleApiError } from "../services/client.js";
import {
  durationToSeconds,
  enforceCharacterLimit,
  errorResult,
  fmtDate,
  fmtDuration,
  paginated,
  toolResult,
} from "../services/format.js";
import {
  isoDateTimeField,
  pageField,
  pageSizeField,
  projectIdField,
  responseFormatField,
  timeEntryIdField,
  userIdField,
  workspaceIdField,
} from "../schemas/common.js";
import { ResponseFormat } from "../types.js";

interface TimeInterval {
  start: string;
  end: string | null;
  duration: string | null;
}

interface TimeEntry {
  id: string;
  description: string;
  tagIds?: string[];
  userId: string;
  billable: boolean;
  taskId?: string | null;
  projectId?: string | null;
  workspaceId: string;
  timeInterval: TimeInterval;
  customFieldValues?: unknown;
  type?: string;
  kioskId?: string | null;
  isLocked?: boolean;
  hourlyRate?: { amount: number; currency: string };
  costRate?: { amount: number; currency: string };
}

function summarizeEntry(e: TimeEntry): Record<string, unknown> {
  const seconds = durationToSeconds(e.timeInterval.duration);
  return {
    id: e.id,
    description: e.description,
    userId: e.userId,
    projectId: e.projectId,
    taskId: e.taskId,
    tagIds: e.tagIds,
    billable: e.billable,
    start: e.timeInterval.start,
    end: e.timeInterval.end,
    duration_iso: e.timeInterval.duration,
    duration_seconds: seconds,
    duration_human: fmtDuration(seconds),
    is_running: e.timeInterval.end === null,
  };
}

export function registerTimeEntryTools(server: McpServer): void {
  // -------- list (for user) --------
  server.registerTool(
    "clockify_list_time_entries",
    {
      title: "List a user's time entries",
      description: `List time entries for a specific user with rich filters.

This is the primary tool to inspect logged time. To filter to *yourself*, first call clockify_get_current_user.

Endpoint: GET /v1/workspaces/{workspaceId}/user/{userId}/time-entries

Filters:
  - start/end window (ISO-8601 with 'Z' suffix)
  - project, task, tag
  - description substring
  - in-progress only
  - billable / billed / hydrated

Use pagination — there can be thousands of entries.`,
      inputSchema: {
        workspaceId: workspaceIdField,
        userId: userIdField,
        description: z.string().optional().describe("Description substring filter."),
        start: isoDateTimeField
          .optional()
          .describe("Window start (inclusive). e.g. '2024-03-01T00:00:00Z'."),
        end: isoDateTimeField
          .optional()
          .describe("Window end (exclusive). e.g. '2024-04-01T00:00:00Z'."),
        project: z.string().optional().describe("Filter by project ID."),
        task: z.string().optional().describe("Filter by task ID."),
        tags: z
          .array(z.string())
          .optional()
          .describe("Time entries that contain ANY of these tag IDs."),
        in_progress: z
          .boolean()
          .optional()
          .describe("If true, only currently-running entries."),
        billable: z.boolean().optional(),
        hydrated: z
          .boolean()
          .default(false)
          .describe("When true, expand related project/task/tag objects (heavier payload)."),
        page: pageField,
        page_size: pageSizeField,
        response_format: responseFormatField,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      workspaceId,
      userId,
      description,
      start,
      end,
      project,
      task,
      tags,
      in_progress,
      billable,
      hydrated,
      page,
      page_size,
      response_format,
    }) => {
      try {
        const params: Record<string, unknown> = {
          description,
          start,
          end,
          project,
          task,
          "in-progress": in_progress,
          billable,
          hydrated,
          page,
          "page-size": page_size,
        };
        if (tags?.length) params.tags = tags.join(",");

        const { data, lastPage } = await clockifyRequest<TimeEntry[]>(
          `/workspaces/${workspaceId}/user/${userId}/time-entries`,
          "GET",
          undefined,
          params,
        );
        const items = data.map(summarizeEntry);
        const out = paginated(items, page, page_size, lastPage);
        const total_seconds = items.reduce(
          (acc, it) => acc + (it.duration_seconds as number),
          0,
        );
        const structured = {
          ...out,
          total_seconds,
          total_duration: fmtDuration(total_seconds),
        };
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : [
                `# Time entries for user ${userId} (page ${page})`,
                ``,
                `Total in this page: **${fmtDuration(total_seconds)}**`,
                ``,
                ...items.map((e) => {
                  const status = e.is_running ? " ▶ RUNNING" : "";
                  return `- \`${e.id}\` ${fmtDate(e.start as string)} → ${fmtDate((e.end as string) ?? "")} (${e.duration_human})${status} — ${e.description || "_no description_"}${e.projectId ? ` [proj=${e.projectId}]` : ""}`;
                }),
                ``,
                out.pagination.has_more
                  ? `_More — page=${out.pagination.next_page}_`
                  : `_End_`,
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

  // -------- get by id --------
  server.registerTool(
    "clockify_get_time_entry",
    {
      title: "Get a single time entry",
      description: `Fetch one time entry by ID.

Endpoint: GET /v1/workspaces/{workspaceId}/time-entries/{id}`,
      inputSchema: {
        workspaceId: workspaceIdField,
        timeEntryId: timeEntryIdField,
        hydrated: z
          .boolean()
          .default(false)
          .describe("Expand project/task/tag references."),
        response_format: responseFormatField,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, timeEntryId, hydrated, response_format }) => {
      try {
        const { data } = await clockifyRequest<TimeEntry>(
          `/workspaces/${workspaceId}/time-entries/${timeEntryId}`,
          "GET",
          undefined,
          { hydrated },
        );
        const structured = summarizeEntry(data);
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : [
                `# Time Entry \`${data.id}\``,
                ``,
                `- **Description**: ${data.description || "—"}`,
                `- **User**: ${data.userId}`,
                `- **Project**: ${data.projectId ?? "—"}`,
                `- **Task**: ${data.taskId ?? "—"}`,
                `- **Tags**: ${data.tagIds?.join(", ") || "—"}`,
                `- **Billable**: ${data.billable}`,
                `- **Start**: ${fmtDate(data.timeInterval.start)}`,
                `- **End**: ${fmtDate(data.timeInterval.end)}`,
                `- **Duration**: ${fmtDuration(durationToSeconds(data.timeInterval.duration))}`,
                `- **Running**: ${data.timeInterval.end === null}`,
              ].join("\n");
        return toolResult(text, structured);
      } catch (error) {
        return errorResult(handleApiError(error));
      }
    },
  );

  // -------- list in-progress on workspace --------
  server.registerTool(
    "clockify_list_in_progress_entries",
    {
      title: "List all currently-running time entries on a workspace",
      description: `List every entry that is currently running across all workspace members.

Useful for admins to see who's tracking right now.

Endpoint: GET /v1/workspaces/{workspaceId}/time-entries/status/in-progress`,
      inputSchema: {
        workspaceId: workspaceIdField,
        page: pageField,
        page_size: pageSizeField,
        response_format: responseFormatField,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, page, page_size, response_format }) => {
      try {
        const { data, lastPage } = await clockifyRequest<TimeEntry[]>(
          `/workspaces/${workspaceId}/time-entries/status/in-progress`,
          "GET",
          undefined,
          { page, "page-size": page_size },
        );
        const items = data.map(summarizeEntry);
        const out = paginated(items, page, page_size, lastPage);
        const structured = { ...out };
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : [
                `# In-progress time entries (page ${page})`,
                ``,
                ...items.map(
                  (e) =>
                    `- \`${e.id}\` user=${e.userId} since ${fmtDate(e.start as string)} — ${e.description || "_no description_"}`,
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

  // -------- start (create) --------
  server.registerTool(
    "clockify_start_time_entry",
    {
      title: "Start a new time entry (or log past entry)",
      description: `Create a time entry. Omit 'end' to start a live timer; supply both 'start' and 'end' to log a past period.

Only one timer can run at a time per user — starting a new one stops any currently running entry automatically (Clockify behavior).

Endpoint: POST /v1/workspaces/{workspaceId}/time-entries

Dates must be ISO-8601 with 'Z' suffix.`,
      inputSchema: {
        workspaceId: workspaceIdField,
        description: z.string().default("").describe("What was being worked on."),
        start: isoDateTimeField.describe("Entry start (required)."),
        end: isoDateTimeField.optional().describe("Entry end. Omit to start a live timer."),
        projectId: z.string().optional(),
        taskId: z.string().optional(),
        tagIds: z.array(z.string()).optional(),
        billable: z.boolean().optional(),
        response_format: responseFormatField,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      workspaceId,
      description,
      start,
      end,
      projectId,
      taskId,
      tagIds,
      billable,
      response_format,
    }) => {
      try {
        const { data } = await clockifyRequest<TimeEntry>(
          `/workspaces/${workspaceId}/time-entries`,
          "POST",
          {
            description,
            start,
            end,
            projectId,
            taskId,
            tagIds,
            billable,
          },
        );
        const structured = summarizeEntry(data);
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : `Started entry \`${data.id}\` at ${fmtDate(data.timeInterval.start)}.${data.timeInterval.end ? ` Ended ${fmtDate(data.timeInterval.end)}.` : " Timer is running."}`;
        return toolResult(text, structured);
      } catch (error) {
        return errorResult(handleApiError(error));
      }
    },
  );

  // -------- update --------
  server.registerTool(
    "clockify_update_time_entry",
    {
      title: "Update a time entry",
      description: `Replace fields on a time entry. Must supply both start and end (or end=null for a running entry).

Endpoint: PUT /v1/workspaces/{workspaceId}/time-entries/{id}`,
      inputSchema: {
        workspaceId: workspaceIdField,
        timeEntryId: timeEntryIdField,
        description: z.string().optional(),
        start: isoDateTimeField.optional(),
        end: isoDateTimeField.optional(),
        projectId: z.string().optional(),
        taskId: z.string().optional(),
        tagIds: z.array(z.string()).optional(),
        billable: z.boolean().optional(),
        response_format: responseFormatField,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, timeEntryId, response_format, ...payload }) => {
      try {
        const { data } = await clockifyRequest<TimeEntry>(
          `/workspaces/${workspaceId}/time-entries/${timeEntryId}`,
          "PUT",
          payload,
        );
        const structured = summarizeEntry(data);
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : `Updated entry \`${data.id}\`.`;
        return toolResult(text, structured);
      } catch (error) {
        return errorResult(handleApiError(error));
      }
    },
  );

  // -------- stop running --------
  server.registerTool(
    "clockify_stop_running_timer",
    {
      title: "Stop the currently running timer for a user",
      description: `Stop the in-progress time entry for a specific user. The 'end' must be after the entry's start.

Endpoint: PATCH /v1/workspaces/{workspaceId}/user/{userId}/time-entries`,
      inputSchema: {
        workspaceId: workspaceIdField,
        userId: userIdField,
        end: isoDateTimeField.describe("When to stop the timer."),
        response_format: responseFormatField,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, userId, end, response_format }) => {
      try {
        const { data } = await clockifyRequest<TimeEntry>(
          `/workspaces/${workspaceId}/user/${userId}/time-entries`,
          "PATCH",
          { end },
        );
        const structured = summarizeEntry(data);
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : `Stopped timer \`${data.id}\` at ${fmtDate(end)} (duration ${fmtDuration(durationToSeconds(data.timeInterval.duration))}).`;
        return toolResult(text, structured);
      } catch (error) {
        return errorResult(handleApiError(error));
      }
    },
  );

  // -------- delete --------
  server.registerTool(
    "clockify_delete_time_entry",
    {
      title: "Delete a time entry",
      description: `Permanently delete a time entry.

Endpoint: DELETE /v1/workspaces/{workspaceId}/time-entries/{id}`,
      inputSchema: {
        workspaceId: workspaceIdField,
        timeEntryId: timeEntryIdField,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, timeEntryId }) => {
      try {
        await clockifyRequest(
          `/workspaces/${workspaceId}/time-entries/${timeEntryId}`,
          "DELETE",
        );
        return toolResult(`Deleted time entry \`${timeEntryId}\`.`, {
          deleted: timeEntryId,
        });
      } catch (error) {
        return errorResult(handleApiError(error));
      }
    },
  );
}
