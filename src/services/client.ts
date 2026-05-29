/**
 * Clockify HTTP client.
 *
 * Wraps axios with the X-Api-Key header, base URL handling, retry-friendly
 * error mapping, and helpers for both the main API and the Reports API.
 */

import axios, { AxiosError, AxiosInstance, AxiosResponse } from "axios";
import {
  DEFAULT_API_BASE_URL,
  DEFAULT_REPORTS_BASE_URL,
  REQUEST_TIMEOUT_MS,
} from "../constants.js";
import { HttpMethod } from "../types.js";

let apiClient: AxiosInstance | null = null;
let reportsClient: AxiosInstance | null = null;

function buildClient(baseURL: string, apiKey: string): AxiosInstance {
  return axios.create({
    baseURL,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      "X-Api-Key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
}

/**
 * Initialise both clients on startup. Throws if API key is missing.
 */
export function initClients(): void {
  const apiKey = process.env.CLOCKIFY_API_KEY;
  if (!apiKey) {
    throw new Error(
      "CLOCKIFY_API_KEY environment variable is required. " +
        "Generate one in Clockify → Profile Settings → API.",
    );
  }
  const apiBaseUrl = process.env.CLOCKIFY_API_BASE_URL || DEFAULT_API_BASE_URL;
  const reportsBaseUrl =
    process.env.CLOCKIFY_REPORTS_BASE_URL || DEFAULT_REPORTS_BASE_URL;

  apiClient = buildClient(apiBaseUrl, apiKey);
  reportsClient = buildClient(reportsBaseUrl, apiKey);
}

function getApiClient(): AxiosInstance {
  if (!apiClient) initClients();
  return apiClient!;
}

function getReportsClient(): AxiosInstance {
  if (!reportsClient) initClients();
  return reportsClient!;
}

/**
 * Generic Clockify API request.
 */
export async function clockifyRequest<T = unknown>(
  endpoint: string,
  method: HttpMethod = "GET",
  data?: unknown,
  params?: Record<string, unknown>,
): Promise<{ data: T; lastPage: boolean | null }> {
  const client = getApiClient();
  const response: AxiosResponse<T> = await client.request<T>({
    url: endpoint.startsWith("/") ? endpoint : `/${endpoint}`,
    method,
    data,
    params,
  });
  return {
    data: response.data,
    lastPage: parseLastPageHeader(response),
  };
}

/**
 * Reports API request (different base URL, same auth).
 */
export async function reportsRequest<T = unknown>(
  endpoint: string,
  method: HttpMethod = "POST",
  data?: unknown,
  params?: Record<string, unknown>,
): Promise<{ data: T }> {
  const client = getReportsClient();
  const response: AxiosResponse<T> = await client.request<T>({
    url: endpoint.startsWith("/") ? endpoint : `/${endpoint}`,
    method,
    data,
    params,
  });
  return { data: response.data };
}

function parseLastPageHeader(response: AxiosResponse): boolean | null {
  const raw =
    (response.headers["last-page"] as string | undefined) ??
    (response.headers["Last-Page"] as string | undefined);
  if (raw === undefined) return null;
  return raw.toLowerCase() === "true";
}

/**
 * Convert any error into a human-readable, actionable message.
 * Never expose stack traces or internals to the model.
 */
export function handleApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const axErr = error as AxiosError<{ message?: string; code?: number }>;
    if (axErr.response) {
      const status = axErr.response.status;
      const body = axErr.response.data;
      const apiMsg =
        (typeof body === "object" && body && "message" in body
          ? (body as { message?: string }).message
          : undefined) || axErr.response.statusText;

      switch (status) {
        case 400:
          return `Error 400 (Bad Request): ${apiMsg ?? "invalid parameters"}. Check field names, date formats (ISO-8601 with 'Z' suffix), and required fields.`;
        case 401:
          return `Error 401 (Unauthorized): API key is missing or invalid. Verify CLOCKIFY_API_KEY is correct and active.`;
        case 403:
          return `Error 403 (Forbidden): ${apiMsg ?? "you do not have permission for this resource"}. Some endpoints require ADMIN or OWNER role.`;
        case 404:
          return `Error 404 (Not Found): ${apiMsg ?? "resource not found"}. Verify workspaceId / projectId / userId etc.`;
        case 409:
          return `Error 409 (Conflict): ${apiMsg ?? "resource already exists or state conflict"}.`;
        case 429:
          return `Error 429 (Rate Limit): Clockify enforces a per-key rate limit. Wait a moment and retry, or batch fewer items.`;
        case 500:
        case 502:
        case 503:
        case 504:
          return `Error ${status}: Clockify is having a temporary issue. Retry in a moment.`;
        default:
          return `Error ${status}: ${apiMsg ?? "request failed"}.`;
      }
    }
    if (axErr.code === "ECONNABORTED") {
      return "Error: request timed out. Reports endpoints can be slow on wide date ranges — narrow the dateRangeStart/End window.";
    }
    if (axErr.code === "ENOTFOUND" || axErr.code === "ECONNREFUSED") {
      return "Error: cannot reach Clockify. Check CLOCKIFY_API_BASE_URL / network connectivity.";
    }
    return `Error: ${axErr.message}`;
  }
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}
