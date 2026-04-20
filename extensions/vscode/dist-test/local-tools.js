"use strict";
/**
 * Local Extension Tools — executed directly in the VS Code extension host.
 *
 * These tools do NOT require an MCP daemon connection. They use VS Code APIs
 * and Node child_process directly for maximum speed and reliability.
 *
 * Tools:
 *   run_command   — Shell execution with stdout/stderr capture + OutputChannel
 *   modify_entity — Entity-level code editing via VS Code symbol provider
 *   write_file    — Create or overwrite a file in the workspace
 *   read_local_file — Read a local file (full or line range)
 *
 * Also exports registerRunnerCommands() for manual palette access to run_command.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOCAL_TOOL_DEFINITIONS = void 0;
exports.isLocalTool = isLocalTool;
exports.executeLocalTool = executeLocalTool;
exports.registerRunnerCommands = registerRunnerCommands;
const vscode = __importStar(require("vscode"));
const cp = __importStar(require("node:child_process"));
const path = __importStar(require("node:path"));
const fs = __importStar(require("node:fs/promises"));
/* ------------------------------------------------------------------ */
/*  Tool definitions (same shape as MCP ToolDefinition)               */
/* ------------------------------------------------------------------ */
exports.LOCAL_TOOL_DEFINITIONS = [
    {
        name: 'run_command',
        description: '[Support tool — execution] Execute a shell command to build, test, or verify ' +
            'changes. Use after code modifications to run build tools (npm run build, tsc), ' +
            'test runners (vitest, jest), linters (eslint). No MCP equivalent exists for this. ' +
            'Returns exit code and keyword-filtered relevant output.',
        inputSchema: {
            type: 'object',
            properties: {
                command: {
                    type: 'string',
                    description: 'Shell command to execute (e.g. "npm run build", "tsc --noEmit").',
                },
                cwd: {
                    type: 'string',
                    description: 'Working directory, relative to workspace root. Defaults to workspace root.',
                },
                timeoutMs: {
                    type: 'number',
                    description: 'Timeout in ms (default 60 000, max 300 000).',
                },
            },
            required: ['command'],
        },
    },
    {
        name: 'modify_entity',
        description: '[Support tool — edit fallback] Replace a code entity in a file. Use as FALLBACK ' +
            'when MCP edit_entity fails. Prefer edit_entity (MCP) first — it validates against ' +
            'the knowledge graph. This tool uses VS Code symbol provider to locate entities ' +
            'precisely and is resilient to whitespace differences.',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'Absolute or workspace-relative path to the file.',
                },
                entity: {
                    type: 'string',
                    description: 'Name of the entity to replace.',
                },
                parentEntity: {
                    type: 'string',
                    description: 'Parent class/interface name for members. Omit for top-level entities.',
                },
                newContent: {
                    type: 'string',
                    description: 'Complete replacement code for the entity.',
                },
            },
            required: ['filePath', 'entity', 'newContent'],
        },
    },
    {
        name: 'write_file',
        description: '[Support tool — file creation] Create or overwrite a file. After creating a file, ' +
            'ALWAYS call enrich_seed_data (MCP) to register the new module/feature in the ' +
            'knowledge graph. Parent directories are created automatically. ' +
            'IMPORTANT: content must be under 300 KB. For large files (plans, docs), write in ' +
            'sections: create the file with the first section, then append remaining sections ' +
            'using subsequent write_file calls. Do NOT generate the entire large file inline ' +
            'in a single tool call — this causes output token exhaustion and silent hangs.',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'Absolute or workspace-relative path.',
                },
                content: {
                    type: 'string',
                    description: 'Full file content to write.',
                },
            },
            required: ['filePath', 'content'],
        },
    },
    {
        name: 'read_local_file',
        description: '[Support tool — read fallback] Read a local file. Use only when MCP daemon is ' +
            'unavailable or for quick verification after edits. Prefer query_resource and ' +
            'read_source_code (MCP entity mode) for normal operations. ' +
            'Optionally specify startLine/endLine for a range (1-based, inclusive).',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: 'Absolute or workspace-relative path.',
                },
                startLine: {
                    type: 'number',
                    description: '1-based start line (inclusive). Omit to read entire file.',
                },
                endLine: {
                    type: 'number',
                    description: '1-based end line (inclusive).',
                },
            },
            required: ['filePath'],
        },
    },
];
const LOCAL_TOOL_NAMES = new Set(exports.LOCAL_TOOL_DEFINITIONS.map((t) => t.name));
function isLocalTool(name) {
    return LOCAL_TOOL_NAMES.has(name);
}
/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */
const MAX_OUTPUT = 50_000;
function resolvePath(p) {
    if (path.isAbsolute(p))
        return p;
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return ws ? path.resolve(ws, p) : p;
}
function ok(data) {
    return JSON.stringify({ success: true, data }, null, 2);
}
function fail(error) {
    return JSON.stringify({ success: false, error }, null, 2);
}
/* ------------------------------------------------------------------ */
/*  Per-file Mutex — prevents concurrent edits to the same file       */
/* ------------------------------------------------------------------ */
/**
 * Simple async mutex keyed by file path. When Anthropic models fire
 * multiple modify_entity / write_file calls targeting the same file
 * simultaneously, the mutex serialises them so only one edit is
 * in-flight per file at a time. Different files can still be edited
 * concurrently without blocking.
 */
