/**
 * Reusable Zod schemas shared across tools.
 */

import { z } from "zod";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "../constants.js";
import { ResponseFormat } from "../types.js";

export const workspaceIdField = z
  .string()
  .min(1, "workspaceId is required")
  .describe("Workspace ID (24-char hex). Use clockify_list_workspaces to find it.");

export const userIdField = z
  .string()
  .min(1, "userId is required")
  .describe("User ID (24-char hex). Use clockify_get_current_user or clockify_list_workspace_users.");

export const projectIdField = z
  .string()
  .min(1, "projectId is required")
  .describe("Project ID (24-char hex).");

export const taskIdField = z
  .string()
  .min(1, "taskId is required")
  .describe("Task ID (24-char hex).");

export const clientIdField = z
  .string()
  .min(1, "clientId is required")
  .describe("Client ID (24-char hex).");

export const tagIdField = z
  .string()
  .min(1, "tagId is required")
  .describe("Tag ID (24-char hex).");

export const timeEntryIdField = z
  .string()
  .min(1, "timeEntryId is required")
  .describe("Time entry ID (24-char hex).");

export const pageField = z
  .number()
  .int()
  .min(1)
  .default(1)
  .describe("1-indexed page number. Default 1.");

export const pageSizeField = z
  .number()
  .int()
  .min(1)
  .max(MAX_PAGE_SIZE)
  .default(DEFAULT_PAGE_SIZE)
  .describe(`Items per page (1-${MAX_PAGE_SIZE}). Default ${DEFAULT_PAGE_SIZE}. Keep small to save context.`);

export const responseFormatField = z
  .nativeEnum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe("Output format: 'markdown' for humans, 'json' for programmatic use.");

/**
 * ISO-8601 datetime with required 'Z' suffix (UTC), used by Clockify everywhere.
 * Example: "2024-03-15T09:00:00Z"
 */
export const isoDateTimeField = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/,
    "Must be ISO-8601 with 'Z' suffix, e.g. '2024-03-15T09:00:00Z'",
  );
