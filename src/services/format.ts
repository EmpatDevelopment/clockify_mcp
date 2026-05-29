/**
 * Helpers for formatting tool responses.
 *
 * Every list-style tool should:
 *   1. Build a structured object using `paginated()`.
 *   2. Pick text format via `formatText()`.
 *   3. Cap with `enforceCharacterLimit()`.
 */

import { CHARACTER_LIMIT } from "../constants.js";
import { PaginationMeta, ResponseFormat, ToolTextResult } from "../types.js";

export function paginated<T>(
  items: T[],
  page: number,
  pageSize: number,
  lastPage: boolean | null,
): { items: T[]; pagination: PaginationMeta } {
  const has_more = lastPage === null ? items.length === pageSize : !lastPage;
  return {
    items,
    pagination: {
      page,
      page_size: pageSize,
      count: items.length,
      has_more,
      ...(has_more ? { next_page: page + 1 } : {}),
    },
  };
}

/**
 * Convert an arbitrary structured object to a text payload.
 * Markdown renderer is supplied by the caller; JSON branch is generic.
 */
export function formatText(
  format: ResponseFormat,
  structured: Record<string, unknown>,
  markdownRenderer: () => string,
): string {
  if (format === ResponseFormat.MARKDOWN) {
    return markdownRenderer();
  }
  return JSON.stringify(structured, null, 2);
}

/**
 * Enforce the character limit. If exceeded, append a truncation notice
 * and (in markdown mode) trim the body; in JSON mode add a truncation flag.
 */
export function enforceCharacterLimit(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  const head = text.slice(0, CHARACTER_LIMIT - 500);
  return `${head}\n\n[Response truncated to ${CHARACTER_LIMIT} chars. Use 'page'/'page_size' or narrow filters (dateRangeStart/End, name, status) to fetch less data per call.]`;
}

/**
 * Build the final tool result with both text and structuredContent.
 */
export function toolResult(
  text: string,
  structured: Record<string, unknown>,
): ToolTextResult {
  return {
    content: [{ type: "text", text: enforceCharacterLimit(text) }],
    structuredContent: structured,
  };
}

export function errorResult(message: string): ToolTextResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

/**
 * Format an ISO-8601 timestamp for human display.
 */
export function fmtDate(ts: string | null | undefined): string {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "Z");
  } catch {
    return ts;
  }
}

/**
 * Convert ISO-8601 duration (e.g. "PT1H30M15S") to seconds.
 * Returns 0 if invalid/empty.
 */
export function durationToSeconds(iso: string | null | undefined): number {
  if (!iso) return 0;
  const m = /^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(iso);
  if (!m) return 0;
  const [, h, mi, s] = m;
  return (
    (h ? parseInt(h, 10) : 0) * 3600 +
    (mi ? parseInt(mi, 10) : 0) * 60 +
    (s ? Math.floor(parseFloat(s)) : 0)
  );
}

/**
 * Pretty-format seconds as "1h 23m 45s".
 */
export function fmtDuration(seconds: number): string {
  if (!seconds) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return parts.join(" ");
}