const fileLocks = new Map();
async function withFileLock(absPath, fn) {
    const key = absPath.toLowerCase(); // normalise on Windows
    const prev = fileLocks.get(key) ?? Promise.resolve();
    let release;
    const next = new Promise((r) => { release = r; });
    fileLocks.set(key, next);
    try {
        await prev; // wait for previous edit on this file to finish
        return await fn();
    }
    finally {
        release();
        // GC: remove the entry only if we're still the tail
        if (fileLocks.get(key) === next)
            fileLocks.delete(key);
    }
}
/* ------------------------------------------------------------------ */
/*  Large-entity safety — detect risky whole-class replacements       */
/* ------------------------------------------------------------------ */
/** Rough count of top-level members inside a class/interface body. */
function countMembers(text) {
    // Heuristic: count lines that start a method, property, or constructor
    const memberPattern = /^\s+(public|private|protected|static|readonly|abstract|async|get |set |constructor\b|\w+\s*\()/gm;
    const matches = text.match(memberPattern);
    return matches?.length ?? 0;
}
/**
 * Maximum number of members a class/interface can have for a whole-entity
 * replacement without explicit confirmation. Beyond this threshold the
 * tool rejects the edit and asks the model to target individual members
 * using parentEntity instead.
 */
const LARGE_ENTITY_MEMBER_THRESHOLD = 15;
/* ------------------------------------------------------------------ */
/*  OutputChannel + keyword extraction (from Copilot-style runner)    */
/* ------------------------------------------------------------------ */
const OUTPUT_NAME = 'DreamGraph • Run';
let _output;
function getOutput() {
    if (!_output)
        _output = vscode.window.createOutputChannel(OUTPUT_NAME, { log: true });
    return _output;
}
function keywordScore(line) {
    const l = line.toLowerCase();
    let score = 0;
    if (/(error|fail|fatal|exception|traceback|npm err!|build failed)/.test(l))
        score += 5;
    if (/(warning|warn)/.test(l))
        score += 2;
    if (/(compiled|built|success|done|finished|passed)/.test(l))
        score += 1;
    if (/^error\b|^warn\b/i.test(line))
        score += 2;
    return score;
}
function extractRelevant(raw, maxLines = 60) {
    const lines = raw.split(/\r?\n/);
    const scored = lines.map((line, i) => ({ i, line, score: keywordScore(line) }));
    const important = scored.filter(s => s.score > 0);
    const tail = lines.slice(Math.max(0, lines.length - 30));
    const selected = new Set();
    important
        .sort((a, b) => b.score - a.score || a.i - b.i)
        .slice(0, Math.min(80, Math.max(20, Math.floor(maxLines * 0.6))))
        .forEach(s => selected.add(s.i));
    tail.forEach((_, idx) => selected.add(lines.length - tail.length + idx));
    const picked = Array.from(selected).sort((a, b) => a - b).map(i => lines[i]);
    const collapsed = [];
    let blankRun = 0;
    for (const ln of picked) {
        if (ln.trim() === '') {
            blankRun++;
            if (blankRun <= 1)
                collapsed.push(ln);
        }
        else {
            blankRun = 0;
            collapsed.push(ln);
        }
    }
    return collapsed.join('\n');
}
async function resolveInstanceEnv(wsRoot) {
    try {
        const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
        if (!home)
            return {};
        const indexPath = path.join(home, '.dreamgraph', '.instances.json');
        const raw = await fs.readFile(indexPath, 'utf-8');
        const instances = JSON.parse(raw);
        if (!Array.isArray(instances))
            return {};
        const match = instances.find((i) => i.projectRoot && path.normalize(i.projectRoot) === path.normalize(wsRoot));
        if (match?.uuid) {
            return { DREAMGRAPH_INSTANCE_UUID: match.uuid };
        }
    }
    catch {
        // No .instances.json, parse error, or no match — silent fallback, continue without UUID
    }
    return {};
}
function buildSpawnArgs(command, cwd, extraEnv) {
    const trimmed = command.trim();
    const isPwsh = /^(powershell|pwsh)\b/i.test(trimmed);
    if (isPwsh && process.platform === 'win32') {
        const bin = trimmed.split(/\s+/)[0];
        const rest = trimmed.slice(bin.length).trim();
        // If the caller already supplied PowerShell flags (-File, -Command, -NoProfile, etc.)
        // let them through as-is via shell:true — don't double-wrap.
        const hasExplicitFlags = /^-(File|Command|NoProfile|NonInteractive|ExecutionPolicy|NoLogo|WindowStyle)\b/i.test(rest);
        if (hasExplicitFlags) {
            return {
                cmd: command,
                args: [],
                opts: { cwd, shell: true, windowsHide: true, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', ...extraEnv } }
            };
        }
        // Bare inline script — bypass cmd.exe wrapping by spawning pwsh directly
        // and injecting the script body as -Command. This prevents here-string and
        // quote mangling that occurs when cmd.exe wraps the command.
        return {
            cmd: bin,
            args: ['-NoProfile', '-NonInteractive', '-Command', rest],
            opts: { cwd, shell: false, windowsHide: true, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', ...extraEnv } }
        };
    }
    return {
        cmd: command,
        args: [],
        opts: { cwd, shell: true, windowsHide: true, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', ...extraEnv } }
    };
}
/* ------------------------------------------------------------------ */
/*  run_command (enhanced: OutputChannel, progress, keyword filter)    */
/* ------------------------------------------------------------------ */
async function handleRunCommand(input) {
    const command = String(input.command ?? '');
    if (!command)
        return fail('command is required');
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!wsRoot)
        return fail('No workspace folder open');
    let cwd = wsRoot;
    if (input.cwd && typeof input.cwd === 'string') {
        cwd = path.isAbsolute(input.cwd) ? input.cwd : path.resolve(wsRoot, input.cwd);
    }
    const timeoutMs = Math.min(Math.max(Number(input.timeoutMs) || 60_000, 5_000), 300_000);
    const out = getOutput();
    out.appendLine(`\n$ ${command}  [cwd: ${cwd}]`);
    // --- Issue 4: auto-inject DREAMGRAPH_INSTANCE_UUID from ~/.dreamgraph/.instances.json ---
    const instanceEnv = await resolveInstanceEnv(wsRoot);
    // --- Issue 3: spawn PowerShell directly to avoid cmd.exe quoting mangling ---
    const spawnArgs = buildSpawnArgs(command, cwd, instanceEnv);
    const start = Date.now();
    return new Promise((resolve) => {
        const proc = cp.spawn(spawnArgs.cmd, spawnArgs.args, spawnArgs.opts);
        let stdout = '';
        let stderr = '';
        let killed = false;
        const timer = setTimeout(() => {
            killed = true;
            try {
                proc.kill('SIGINT');
            }
            catch { /* ignore */ }
        }, timeoutMs);
        // Show progress notification in VS Code
        void vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Running: ${command}`, cancellable: true }, (_progress, token) => {
            token.onCancellationRequested(() => { killed = true; try {
                proc.kill('SIGINT');
            }
            catch { /* ignore */ } });
            return new Promise((res) => { proc.on('close', () => res()); proc.on('error', () => res()); });
        });
        proc.stdout?.setEncoding('utf8');
        proc.stderr?.setEncoding('utf8');
        proc.stdout?.on('data', (chunk) => { stdout += chunk; out.append(chunk); });
        proc.stderr?.on('data', (chunk) => { stderr += chunk; out.append(chunk); });
        proc.on('close', (code) => {
            clearTimeout(timer);
            const elapsed = Date.now() - start;
            const exitCode = code ?? (killed ? 137 : 1);
            const combined = (stdout + '\n' + stderr).trim();
            const relevant = extractRelevant(combined);
            out.appendLine(`\n--- exit ${exitCode} (${(elapsed / 1000).toFixed(1)}s) ---`);
            if (relevant.length > MAX_OUTPUT) {
                resolve(ok({ exitCode, relevant: relevant.slice(0, MAX_OUTPUT), timedOut: killed, command, cwd, durationMs: elapsed }));
            }
            else {
                resolve(ok({ exitCode, relevant, timedOut: killed, command, cwd, durationMs: elapsed }));
            }
        });
        proc.on('error', (err) => {
            clearTimeout(timer);
            resolve(fail(`spawn failed: ${err.message}`));
        });
    });
}
/* ------------------------------------------------------------------ */
/*  modify_entity                                                     */
/* ------------------------------------------------------------------ */
async function handleModifyEntity(input) {
    const filePath = String(input.filePath ?? '');
    const entityName = String(input.entity ?? '');
    const newContent = String(input.newContent ?? '');
    const parentEntity = input.parentEntity ? String(input.parentEntity) : undefined;
    if (!filePath || !entityName || !newContent) {
        return fail('filePath, entity, and newContent are all required');
    }
    const absPath = resolvePath(filePath);
    // Per-file mutex: serialise concurrent edits to the same file
    return withFileLock(absPath, async () => {
        const uri = vscode.Uri.file(absPath);
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            // Try VS Code symbol provider first (language-server-accurate)
            const symbols = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', uri);
            let target;
            if (symbols && symbols.length > 0) {
                target = findSymbol(symbols, entityName, parentEntity);
            }
            if (target) {
                // ── Large-entity safety guard ──
                // When replacing an entire class/interface (no parentEntity), check
                // whether the existing entity has many members. If so, the model
                // likely intended to edit a single member but replaced the whole
                // class, which drops unrelated code.
                if (!parentEntity) {
                    const existingText = doc.getText(target.range);
                    const existingMembers = countMembers(existingText);
                    const newMembers = countMembers(newContent);
                    if (existingMembers > LARGE_ENTITY_MEMBER_THRESHOLD &&
                        newMembers < existingMembers * 0.8) {
                        return fail(`Safety guard: "${entityName}" has ${existingMembers} members but the replacement ` +
                            `only contains ${newMembers}. This would drop unrelated code. Use parentEntity ` +
                            `to target the specific member you want to change, e.g. ` +
                            `{ "entity": "memberName", "parentEntity": "${entityName}" }.`);
                    }
                }
                // Symbol-based replacement
                const edit = new vscode.WorkspaceEdit();
                edit.replace(uri, target.range, newContent);
                const applied = await vscode.workspace.applyEdit(edit);
                if (!applied)
                    return fail('VS Code rejected the edit');
                await doc.save();
                return ok({
                    message: `Modified ${parentEntity ? parentEntity + '.' : ''}${entityName} in ${path.basename(absPath)} (${newContent.split('\n').length} lines)`,
                    filePath: absPath,
                    entity: entityName,
                    parentEntity,
                    method: 'symbol-provider',
                });
            }
            // Fallback: regex-based
            return await regexEntityReplace(doc, entityName, newContent, absPath);
        }
        catch (err) {
            return fail(`modify_entity failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
}
function findSymbol(symbols, name, parent) {
    if (parent) {
        for (const sym of symbols) {
            if (sym.name === parent) {
                for (const child of sym.children) {
                    if (child.name === name)
                        return child;
                }
            }
            const found = findSymbol(sym.children, name, parent);
            if (found)
                return found;
        }
        return undefined;
    }
    for (const sym of symbols) {
        if (sym.name === name)
            return sym;
        const found = findSymbol(sym.children, name);
        if (found)
            return found;
    }
    return undefined;
}
async function regexEntityReplace(doc, entityName, newContent, absPath) {
    const text = doc.getText();
    const esc = entityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        new RegExp(`^(export\\s+)?(async\\s+)?function\\s+${esc}\\s*[(<]`, 'm'),
        new RegExp(`^(export\\s+)?(default\\s+)?(abstract\\s+)?class\\s+${esc}[\\s{<]`, 'm'),
        new RegExp(`^(export\\s+)?interface\\s+${esc}[\\s{<]`, 'm'),
        new RegExp(`^(export\\s+)?type\\s+${esc}[\\s=<]`, 'm'),
        new RegExp(`^(export\\s+)?enum\\s+${esc}[\\s{]`, 'm'),
        new RegExp(`^(export\\s+)?(const|let|var)\\s+${esc}[\\s=:;]`, 'm'),
        new RegExp(`^\\s+(async\\s+)?(private\\s+|protected\\s+|public\\s+|static\\s+|readonly\\s+)*${esc}\\s*[(<]`, 'm'),
    ];
    for (const pattern of patterns) {
        const match = pattern.exec(text);
        if (!match)
            continue;
        const startOffset = match.index;
        const endOffset = findEntityEnd(text, startOffset);
        if (endOffset < 0)
            continue;
        const range = new vscode.Range(doc.positionAt(startOffset), doc.positionAt(endOffset));
        const edit = new vscode.WorkspaceEdit();
        edit.replace(doc.uri, range, newContent);
        const applied = await vscode.workspace.applyEdit(edit);
        if (!applied)
            return fail('VS Code rejected the edit');
        await doc.save();
        return ok({
            message: `Modified ${entityName} in ${path.basename(absPath)} (regex fallback, ${newContent.split('\n').length} lines)`,
            filePath: absPath,
            entity: entityName,
            method: 'regex-fallback',
        });
    }
    return fail(`Entity "${entityName}" not found in ${path.basename(absPath)}`);
}
/**
 * Brace/bracket-matching entity-end finder.
 * Handles strings, template literals, comments, and semicolon-only declarations.
 */
function findEntityEnd(text, startOffset) {
    let depth = 0;
    let inString = false;
    let stringChar = '';
    let inLineComment = false;
    let inBlockComment = false;
    let foundFirstBrace = false;
    for (let i = startOffset; i < text.length; i++) {
        const ch = text[i];
        const next = text[i + 1];
        if (inLineComment) {
            if (ch === '\n')
                inLineComment = false;
            continue;
        }
        if (inBlockComment) {
            if (ch === '*' && next === '/') {
                inBlockComment = false;
                i++;
            }
            continue;
        }
        if (inString) {
            if (ch === '\\') {
                i++;
                continue;
            }
            if (ch === stringChar)
                inString = false;
            continue;
        }
        if (ch === '/' && next === '/') {
            inLineComment = true;
            i++;
            continue;
        }
        if (ch === '/' && next === '*') {
            inBlockComment = true;
            i++;
            continue;
        }
        if (ch === '\'' || ch === '"' || ch === '`') {
            inString = true;
            stringChar = ch;
            continue;
        }
        if (ch === '{') {
            depth++;
            foundFirstBrace = true;
        }
        else if (ch === '}') {
            depth--;
            if (foundFirstBrace && depth === 0) {
                let end = i + 1;
                // Include trailing semicolon if present
                if (end < text.length && text[end] === ';')
                    end++;
                return end;
            }
        }
        // Simple declaration without braces — ends at semicolon
        if (!foundFirstBrace && ch === ';' && depth === 0 && i > startOffset + 3) {
            return i + 1;
        }
    }
    return -1;
}
/* ------------------------------------------------------------------ */
/*  write_file                                                        */
/* ------------------------------------------------------------------ */
/** Maximum bytes allowed for a single write_file call.
 *  Prevents the model from being asked to generate massive inline file content
 *  which causes output token exhaustion and silent hangs. ~300 KB is generous
 *  for any reasonable file; plans over this limit should be written in sections. */
const MAX_WRITE_BYTES = 300_000;
async function handleWriteFile(input) {
    const filePath = String(input.filePath ?? '');
    const content = String(input.content ?? '');
    if (!filePath)
        return fail('filePath is required');
    const encoded = Buffer.from(content, 'utf-8');
    if (encoded.length > MAX_WRITE_BYTES) {
        return fail(`write_file: content is ${encoded.length} bytes which exceeds the ${MAX_WRITE_BYTES}-byte limit. ` +
            `Split the file into sections and write each section separately, or reduce the content size.`);
    }
    const absPath = resolvePath(filePath);
    // Per-file mutex: serialise concurrent writes to the same file
    return withFileLock(absPath, async () => {
        // Create parent directories automatically
        const dir = path.dirname(absPath);
        await fs.mkdir(dir, { recursive: true });
        const uri = vscode.Uri.file(absPath);
        try {
            await vscode.workspace.fs.writeFile(uri, encoded);
            return ok({
                message: `Wrote ${path.basename(absPath)} (${content.split('\n').length} lines, ${encoded.length} bytes)`,
                filePath: absPath,
                lines: content.split('\n').length,
                bytes: encoded.length,
            });
        }
        catch (err) {
            return fail(`write_file failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    });
}
/* ------------------------------------------------------------------ */
/*  read_local_file                                                   */
/* ------------------------------------------------------------------ */
async function handleReadFile(input) {
    const filePath = String(input.filePath ?? '');
    if (!filePath)
        return fail('filePath is required');
    const absPath = resolvePath(filePath);
    const uri = vscode.Uri.file(absPath);
    try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const text = Buffer.from(bytes).toString('utf-8');
        const lines = text.split('\n');
        const start = input.startLine ? Math.max(1, Number(input.startLine)) : 1;
        const end = input.endLine ? Math.min(lines.length, Number(input.endLine)) : lines.length;
        const slice = lines.slice(start - 1, end);
        let result = slice.join('\n');
        if (result.length > MAX_OUTPUT) {
            result = result.slice(0, MAX_OUTPUT) + `\n…[truncated, ${result.length} chars]`;
        }
        return ok({
            filePath: absPath,
            totalLines: lines.length,
            range: `${start}-${end}`,
            content: result,
        });
    }
    catch (err) {
        return fail(`read_local_file failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}
/* ------------------------------------------------------------------ */
/*  Dispatcher                                                        */
/* ------------------------------------------------------------------ */
async function executeLocalTool(name, input) {
    switch (name) {
        case 'run_command': return handleRunCommand(input);
        case 'modify_entity': return handleModifyEntity(input);
        case 'write_file': return handleWriteFile(input);
        case 'read_local_file': return handleReadFile(input);
        default: return fail(`Unknown local tool: ${name}`);
    }
}
/* ------------------------------------------------------------------ */
/*  Manual palette commands (dreamgraph.runCommand, dreamgraph.runBuild) */
/* ------------------------------------------------------------------ */
function registerRunnerCommands(ctx) {
    // dreamgraph.runCommand — prompt for arbitrary shell command
    ctx.subscriptions.push(vscode.commands.registerCommand('dreamgraph.runCommand', async () => {
        const command = await vscode.window.showInputBox({
            prompt: 'Shell command to run in workspace',
            placeHolder: 'e.g. npm run build',
        });
        if (!command)
            return;
        const result = await handleRunCommand({ command });
        const parsed = JSON.parse(result);
        if (parsed.exitCode === 0) {
            void vscode.window.showInformationMessage(`✓ Command finished (exit 0)`);
        }
        else {
            void vscode.window.showWarningMessage(`Command exited with code ${parsed.exitCode}`);
        }
        getOutput().show(true);
    }));
    // dreamgraph.runBuild — pick an npm script from package.json
    ctx.subscriptions.push(vscode.commands.registerCommand('dreamgraph.runBuild', async () => {
        const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!wsRoot) {
            void vscode.window.showErrorMessage('No workspace open');
            return;
        }
        // Scan for package.json scripts
        let scripts = [];
        try {
            const pkgPath = path.join(wsRoot, 'package.json');
            const raw = await fs.readFile(pkgPath, 'utf-8');
            const pkg = JSON.parse(raw);
            if (pkg.scripts && typeof pkg.scripts === 'object') {
                scripts = Object.keys(pkg.scripts);
            }
        }
        catch { /* no package.json or not parseable */ }
        // Also check extensions/vscode/package.json
        try {
            const extPkgPath = path.join(wsRoot, 'extensions', 'vscode', 'package.json');
            const raw = await fs.readFile(extPkgPath, 'utf-8');
            const pkg = JSON.parse(raw);
            if (pkg.scripts && typeof pkg.scripts === 'object') {
                scripts.push(...Object.keys(pkg.scripts).map(s => `ext:${s}`));
            }
        }
        catch { /* no ext package.json */ }
        if (scripts.length === 0) {
            void vscode.window.showWarningMessage('No npm scripts found');
            return;
        }
        const picked = await vscode.window.showQuickPick(scripts, {
            placeHolder: 'Select a build script to run',
        });
        if (!picked)
            return;
        let command;
        let cwd;
        if (picked.startsWith('ext:')) {
            command = `npm run ${picked.slice(4)}`;
            cwd = path.join(wsRoot, 'extensions', 'vscode');
        }
        else {
            command = `npm run ${picked}`;
        }
        const result = await handleRunCommand({ command, cwd });
        const parsed = JSON.parse(result);
        if (parsed.exitCode === 0) {
            void vscode.window.showInformationMessage(`✓ Build "${picked}" succeeded`);
        }
        else {
            void vscode.window.showWarningMessage(`Build "${picked}" exited with code ${parsed.exitCode}`);
        }
        getOutput().show(true);
    }));
}
//# sourceMappingURL=local-tools.js.map