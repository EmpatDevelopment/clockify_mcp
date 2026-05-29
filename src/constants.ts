/**
 * Shared constants for the Clockify MCP server.
 */

export const DEFAULT_API_BASE_URL = "https://api.clockify.me/api/v1";
export const DEFAULT_REPORTS_BASE_URL = "https://reports.api.clockify.me/v1";

/**
 * Maximum characters allowed in a tool's text content response.
 * Anything above this is truncated and a warning is added.
 */
export const CHARACTER_LIMIT = 25000;

/**
 * Default page size for paginated list endpoints.
 * Clockify allows up to 5000 but we keep this low for context efficiency.
 */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export const REQUEST_TIMEOUT_MS = 30_000;
