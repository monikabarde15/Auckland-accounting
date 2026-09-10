# ACULA PLATFORM — DYNAMIC ROLE & PERMISSION MANAGEMENT SPECIFICATION

```
SYSTEM: ACULA (Auckland Accounting Services Ltd - Outbound Telephony & IVR)
AUTHORITATIVE SPEC: Acula-new.pdf (§4, §5, §62)
COMPLIANCE JURISDICTION: New Zealand (Privacy Act 2020, Unsolicited Electronic Messages Act 2007)
LAST UPDATED: SEPTEMBER 10, 2026
```

---

## 1. Executive Summary & Architecture Overview

The ACULA dynamic Role-Based Access Control (RBAC) engine provides fine-grained, database-backed permission governance. It allows `SUPER_ADMIN` (Principal Partners) to dynamically grant or revoke specific operational permissions from the `ADMIN` (Practice Managers) and `OPERATOR` (Telephony Staff) roles in real time.

```
+-------------------------------------------------------------------------+
|                              SUPER_ADMIN                                |
|   (Unrestricted Root Access, System-Protected, Immutable Master Role)   |
+-------------------------------------------------------------------------+
                                     │
           ┌─────────────────────────┴─────────────────────────┐
           ▼                                                   ▼
+-----------------------+                           +---------------------+
|         ADMIN         |                           |      OPERATOR       |
|  (Dynamic RBAC via    |                           |  (Dynamic RBAC via  |
|   PostgreSQL + Cache) |                           |   PostgreSQL + Cache|
+-----------------------+                           +---------------------+
           │                                                   │
           ├─────────────────────────┬─────────────────────────┤
           ▼                         ▼                         ▼
   Contacts & Groups         Campaigns & Calls         Reports & Exports
   (DB-Backed Authz)         (DB-Backed Authz)         (DB-Backed Authz)
           │                         │                         │
           └─────────────────────────┼─────────────────────────┘
                                     ▼
                      +-----------------------------+
                      |   HARDENED COMPLIANCE GATE  |
                      |   - DNC Registry Check      |
                      |   - Explicit Consent Check  |
                      |   - NZ Calling Hours (NZST) |
                      |   - Concurrency & Cost Caps |
                      |   - Global Emergency Stop   |
                      +-----------------------------+
```

### Key Architectural Invariants
1. **Real PostgreSQL Persistence:** Permissions are stored in `permissions` and `role_permissions` relational tables. Changes persist permanently across application restarts.
2. **Immediate Runtime Invalidation:** Permissions are evaluated in microsecond lookup time via an in-memory cache in `rbacService`. Updates atomically write to PostgreSQL, create an audit trail in `audit_logs`, and immediately purge the cache. The very next HTTP request evaluates the updated permissions without requiring a server reboot or user relogin.
3. **Immutability of SUPER_ADMIN:** `SUPER_ADMIN` holds permanent root authority (`*` / `manage:all`). Any API attempt to modify or strip permissions from `SUPER_ADMIN` is rejected with `400 Bad Request`.
4. **Zero Bypass of Telephony Safety Controls:** Permissions grant access to API endpoints, but safety invariants (DNC suppression, consent validation, NZ calling hours 08:00–20:00, budget caps, and emergency stop) are enforced unconditionally at the service and telephony gateway level.

---

## 2. Granular System Permissions Catalog

The system defines 28 standard granular permissions across 10 functional domains:

