/**
 * DreamGraph v6.0 "La Catedral" — Instance Isolation Integration Tests.
 *
 * Tests cover:
 *   1. InstanceScope boundary checks
 *   2. Cross-instance contamination prevention
 *   3. Legacy mode fallback
 *   4. Instance creation & directory scaffold
 *   5. Policy parser validation
 *   6. UUID-prefix mutex keys
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, sep } from "node:path";
import { InstanceScope, ScopeViolationError } from "../src/instance/scope.js";
import { INSTANCE_DIRS, DATA_STUBS } from "../src/instance/types.js";
import type { PoliciesFile, PolicyProfile } from "../src/instance/types.js";
import {
  DEFAULT_POLICIES,
  validatePolicies,
} from "../src/instance/policies.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const TEST_UUID_A = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const TEST_UUID_B = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";

let tempMaster: string;

async function freshMaster(): Promise<string> {
  return mkdtemp(join(tmpdir(), "dreamgraph-test-"));
}

/* ------------------------------------------------------------------ */
/*  1. InstanceScope — Boundary Checks                                */
/* ------------------------------------------------------------------ */

describe("InstanceScope — boundary checks", () => {
  beforeEach(async () => {
    tempMaster = await freshMaster();
  });

  afterEach(async () => {
    await rm(tempMaster, { recursive: true, force: true });
  });

  it("identifies own paths", () => {
    const scope = new InstanceScope(TEST_UUID_A, tempMaster);

    expect(scope.isOwnPath(resolve(tempMaster, TEST_UUID_A))).toBe(true);
    expect(scope.isOwnPath(resolve(tempMaster, TEST_UUID_A, "data"))).toBe(
      true,
    );
    expect(
      scope.isOwnPath(resolve(tempMaster, TEST_UUID_A, "data", "dream_graph.json")),
    ).toBe(true);
  });

  it("rejects paths belonging to another instance", () => {
    const scope = new InstanceScope(TEST_UUID_A, tempMaster);

    expect(scope.isOtherInstance(resolve(tempMaster, TEST_UUID_B))).toBe(true);
    expect(
      scope.isOtherInstance(
        resolve(tempMaster, TEST_UUID_B, "data", "dream_graph.json"),
      ),
    ).toBe(true);
  });

  it("does not consider its own paths as another instance", () => {
    const scope = new InstanceScope(TEST_UUID_A, tempMaster);

    expect(scope.isOtherInstance(resolve(tempMaster, TEST_UUID_A))).toBe(false);
    expect(
      scope.isOtherInstance(
        resolve(tempMaster, TEST_UUID_A, "data", "schedules.json"),
      ),
    ).toBe(false);
  });

  it("identifies project paths when bound", () => {
    const projectRoot = resolve(tempMaster, "..", "my-project");
    const scope = new InstanceScope(TEST_UUID_A, tempMaster, projectRoot);

    expect(scope.isProjectPath(projectRoot)).toBe(true);
    expect(scope.isProjectPath(resolve(projectRoot, "src", "index.ts"))).toBe(
      true,
    );
    // Not inside project
    expect(scope.isProjectPath(resolve(tempMaster, "random"))).toBe(false);
  });

  it("identifies declared repo paths", () => {
    const repoPath = resolve(tempMaster, "..", "other-repo");
    const scope = new InstanceScope(TEST_UUID_A, tempMaster, null, {
      "other-repo": repoPath,
    });

    expect(scope.isProjectPath(repoPath)).toBe(true);
    expect(scope.isProjectPath(resolve(repoPath, "lib", "foo.ts"))).toBe(true);
  });

  it("isWithinBounds combines own + project", () => {
    const projectRoot = resolve(tempMaster, "..", "my-project");
    const scope = new InstanceScope(TEST_UUID_A, tempMaster, projectRoot);

    // Own dir
    expect(
      scope.isWithinBounds(resolve(tempMaster, TEST_UUID_A, "data")),
    ).toBe(true);
    // Project dir
    expect(scope.isWithinBounds(resolve(projectRoot, "src"))).toBe(true);
    // Neither
    expect(scope.isWithinBounds(resolve(tempMaster, "..", "unrelated"))).toBe(
      false,
    );
  });

  it("paths outside master dir are not other instances", () => {
    const scope = new InstanceScope(TEST_UUID_A, tempMaster);
    const outsidePath = resolve(tempMaster, "..", "totally-different");

    expect(scope.isOtherInstance(outsidePath)).toBe(false);
    // But also not within bounds
    expect(scope.isWithinBounds(outsidePath)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  2. InstanceScope — Guard Functions                                */
/* ------------------------------------------------------------------ */

describe("InstanceScope — guard functions", () => {
  beforeEach(async () => {
    tempMaster = await freshMaster();
  });

  afterEach(async () => {
    await rm(tempMaster, { recursive: true, force: true });
  });

  it("assertWithinBounds passes for own paths", () => {
    const scope = new InstanceScope(TEST_UUID_A, tempMaster);

    expect(() =>
      scope.assertWithinBounds(
        resolve(tempMaster, TEST_UUID_A, "data", "dream_graph.json"),
      ),
    ).not.toThrow();
  });

  it("assertWithinBounds throws ScopeViolationError for cross-instance access", () => {
    const scope = new InstanceScope(TEST_UUID_A, tempMaster);

    expect(() =>
      scope.assertWithinBounds(
        resolve(tempMaster, TEST_UUID_B, "data", "dream_graph.json"),
        "test cross-instance",
      ),
    ).toThrow(ScopeViolationError);
  });

  it("assertWithinBounds throws for out-of-bounds paths", () => {
    const scope = new InstanceScope(TEST_UUID_A, tempMaster);

    expect(() =>
      scope.assertWithinBounds(resolve("/tmp/random/file.json")),
    ).toThrow(ScopeViolationError);
  });

  it("assertOwnDataPath passes for data dir files", () => {
    const scope = new InstanceScope(TEST_UUID_A, tempMaster);

    expect(() =>
      scope.assertOwnDataPath(
        resolve(tempMaster, TEST_UUID_A, "data", "dream_graph.json"),
      ),
    ).not.toThrow();
  });

  it("assertOwnDataPath rejects config dir (stricter than assertWithinBounds)", () => {
    const scope = new InstanceScope(TEST_UUID_A, tempMaster);

    // Config is own path but NOT data
    expect(() =>
      scope.assertOwnDataPath(
        resolve(tempMaster, TEST_UUID_A, "config", "policies.json"),
      ),
    ).toThrow(ScopeViolationError);
  });

  it("assertOwnDataPath rejects project paths", () => {
    const projectRoot = resolve(tempMaster, "..", "project");
    const scope = new InstanceScope(TEST_UUID_A, tempMaster, projectRoot);

    expect(() =>
      scope.assertOwnDataPath(resolve(projectRoot, "data.json")),
    ).toThrow(ScopeViolationError);
  });
});

/* ------------------------------------------------------------------ */
/*  3. Convenience helpers                                            */
/* ------------------------------------------------------------------ */

describe("InstanceScope — convenience helpers", () => {
  it("dataPath resolves within data dir", () => {
    const scope = new InstanceScope(TEST_UUID_A, "/fake/master");
    const result = scope.dataPath("dream_graph.json");
    expect(result).toBe(
      resolve("/fake/master", TEST_UUID_A, "data", "dream_graph.json"),
    );
  });

  it("configPath resolves within config dir", () => {
    const scope = new InstanceScope(TEST_UUID_A, "/fake/master");
    const result = scope.configPath("policies.json");
    expect(result).toBe(
      resolve("/fake/master", TEST_UUID_A, "config", "policies.json"),
    );
  });

  it("logPath resolves within logs dir", () => {
    const scope = new InstanceScope(TEST_UUID_A, "/fake/master");
    const result = scope.logPath("system.log");
    expect(result).toBe(
      resolve("/fake/master", TEST_UUID_A, "logs", "system.log"),
    );
  });

  it("mutexKey prefixes with UUID", () => {
    const scope = new InstanceScope(TEST_UUID_A, "/fake/master");
    expect(scope.mutexKey("schedules.json")).toBe(
      `${TEST_UUID_A}:schedules.json`,
    );
  });

  it("toString includes short UUID and project state", () => {
    const scope = new InstanceScope(TEST_UUID_A, "/fake/master", "/my/project");
    const str = scope.toString();
    expect(str).toContain(TEST_UUID_A.slice(0, 8));
    // Project root is resolved to absolute — check that it's present (platform-agnostic)
    expect(str).not.toContain("unbound");
    expect(str).toMatch(/project/i);
  });

  it("toString shows unbound when no project", () => {
    const scope = new InstanceScope(TEST_UUID_A, "/fake/master");
    expect(scope.toString()).toContain("unbound");
  });
});

/* ------------------------------------------------------------------ */
/*  4. Policy Validation                                              */
/* ------------------------------------------------------------------ */

describe("validatePolicies", () => {
  it("accepts valid DEFAULT_POLICIES", () => {
    const result = validatePolicies(DEFAULT_POLICIES);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects non-object input", () => {
    expect(validatePolicies(null).valid).toBe(false);
    expect(validatePolicies("string").valid).toBe(false);
    expect(validatePolicies([]).valid).toBe(false);
    expect(validatePolicies(42).valid).toBe(false);
  });

  it("rejects wrong schema_version", () => {
    const bad = { ...DEFAULT_POLICIES, schema_version: "2.0.0" };
    const result = validatePolicies(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("schema_version"))).toBe(true);
  });

  it("rejects unknown active profile", () => {
    const bad = { ...DEFAULT_POLICIES, profile: "ultra" };
    const result = validatePolicies(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("ultra"))).toBe(true);
  });

  it("rejects missing profiles map", () => {
    const bad = { schema_version: "1.0.0", profile: "strict" };
    const result = validatePolicies(bad);
    expect(result.valid).toBe(false);
  });

  it("detects missing required profile definitions", () => {
    const bad: PoliciesFile = {
      schema_version: "1.0.0",
      profile: "strict",
      profiles: {
        strict: DEFAULT_POLICIES.profiles.strict,
        // balanced and creative missing
      } as any,
    };
    const result = validatePolicies(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("balanced"))).toBe(true);
    expect(result.errors.some((e) => e.includes("creative"))).toBe(true);
  });

  it("detects missing fields in a profile definition", () => {
    const badStrict = { description: "test" }; // missing all others
    const bad = {
      schema_version: "1.0.0",
      profile: "strict",
      profiles: {
        strict: badStrict,
        balanced: DEFAULT_POLICIES.profiles.balanced,
        creative: DEFAULT_POLICIES.profiles.creative,
      },
    };
    const result = validatePolicies(bad);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes("require_tool_evidence")),
    ).toBe(true);
  });

  it("detects wrong type for boolean fields", () => {
    const bad = structuredClone(DEFAULT_POLICIES);
    (bad.profiles.strict as any).require_tool_evidence = "yes";
    const result = validatePolicies(bad);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) =>
          e.includes("require_tool_evidence") && e.includes("boolean"),
      ),
    ).toBe(true);
  });

  it("detects wrong type for max_verify_loops", () => {
    const bad = structuredClone(DEFAULT_POLICIES);
    (bad.profiles.balanced as any).max_verify_loops = "five";
    const result = validatePolicies(bad);
    expect(result.valid).toBe(false);
  });

  it("detects wrong type for array fields", () => {
    const bad = structuredClone(DEFAULT_POLICIES);
    (bad.profiles.creative as any).mandatory_ingest_tools = "not-an-array";
    const result = validatePolicies(bad);
    expect(result.valid).toBe(false);
  });

  it("warns about unknown profile names", () => {
    const extended = structuredClone(DEFAULT_POLICIES) as any;
    extended.profiles.paranoid = structuredClone(
      DEFAULT_POLICIES.profiles.strict,
    );
    const result = validatePolicies(extended);
    // Should be valid (it's just a warning)
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("paranoid"))).toBe(true);
  });

  it("warns about unknown fields in profile definition", () => {
    const extended = structuredClone(DEFAULT_POLICIES);
    (extended.profiles.strict as any).custom_flag = true;
    const result = validatePolicies(extended);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes("custom_flag"))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  5. DEFAULT_POLICIES structure                                     */
/* ------------------------------------------------------------------ */

describe("DEFAULT_POLICIES", () => {
  it("has balanced as default profile", () => {
    expect(DEFAULT_POLICIES.profile).toBe("balanced");
  });

  it("has all three canonical profiles", () => {
    const names = Object.keys(DEFAULT_POLICIES.profiles);
    expect(names).toContain("strict");
    expect(names).toContain("balanced");
    expect(names).toContain("creative");
  });

  it("strict profile blocks creative mode", () => {
    expect(DEFAULT_POLICIES.profiles.strict.allow_creative_mode).toBe(false);
    expect(DEFAULT_POLICIES.profiles.strict.require_tool_evidence).toBe(true);
    expect(DEFAULT_POLICIES.profiles.strict.block_unbacked_claims).toBe(true);
  });

  it("creative profile allows everything", () => {
    expect(DEFAULT_POLICIES.profiles.creative.require_tool_evidence).toBe(
      false,
    );
    expect(DEFAULT_POLICIES.profiles.creative.allow_phase_skip).toBe(true);
    expect(DEFAULT_POLICIES.profiles.creative.allow_creative_mode).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  6. INSTANCE_DIRS & DATA_STUBS constants                           */
/* ------------------------------------------------------------------ */

describe("Instance constants", () => {
  it("INSTANCE_DIRS has required subdirectories", () => {
    expect(INSTANCE_DIRS).toContain("config");
    expect(INSTANCE_DIRS).toContain("data");
    expect(INSTANCE_DIRS).toContain("runtime");
    expect(INSTANCE_DIRS).toContain("logs");
    expect(INSTANCE_DIRS).toContain("exports");
  });

  it("DATA_STUBS has all 20 data files", () => {
    const keys = Object.keys(DATA_STUBS);
    expect(keys.length).toBe(20);
    expect(keys).toContain("dream_graph.json");
    expect(keys).toContain("schedules.json");
    expect(keys).toContain("adr_log.json");
    expect(keys).toContain("ui_registry.json");
    expect(keys).toContain("tension_log.json");
    expect(keys).toContain("datastores.json");
  });

  it("DATA_STUBS values are valid JSON objects", () => {
    for (const [filename, stub] of Object.entries(DATA_STUBS)) {
      expect(typeof stub).toBe("object");
      // Should be serializable
      expect(() => JSON.stringify(stub)).not.toThrow();
    }
  });
});

/* ------------------------------------------------------------------ */
/*  7. Cross-instance contamination (dual-scope scenario)             */
/* ------------------------------------------------------------------ */

describe("Cross-instance contamination prevention", () => {
  beforeEach(async () => {
    tempMaster = await freshMaster();
  });

  afterEach(async () => {
    await rm(tempMaster, { recursive: true, force: true });
  });

  it("scope A cannot access scope B's paths", () => {
    const scopeA = new InstanceScope(TEST_UUID_A, tempMaster);
    const scopeB = new InstanceScope(TEST_UUID_B, tempMaster);

    const bDataFile = scopeB.dataPath("dream_graph.json");

    // A should detect B's file as another instance
    expect(scopeA.isOtherInstance(bDataFile)).toBe(true);
    expect(scopeA.isOwnPath(bDataFile)).toBe(false);
    expect(scopeA.isWithinBounds(bDataFile)).toBe(false);

    // A's guard should throw
    expect(() =>
      scopeA.assertWithinBounds(bDataFile, "cross-instance test"),
    ).toThrow(ScopeViolationError);
  });

  it("scope B cannot access scope A's config", () => {
    const scopeA = new InstanceScope(TEST_UUID_A, tempMaster);
    const scopeB = new InstanceScope(TEST_UUID_B, tempMaster);

    const aConfigFile = scopeA.configPath("policies.json");

    expect(scopeB.isOtherInstance(aConfigFile)).toBe(true);
    expect(() => scopeB.assertWithinBounds(aConfigFile)).toThrow(
      ScopeViolationError,
    );
  });

  it("two scopes have distinct data paths for the same filename", () => {
    const scopeA = new InstanceScope(TEST_UUID_A, tempMaster);
    const scopeB = new InstanceScope(TEST_UUID_B, tempMaster);

    const aPath = scopeA.dataPath("dream_graph.json");
    const bPath = scopeB.dataPath("dream_graph.json");

    expect(aPath).not.toBe(bPath);
    expect(aPath).toContain(TEST_UUID_A);
    expect(bPath).toContain(TEST_UUID_B);
  });

  it("two scopes produce distinct mutex keys", () => {
    const scopeA = new InstanceScope(TEST_UUID_A, tempMaster);
    const scopeB = new InstanceScope(TEST_UUID_B, tempMaster);

    expect(scopeA.mutexKey("schedules.json")).not.toBe(
      scopeB.mutexKey("schedules.json"),
    );
    expect(scopeA.mutexKey("schedules.json")).toContain(TEST_UUID_A);
    expect(scopeB.mutexKey("schedules.json")).toContain(TEST_UUID_B);
  });

  it("master registry path is not treated as another instance", () => {
    const scope = new InstanceScope(TEST_UUID_A, tempMaster);
    const registryPath = resolve(tempMaster, "instances.json");

    expect(scope.isOtherInstance(registryPath)).toBe(false);
    // But it's also not the instance's own path
    expect(scope.isOwnPath(registryPath)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  8. InstanceScope.fromInstance factory                              */
/* ------------------------------------------------------------------ */

describe("InstanceScope.fromInstance", () => {
  it("creates scope from DreamGraphInstance", () => {
    const instance = {
      uuid: TEST_UUID_A,
      name: "test",
      project_root: "/projects/test",
      mode: "development" as const,
      policy_profile: "strict" as PolicyProfile,
      version: "6.0.0",
      transport: { type: "stdio" as const },
      created_at: new Date().toISOString(),
      last_active_at: new Date().toISOString(),
      total_dream_cycles: 0,
      total_tool_calls: 0,
    };

    const scope = InstanceScope.fromInstance(instance, "/master", {
      repo1: "/repos/one",
    });

    expect(scope.uuid).toBe(TEST_UUID_A);
    expect(scope.projectRoot).toBe(resolve("/projects/test"));
    expect(scope.repos).toEqual({ repo1: "/repos/one" });
  });
});
