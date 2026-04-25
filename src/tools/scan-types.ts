/**
 * DreamGraph — scan-project shared types.
 *
 * Extracted from scan-project.ts so that helper modules
 * (sanitize-entity, structural-generators) can consume the scan shape
 * without importing the orchestrator file.
 */

export interface ScannedFile {
  abs: string;
  rel: string;
  name: string;
  ext: string;
  dirParts: string[];
  size: number;
}

export interface ProjectScan {
  repoName: string;
  repoRoot: string;
  technology: string;
  files: ScannedFile[];
  manifestContent: Record<string, string>;
  uiFiles: ScannedFile[];
  topLevelDirs: string[];
}
