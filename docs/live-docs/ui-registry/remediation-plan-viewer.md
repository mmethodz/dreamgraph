# Remediation Plan Viewer

> Render generated remediation plans with ordered steps, risk notes, and verification guidance for a selected tension or issue.

**ID:** `remediation_plan_viewer`  
**Category:** composite  

## Data Contract

### Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| plan | `object` | ✅ | Structured remediation plan including steps, risks, and verification criteria. |

### Outputs

| Name | Type | Trigger | Description |
|------|------|---------|-------------|
| step_selected | `string` | on_click | Emits selected remediation step identifier. |
| verification_requested | `string` | on_click | Requests verification guidance for a plan item. |

## Interactions

- **expand_step** — Reveal full details for a remediation step.
- **review_risks** — Inspect accepted risks and guard rails.
- **trigger_verification** — Open or request verification instructions for the selected step.

## Platform Implementations

| Platform | Component | Source File | Notes |
|----------|-----------|-------------|-------|
| react | `RemediationPlanViewer` | - | Registered semantically for future extension/dashboard integration. |

**Used by features:** dashboard_view

**Tags:** remediation, planning, tensions
