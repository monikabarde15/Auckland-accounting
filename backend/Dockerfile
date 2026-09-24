# ==============================================================================
# ACULA Backend API & Call Worker — Production Multi-Stage Container
# ==============================================================================

# Stage 1: Build & Compile TypeScript
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root and backend package definitions
COPY package*.json ./
COPY backend/package*.json ./backend/
COPY backend/prisma ./backend/prisma/

# Install dependencies including devDependencies for build
RUN npm ci --workspace=backend

# Copy backend source code
COPY backend/tsconfig.json ./backend/
COPY backend/src ./backend/src/

# Generate Prisma Client and compile TypeScript
WORKDIR /app/backend
RUN npx prisma generate
RUN npm run build

# Stage 2: Production Minimal Runtime
FROM node:22-alpine AS runner

WORKDIR /app/backend

ENV NODE_ENV=production
ENV PORT=5000

# Install production dependencies only
COPY package*.json /app/
COPY backend/package*.json ./
COPY backend/prisma ./prisma/

WORKDIR /app
RUN npm ci --workspace=backend --omit=dev
WORKDIR /app/backend
RUN npx prisma generate

# Copy compiled artifacts from builder
COPY --from=builder /app/backend/dist ./dist

# Create non-root user for security
RUN addgroup -S acula && adduser -S acula -G acula
USER acula

EXPOSE 5000

# Default command starts the REST API
CMD ["node", "dist/server.js"]
