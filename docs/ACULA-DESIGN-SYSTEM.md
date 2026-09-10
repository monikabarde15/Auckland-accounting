# ACULA Design System Documentation

> Auckland Accounting Services Ltd — Automated Outbound Calling & IVR Platform

---

## 1. Design Direction & Philosophy

ACULA is a focused, authoritative B2B SaaS operations platform built for a professional accounting practice in Auckland, New Zealand. 

The visual language emphasizes:
- **Restraint**: Information density over decorative whitespace.
- **Clarity**: Tables and structured lists over oversized card grids.
- **Authoritative Palette**: Deep Auckland navy (`#0f2e4a`), neutral surfaces, and restrained status accents.
- **Discipline**: Single primary CTA per view, no gratuitous gradients, no floating card shadows.

---

## 2. Color Palette & Tokens

| Semantic Role | Token Name | Hex Value | Usage |
|---|---|---|---|
| **Brand Primary** | `--color-brand` | `#0f2e4a` | Sidebar header, primary buttons, focus rings |
| **Brand Hover** | `--color-brand-hover` | `#163e63` | Hover states for primary actions |
| **App Background** | `--color-app-bg` | `#f8f9fb` | Neutral background for the workspace |
| **Surface** | `--color-surface` | `#ffffff` | Content cards, tables, modals |
| **Surface Secondary** | `--color-surface-secondary`| `#f4f6f9` | Table headers, secondary blocks |
| **Borders** | `--color-border` | `#e2e5ea` | Standard container and divider borders |
| **Text Primary** | `--color-text-primary` | `#1a1d23` | Headings, primary cell values |
| **Text Secondary** | `--color-text-secondary` | `#5f6672` | Subtitles, secondary descriptions |
| **Success** | `--color-success` | `#16a34a` | Running campaigns, completed calls, valid flow |
| **Warning** | `--color-warning` | `#d97706` | Paused campaigns, busy lines |
| **Danger** | `--color-danger` | `#dc2626` | DNC suppression, failed calls, destructive actions |
| **Info / Accent** | `--color-info` | `#2563eb` | Links, active tab indicators, transferred calls |

---

## 3. Typography Scale

- **Page Title**: `text-lg font-semibold` (18px) — Used in `<PageHeader>`
- **Section Heading**: `text-sm font-semibold` (14px) — Table and card headers
- **Body & Data**: `text-xs` / `text-sm` (12px - 14px) — Table cells, descriptions, inputs
- **Metadata & Subtext**: `text-[11px]` / `text-[10px]` — Timestamps, badges, secondary notes
- **Monospace**: `font-mono text-xs` — Phone numbers (E.164), IRD numbers, SID identifiers, timestamps

---

## 4. Component Primitives (`src/components/ui/`)

1. **`Button`**: `primary` (Navy), `secondary`, `outline`, `ghost`, `danger`. Sizing: `xs`, `sm`, `md`, `lg`. Supports loading state.
2. **`Badge`**: Status indicators (`neutral`, `success`, `warning`, `danger`, `info`, `brand`) with optional status dot.
3. **`Card`**: Standardized white container with `border border-slate-200` and `rounded-lg`.
4. **`Input`**: Form input with label, error, helper text, and left/right icon slots.
5. **`Table`**: Semantic data table system (`Table`, `TableHeader`, `TableBody`, `TableRow`, `TableCell`, `TableHeaderCell`).
6. **`Modal`**: Accessible dialog box with backdrop, title, description, body, and footer slots.
7. **`Drawer`**: Slide-over panel for inspecting call details and configuring question flow steps.
8. **`DropdownMenu`**: Contextual row actions menu (`⋮`) with click-outside detection.
9. **`Tabs`**: Clean underline tab navigation for view filtering.
10. **`EmptyState`**: Empty state feedback with icon, title, description, and action button.
11. **`ConfirmDialog`**: Confirmation modal for state transitions and deletions.
12. **`MetricRow`**: Compact horizontal statistics banner replacing oversized KPI card grids.
13. **`PageHeader`**: Unified page title, description, and primary action container.

---

## 5. Information Architecture & Navigation

```
[ACULA Workspace]
├── Operations
│   ├── Dashboard (/dashboard) — Operational status, active sessions, recent calls
│   ├── Campaigns (/campaigns) — Outbound schedules, lifecycle management, pre-launch check
│   ├── Questionnaires (/questions) — Split-panel IVR step editor & branching logic
│   └── Call Records (/calls) — Telephony logs, transcript timeline & audio playback
│
├── Contacts
│   ├── Directory (/contacts) — Practice client table, E.164 normalization, DNC status
│   ├── Groups (/contacts/groups) — Audience segmentation for campaigns
│   └── DNC Registry (/contacts/dnc) — Do-Not-Call suppression compliance list
│
├── Insights
│   ├── Reports (/reports) — Hourly connection rates, outcomes, GST reconciliation stats
│   └── Audit Trail (/audit-logs) — Immutable security and compliance event records
│
└── Administration
    ├── Practice Settings (/settings) — Calling window compliance (NZST) & caller ID
    ├── Practice Users (/users) — Staff accounts & invitations
    ├── Roles & RBAC (/roles) — Role-based capability matrix
    └── Developer Tools (/api-docs) — REST API specs, webhook simulator, TwiML generator
```

---

## 6. Preserved Core Business Logic & Safety

- **Zero Breaking API Changes**: All 7 backend route modules remain unmodified.
- **RBAC Enforcement**: Protected routes and role capabilities (`SUPER_ADMIN`, `ADMIN`, `OPERATOR`) strictly enforced.
- **Compliance & DNC**: Do-Not-Call suppression, NZ calling windows (09:00 - 18:00 NZST), consent audit trails.
- **Telephony Audio**: Web Audio API dual-tone DTMF synthesizer, Web Speech API synthesis & speech recognition, variable interpolation (`{client_name}`, `{balance}`).
