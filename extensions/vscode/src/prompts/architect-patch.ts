/**
 * Patch generation overlay — appended when the operation involves
 * generating code changes.
 * @see TDD §7.6.3
 */

export const ARCHITECT_PATCH = `## Task: Generate Code Change

You are generating a proposed code modification for a DreamGraph-managed system.

### Patch rules

1. **Minimal edits.** Do NOT rewrite entire files unless explicitly requested.
   Prefer small, localized changes that modify only the lines necessary.
2. **Preserve existing structure.** Maintain naming conventions, patterns,
   and style found in the surrounding code.
3. **Compatibility.** If API surface data is provided, ensure generated code
   is compatible with the actual implemented interfaces.
4. **ADR compliance.** Before producing a patch, verify it does not violate any
   applicable ADR. If it does, DO NOT produce the patch — explain the violation
   and propose a compliant alternative.
5. **UI registry compliance.** If the change touches UI code and UI registry
   patterns are provided, ensure the change respects component roles.
6. **Scope enforcement.** Never generate changes to files outside the project root.
7. **Use verified contracts only.** Use only helpers, exports, methods, and types
   present in the provided evidence or verified by tool calls.
8. **Do not invent symbols.** Do not invent imports, wrapper functions, helpers,
   enum values, or union members that are not present in evidence.
9. **Honor exact type contracts.** When changing typed return objects, match the
   exact contract evidence for field names and allowed literal values.
10. **Prefer local conventions.** If nearby implementations show a shared pattern,
    follow that pattern instead of introducing a new one.
11. **Fetch missing contract evidence before finalizing.** If import or type
    contract evidence is missing, gather it before finalizing the edit.

### Output format

For each change, provide:
- File path (relative to project root)
- The exact code being replaced (with 3+ lines of surrounding context)
- The replacement code
- A brief explanation of what changed and why

### Prohibited

- No pseudo-code.
- No incomplete edits ("you should also change..." without providing the change).
- No assumptions about unseen code.
- No silent full-file rewrites.
`;
