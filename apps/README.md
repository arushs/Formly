# Tax Intake Agent - Hono + React on Railway

This directory contains the migrated application from Next.js to a Hono API backend + Vite React frontend.

## Structure

```
apps/
├── api/                    # Hono backend
│   ├── src/
│   │   ├── index.ts        # Hono app entry
│   │   ├── routes/
│   │   │   ├── engagements.ts
│   │   │   ├── webhooks.ts
│   │   │   └── cron.ts
│   │   ├── middleware/
│   │   │   └── auth.ts
│   │   ├── lib/            # Business logic
│   │   ├── workers/
│   │   │   └── background.ts
│   │   ├── scheduler.ts    # node-cron setup
│   │   └── types.ts
│   ├── prisma/
│   ├── Dockerfile
│   └── package.json
│
└── web/                    # React frontend
    ├── src/
    │   ├── main.tsx
    │   ├── App.tsx
    │   ├── api/client.ts
    │   └── pages/
    ├── Dockerfile
    └── package.json
```

## Development

### API (Port 3001)

```bash
cd apps/api
cp .env.example .env  # Configure environment variables
npm install
npx prisma generate
npm run dev
```

### Web (Port 5173)

```bash
cd apps/web
npm install
npm run dev
```

The frontend dev server proxies `/api/*` requests to `localhost:3001`.

## Production Build

### API

```bash
cd apps/api
npm run build
npm start
```

### Web

```bash
cd apps/web
npm run build
# Serve dist/ with nginx or other static server
```

## Docker

Build and run with Docker:

```bash
# API
cd apps/api
docker build -t tax-agent-api .
docker run -p 3001:3001 --env-file .env tax-agent-api

# Web
cd apps/web
docker build -t tax-agent-web .
docker run -p 80:80 tax-agent-web
```

## Environment Variables

### API

See `apps/api/.env.example` for required variables:

- `DATABASE_URL` - PostgreSQL connection string
- `OPENAI_API_KEY` - For GPT-4o structured outputs
- `MISTRAL_API_KEY` - For Mistral OCR document extraction
- `TYPEFORM_WEBHOOK_SECRET` - HMAC signature verification
- `CRON_SECRET` - Cron job authorization
- `RESEND_API_KEY` - Email sending
- Storage provider credentials (SharePoint, Google Drive, or Dropbox)

### Web

- `VITE_API_URL` - API URL (leave empty in dev to use proxy)

## Key Changes from Next.js

1. **`waitUntil()` → `runInBackground()`**: Railway containers persist, so we use fire-and-forget for background tasks.

2. **Vercel Cron → node-cron**: Scheduled tasks run in-process via node-cron.

3. **Server Components → Client Fetch**: React pages fetch data from the API instead of using RSC.

4. **API Routes → Hono Routes**: Next.js route handlers converted to Hono handlers.

5. **`@/` imports → Relative imports**: No more path aliases, using `.js` extensions for ESM.
