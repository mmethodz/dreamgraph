/**
 * DreamGraph MCP Server - Web Senses tool.
 *
 * Gives the AI agent the ability to fetch external web pages
 * (documentation, API references, changelogs) and read them as
 * clean Markdown text - no CSS, no scripts, no noise.
 *
 * Pipeline:  URL -> fetch -> cheerio (strip noise) -> turndown (HTML->MD)
 *
 * Safety:
 *   - Configurable URL allowlist (default: allow all HTTPS)
 *   - Blocked protocols: file://, ftp://, data:
 *   - Response size cap (default 2 MB) to prevent memory issues
 *   - Timeout (default 15 s)
 *
 * READ-ONLY: This tool only reads from the network.
 * It does NOT modify any files or repositories.
 */

import { z } from "zod";
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { success, error, safeExecute } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import type { ToolResponse } from "../types/index.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Maximum response body size in bytes (2 MB) */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** Fetch timeout in milliseconds */
const FETCH_TIMEOUT_MS = 15_000;

/** Blocked URL schemes */
const BLOCKED_SCHEMES = ["file:", "ftp:", "data:", "javascript:"];

// ---------------------------------------------------------------------------
// Turndown instance (reused across calls)
// ---------------------------------------------------------------------------

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

// Strip images by default - they are noise for an LLM
turndown.addRule("remove-images", {
  filter: "img",
  replacement: (_content, node) => {
    const alt = (node as HTMLElement).getAttribute?.("alt") ?? "";
    return alt ? "[image: " + alt + "]" : "";
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid URL: " + raw);
  }

  if (BLOCKED_SCHEMES.some((s) => url.protocol === s)) {
    throw new Error(
      "Blocked protocol: " + url.protocol + " - only http: and https: allowed."
    );
  }

  return url;
}

/**
 * Strip non-content elements from the parsed HTML before conversion.
 * Removes scripts, styles, nav, footer, ads, cookie banners, etc.
 */
function cleanHtml($: cheerio.CheerioAPI): void {
  const remove = [
    "script",
    "style",
    "noscript",
    "iframe",
    "svg",
    "canvas",
    "nav",
    "footer",
    "header",
    "aside",
    "form",
    "[role='navigation']",
    "[role='banner']",
    "[role='complementary']",
    "[aria-hidden='true']",
    ".cookie-banner",
    ".cookie-consent",
    ".ad",
    ".ads",
    ".advertisement",
    "#cookie-banner",
    "#gdpr",
  ];
  $(remove.join(", ")).remove();
}

/**
 * Try to extract just the main content area.
 * Falls back to <body> if no main/article found.
 */
function extractMainContent($: cheerio.CheerioAPI): string {
  // Priority: <main>, <article>, [role="main"], then <body>
  for (const selector of ["main", "article", "[role='main']"]) {
    const el = $(selector).first();
    if (el.length > 0) {
      return el.html() ?? "";
    }
  }
  return $("body").html() ?? $.html() ?? "";
}

// ---------------------------------------------------------------------------
// Output type
// ---------------------------------------------------------------------------

interface FetchWebPageResult {
  url: string;
  title: string;
  /** Content length in characters */
  content_length: number;
  /** The page content as Markdown */
  markdown: string;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerWebSensesTools(server: McpServer): void {
  server.tool(
    "fetch_web_page",
    "Fetch a web page and return it as clean Markdown text. " +
      "Use this to read documentation, API references, or " +
      "other external sources (e.g. resend.com/docs/webhooks). " +
      "HTML is automatically converted to Markdown - no CSS, no scripts.",
    {
      url: z
        .string()
        .url()
        .describe(
          "URL of the page to fetch (e.g. 'https://resend.com/docs/webhooks'). " +
            "Only http: and https: allowed."
        ),
      selector: z
        .string()
        .optional()
        .describe(
          "Optional CSS selector to narrow down the content " +
            "(e.g. '.docs-content', '#api-reference'). " +
            "If omitted, <main> or <article> is extracted automatically."
        ),
      maxLength: z
        .number()
        .int()
        .min(500)
        .max(100_000)
        .optional()
        .describe(
          "Maximum length of returned Markdown in characters (default: 30000). " +
            "Longer text is truncated."
        ),
    },
    async ({ url: rawUrl, selector, maxLength }) => {
      const limit = maxLength ?? 30_000;

      logger.info("fetch_web_page called: url=" + rawUrl + ", selector=" + (selector ?? "(auto)"));

      const result = await safeExecute<FetchWebPageResult>(
        async (): Promise<ToolResponse<FetchWebPageResult>> => {
          // Validate URL
          let url: URL;
          try {
            url = validateUrl(rawUrl);
          } catch (err) {
            return error(
              "INVALID_URL",
              err instanceof Error ? err.message : String(err)
            );
          }

          // Fetch with timeout and size cap
          let html: string;
          try {
            const controller = new AbortController();
            const timer = setTimeout(
              () => controller.abort(),
              FETCH_TIMEOUT_MS
            );

            const response = await fetch(url.href, {
              signal: controller.signal,
              headers: {
                "User-Agent":
                  "DreamGraph/1.0 (cognitive-agent)",
                Accept:
                  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              },
            });

            clearTimeout(timer);

            if (!response.ok) {
              return error(
                "HTTP_ERROR",
                "HTTP " + response.status + " " + response.statusText + " -- " + url.href
              );
            }

            // Check content type
            const ct = response.headers.get("content-type") ?? "";
            if (
              !ct.includes("text/html") &&
              !ct.includes("application/xhtml") &&
              !ct.includes("text/plain")
            ) {
              return error(
                "UNSUPPORTED_TYPE",
                "Content type '" + ct + "' is not supported. Only HTML/text allowed."
              );
            }

            // Read body with size cap
            const buffer = await response.arrayBuffer();
            if (buffer.byteLength > MAX_BODY_BYTES) {
              const sizeMB = (buffer.byteLength / 1024 / 1024).toFixed(1);
              const maxMB = String(MAX_BODY_BYTES / 1024 / 1024);
              return error(
                "TOO_LARGE",
                "Page is too large (" + sizeMB + " MB). Max: " + maxMB + " MB."
              );
            }

            html = new TextDecoder("utf-8").decode(buffer);
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : String(err);
            if (msg.includes("abort")) {
              return error(
                "TIMEOUT",
                "Request timed out after " + String(FETCH_TIMEOUT_MS / 1000) + " seconds."
              );
            }
            return error("FETCH_ERROR", "Fetch failed: " + msg);
          }

          // Parse and clean HTML
          const $ = cheerio.load(html);
          const title = $("title").first().text().trim() || url.hostname;

          cleanHtml($);

          // Extract content
          let contentHtml: string;
          if (selector) {
            const selected = $(selector).first();
            if (selected.length === 0) {
              return error(
                "SELECTOR_NOT_FOUND",
                "CSS selector '" + selector + "' was not found on the page."
              );
            }
            contentHtml = selected.html() ?? "";
          } else {
            contentHtml = extractMainContent($);
          }

          // Convert to Markdown
          let markdown = turndown.turndown(contentHtml);

          // Collapse excessive whitespace
          markdown = markdown
            .replace(/\n{4,}/g, "\n\n\n")
            .replace(/[ \t]+\n/g, "\n")
            .trim();

          // Truncate if needed
          const truncated = markdown.length > limit;
          if (truncated) {
            markdown =
              markdown.slice(0, limit) +
              "\n\n---\n*[Truncated: showing " + limit.toLocaleString() + " / " + markdown.length.toLocaleString() + " chars]*";
          }

          logger.debug(
            "fetch_web_page: " + title + " - " + markdown.length + " chars" +
              (truncated ? " (truncated)" : "")
          );

          return success<FetchWebPageResult>({
            url: url.href,
            title,
            content_length: markdown.length,
            markdown,
          });
        }
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  logger.info("Registered 1 web-senses tool (fetch_web_page)");
}
