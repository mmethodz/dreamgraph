#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════════
# DreamGraph Global Installer (Linux / macOS)
#
# Builds the project, deploys compiled files to ~/.dreamgraph/bin/,
# installs production dependencies, and creates wrapper scripts
# on PATH.
#
# Usage:
#   ./scripts/install.sh [--source <dir>] [--force]
#
# After installation, `dg` and `dreamgraph` are available from any
# terminal session.
# ═══════════════════════════════════════════════════════════════════

# ── Defaults ────────────────────────────────────────────────────────
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORCE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --source)  SOURCE_DIR="$2"; shift 2 ;;
        --force)   FORCE=true; shift ;;
        --help|-h)
            echo "Usage: install.sh [--source <dir>] [--force]"
            echo ""
            echo "Options:"
            echo "  --source <dir>   Path to DreamGraph source repo (default: parent of scripts/)"
            echo "  --force          Overwrite existing installation without prompting"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

DG_HOME="${DREAMGRAPH_MASTER_DIR:-$HOME/.dreamgraph}"
BIN_DIR="$DG_HOME/bin"
DIST_TARGET="$BIN_DIR/dist"
TEMPLATE_TARGET="$DG_HOME/templates"

# ── Colors ───────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

step()  { echo -e "\n${CYAN}${BOLD}$*${NC}"; }
ok()    { echo -e "  ${GREEN}$* ✓${NC}"; }
warn()  { echo -e "  ${YELLOW}⚠ $*${NC}"; }
fail()  { echo -e "${RED}Error: $*${NC}" >&2; exit 1; }

# ── Prerequisites ───────────────────────────────────────────────────
step "Checking prerequisites..."

NODE_VERSION=$(node --version 2>/dev/null || true)
[[ -z "$NODE_VERSION" ]] && fail "Node.js is required but not found. Install from https://nodejs.org/"
MAJOR=$(echo "$NODE_VERSION" | sed 's/^v\([0-9]*\)\..*/\1/')
[[ "$MAJOR" -lt 18 ]] && fail "Node.js >= 18 required (found $NODE_VERSION)"
ok "Node.js $NODE_VERSION"

NPM_VERSION=$(npm --version 2>/dev/null || true)
[[ -z "$NPM_VERSION" ]] && fail "npm is required but not found."
ok "npm $NPM_VERSION"

# ── Validate source ────────────────────────────────────────────────
PACKAGE_JSON="$SOURCE_DIR/package.json"
[[ ! -f "$PACKAGE_JSON" ]] && fail "No package.json at $SOURCE_DIR. Is this the DreamGraph repo?"

PKG_NAME=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$PACKAGE_JSON','utf8')).name)")
[[ "$PKG_NAME" != "dreamgraph" ]] && fail "Not a DreamGraph repo (name: $PKG_NAME)"

VERSION=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$PACKAGE_JSON','utf8')).version)")
ok "DreamGraph v$VERSION source at $SOURCE_DIR"

# ── Check existing install ─────────────────────────────────────────
if [[ -d "$DIST_TARGET" ]] && [[ "$FORCE" != "true" ]]; then
    EXISTING="unknown"
    if [[ -f "$BIN_DIR/version.json" ]]; then
        EXISTING=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$BIN_DIR/version.json','utf8')).version)")
    fi
    warn "Existing installation found (v$EXISTING)"
    read -rp "  Overwrite? [y/N] " confirm
    [[ "$confirm" != "y" && "$confirm" != "Y" ]] && { echo "Aborted."; exit 0; }
fi

# ── Build ──────────────────────────────────────────────────────────
step "Building DreamGraph..."
(cd "$SOURCE_DIR" && npm run build)
ok "Build complete"

SOURCE_DIST="$SOURCE_DIR/dist"
[[ ! -d "$SOURCE_DIST" ]] && fail "dist/ not found after build"

# ── Deploy ─────────────────────────────────────────────────────────
step "Deploying to $BIN_DIR..."

mkdir -p "$BIN_DIR"

# Remove old dist if present
[[ -d "$DIST_TARGET" ]] && rm -rf "$DIST_TARGET"

# Copy dist
cp -r "$SOURCE_DIST" "$DIST_TARGET"
ok "dist/ copied"

