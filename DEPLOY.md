# Formly (Tax Intake Agent) - Deployment Guide

## Overview

| Component | Platform | URL |
|-----------|----------|-----|
| API | Render | https://tax-agent-api-1glq.onrender.com |
| Web | Render | (see Render dashboard) |
| Database | Render PostgreSQL | tax-agent-db |

## Quick Deploy

Push to `master` branch → Render auto-deploys both services.

```bash
git push origin master
```

## CI/CD Flow

```
   master branch
        │
        ├── CI runs (build + typecheck)
        │
        └── Render auto-deploys
             ├── API service (Docker)
             └── Web service (Docker)
```

## Manual Deployment

### Via Render Dashboard

1. Go to https://dashboard.render.com
2. Find `tax-agent-api` or `tax-agent-web`
3. Click "Manual Deploy" → "Deploy latest commit"

### Via Render CLI

```bash
# API key in secrets/render.env
export RENDER_API_KEY=$(cat secrets/render.env | cut -d= -f2)

# Trigger deploy via API
curl -X POST "https://api.render.com/v1/services/YOUR_SERVICE_ID/deploys" \
  -H "Authorization: Bearer $RENDER_API_KEY"
```

## Environment Variables

### API Service

Set in Render dashboard under "Environment":

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | Auto-set from Render Postgres |
| `PORT` | ✅ | `3001` |
| `FRONTEND_URL` | ✅ | Web service URL |
| `ENABLE_SCHEDULER` | ✅ | `true` |
| `OPENAI_API_KEY` | ✅ | Document classification |
| `MISTRAL_API_KEY` | ✅ | OCR processing |
| `ANTHROPIC_API_KEY` | ✅ | AI agents |
| `TYPEFORM_WEBHOOK_SECRET` | ✅ | Webhook verification |
| `CRON_SECRET` | ✅ | Cron job auth |
| `RESEND_API_KEY` | ✅ | Email sending |
| `EMAIL_FROM` | ✅ | Sender email |

#### Optional Storage Providers

| Variable | Provider |
|----------|----------|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Google Drive |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | Google Drive |
| `AZURE_TENANT_ID` | SharePoint |
| `AZURE_CLIENT_ID` | SharePoint |
| `AZURE_CLIENT_SECRET` | SharePoint |
| `DROPBOX_*` | Dropbox |

### Web Service

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_API_URL` | ✅ | API service URL (build-time) |

## Database Migrations

After schema changes, migrations run automatically via `preDeployCommand` in `render.yaml`:

```bash
npx prisma db push --skip-generate --accept-data-loss
```

To run manually:
```bash
# SSH into Render service or use Render Shell
npx prisma db push
```

## Local Development

```bash
# Start all services (Docker Compose)
./bin/dev

# With Cloudflare tunnel for webhooks
./bin/dev --tunnel
```

## Detailed Docs

See `apps/DEPLOY.md` for:
- Manual setup instructions
- Railway deployment option
- Troubleshooting guide

## Gotchas

1. **Branch is `master`** - Render deploys from `master`, not `main`
2. **Docker builds** - Both services use Docker, builds take ~2-3 min
3. **Free tier sleep** - Render free tier services spin down after inactivity
4. **Env rebuild** - Changing `VITE_*` variables requires full rebuild of web service
5. **Prisma schema sync** - preDeployCommand runs `prisma db push` automatically
