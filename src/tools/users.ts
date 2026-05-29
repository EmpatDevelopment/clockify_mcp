/**
 * User-related tools: get current user, list users on workspace.
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
  responseFormatField,
  workspaceIdField,
} from "../schemas/common.js";
import { ResponseFormat } from "../types.js";

interface ClockifyUser {
  id: string;
  email: string;
  name: string;
  status?: string;
  activeWorkspace?: string;
  defaultWorkspace?: string;
  memberships?: Array<{
    targetId: string;
    membershipType: string;
    membershipStatus: string;
    hourlyRate?: { amount: number; currency: string };
  }>;
  settings?: Record<string, unknown>;
  profilePicture?: string;
  timeZone?: string;
}

function summarizeUser(u: ClockifyUser): Record<string, unknown> {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    status: u.status,
    timeZone: u.timeZone,
    activeWorkspace: u.activeWorkspace,
    defaultWorkspace: u.defaultWorkspace,
  };
}

export function registerUserTools(server: McpServer): void {
  // -------- current user --------
  server.registerTool(
    "clockify_get_current_user",
    {
      title: "Get current Clockify user",
      description: `Get the profile of the user whose API key is configured.

Useful for finding your own userId and active workspaceId before calling other tools.

Returns: { id, name, email, status, timeZone, activeWorkspace, defaultWorkspace, memberships }
Endpoint: GET /v1/user`,
      inputSchema: {
        response_format: responseFormatField,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ response_format }) => {
      try {
        const { data } = await clockifyRequest<ClockifyUser>("/user");
        const structured = {
          ...summarizeUser(data),
          memberships: data.memberships?.map((m) => ({
            workspaceId: m.targetId,
            type: m.membershipType,
            status: m.membershipStatus,
          })),
        };
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : [
                `# Current User`,
                ``,
                `- **Name**: ${data.name} (${data.id})`,
                `- **Email**: ${data.email}`,
                `- **Status**: ${data.status ?? "—"}`,
                `- **Time zone**: ${data.timeZone ?? "—"}`,
                `- **Active workspace**: ${data.activeWorkspace ?? "—"}`,
                `- **Default workspace**: ${data.defaultWorkspace ?? "—"}`,
                ``,
                `## Memberships`,
                ...(data.memberships ?? []).map(
                  (m) =>
                    `- workspace ${m.targetId} — ${m.membershipType} (${m.membershipStatus})`,
                ),
              ].join("\n");
        return toolResult(text, structured);
      } catch (error) {
        return errorResult(handleApiError(error));
      }
    },
  );

  // -------- list workspace users --------
  server.registerTool(
    "clockify_list_workspace_users",
    {
      title: "List users in a workspace",
      description: `List all users (members) in a workspace, with optional filters.

Useful for: finding userIds to use with clockify_list_time_entries; auditing workspace membership.

Endpoint: GET /v1/workspaces/{workspaceId}/users
Supports pagination (page, page-size).`,
      inputSchema: {
        workspaceId: workspaceIdField,
        email: z
          .string()
          .optional()
          .describe("Filter by email substring."),
        status: z
          .enum(["ACTIVE", "PENDING_EMAIL_VERIFICATION", "DELETED", "INACTIVE", "NOT_REGISTERED", "DECLINED"])
          .optional()
          .describe("Filter by membership status."),
        name: z
          .string()
          .optional()
          .describe("Filter by name substring (case-insensitive)."),
        projectId: z
          .string()
          .optional()
          .describe("Only users assigned to this project."),
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
      email,
      status,
      name,
      projectId,
      page,
      page_size,
      response_format,
    }) => {
      try {
        const { data, lastPage } = await clockifyRequest<ClockifyUser[]>(
          `/workspaces/${workspaceId}/users`,
          "GET",
          undefined,
          {
            email,
            status,
            name,
            "project-id": projectId,
            page,
            "page-size": page_size,
          },
        );
        const items = data.map(summarizeUser);
        const out = paginated(items, page, page_size, lastPage);
        const structured = { ...out };
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : [
                `# Workspace Users (page ${page})`,
                ``,
                ...items.map(
                  (u) =>
                    `- **${u.name}** \`${u.id}\` — ${u.email} (${u.status ?? "—"})`,
                ),
                ``,
                out.pagination.has_more
                  ? `_More pages available — call again with page=${out.pagination.next_page}._`
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
}
