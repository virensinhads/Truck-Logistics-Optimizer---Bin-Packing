# 05 - Deployment, Build Pipeline & Environment Configuration

## 1. Runtime Environment & Architecture

The **Logistics Payload & Route Optimization Engine** is structured as a client-side Single Page Application (SPA) designed for rapid execution and zero external server dependencies for core optimization tasks.

### Infrastructure Constraints:
- **Port**: Must listen on port `3000` (required by container ingress and reverse proxy layers).
- **Host**: Configured to bind on `0.0.0.0`.
- **Static Asset Serving**: Production builds output optimized static bundles to `/dist` which can be served by any static web server (Nginx, Cloudflare Pages, Vercel, Firebase Hosting) or containerized on Google Cloud Run.

---

## 2. Build & Development Scripts

The project includes standard npm scripts defined in `package.json`:

```json
{
  "scripts": {
    "dev": "vite --port=3000 --host=0.0.0.0",
    "build": "vite build",
    "preview": "vite preview",
    "generate-matrix": "tsx scripts/generate_osrm_matrix.ts",
    "clean": "rm -rf dist server.js",
    "lint": "tsc --noEmit"
  }
}
```

### Script Usage:
- `npm run dev`: Starts the local Vite development server with Hot Module Replacement on `http://localhost:3000`.
- `npm run build`: Compiles TypeScript and packages CSS/assets into production-ready static files in `/dist`.
- `npm run lint`: Validates TypeScript types across all source files (`tsc --noEmit`).
- `npm run generate-matrix`: Runs the headless Node CLI matrix generator against arbitrary Excel spreadsheets.

---

## 3. Environment Variables

Environment variables are documented in `.env.example`.

```env
# Port configuration (Required by platform reverse proxy)
PORT=3000

# Optional: Custom OSRM Routing Machine base URL (Default: http://localhost:5001)
OSRM_BASE_URL=http://localhost:5001

# Optional: Google Gemini API Key (for server-side GenAI reasoning extensions)
GEMINI_API_KEY=
```

> **Note**: For client-side exposed variables in Vite, prefix with `VITE_` (e.g. `VITE_OSRM_BASE_URL`).

---

## 4. Container Deployment (Docker / Cloud Run)

For production deployment in a containerized environment (e.g. Google Cloud Run):

### Sample Multi-Stage Dockerfile:
```dockerfile
# Stage 1: Build the static assets
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Serve static assets via lightweight Nginx
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
```

### Sample Nginx Ingress Configuration (`nginx.conf`):
```nginx
server {
    listen 3000;
    server_name localhost;

    location / {
        root /usr/share/nginx/html;
        index index.html index.htm;
        try_files $uri $uri/ /index.html;
    }

    # Enable gzip compression for fast spreadsheet/map asset delivery
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
}
```

---

## 5. Headless Batch Execution via CI/CD

The standalone matrix generator script can be executed in scheduled cron jobs or CI/CD pipelines (e.g. GitHub Actions, Cloud Build):

```bash
# Execute headless matrix generation for daily incoming register
npx tsx scripts/generate_osrm_matrix.ts \
  ./data/incoming_sales_register.xlsx \
  ./output/computed_distance_matrix.xlsx \
  http://osrm-internal.cluster.local:5001
```
