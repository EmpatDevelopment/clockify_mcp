/**
 * Shared TypeScript types and enums for Clockify MCP server.
 */

export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

/**
 * Common pagination metadata returned by list tools.
 */
export interface PaginationMeta {
  page: number;
  page_size: number;
  count: number;
  has_more: boolean;
  next_page?: number;
}

/**
 * Tool result format for SDK responses.
 * Index signature matches the SDK's CallToolResult type.
 */
export interface ToolTextResult {
  [x: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}
