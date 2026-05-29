#!/usr/bin/env node
/**
 * Clockify MCP Server.
 *
 * Exposes Clockify's REST API (workspaces, users, clients, projects, tasks,
 * tags, time entries) and Reports API (detailed, summary, weekly) as MCP tools.
 *
 * Auth: X-Api-Key from CLOCKIFY_API_KEY env var.
 * Transport: stdio.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { initClients } from "./services/client.js";
import { registerUserTools } from "./tools/users.js";
import { registerWorkspaceTools } from "./tools/workspaces.js";
import { registerClientTools } from "./tools/clients.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerTaskTools } from "./tools/tasks.js";
import { registerTagTools } from "./tools/tags.js";
import { registerTimeEntryTools } from "./tools/timeEntries.js";
import { registerReportTools } from "./tools/reports.js";

const SERVER_NAME = "clockify-mcp-server";
const SERVER_VERSION = "1.0.0";

function buildServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerWorkspaceTools(server);
  registerUserTools(server);
  registerClientTools(server);
  registerProjectTools(server);
  registerTaskTools(server);
  registerTagTools(server);
  registerTimeEntryTools(server);
  registerReportTools(server);

  return server;
}

async function main(): Promise<void> {
  // Surface a clear error message before connecting if no API key is set.
  try {
    initClients();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr ONLY — stdout is reserved for MCP protocol messages.
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio.`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
