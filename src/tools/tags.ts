/**
 * Tag tools.
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
  tagIdField,
  workspaceIdField,
} from "../schemas/common.js";
import { ResponseFormat } from "../types.js";

interface Tag {
  id: string;
  name: string;
  workspaceId: string;
  archived: boolean;
}

export function registerTagTools(server: McpServer): void {
  server.registerTool(
    "clockify_list_tags",
    {
      title: "List tags on a workspace",
      description: `List tags in a workspace.

Endpoint: GET /v1/workspaces/{workspaceId}/tags`,
      inputSchema: {
        workspaceId: workspaceIdField,
        name: z.string().optional(),
        archived: z.boolean().optional(),
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
        const { data, lastPage } = await clockifyRequest<Tag[]>(
          `/workspaces/${workspaceId}/tags`,
          "GET",
          undefined,
          { name, archived, page, "page-size": page_size },
        );
        const items = data.map((t) => ({
          id: t.id,
          name: t.name,
          archived: t.archived,
        }));
        const out = paginated(items, page, page_size, lastPage);
        const structured = { ...out };
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : [
                `# Tags (page ${page})`,
                ``,
                ...items.map(
                  (t) =>
                    `- **${t.name}** \`${t.id}\`${t.archived ? " [ARCHIVED]" : ""}`,
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

  server.registerTool(
    "clockify_get_tag",
    {
      title: "Get a tag by ID",
      description: `Endpoint: GET /v1/workspaces/{workspaceId}/tags/{tagId}`,
      inputSchema: {
        workspaceId: workspaceIdField,
        tagId: tagIdField,
        response_format: responseFormatField,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, tagId, response_format }) => {
      try {
        const { data } = await clockifyRequest<Tag>(
          `/workspaces/${workspaceId}/tags/${tagId}`,
        );
        const structured = {
          id: data.id,
          name: data.name,
          archived: data.archived,
        };
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : `# ${data.name}\n\n- **ID**: ${data.id}\n- **Archived**: ${data.archived}`;
        return toolResult(text, structured);
      } catch (error) {
        return errorResult(handleApiError(error));
      }
    },
  );

  server.registerTool(
    "clockify_create_tag",
    {
      title: "Create a tag",
      description: `Endpoint: POST /v1/workspaces/{workspaceId}/tags`,
      inputSchema: {
        workspaceId: workspaceIdField,
        name: z.string().min(1),
        response_format: responseFormatField,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, name, response_format }) => {
      try {
        const { data } = await clockifyRequest<Tag>(
          `/workspaces/${workspaceId}/tags`,
          "POST",
          { name },
        );
        const structured = { id: data.id, name: data.name, archived: data.archived };
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : `Created tag **${data.name}** \`${data.id}\`.`;
        return toolResult(text, structured);
      } catch (error) {
        return errorResult(handleApiError(error));
      }
    },
  );

  server.registerTool(
    "clockify_update_tag",
    {
      title: "Update a tag",
      description: `Endpoint: PUT /v1/workspaces/{workspaceId}/tags/{tagId}`,
      inputSchema: {
        workspaceId: workspaceIdField,
        tagId: tagIdField,
        name: z.string().min(1).optional(),
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
    async ({ workspaceId, tagId, response_format, ...payload }) => {
      try {
        const { data } = await clockifyRequest<Tag>(
          `/workspaces/${workspaceId}/tags/${tagId}`,
          "PUT",
          payload,
        );
        const structured = { id: data.id, name: data.name, archived: data.archived };
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : `Updated tag **${data.name}**.`;
        return toolResult(text, structured);
      } catch (error) {
        return errorResult(handleApiError(error));
      }
    },
  );

  server.registerTool(
    "clockify_delete_tag",
    {
      title: "Delete a tag",
      description: `Endpoint: DELETE /v1/workspaces/{workspaceId}/tags/{tagId}`,
      inputSchema: {
        workspaceId: workspaceIdField,
        tagId: tagIdField,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ workspaceId, tagId }) => {
      try {
        await clockifyRequest(
          `/workspaces/${workspaceId}/tags/${tagId}`,
          "DELETE",
        );
        return toolResult(`Deleted tag \`${tagId}\`.`, { deleted: tagId });
      } catch (error) {
        return errorResult(handleApiError(error));
      }
    },
  );
}
