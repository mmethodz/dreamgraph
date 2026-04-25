import path from "node:path";

const GENERATED_DIRECTORY_NAMES = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "dist-test",
  "build",
  "out",
  "target",
  "bin",
  "obj",
  "coverage",
  ".nyc_output",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".sass-cache",
  ".gradle",
  ".mvn",
  "cmake-build-debug",
  "cmake-build-release",
  "tmp",
  "temp",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".venv",
  "venv",
  ".tox",
  ".nox",
  ".dart_tool",
  ".idea",
  ".vs",
]);

const GENERATED_PATH_SEGMENTS = [
  "/dist/",
  "/dist-test/",
  "/build/",
  "/out/",
  "/target/",
  "/bin/",
  "/obj/",
  "/coverage/",
  "/tmp/",
  "/temp/",
  "/.next/",
  "/.nuxt/",
  "/.svelte-kit/",
  "/.turbo/",
  "/.cache/",
  "/.parcel-cache/",
  "/.sass-cache/",
  "/.gradle/",
  "/cmake-build-debug/",
  "/cmake-build-release/",
  "/__pycache__/",
  "/.pytest_cache/",
  "/.mypy_cache/",
  "/.ruff_cache/",
  "/.venv/",
  "/venv/",
  "/.tox/",
  "/.nox/",
  "/.dart_tool/",
];

const GENERATED_PATH_SUFFIXES = [
  "/dist",
  "/dist-test",
  "/build",
  "/out",
  "/target",
  "/bin",
  "/obj",
  "/coverage",
  "/tmp",
  "/temp",
  "/.next",
  "/.nuxt",
  "/.svelte-kit",
  "/.turbo",
  "/.cache",
  "/.parcel-cache",
  "/.sass-cache",
  "/.gradle",
  "/cmake-build-debug",
  "/cmake-build-release",
  "/__pycache__",
  "/.pytest_cache",
  "/.mypy_cache",
  "/.ruff_cache",
  "/.venv",
  "/venv",
  "/.tox",
  "/.nox",
  "/.dart_tool",
];

export interface ScanDirectoryPolicyInput {
  repoRoot: string;
  absDir: string;
  entryName: string;
}

function normalizeRelativeDir(repoRoot: string, absDir: string): string {
  const relDir = path.relative(repoRoot, absDir).replace(/\\/g, "/");
  if (!relDir || relDir === ".") return "";
  return `/${relDir.toLowerCase()}`;
}

export function shouldSkipScanDirectory({ repoRoot, absDir, entryName }: ScanDirectoryPolicyInput): boolean {
  const normalizedName = entryName.toLowerCase();
  if (normalizedName.startsWith(".")) {
    return true;
  }

  if (GENERATED_DIRECTORY_NAMES.has(normalizedName)) {
    return true;
  }

  const normalizedRelDir = normalizeRelativeDir(repoRoot, absDir);
  if (!normalizedRelDir) {
    return false;
  }

  const pathSegments = normalizedRelDir.split("/").filter(Boolean);
  if (pathSegments.some(segment => GENERATED_DIRECTORY_NAMES.has(segment))) {
    return true;
  }

  if (GENERATED_PATH_SEGMENTS.some(segment => normalizedRelDir.includes(segment))) {
    return true;
  }

  if (GENERATED_PATH_SUFFIXES.some(suffix => normalizedRelDir.endsWith(suffix))) {
    return true;
  }

  return false;
}