# Create minimal package.json with production deps only
node -e "
  const pkg = JSON.parse(require('fs').readFileSync('$PACKAGE_JSON', 'utf8'));
  const binPkg = {
    name: 'dreamgraph-global',
    version: pkg.version,
    type: 'module',
    dependencies: pkg.dependencies || {}
  };
  require('fs').writeFileSync(
    '$BIN_DIR/package.json',
    JSON.stringify(binPkg, null, 2)
  );
"
ok "package.json created"

# Install production deps (clean first to avoid hoisting artifacts)
echo -e "  ${CYAN}Installing dependencies...${NC}"
[[ -d "$BIN_DIR/node_modules" ]] && rm -rf "$BIN_DIR/node_modules"
(cd "$BIN_DIR" && npm install --omit=dev --loglevel=warn 2>&1 | tail -1)
ok "Dependencies installed"

# ── Templates ─────────────────────────────────────────────────────
if [[ -d "$SOURCE_DIR/templates" ]]; then
    if [[ ! -d "$TEMPLATE_TARGET" ]]; then
        cp -r "$SOURCE_DIR/templates" "$TEMPLATE_TARGET"
        ok "Templates copied"
    else
        echo "  Templates already exist, skipping"
    fi
fi

# ── Version file ───────────────────────────────────────────────────
node -e "
  require('fs').writeFileSync('$BIN_DIR/version.json', JSON.stringify({
    version: '$VERSION',
    installed_at: new Date().toISOString(),
    source: '$SOURCE_DIR',
    node_version: '$NODE_VERSION'
  }, null, 2));
"

# ── Symlinks / Shims ─────────────────────────────────────────────
step "Creating command shims..."

# Determine link target directory (prefer /usr/local/bin if writable)
LINK_DIR="$HOME/.local/bin"
if [[ -d "/usr/local/bin" ]] && [[ -w "/usr/local/bin" ]]; then
    LINK_DIR="/usr/local/bin"
fi
mkdir -p "$LINK_DIR"

# Resolve DG_HOME for shim scripts — use env var if set, else hardcode home path
if [[ -n "${DREAMGRAPH_MASTER_DIR:-}" ]]; then
    SHIM_BIN_DIR="\${DREAMGRAPH_MASTER_DIR:-$DG_HOME}/bin"
else
    SHIM_BIN_DIR="$DG_HOME/bin"
fi

# Create wrapper scripts (more reliable than symlinks for Node.js ESM)
cat > "$LINK_DIR/dg" << EOF
#!/usr/bin/env bash
exec node "$SHIM_BIN_DIR/dist/cli/dg.js" "\$@"
EOF
chmod +x "$LINK_DIR/dg"

cat > "$LINK_DIR/dreamgraph" << EOF
#!/usr/bin/env bash
exec node "$SHIM_BIN_DIR/dist/index.js" "\$@"
EOF
chmod +x "$LINK_DIR/dreamgraph"

ok "Shims created in $LINK_DIR"

# Check if LINK_DIR is in PATH
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$LINK_DIR"; then
    warn "$LINK_DIR is not in your PATH"
    # Detect shell and suggest appropriate rc file
    SHELL_NAME=$(basename "${SHELL:-bash}")
    case "$SHELL_NAME" in
        zsh)  RC_FILE="~/.zshrc" ;;
        fish) RC_FILE="~/.config/fish/config.fish" ;;
        *)    RC_FILE="~/.bashrc" ;;
    esac
    echo "  Add to your $RC_FILE:"
    echo "    export PATH=\"$LINK_DIR:\$PATH\""
fi

# ── Verify ─────────────────────────────────────────────────────────
step "Verifying installation..."
OUTPUT=$(node "$DIST_TARGET/cli/dg.js" --version 2>&1 || true)
ok "$OUTPUT"

# ── Summary ─────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}═══════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD} DreamGraph v$VERSION installed successfully!${NC}"
echo -e "${GREEN}${BOLD}═══════════════════════════════════════════════${NC}"
echo ""
echo " Binary:  $BIN_DIR"
echo " Links:   $LINK_DIR/dg, $LINK_DIR/dreamgraph"
echo " Run:     dg --help"
echo " Start:   dg start <instance-name> --http"
echo ""
