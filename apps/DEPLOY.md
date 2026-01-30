# Railway Deployment Guide

## Prerequisites
- Railway account (https://railway.app)
- GitHub repo connected to Railway

## Setup Steps

### 1. Create Railway Project
1. Go to https://railway.app/new
2. Select "Deploy from GitHub repo"
3. Connect your GitHub account and select this repo

### 2. Add PostgreSQL Database
1. In your Railway project, click "New" → "Database" → "PostgreSQL"
2. Copy the `DATABASE_URL` from the Postgres service variables

### 3. Deploy API Service
1. Click "New" → "GitHub Repo" → Select this repo
2. Configure:
   - **Root Directory**: `apps/api`
   - **Service Name**: `tax-agent-api`
3. Add environment variables:
   ```
   DATABASE_URL=<from step 2>
   PORT=3001
   FRONTEND_URL=https://<web-service>.up.railway.app
   ENABLE_SCHEDULER=true

   # Required for functionality
   OPENAI_API_KEY=<your key>
   MISTRAL_API_KEY=<your key>
   ANTHROPIC_API_KEY=<your key>
   TYPEFORM_WEBHOOK_SECRET=<your secret>
   RESEND_API_KEY=<your key>
   EMAIL_FROM=noreply@yourdomain.com

   # Storage (configure at least one)
   # SharePoint
   AZURE_TENANT_ID=<optional>
   AZURE_CLIENT_ID=<optional>
   AZURE_CLIENT_SECRET=<optional>

   # Google Drive
   GOOGLE_SERVICE_ACCOUNT_EMAIL=<optional>
   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=<optional>

   # Dropbox
   DROPBOX_ACCESS_TOKEN=<optional>
   ```
4. Deploy

### 4. Deploy Web Service
1. Click "New" → "GitHub Repo" → Select this repo
2. Configure:
   - **Root Directory**: `apps/web`
   - **Service Name**: `tax-agent-web`
3. Add build variables:
   ```
   VITE_API_URL=https://<api-service>.up.railway.app
   ```
4. Deploy

### 5. Configure Networking
1. For API service: Generate a public domain (Settings → Networking → Generate Domain)
2. For Web service: Generate a public domain
3. Update `FRONTEND_URL` in API with the web domain
4. Redeploy web with the correct `VITE_API_URL`

## Environment Variables Reference

### API Service
| Variable | Required | Description |
|----------|----------|-------------|
| DATABASE_URL | Yes | PostgreSQL connection string |
| PORT | Yes | Server port (3001) |
| FRONTEND_URL | Yes | Web app URL for CORS |
| ENABLE_SCHEDULER | No | Enable cron jobs (default: true) |
| OPENAI_API_KEY | Yes | For document classification |
| MISTRAL_API_KEY | Yes | For OCR |
| ANTHROPIC_API_KEY | Yes | For AI agents |
| TYPEFORM_WEBHOOK_SECRET | Yes | Webhook verification |
| RESEND_API_KEY | Yes | Email sending |
| EMAIL_FROM | Yes | Sender email address |

### Web Service (Build Args)
| Variable | Required | Description |
|----------|----------|-------------|
| VITE_API_URL | Yes | API service URL |

## Troubleshooting

### Database migrations
If you see "column not found" errors, run:
```bash
railway run npx prisma db push
```

### Check logs
```bash
railway logs -s tax-agent-api
railway logs -s tax-agent-web
```
