#!/usr/bin/env bash
set -euo pipefail

# ===================================================================
# DreamGraph Global Installer (Linux / macOS)
#
# Builds the project, deploys compiled files to ~/.dreamgraph/bin/,
# installs production dependencies, creates wrapper scripts on PATH,
# and attempts a verified VS Code extension install when possible.
#
# Fail-safe behavior:
# - hard-fail on core DreamGraph install errors
# - degrade gracefully on optional VS Code extension install errors
# - never claim extension installation success without verification
# ===================================================================

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

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

step()  { echo -e "\n${CYAN}${BOLD}$*${NC}"; }
ok()    { echo -e "  ${GREEN}$* [ok]${NC}"; }
warn()  { echo -e "  ${YELLOW}[!] $*${NC}"; }
fail()  { echo -e "${RED}Error: $*${NC}" >&2; exit 1; }

run_logged() {
    local allow_failure="false"
    local quiet="false"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --allow-failure) allow_failure="true"; shift ;;
            --quiet) quiet="true"; shift ;;
            --) shift; break ;;
            *) break ;;
        esac
    done

    local output
    local exit_code=0
    output=$("$@" 2>&1) || exit_code=$?

    if [[ "$quiet" != "true" ]] && [[ -n "$output" ]]; then
        while IFS= read -r line; do
            [[ -n "$line" ]] && printf '  %s\n' "$line"
        done <<< "$output"
    fi

    if [[ "$allow_failure" != "true" ]] && [[ $exit_code -ne 0 ]]; then
        fail "$* failed with exit code $exit_code"
    fi

    RUN_LOGGED_EXIT_CODE=$exit_code
    RUN_LOGGED_OUTPUT="$output"
    return 0
}

ensure_root_build_dependencies() {
    local needs_install=false

    if [[ ! -d "$SOURCE_DIR/node_modules" ]]; then
        needs_install=true
    elif [[ ! -d "$SOURCE_DIR/node_modules/typescript" ]]; then
        needs_install=true
    elif [[ ! -d "$SOURCE_DIR/node_modules/@types/node" ]]; then
        needs_install=true
    elif [[ ! -d "$SOURCE_DIR/node_modules/zod" ]]; then
        needs_install=true
    elif [[ ! -d "$SOURCE_DIR/node_modules/@modelcontextprotocol" ]]; then
        needs_install=true
    fi

    if [[ "$needs_install" == "true" ]]; then
        echo -e "  ${CYAN}Installing root dependencies (including dev dependencies for build)...${NC}"
        (
            cd "$SOURCE_DIR"
            run_logged -- npm install --include=dev --loglevel=warn
        )
        ok "Root dependencies installed"
    fi
}

resolve_vscode_cli() {
    if command -v code.cmd >/dev/null 2>&1; then
        command -v code.cmd
        return 0
    fi
    if command -v code >/dev/null 2>&1; then
        command -v code
        return 0
    fi
    if [[ -x "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" ]]; then
        echo "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
        return 0
    fi
    if [[ -x "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code" ]]; then
        echo "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code"
        return 0
    fi
    return 1
}

can_build_vscode_extension() {
    [[ -d "$SOURCE_DIR/extensions/vscode" ]]
}

ensure_extension_build_dependencies() {
    local ext_source="$SOURCE_DIR/extensions/vscode"
    if [[ ! -d "$ext_source/node_modules/typescript" ]] || [[ ! -d "$ext_source/node_modules/esbuild" ]] || [[ ! -d "$ext_source/node_modules/@vscode/vsce" ]]; then
        echo -e "  ${CYAN}Installing VS Code extension build dependencies...${NC}"
        (
            cd "$ext_source"
            run_logged -- npm install --loglevel=warn
        )
        ok "VS Code extension build dependencies installed"
    fi
}

