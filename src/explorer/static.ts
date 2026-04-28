/**
 * Phase 1 — static SPA shell hosting.
 *
 * Serves the built React/Sigma SPA from <dist>/explorer-spa/ at /explorer/
 * and /explorer/assets/*. Built by `vite build` in the explorer/ workspace,
 * which writes directly to dist/explorer-spa/ so the assets ship next to
 * the compiled daemon (dist/index.js).
 *
 * Resolves the assets directory relative to this compiled module:
 *   dist/explorer/static.js  →  ../../explorer-spa  →  dist/explorer-spa
 *
 * Design constraints (plans/DREAMGRAPH_EXPLORER.md §4, §9):
 *   - Loopback-only; no auth introduced yet.
 *   - No path traversal: every served path is resolved and re-checked.
 *   - Unknown SPA URLs fall back to index.html so deep-linked routes work.
 *   - Falls through (returns false) when the SPA bundle is absent so the
 *     daemon can still serve a useful 404 message.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, statSync, createReadStream } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../utils/logger.js";

const SPA_ROOT = resolve(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "explorer-spa",
);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

function mimeFor(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
}

function safeResolve(rel: string): string | null {
  // Strip /explorer/ prefix and any query/hash already removed upstream.
  const trimmed = rel.replace(/^\/+/, "");
  const target = normalize(join(SPA_ROOT, trimmed));
  // Containment check: the resolved path must stay inside SPA_ROOT.
  if (target !== SPA_ROOT && !target.startsWith(SPA_ROOT + sep)) return null;
  return target;
}

function serveFile(res: ServerResponse, file: string): void {
  const stat = statSync(file);
  res.writeHead(200, {
    "Content-Type": mimeFor(file),
    "Content-Length": stat.size,
    "Cache-Control": file.includes(`${sep}assets${sep}`)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  });
  createReadStream(file).pipe(res);
}

/**
 * Try to serve the SPA for a request under /explorer/.
 *
 * Returns true if a response was sent (file streamed, index fallback,
 * or 404). Returns false if the SPA bundle does not exist on disk so
 * the daemon's outer router can produce its standard "Not found".
 */
export function handleSpaRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;

  const indexHtml = join(SPA_ROOT, "index.html");
  if (!existsSync(indexHtml)) {
    // Bundle never built / not deployed.
    return false;
  }

  // Strip the /explorer prefix to map onto SPA_ROOT.
  // /explorer/         → index.html
  // /explorer/assets/x → assets/x
  // /explorer/foo      → assets/foo if exists, else index.html (SPA route)
  const rel = pathname.replace(/^\/explorer/, "") || "/";

  if (rel === "/" || rel === "") {
    serveFile(res, indexHtml);
    return true;
  }

  const target = safeResolve(rel);
  if (!target) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Bad request");
    return true;
  }

  try {
    if (existsSync(target)) {
      const st = statSync(target);
      if (st.isFile()) {
        serveFile(res, target);
        return true;
      }
    }
    // SPA fallback: unknown paths under /explorer/ that aren't asset files
    // serve index.html so client-side routing works in later phases.
    if (!rel.startsWith("/assets/")) {
      serveFile(res, indexHtml);
      return true;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return true;
  } catch (err) {
    logger.error(`/explorer static error (${pathname}):`, err);
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal error");
    return true;
  }
}

export const SPA_ASSET_ROOT = SPA_ROOT;