| Domain | Permission Key | Legacy Colon Key | Label | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Contacts & CRM** | `contacts.view` | `view:contacts` | View Contacts | View contact directory, tax profile, and balances |
| | `contacts.create` | `create:contacts` | Create Contact | Add individual client records manually |
| | `contacts.edit` | `edit:contacts` | Edit Contact | Update contact info, assigned accountant, or details |
| | `contacts.delete` | `delete:contacts` | Delete Contact | Remove contact records permanently |
| | `contacts.import` | `import:contacts` | Import CSV | Upload and parse bulk client CSV spreadsheets |
| | `contacts.export` | `export:contacts` | Export Contacts | Export filtered contact lists to CSV |
| **Contact Groups** | `groups.view` | `view:groups` | View Groups | Browse categorized contact groups and member counts |
| | `groups.manage` | `manage:groups` | Manage Groups | Create, rename, delete groups and assign members |
| **Do-Not-Call (DNC)** | `dnc.view` | `view:dnc` | View DNC Registry | View suppressed phone numbers and DNC records |
| | `dnc.manage` | `manage:dnc` | Manage DNC Registry | Add or remove numbers from DNC suppression list |
| **Campaigns** | `campaigns.view` | `view:campaigns` | View Campaigns | View campaign list, schedule, and execution status |
| | `campaigns.create` | `create:campaigns` | Create Campaign | Create new outbound voice campaign drafts |
| | `campaigns.edit` | `edit:campaigns` | Edit Campaign | Modify campaign calling windows, retries, and settings |
| | `campaigns.delete` | `delete:campaigns` | Delete Campaign | Delete non-running campaign records |
| | `campaigns.start` | `start:campaigns` | Start Campaign | Launch and activate scheduled outbound campaigns |
| | `campaigns.pause` | `pause:campaigns` | Pause Campaign | Temporarily halt dialing for an active campaign |
| | `campaigns.resume` | `resume:campaigns` | Resume Campaign | Resume dialing for a paused campaign |
| | `campaigns.cancel` | `cancel:campaigns` | Cancel Campaign | Abort and cancel campaign execution |
| | `campaigns.manage` | `manage:campaigns` | Manage Campaigns | Full administrative control over campaigns |
| **Questionnaires** | `questionnaires.view` | `view:questionnaires` | View Questionnaires | Browse IVR survey flow templates and trees |
| | `questionnaires.create` | `create:questionnaires` | Create Questionnaire | Create new IVR flow diagrams and prompts |
| | `questionnaires.edit` | `edit:questionnaires` | Edit Questionnaire | Modify questions, DTMF branching, and timeout rules |
| | `questionnaires.delete` | `delete:questionnaires` | Delete Questionnaire | Delete unused questionnaire flow templates |
| **Live Telephony** | `calls.view` | `view:calls` | View Call Logs | Inspect call records, durations, transcripts, recordings |
| | `calls.initiate` | `initiate:calls` | Initiate Calls | Place ad-hoc manual outbound calls to verified clients |
| | `calls.terminate` | `terminate:calls` | Terminate Calls | Force hang-up on active in-progress calls |
| **Reports & Analytics** | `reports.view` | `view:reports` | View Analytics | Access dashboard KPIs, call outcomes, hourly trends |
| | `reports.export` | `export:reports` | Export Reports | Download aggregated analytics and call logs in CSV |
| **User Administration** | `users.view` | `view:users` | View Users | View practice user list and account statuses |
| | `users.create` | `create:users` | Create User | Provision new staff accounts |
| | `users.edit` | `edit:users` | Edit User | Modify staff details, email, or active status |
| | `users.delete` | `delete:users` | Delete User | Deactivate or delete practice user accounts |
| **Roles & Permissions** | `roles.view` | `view:roles` | View Roles | View system roles and assigned permissions |
| | `roles.manage` | `manage:roles` | Manage Roles | Dynamically grant or revoke role permissions |
| **System & Governance** | `audit.view` | `view:audit` | View Audit Trail | Inspect immutable compliance and security audit logs |
| | `system.settings` | `manage:settings` | Practice Settings | Configure gateway, caller ID, and practice defaults |
| | `emergency.stop` | `manage:emergency` | Emergency Stop | Trigger global emergency stop across all dialers |

---

## 3. Dynamic Roles API Specification

All role management endpoints require an authenticated `SUPER_ADMIN` session:

### 3.1 `GET /api/roles/permissions`
- **Access:** `SUPER_ADMIN` only.
- **Description:** Returns the complete list of system permissions alongside category groupings.
- **Response Format:**
```json
{
  "success": true,
  "data": {
    "permissions": [
      {
        "id": "cmtl8ne3d0000v4nsxyz12345",
        "key": "contacts.view",
        "legacyKey": "view:contacts",
        "action": "view",
        "subject": "contacts",
        "category": "Contacts & CRM",
        "label": "View Contacts",
        "description": "View directory contacts and taxpayer records"
      }
    ],
    "grouped": {
      "Contacts & CRM": [...],
      "Campaigns": [...]
    }
  }
}
```

### 3.2 `GET /api/roles`
- **Access:** `SUPER_ADMIN` only.
- **Description:** Lists all system roles (`SUPER_ADMIN`, `ADMIN`, `OPERATOR`) with user count, assigned permission keys, and protection status.

### 3.3 `PUT /api/roles/:roleId/permissions`
- **Access:** `SUPER_ADMIN` only.
- **Body Schema (Zod):**
```json
{
  "permissions": ["contacts.view", "contacts.create", "campaigns.start", "reports.view"]
}
```
- **Guards:**
  - If `roleId` belongs to `SUPER_ADMIN`, returns `400 Bad Request` ("SUPER_ADMIN permissions are system-protected and cannot be modified").
  - Replaces active `role_permissions` associations in a single database transaction.
  - Automatically writes an `audit_logs` record (`ROLE_PERMISSIONS_UPDATED`).
  - Clears `rbacService` memory cache for the modified role.

---

## 4. Frontend UI Implementation

The `RoleManagementView` component in `frontend/src/components/RoleManagementView.tsx` (mounted under `/roles` and accessible via Practice Navigation) provides:

1. **SUPER_ADMIN Protection Notice:** Informational banner detailing that `SUPER_ADMIN` retains permanent, unrestricted system access by design.
2. **Role Selection Tabs:** Switch between configurable roles (`ADMIN` vs. `OPERATOR`) with real-time user count badges.
3. **Grouped Module Cards:** 10 categorized cards with category select/deselect toggles, permission checkboxes, permission key badges, and capability descriptions.
4. **Dirty State Tracking & Save Controls:** Unsaved changes indicator with "Discard Changes" and "Save Permissions" buttons.
5. **Instantaneous Feedback:** Visual success/error toasts upon persisting changes.