remove_legacy_vscode_extension_artifacts() {
    local extension_id="$1"
    local legacy_version="$2"
    local roots=("$HOME/.vscode/extensions" "$HOME/.vscode-insiders/extensions")

    for extensions_root in "${roots[@]}"; do
        [[ -d "$extensions_root" ]] || continue
        shopt -s nullglob
        local matches=("$extensions_root/${extension_id}-${legacy_version}"*)
        shopt -u nullglob

        for dir in "${matches[@]}"; do
            if [[ -d "$dir" ]]; then
                rm -rf "$dir"
                ok "Removed legacy extension folder $(basename "$dir")"
            fi
        done
    done
}

test_vscode_extension_installed() {
    local code_cli="$1"
    local extension_id="$2"
    local version="$3"

    run_logged --allow-failure --quiet -- "$code_cli" --list-extensions --show-versions
    if [[ $RUN_LOGGED_EXIT_CODE -ne 0 ]]; then
        return 1
    fi

    grep -q "^${extension_id}@${version}$" <<< "$RUN_LOGGED_OUTPUT"
}

install_vscode_extension_safely() {
    local code_cli="$1"
    local vsix_path="$2"
    local extension_id="$3"
    local version="$4"

    run_logged --allow-failure --quiet -- "$code_cli" --uninstall-extension "$extension_id" --force || true
    run_logged --allow-failure -- "$code_cli" --install-extension "$vsix_path" --force
    if [[ $RUN_LOGGED_EXIT_CODE -ne 0 ]]; then
        return 1
    fi

    test_vscode_extension_installed "$code_cli" "$extension_id" "$version"
}

step "Checking prerequisites..."

NODE_VERSION=$(node --version 2>/dev/null || true)
[[ -z "$NODE_VERSION" ]] && fail "Node.js is required but not found. Install from https://nodejs.org/"
MAJOR=$(echo "$NODE_VERSION" | sed 's/^v\([0-9]*\)\..*/\1/')
[[ "$MAJOR" -lt 18 ]] && fail "Node.js >= 18 required (found $NODE_VERSION)"
ok "Node.js $NODE_VERSION"

NPM_VERSION=$(npm --version 2>/dev/null || true)
[[ -z "$NPM_VERSION" ]] && fail "npm is required but not found."
ok "npm $NPM_VERSION"

PACKAGE_JSON="$SOURCE_DIR/package.json"
[[ ! -f "$PACKAGE_JSON" ]] && fail "No package.json at $SOURCE_DIR. Is this the DreamGraph repo?"

PKG_NAME=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$PACKAGE_JSON','utf8')).name)")
[[ "$PKG_NAME" != "dreamgraph" ]] && fail "Not a DreamGraph repo (name: $PKG_NAME)"

VERSION=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$PACKAGE_JSON','utf8')).version)")
ok "DreamGraph v$VERSION source at $SOURCE_DIR"

if [[ -d "$DIST_TARGET" ]] && [[ "$FORCE" != "true" ]]; then
    EXISTING="unknown"
    if [[ -f "$BIN_DIR/version.json" ]]; then
        EXISTING=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$BIN_DIR/version.json','utf8')).version)")
    fi
    warn "Existing installation found (v$EXISTING)"
    read -rp "  Overwrite? [y/N] " confirm
    [[ "$confirm" != "y" && "$confirm" != "Y" ]] && { echo "Aborted."; exit 0; }
fi

step "Building DreamGraph..."
ensure_root_build_dependencies
(
    cd "$SOURCE_DIR"
    run_logged -- npm run build
)
ok "Build complete"

SOURCE_DIST="$SOURCE_DIR/dist"
[[ ! -d "$SOURCE_DIST" ]] && fail "dist/ not found after build"

step "Deploying to $BIN_DIR..."
mkdir -p "$BIN_DIR"
[[ -d "$DIST_TARGET" ]] && rm -rf "$DIST_TARGET"
cp -r "$SOURCE_DIST" "$DIST_TARGET"
ok "dist/ copied"

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

