/**
 * DreamGraph MCP Server — Async file mutex.
 *
 * Prevents concurrent read-modify-write on the same JSON data file.
 * When two MCP tool calls arrive in parallel and both need to update
 * the same file, the mutex serialises them so the second caller waits
 * until the first has finished writing.
 *
 * Usage:
 *   import { withFileLock } from "../utils/mutex.js";
 *
 *   const result = await withFileLock("adr_log.json", async () => {
 *     const data = await loadADRLog();
 *     data.decisions.push(newDecision);
 *     await saveADRLog(data);
 *     return data;
 *   });
 *
 * The lock key is typically the data filename. All callers that use
 * the same key are serialised; different keys run concurrently.
 */

import { logger } from "./logger.js";

/** Map of lock keys → tail of the promise chain. */
const locks = new Map<string, Promise<void>>();

/**
 * Execute `fn` while holding an exclusive async lock for `key`.
 *
 * This is a simple promise-chain mutex: each new call appends itself
 * to the previous promise for that key, guaranteeing FIFO ordering
 * with zero busy-waiting.
 */
export async function withFileLock<T>(
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  // Get the current tail (or a resolved promise if no one is waiting)
  const prev = locks.get(key) ?? Promise.resolve();

  let releaseLock!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });

  // Chain ourselves onto the lock — future callers will wait on `gate`
  locks.set(key, gate);

  // Wait for the previous holder to finish
  await prev;

  logger.debug(`Mutex acquired: ${key}`);
  try {
    return await fn();
  } finally {
    logger.debug(`Mutex released: ${key}`);
    releaseLock();

    // Clean up if we're the last in the chain
    if (locks.get(key) === gate) {
      locks.delete(key);
    }
  }
}
