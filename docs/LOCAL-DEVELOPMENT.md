# ACULA PLATFORM — LOCAL DEVELOPMENT GUIDE

```
SYSTEM: Auckland Accounting Services Ltd — Automated Outbound Calling & IVR Platform
ARCHITECTURE: Decoupled Monorepo (React 19 Frontend + Express REST API Backend + PostgreSQL / Prisma + Redis)
```

---

## 1. Prerequisites & System Requirements

Ensure the following tools are installed on your host machine:

- **Node.js**: v20.x or v22.x+ (Verified on v24.11.1)
- **npm**: v10.x+ (Uses native npm workspaces)
- **PostgreSQL**: v15.x+ (Verified on PostgreSQL 18.4)
- **Redis**: v7.x+ (Optional for Phase 1; backend operates in resilient mode if offline)

---

## 2. Repository Layout

```
auckland-accounting/
├── frontend/                        # React 19 Client SPA (Vite + Tailwind CSS v4)
│   ├── src/
│   │   ├── components/              # Dashboard, Campaigns, Builder, Contacts, Simulator
│   │   ├── services/api.ts          # Centralized API client proxying to /api
│   │   ├── utils/                   # Web Audio DTMF & Speech synthesizers
│   │   └── data/                    # Prototype seed fixtures (localStorage fallback)
│   └── vite.config.ts               # Proxies /api -> http://localhost:5000
│
├── backend/                         # Express.js REST API
│   ├── prisma/
│   │   ├── schema.prisma            # Authoritative PostgreSQL relational schema
│   │   ├── migrations/              # Prisma migration history
│   │   └── seed.ts                  # Database seeding script
│   ├── src/
│   │   ├── config/env.ts            # Zod-validated environment configuration
│   │   ├── errors/AppError.ts       # Standardized error hierarchy
│   │   ├── middleware/              # Logging (Pino), Request ID, Error handling, Validation
│   │   ├── routes/                  # /api/health, /api/auth
│   │   ├── services/                # Prisma ORM & Redis resilient connection clients
│   │   ├── app.ts                   # Express app setup
│   │   └── server.ts                # Server startup & graceful shutdown
│   └── tests/                       # Automated Vitest integration tests
│
├── docs/                            # Specifications, audits & verification evidence
└── package.json                     # Root orchestrator scripts (npm workspaces)
```

---

## 3. Environment Configuration

### Backend (`backend/.env`)
Copy the template from `backend/.env.example` to `backend/.env`:

```bash
cp backend/.env.example backend/.env
```

Default local development values:
```env
NODE_ENV=development
PORT=5000
BASE_URL=http://localhost:5000
LOG_LEVEL=info

# PostgreSQL Connection String
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/auckland_accounting_db?schema=public"

# Redis Infrastructure
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=""

# JWT Secrets (Minimum 16 characters in dev)
JWT_SECRET=development-jwt-secret-min-16-chars
JWT_REFRESH_SECRET=development-refresh-secret-min-16-chars

# Twilio Telephony Credentials (Phase 5)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
```

---

## 4. Database Setup & Migrations

### 4.1 Create Database
If not already created, create the PostgreSQL database using `psql`:

```sql
CREATE DATABASE auckland_accounting_db;
```

### 4.2 Run Prisma Migrations
Apply the initial database schema migration from the repository root:

```bash
npm run db:migrate
```
*Behind the scenes, this executes `prisma migrate dev` inside `backend/`, generating the Prisma Client and syncing all 20 tables.*

### 4.3 Seed Initial Data
Seed system roles (`SUPER_ADMIN`, `ADMIN`, `OPERATOR`), practice settings, sample contacts, and default IVR campaigns:

```bash
npm run db:seed
```

### 4.4 Resetting Local Database
To safely reset and re-seed the local database at any time:

```bash
npx --prefix backend prisma migrate reset --force
```

---

## 5. Starting the Applications

### Option A: Run Both Together
```bash
# Start backend on :5000 and frontend on :3000 concurrently
npm run dev:backend
# In another terminal:
npm run dev:frontend
```

### Option B: Independent Execution
- **Backend Only**:
  ```bash
  npm run dev --workspace=backend
  # Server listens at http://localhost:5000
  ```
- **Frontend Only**:
  ```bash
  npm run dev --workspace=frontend
  # Web application available at http://localhost:3000
  ```

---

## 6. Health Checks & Verification

### 6.1 Check API Health
```bash
curl http://localhost:5000/api/health
```

Expected JSON response:
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "service": "acula-api",
    "version": "1.0.0",
    "timestamp": "2026-09-03T08:10:00.000Z",
    "uptimeSeconds": 45.2,
    "environment": "development",
    "database": {
      "connected": true,
      "status": "healthy",
      "latencyMs": 3
    },
    "redis": {
      "connected": false,
      "status": "unavailable"
    }
  }
}
```

### 6.2 Check Protected Endpoint Foundation
```bash
curl http://localhost:5000/api/auth/me
```

Expected response (`401 Unauthorized`):
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required. Session or Bearer token missing."
  }
}
```

---

## 7. Running Automated Tests & Quality Checks

```bash
# Run backend Vitest integration tests
npm run test

# Run TypeScript type-check on both frontend and backend
npm run lint

# Compile production bundles for both frontend and backend
npm run build
```
