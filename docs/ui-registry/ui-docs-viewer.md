# Docs Viewer

> Browse DreamGraph documentation and render individual markdown documents inside the canonical dashboard docs surface, preserving abstract reader and navigation semantics independent of framework styling.

**ID:** `ui_docs_viewer`  
**Category:** composite  
**Status:** active  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| doc_index | `array<object>` | ✅ | Available docs entries with titles, slugs, and file references. |
| doc_content | `string` | ❌ | Markdown or rendered content for the selected document. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| select_doc | `string` | on_click | Slug of the documentation page selected by the user. |

## Interactions

- **browse_docs** — Choose a document from the dashboard docs index.
- **read_doc** — View the rendered markdown for the selected document.

## Visual Semantics

- **Role:** inspector
- **Emphasis:** secondary
- **Density:** comfortable
- **Chrome:** embedded

### State Styling

- **index_browsing** — Keep the navigation list visually subordinate to the reading surface.
- **document_open** — Promote readable content hierarchy with calm chrome and clear heading emphasis.
- **missing_document** — Switch to warning emphasis while preserving reader context and navigation access.

## Layout Semantics

- **Pattern:** split_view
- **Alignment:** leading
- **Sizing behavior:** fill_parent
- **Responsive behavior:** collapse, scroll

### Layout Hierarchy

- **doc_index** — secondary
- **doc_content** — primary

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| html | `Server markdown docs browser` | src/server/dashboard.ts | Backed by /docs and /docs/:slug route handlers that read docs/ markdown files and render them in the dashboard shell. |

**Used by features:** feature_dashboard_server, docs_viewer, feature_ui_registry

**Tags:** docs, markdown, dashboard, viewer, canonical, visual-meta-v3