echo -e "  ${CYAN}Installing dependencies...${NC}"
[[ -d "$BIN_DIR/node_modules" ]] && rm -rf "$BIN_DIR/node_modules"
(
    cd "$BIN_DIR"
    run_logged -- npm install --omit=dev --loglevel=warn
)
ok "Dependencies installed"

if [[ -d "$SOURCE_DIR/templates" ]]; then
    COPY_TEMPLATES=true
    if [[ -d "$TEMPLATE_TARGET" ]]; then
        if [[ "$FORCE" == "true" ]]; then
            rm -rf "$TEMPLATE_TARGET"
        else
            warn "Existing global templates found at $TEMPLATE_TARGET"
            read -rp "  Overwrite templates? [y/N] " template_confirm
            if [[ "$template_confirm" == "y" || "$template_confirm" == "Y" ]]; then
                rm -rf "$TEMPLATE_TARGET"
            else
                COPY_TEMPLATES=false
                echo "  Keeping existing templates"
            fi
        fi
    fi

    if [[ "$COPY_TEMPLATES" == "true" ]]; then
        cp -r "$SOURCE_DIR/templates" "$TEMPLATE_TARGET"
        ok "Templates copied"
    fi
fi

if can_build_vscode_extension; then
    step "Installing VS Code extension..."
    EXT_SOURCE="$SOURCE_DIR/extensions/vscode"
    EXT_PKG="$EXT_SOURCE/package.json"
    CODE_CLI="$(resolve_vscode_cli || true)"

    if [[ ! -f "$EXT_PKG" ]]; then
        warn "Extension source not found at $EXT_SOURCE -- skipping"
    elif [[ -z "$CODE_CLI" ]]; then
        warn "VS Code CLI not found (tried PATH and standard app locations) -- skipping extension install"
    else
        EXT_PUBLISHER=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$EXT_PKG','utf8')).publisher)")
        EXT_NAME=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$EXT_PKG','utf8')).name)")
        EXT_VER=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$EXT_PKG','utf8')).version)")
        EXTENSION_ID="${EXT_PUBLISHER}.${EXT_NAME}"
        LEGACY_EXTENSION_VERSION="7"
        VSIX_PATH="$EXT_SOURCE/${EXT_NAME}-${EXT_VER}.vsix"

        ensure_extension_build_dependencies
        (
            cd "$EXT_SOURCE"
            run_logged --allow-failure -- npm run build
        )
        if [[ $RUN_LOGGED_EXIT_CODE -ne 0 ]]; then
            warn "Extension build failed -- skipping VS Code extension install"
        else
            ok "Extension built"
            rm -f "$VSIX_PATH"
            (
                cd "$EXT_SOURCE"
                run_logged --allow-failure -- npx --yes @vscode/vsce package --out "$VSIX_PATH"
            )
            if [[ $RUN_LOGGED_EXIT_CODE -ne 0 ]] || [[ ! -f "$VSIX_PATH" ]]; then
                warn "Extension packaging failed -- skipping VS Code extension install"
            else
                ok "Packaged extension to $(basename "$VSIX_PATH")"
                remove_legacy_vscode_extension_artifacts "$EXTENSION_ID" "$LEGACY_EXTENSION_VERSION"

                if install_vscode_extension_safely "$CODE_CLI" "$VSIX_PATH" "$EXTENSION_ID" "$EXT_VER"; then
                    ok "Installed ${EXTENSION_ID}@${EXT_VER}"
                    warn "Reload VS Code to activate the extension"
                else
                    warn "VS Code extension installation could not be verified; VSIX was built at $VSIX_PATH"
                fi
            fi
        fi
    fi
else
    echo "  Extension source unavailable -- skipping extension build/install"
fi

node -e "
  require('fs').writeFileSync('$BIN_DIR/version.json', JSON.stringify({
    version: '$VERSION',
    installed_at: new Date().toISOString(),
    source: '$SOURCE_DIR',
    node_version: '$NODE_VERSION'
  }, null, 2));
