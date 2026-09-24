# ==============================================================================
# ACULA Frontend SPA — Production Multi-Stage Container
# ==============================================================================

# Stage 1: Build Static Assets
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root and frontend package definitions
COPY package*.json ./
COPY frontend/package*.json ./frontend/

# Install dependencies
RUN npm ci --workspace=frontend

# Copy frontend source code
COPY frontend/ ./frontend/

# Build static bundle
WORKDIR /app/frontend
ARG VITE_API_URL
ARG VITE_SHOW_DEMO_CREDENTIALS=false
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SHOW_DEMO_CREDENTIALS=$VITE_SHOW_DEMO_CREDENTIALS
RUN npm run build

# Stage 2: Serve via Nginx
FROM nginx:alpine

COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
