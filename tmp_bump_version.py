from pathlib import Path
files = [
    Path('package.json'),
    Path('INSTALL.md'),
    Path('SECURITY.md'),
    Path('src/cli/dg.ts'),
    Path('extensions/vscode/README.md'),
    Path('extensions/vscode/prompts/architect_core.md'),
    Path('extensions/vscode/src/prompts/architect-core.ts'),
    Path('extensions/vscode/package.json'),
    Path('extensions/vscode/package-lock.json'),
    Path('docs/README.md'),
    Path('docs/features/security-policy.md'),
    Path('scripts/_mcp_init.json'),
    Path('scripts/_mcp_root.txt'),
]
repls = [
    ('DreamGraph CLI v7.0.0 (El Alarife)', 'DreamGraph CLI v7.1.0 (El Alarife)'),
    ('DreamGraph CLI — Instance Management (v7.0 El Alarife)', 'DreamGraph CLI — Instance Management (v7.1 El Alarife)'),
    ('DreamGraph MCP Server v7.0.0', 'DreamGraph MCP Server v7.1.0'),
    ('DreamGraph v7.0.0', 'DreamGraph v7.1.0'),
    ('Status: v7.0.0', 'Status: v7.1.0'),
    ('SafeSkill v7.0.0 scan', 'SafeSkill v7.1.0 scan'),
    ('"version": "7.0.0"', '"version": "7.1.0"'),
    ('v7.0.0 release', 'v7.1.0 release'),
    ('| v7.0.0 "El Alarife" | ✅ Active |', '| v7.1.0 "El Alarife" | ✅ Active |'),
    ('| < v7.0.0 | ❌ Not supported |', '| < v7.1.0 | ❌ Not supported |'),
    ('v7.0.0', 'v7.1.0'),
]
changed = []
for path in files:
    text = path.read_text(encoding='utf-8')
    orig = text
    for a, b in repls:
        text = text.replace(a, b)
    if text != orig:
        path.write_text(text, encoding='utf-8')
        changed.append(str(path))
for item in changed:
    print(item)
