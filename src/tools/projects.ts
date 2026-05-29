/**
 * Project tools: list, get, create, update, delete.
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
  workspaceIdField,
} from "../schemas/common.js";
import { ResponseFormat } from "../types.js";

interface Project {
  id: string;
  name: string;
  hourlyRate?: { amount: number; currency: string };
  clientId?: string;
  workspaceId: string;
  billable: boolean;
  memberships?: Array<{ userId: string; membershipStatus: string }>;
  color?: string;
  estimate?: { estimate: string; type: string };
  archived: boolean;
  duration?: string;
  clientName?: string;
  note?: string;
  template?: boolean;
  public: boolean;
}

function summarizeProject(p: Project): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    clientId: p.clientId,
    clientName: p.clientName,
    billable: p.billable,
    archived: p.archived,
    public: p.public,
    color: p.color,
    hourlyRate: p.hourlyRate?.amount,
    currency: p.hourlyRate?.currency,
    memberCount: p.memberships?.length ?? 0,
    estimate: p.estimate?.estimate,
    estimateType: p.estimate?.type,
  };
}

export function registerProjectTools(server: McpServer): void {
  server.registerTool(
    "clockify_list_projects",
    {
      title: "List projects on a workspace",
      description: `List projects in a workspace with optional filters.

Endpoint: GET /v1/workspaces/{workspaceId}/projects
Supports: name, archived, billable, client filter, user filter, page/page-size.`,
      inputSchema: {
        workspaceId: workspaceIdField,
        name: z.string().optional().describe("Name substring filter (case-insensitive)."),
        archived: z.boolean().optional().describe("true=archived only, false=active only, omit=all."),
        billable: z.boolean().optional().describe("Billable filter."),
        clientIds: z
          .array(z.string())
          .optional()
          .describe("Restrict to projects under these client IDs."),
        userIds: z
          .array(z.string())
          .optional()
          .describe("Restrict to projects assigned to these users."),
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
      name,
      archived,
      billable,
      clientIds,
      userIds,
      page,
      page_size,
      response_format,
    }) => {
      try {
        const params: Record<string, unknown> = {
          name,
          archived,
          billable,
          page,
          "page-size": page_size,
        };
        if (clientIds?.length) params.clients = clientIds.join(",");
        if (userIds?.length) params.users = userIds.join(",");

        const { data, lastPage } = await clockifyRequest<Project[]>(
          `/workspaces/${workspaceId}/projects`,
          "GET",
          undefined,
          params,
        );
        const items = data.map(summarizeProject);
        const out = paginated(items, page, page_size, lastPage);
        const structured = { ...out };
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : [
                `# Projects (page ${page})`,
                ``,
                ...items.map(
                  (p) =>
                    `- **${p.name}** \`${p.id}\`${p.archived ? " [ARCHIVED]" : ""}${p.billable ? " 💰" : ""}${p.clientName ? ` — client: ${p.clientName}` : ""}`,
                ),
                ``,
                out.pagination.has_more
                  ? `_More pages — call again with page=${out.pagination.next_page}._`
                  : `_End of results._`,
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
    "clockify_get_project",
    {
      title: "Get project by ID",
      description: `Fetch one project's full details.

Endpoint: GET /v1/workspaces/{workspaceId}/projects/{projectId}`,
      inputSchema: {
        workspaceId: workspaceIdField,
        projectId: projectIdField,
        response_format: responseFormatField,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, projectId, response_format }) => {
      try {
        const { data } = await clockifyRequest<Project>(
          `/workspaces/${workspaceId}/projects/${projectId}`,
        );
        const structured = summarizeProject(data);
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : `# ${data.name}\n\n- **ID**: ${data.id}\n- **Client**: ${data.clientName ?? "—"}\n- **Billable**: ${data.billable}\n- **Archived**: ${data.archived}\n- **Public**: ${data.public}\n- **Rate**: ${data.hourlyRate ? `${data.hourlyRate.currency} ${data.hourlyRate.amount}/h` : "—"}\n- **Members**: ${data.memberships?.length ?? 0}\n- **Note**: ${data.note ?? "—"}`;
        return toolResult(text, structured);
      } catch (error) {
        return errorResult(handleApiError(error));
      }
    },
  );

  server.registerTool(
    "clockify_create_project",
    {
      title: "Create a project",
      description: `Create a project in a workspace.

Endpoint: POST /v1/workspaces/{workspaceId}/projects`,
      inputSchema: {
        workspaceId: workspaceIdField,
        name: z.string().min(1).describe("Project name (required)."),
        clientId: z.string().optional(),
        billable: z.boolean().optional().describe("Default: false."),
        isPublic: z.boolean().optional().describe("Default: true."),
        color: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional()
          .describe("Hex color like '#3B82F6'."),
        note: z.string().optional(),
        hourlyRate: z
          .object({
            amount: z.number().int().min(0).describe("Amount in cents."),
            currency: z.string().length(3).describe("ISO 4217, e.g. 'USD'."),
          })
          .optional(),
        response_format: responseFormatField,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, response_format, ...payload }) => {
      try {
        const { data } = await clockifyRequest<Project>(
          `/workspaces/${workspaceId}/projects`,
          "POST",
          payload,
        );
        const structured = summarizeProject(data);
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : `Created project **${data.name}** \`${data.id}\`.`;
        return toolResult(text, structured);
      } catch (error) {
        return errorResult(handleApiError(error));
      }
    },
  );

  server.registerTool(
    "clockify_update_project",
    {
      title: "Update a project",
      description: `Update project fields. Each optional arg replaces the existing value if provided.

Endpoint: PUT /v1/workspaces/{workspaceId}/projects/{projectId}`,
      inputSchema: {
        workspaceId: workspaceIdField,
        projectId: projectIdField,
        name: z.string().min(1).optional(),
        clientId: z.string().optional(),
        billable: z.boolean().optional(),
        isPublic: z.boolean().optional(),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        note: z.string().optional(),
        archived: z.boolean().optional(),
        response_format: responseFormatField,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, projectId, response_format, ...payload }) => {
      try {
        const { data } = await clockifyRequest<Project>(
          `/workspaces/${workspaceId}/projects/${projectId}`,
          "PUT",
          payload,
        );
        const structured = summarizeProject(data);
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : `Updated project **${data.name}** \`${data.id}\`.`;
        return toolResult(text, structured);
      } catch (error) {
        return errorResult(handleApiError(error));
      }
    },
  );

  server.registerTool(
    "clockify_delete_project",
    {
      title: "Delete a project",
      description: `Permanently delete a project. Project must be archived first.

Endpoint: DELETE /v1/workspaces/{workspaceId}/projects/{projectId}`,
      inputSchema: {
        workspaceId: workspaceIdField,
        projectId: projectIdField,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, projectId }) => {
      try {
        await clockifyRequest(
          `/workspaces/${workspaceId}/projects/${projectId}`,
          "DELETE",
        );
        return toolResult(`Deleted project \`${projectId}\`.`, {
          deleted: projectId,
        });
      } catch (error) {
        return errorResult(handleApiError(error));
      }
    },
  );
}
