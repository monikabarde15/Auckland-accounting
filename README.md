<div align="center">

# 📞 Acula
### Intelligent Outbound Calling, IVR & Campaign Management Platform

[![React](https://img.shields.io/badge/React-19.0-61DAFB?logo=react&logoColor=black&style=for-the-badge)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white&style=for-the-badge)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.2-646CFF?logo=vite&logoColor=white&style=for-the-badge)](https://vitejs.dev/)
[![TailwindCSS](https://img.shields.io/badge/Tailwind-4.1-38B2AC?logo=tailwind-css&logoColor=white&style=for-the-badge)](https://tailwindcss.com/)
[![Express](https://img.shields.io/badge/Express-4.21-000000?logo=express&logoColor=white&style=for-the-badge)](https://expressjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-6.4-2D3748?logo=prisma&logoColor=white&style=for-the-badge)](https://www.prisma.io/)
[![Redis](https://img.shields.io/badge/Redis-BullMQ-DC382D?logo=redis&logoColor=white&style=for-the-badge)](https://redis.io/)
[![Twilio](https://img.shields.io/badge/Twilio-Voice_API-F22F46?logo=twilio&logoColor=white&style=for-the-badge)](https://www.twilio.com/)

<p align="center">
  <b>Enterprise-grade telecommunication platform designed for high-concurrency automated outbound calling, dynamic interactive IVR trees, granular DNC compliance, and real-time campaign telemetry.</b>
</p>

---

</div>

## ✨ Key Highlights

<table>
  <tr>
    <td width="50%">
      <h3>🎯 Campaign Engine</h3>
      <ul>
        <li>Automated queue-based outbound dialing with BullMQ.</li>
        <li>Pre-launch validation & safety checks against invalid numbers.</li>
        <li>Instant pause, resume, and emergency kill-switch controls.</li>
      </ul>
    </td>
    <td width="50%">
      <h3>🌳 Visual IVR Builder</h3>
      <ul>
        <li>Customizable question flows with DTMF & voice capture.</li>
        <li>Conditional branch routing and real-time response analysis.</li>
        <li>Dynamic answer scoring and automated disposition tagging.</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <h3>🛡️ Compliance & DNC Registry</h3>
      <ul>
        <li>Real-time Do-Not-Call (DNC) suppression checks.</li>
        <li>Explicit consent tracking & audit logging per contact.</li>
        <li>CSV contact import wizard with schema validation & deduplication.</li>
      </ul>
    </td>
    <td width="50%">
      <h3>🔒 Dynamic RBAC & Security</h3>
      <ul>
        <li>Super Admin, Admin, Manager, and Agent permission levels.</li>
        <li>Granular module access controls updated on the fly.</li>
        <li>JWT session management with secure HttpOnly token refresh.</li>
      </ul>
    </td>
  </tr>
</table>

---

## 🏗️ Repository Architecture

This project is organized as an **npm monorepo workspace**:

```
auckland-accounting/
├── frontend/             # React 19 + Vite Single Page Application (SPA)
│   ├── src/
│   │   ├── components/   # Modular UI views (Campaigns, Contacts, IVR, Analytics)
│   │   ├── context/      # Authentication & Global State
│   │   ├── services/     # Centralized REST API client
│   │   └── types/        # TypeScript interfaces & domain models
│   └── vite.config.ts    # Vite configuration with Tailwind CSS v4
├── backend/              # Node.js + Express REST API & Telephony Engine
│   ├── prisma/           # PostgreSQL Schema & Migration scripts
│   ├── src/
│   │   ├── middleware/   # JWT Auth, Dynamic RBAC, Rate Limiting
│   │   ├── routes/       # REST API endpoints (Auth, Contacts, Campaigns, Calls)
│   │   ├── services/     # Twilio Voice, IVR Engine & Analytics services
│   │   └── workers/      # BullMQ background worker for call dispatching
│   └── server.ts         # Main HTTP server entrypoint
└── package.json          # Monorepo root workspace orchestrator
```

---

## 🚀 Quick Start (Local Development)

### 1. Prerequisites
* **Node.js** >= 18.x
* **PostgreSQL** (running locally or cloud instance)
* **Redis** (running locally or cloud instance)

### 2. Installation
Clone the repository and install all monorepo dependencies in one command:
```bash
git clone https://github.com/your-username/auckland-accounting.git
cd auckland-accounting
npm install
```

### 3. Environment Configuration
Copy the environment template in the root directory:
```bash
cp .env.example .env
```
Configure your credentials in `.env`:
```env
PORT=5000
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/auckland_accounting_db?schema=public"
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
JWT_SECRET=your_super_secret_jwt_key
JWT_REFRESH_SECRET=your_super_secret_refresh_key
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=your_twilio_phone_number
```

### 4. Database Setup & Seeding
Initialize Prisma migrations and generate client types:
```bash
npm run db:migrate
npm run db:generate
npm run db:seed
```

### 5. Run the Application
Start both the Frontend and Backend concurrently:
```bash
# Start full stack in development mode
npm run dev:frontend
npm run dev:backend
```
* **Frontend**: `http://localhost:3000`
* **Backend API**: `http://localhost:5000`
* **Health Check**: `http://localhost:5000/api/health`

---

## 🚢 Production Deployment

### Frontend (Vercel)
The React SPA is optimized for zero-config static hosting on **Vercel**:
1. Connect your repository to Vercel.
2. Set **Root Directory** to `frontend`.
3. Set **Framework Preset** to `Vite`.
4. Ensure `frontend/vercel.json` rewrites are enabled for SPA routing.

### Backend (Railway / Render / VPS)
Because the backend utilizes persistent **BullMQ workers** and **Twilio webhook handlers**, host it on a Node.js runtime host:
1. Set **Root Directory** to `backend`.
2. **Build Command**: `npm install && npm run db:generate && npm run build`
3. **Start Command (API)**: `npm run start`
4. **Start Command (Worker)**: `npm run worker`
5. Link your cloud PostgreSQL and Redis connection strings.

---

## 🧪 Testing & Code Quality

```bash
# Run all unit and integration tests across frontend & backend
npm test

# Run TypeScript typechecks
npm run lint
```

---

<div align="center">
  <sub>Built with ❤️ for modern telephony automation and seamless contact operations.</sub>
</div>
