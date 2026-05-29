/**
 * Workspace tools: list all workspaces.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { clockifyRequest, handleApiError } from "../services/client.js";
import { errorResult, toolResult } from "../services/format.js";
import { responseFormatField } from "../schemas/common.js";
import { ResponseFormat } from "../types.js";

interface Workspace {
  id: string;
  name: string;
  hourlyRate?: { amount: number; currency: string };
  memberships?: Array<{ userId: string; membershipType: string; membershipStatus: string }>;
  workspaceSettings?: Record<string, unknown>;
}

export function registerWorkspaceTools(server: McpServer): void {
  server.registerTool(
    "clockify_list_workspaces",
    {
      title: "List my Clockify workspaces",
      description: `List every workspace the configured API key has access to.

ALWAYS call this first if you don't know the workspaceId. Most other tools need it.

Endpoint: GET /v1/workspaces
Returns: id, name, hourlyRate, memberCount.`,
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
        const { data } = await clockifyRequest<Workspace[]>("/workspaces");
        const items = data.map((w) => ({
          id: w.id,
          name: w.name,
          currency: w.hourlyRate?.currency,
          hourlyRate: w.hourlyRate?.amount,
          memberCount: w.memberships?.length ?? 0,
        }));
        const structured = { count: items.length, workspaces: items };
        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(structured, null, 2)
            : [
                `# Workspaces (${items.length})`,
                ``,
                ...items.map(
                  (w) =>
                    `- **${w.name}** \`${w.id}\`${w.currency ? ` — ${w.currency} ${w.hourlyRate}/h` : ""} — ${w.memberCount} members`,
                ),
              ].join("\n");
        return toolResult(text, structured);
      } catch (error) {
        return errorResult(handleApiError(error));
      }
    },
  );
}
