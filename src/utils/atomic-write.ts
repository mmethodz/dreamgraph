/**
 * DreamGraph — Atomic file write utility.
 *
 * Prevents data loss from crashes or power loss during writes.
 * Writes to a temporary file first, then atomically renames it
 * to the target path.  On POSIX `rename()` is atomic; on Windows
 * NTFS it is also atomic for same-volume renames.
 *
 * Usage:
 *   import { atomicWriteFile } from "../utils/atomic-write.js";
 *   await atomicWriteFile(dataPath("dream_graph.json"), jsonStr);
 */

import { open, rename, unlink } from "node:fs/promises";
import { logger } from "./logger.js";

/**
 * Write `data` to `filePath` atomically via a temp file + fsync + rename.
 *
 * Sequence:
 *   1. Open a temp file for writing
 *   2. Write data to the temp file
 *   3. fsync (datasync) — flush OS buffers to physical disk
 *   4. Close the file descriptor
 *   5. Rename temp → target (atomic on POSIX & NTFS same-volume)
 *
 * If the process crashes during write, only the `.tmp` file
 * is left corrupted — the original file remains intact.
 * The next read will find the original; the orphaned `.tmp` is harmless.
 *
 * The fsync step prevents the zero-byte anomaly: without it, the OS may
 * report the rename as committed before data is physically written,
 * leading to a zero-byte or truncated file after power loss.
 */
export async function atomicWriteFile(
  filePath: string,
  data: string,
  encoding: BufferEncoding = "utf-8",
): Promise<void> {
  const tmp = filePath + ".tmp";
  let fd;
  try {
    fd = await open(tmp, "w");
    await fd.writeFile(data, encoding);
    await fd.datasync();           // flush to physical disk
    await fd.close();
    fd = undefined;                // mark closed so catch doesn't double-close
    await rename(tmp, filePath);
  } catch (err) {
    // Best-effort cleanup
    try { if (fd) await fd.close(); } catch { /* ignore */ }
    try { await unlink(tmp); } catch { /* ignore */ }
    throw err;
  }
}
