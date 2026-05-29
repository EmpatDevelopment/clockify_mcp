/**
 * Client tools: list, get, create, update, archive, delete clients.
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
  clientIdField,
  pageField,
  pageSizeField,
  responseFormatField,
  workspaceIdField,
} from "../schemas/common.js";
import { ResponseFormat } from "../types.js";

interface Client {
  id: string;
  name: string;
  address?: string;
  note?: string;
  email?: string;
  archived: boolean;
  workspaceId: string;
}

function summarizeClient(c: Client): Record<string, unknown> {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    archived: c.archived,
    address: c.address,
    note: c.note,
  };
}

export function registerClientTools(server: McpServer): void {
  // list
  server.registerTool(
    "clockify_list_clients",
    {
      title: "List clients on a workspace",
      description: `List clients in a workspace.

Endpoint: GET /v1/workspaces/{workspaceId}/clients
Supports name filter and archived filter.`,
      inputSchema: {
        workspaceId: workspaceIdField,
        name: z.string().optional().describe("Filter by name substring (case-insensitive)."),
        archived: z.boolean().optional().describe("If true, only archived clients; if false, only active. Omit for all."),
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
    async ({ workspaceId, name, archived, page, page_size, response_format }) => {
      try {
        const { data, lastPage } = await clockifyRequest<Client[]>(
          `/workspaces/${workspaceId}/clients`,
          "GET",
          undefined,
          { name, archived, page, "page-size": page_size },
        );
        const items = data.map(summarizeClient);
        const out = paginated(items, page, page_size, lastPage);
        const structured = { ...out };
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : [
                `# Clients (page ${page})`,
                ``,
                ...items.map(
                  (c) =>
                    `- **${c.name}** \`${c.id}\`${c.archived ? " [ARCHIVED]" : ""}${c.email ? ` — ${c.email}` : ""}`,
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

  // get
  server.registerTool(
    "clockify_get_client",
    {
      title: "Get a client by ID",
      description: `Fetch a single client by its ID.

Endpoint: GET /v1/workspaces/{workspaceId}/clients/{clientId}`,
      inputSchema: {
        workspaceId: workspaceIdField,
        clientId: clientIdField,
        response_format: responseFormatField,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, clientId, response_format }) => {
      try {
        const { data } = await clockifyRequest<Client>(
          `/workspaces/${workspaceId}/clients/${clientId}`,
        );
        const structured = summarizeClient(data);
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : `# ${data.name}\n\n- **ID**: ${data.id}\n- **Email**: ${data.email ?? "—"}\n- **Archived**: ${data.archived}\n- **Address**: ${data.address ?? "—"}\n- **Note**: ${data.note ?? "—"}`;
        return toolResult(text, structured);
      } catch (error) {
        return errorResult(handleApiError(error));
      }
    },
  );

  // create
  server.registerTool(
    "clockify_create_client",
    {
      title: "Create a new client",
      description: `Create a client in a workspace.

Endpoint: POST /v1/workspaces/{workspaceId}/clients`,
      inputSchema: {
        workspaceId: workspaceIdField,
        name: z.string().min(1).describe("Client name (required)."),
        email: z.string().email().optional().describe("Client email."),
        address: z.string().optional(),
        note: z.string().optional(),
        response_format: responseFormatField,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, name, email, address, note, response_format }) => {
      try {
        const { data } = await clockifyRequest<Client>(
          `/workspaces/${workspaceId}/clients`,
          "POST",
          { name, email, address, note },
        );
        const structured = summarizeClient(data);
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : `Created client **${data.name}** \`${data.id}\`.`;
        return toolResult(text, structured);
      } catch (error) {
        return errorResult(handleApiError(error));
      }
    },
  );

  // update
  server.registerTool(
    "clockify_update_client",
    {
      title: "Update a client",
      description: `Update a client's fields. All optional fields replace existing values when provided.

Endpoint: PUT /v1/workspaces/{workspaceId}/clients/{clientId}`,
      inputSchema: {
        workspaceId: workspaceIdField,
        clientId: clientIdField,
        name: z.string().min(1).optional(),
        email: z.string().email().optional(),
        address: z.string().optional(),
        note: z.string().optional(),
        archived: z.boolean().optional().describe("Set true to archive."),
        response_format: responseFormatField,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, clientId, response_format, ...payload }) => {
      try {
        const { data } = await clockifyRequest<Client>(
          `/workspaces/${workspaceId}/clients/${clientId}`,
          "PUT",
          payload,
        );
        const structured = summarizeClient(data);
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : `Updated client **${data.name}** \`${data.id}\`.`;
        return toolResult(text, structured);
      } catch (error) {
        return errorResult(handleApiError(error));
      }
    },
  );

  // delete
  server.registerTool(
    "clockify_delete_client",
    {
      title: "Delete a client",
      description: `Permanently delete a client. Fails if the client has any projects — archive instead in that case.

Endpoint: DELETE /v1/workspaces/{workspaceId}/clients/{clientId}`,
      inputSchema: {
        workspaceId: workspaceIdField,
        clientId: clientIdField,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, clientId }) => {
      try {
        await clockifyRequest(
          `/workspaces/${workspaceId}/clients/${clientId}`,
          "DELETE",
        );
        return toolResult(`Deleted client \`${clientId}\`.`, {
          deleted: clientId,
        });
      } catch (error) {
        return errorResult(handleApiError(error));
      }
    },
  );
}
