/**
 * Task tools (tasks are sub-units inside a project).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { clockifyRequest, handleApiError } from "../services/client.js";
import {
  enforceCharacterLimit,
  errorResult,
  paginated,
  toolResult,
} from "../services/format.js";
import {
  pageField,
  pageSizeField,
  projectIdField,
  responseFormatField,
  taskIdField,
  workspaceIdField,
} from "../schemas/common.js";
import { ResponseFormat } from "../types.js";

interface Task {
  id: string;
  name: string;
  projectId: string;
  assigneeIds?: string[];
  estimate?: string;
  status: "ACTIVE" | "DONE";
  billable?: boolean;
  duration?: string;
}

function summarizeTask(t: Task): Record<string, unknown> {
  return {
    id: t.id,
    name: t.name,
    projectId: t.projectId,
    status: t.status,
    billable: t.billable,
    estimate: t.estimate,
    assigneeIds: t.assigneeIds,
  };
}

export function registerTaskTools(server: McpServer): void {
  server.registerTool(
    "clockify_list_tasks",
    {
      title: "List tasks on a project",
      description: `List tasks belonging to a project.

Endpoint: GET /v1/workspaces/{workspaceId}/projects/{projectId}/tasks
Supports: name filter, active/done status filter, page/page-size.`,
      inputSchema: {
        workspaceId: workspaceIdField,
        projectId: projectIdField,
        name: z.string().optional().describe("Name substring filter."),
        is_active: z
          .boolean()
          .optional()
          .describe("true = only ACTIVE tasks, false = only DONE."),
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
      projectId,
      name,
      is_active,
      page,
      page_size,
      response_format,
    }) => {
      try {
        const { data, lastPage } = await clockifyRequest<Task[]>(
          `/workspaces/${workspaceId}/projects/${projectId}/tasks`,
          "GET",
          undefined,
          {
            name,
            "is-active": is_active,
            page,
            "page-size": page_size,
          },
        );
        const items = data.map(summarizeTask);
        const out = paginated(items, page, page_size, lastPage);
        const structured = { ...out };
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : [
                `# Tasks (page ${page})`,
                ``,
                ...items.map(
                  (t) =>
                    `- **${t.name}** \`${t.id}\` — ${t.status}${t.billable ? " 💰" : ""}`,
                ),
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

  server.registerTool(
    "clockify_get_task",
    {
      title: "Get a task by ID",
      description: `Fetch a task's details.

Endpoint: GET /v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}`,
      inputSchema: {
        workspaceId: workspaceIdField,
        projectId: projectIdField,
        taskId: taskIdField,
        response_format: responseFormatField,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, projectId, taskId, response_format }) => {
      try {
        const { data } = await clockifyRequest<Task>(
          `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}`,
        );
        const structured = summarizeTask(data);
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : `# ${data.name}\n\n- **ID**: ${data.id}\n- **Status**: ${data.status}\n- **Billable**: ${data.billable ?? "—"}\n- **Estimate**: ${data.estimate ?? "—"}\n- **Assignees**: ${data.assigneeIds?.join(", ") || "—"}`;
        return toolResult(text, structured);
      } catch (error) {
        return errorResult(handleApiError(error));
      }
    },
  );

  server.registerTool(
    "clockify_create_task",
    {
      title: "Create a task on a project",
      description: `Create a new task on a project.

Endpoint: POST /v1/workspaces/{workspaceId}/projects/{projectId}/tasks`,
      inputSchema: {
        workspaceId: workspaceIdField,
        projectId: projectIdField,
        name: z.string().min(1).describe("Task name (required)."),
        assigneeIds: z.array(z.string()).optional(),
        estimate: z
          .string()
          .regex(/^PT(?:\d+H)?(?:\d+M)?$/)
          .optional()
          .describe("ISO-8601 duration, e.g. 'PT8H' for 8 hours."),
        billable: z.boolean().optional(),
        status: z.enum(["ACTIVE", "DONE"]).optional().describe("Default ACTIVE."),
        response_format: responseFormatField,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, projectId, response_format, ...payload }) => {
      try {
        const { data } = await clockifyRequest<Task>(
          `/workspaces/${workspaceId}/projects/${projectId}/tasks`,
          "POST",
          payload,
        );
        const structured = summarizeTask(data);
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : `Created task **${data.name}** \`${data.id}\`.`;
        return toolResult(text, structured);
      } catch (error) {
        return errorResult(handleApiError(error));
      }
    },
  );

  server.registerTool(
    "clockify_update_task",
    {
      title: "Update a task",
      description: `Update task fields.

Endpoint: PUT /v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}`,
      inputSchema: {
        workspaceId: workspaceIdField,
        projectId: projectIdField,
        taskId: taskIdField,
        name: z.string().min(1).optional(),
        assigneeIds: z.array(z.string()).optional(),
        estimate: z.string().regex(/^PT(?:\d+H)?(?:\d+M)?$/).optional(),
        billable: z.boolean().optional(),
        status: z.enum(["ACTIVE", "DONE"]).optional(),
        response_format: responseFormatField,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, projectId, taskId, response_format, ...payload }) => {
      try {
        const { data } = await clockifyRequest<Task>(
          `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}`,
          "PUT",
          payload,
        );
        const structured = summarizeTask(data);
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : `Updated task **${data.name}** \`${data.id}\`.`;
        return toolResult(text, structured);
      } catch (error) {
        return errorResult(handleApiError(error));
      }
    },
  );

  server.registerTool(
    "clockify_delete_task",
    {
      title: "Delete a task",
      description: `Delete a task from a project.

Endpoint: DELETE /v1/workspaces/{workspaceId}/projects/{projectId}/tasks/{taskId}`,
      inputSchema: {
        workspaceId: workspaceIdField,
        projectId: projectIdField,
        taskId: taskIdField,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, projectId, taskId }) => {
      try {
        await clockifyRequest(
          `/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}`,
          "DELETE",
        );
        return toolResult(`Deleted task \`${taskId}\`.`, { deleted: taskId });
      } catch (error) {
        return errorResult(handleApiError(error));
      }
    },
  );
}