"

step "Creating command shims..."
LINK_DIR=""
if mkdir -p "/usr/local/bin" 2>/dev/null && [[ -w "/usr/local/bin" ]]; then
    LINK_DIR="/usr/local/bin"
else
    while IFS=':' read -r path_entry; do
        [[ -z "$path_entry" ]] && continue
        [[ "$path_entry" == "$HOME/.local/bin" ]] && continue
        if [[ -d "$path_entry" ]] && [[ -w "$path_entry" ]]; then
            LINK_DIR="$path_entry"
            break
        fi
    done <<< "$PATH"
fi
if [[ -z "$LINK_DIR" ]]; then
    LINK_DIR="$HOME/.local/bin"
fi
mkdir -p "$LINK_DIR"

if [[ -n "${DREAMGRAPH_MASTER_DIR:-}" ]]; then
    SHIM_BIN_DIR="\${DREAMGRAPH_MASTER_DIR:-$DG_HOME}/bin"
else
    SHIM_BIN_DIR="$DG_HOME/bin"
fi

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

if [[ ! -x "$LINK_DIR/dg" ]] || [[ ! -x "$LINK_DIR/dreamgraph" ]]; then
    fail "Failed to create executable command shims in $LINK_DIR"
fi

if ! echo "$PATH" | tr ':' '\n' | grep -qx "$LINK_DIR"; then
    warn "$LINK_DIR is not in your PATH"

    SHELL_NAME=$(basename "${SHELL:-bash}")
    case "$SHELL_NAME" in
        zsh)  RC_FILE="$HOME/.zshrc" ;;
        fish) RC_FILE="$HOME/.config/fish/config.fish" ;;
        *)    RC_FILE="$HOME/.bashrc" ;;
    esac

    mkdir -p "$(dirname "$RC_FILE")"
    [[ -f "$RC_FILE" ]] || touch "$RC_FILE"

    PATH_LINE="export PATH=\"$LINK_DIR:\$PATH\""
    FISH_PATH_LINE="fish_add_path \"$LINK_DIR\""

    if [[ "$SHELL_NAME" == "fish" ]]; then
        if ! grep -Fqx "$FISH_PATH_LINE" "$RC_FILE" 2>/dev/null; then
            printf '\n# Added by DreamGraph installer\n%s\n' "$FISH_PATH_LINE" >> "$RC_FILE"
            ok "Added $LINK_DIR to PATH in $RC_FILE"
        else
            ok "$RC_FILE already adds $LINK_DIR to PATH"
        fi
    else
        if ! grep -Fqx "$PATH_LINE" "$RC_FILE" 2>/dev/null; then
            printf '\n# Added by DreamGraph installer\n%s\n' "$PATH_LINE" >> "$RC_FILE"
            ok "Added $LINK_DIR to PATH in $RC_FILE"
        else
            ok "$RC_FILE already adds $LINK_DIR to PATH"
        fi
    fi

    warn "Restart your shell or run: export PATH=\"$LINK_DIR:\$PATH\""
fi

step "Verifying installation..."
OUTPUT=$(node "$DIST_TARGET/cli/dg.js" --version 2>&1 || true)
ok "$OUTPUT"

echo ""
echo -e "${GREEN}${BOLD}===============================================${NC}"
echo -e "${GREEN}${BOLD} DreamGraph v$VERSION installed successfully!${NC}"
echo -e "${GREEN}${BOLD}===============================================${NC}"
echo ""
echo " Binary:  $BIN_DIR"
echo " Links:   $LINK_DIR/dg, $LINK_DIR/dreamgraph"
echo " Run:     dg --help"
echo " Start:   dg start <instance-name> --http"
echo ""
echo -e "${YELLOW} Reminder: restart any running DreamGraph and VS Code instances to load the updated installation.${NC}"
echo ""
