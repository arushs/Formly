# Deployment Guide

## Option 1: Render (Recommended)

### Quick Deploy with Blueprint

1. Go to https://render.com/deploy
2. Connect your GitHub repo
3. Render will auto-detect `render.yaml` and create:
   - PostgreSQL database
   - API service (Docker)
   - Web service (Docker)

### Manual Setup

1. **Create PostgreSQL Database**
   - Dashboard → New → PostgreSQL
   - Name: `tax-agent-db`
   - Copy the Internal Database URL

2. **Deploy API**
   - Dashboard → New → Web Service
   - Connect GitHub repo
   - Root Directory: `apps/api`
   - Runtime: Docker
   - Add environment variables (see below)

3. **Deploy Web**
   - Dashboard → New → Web Service
   - Connect GitHub repo
   - Root Directory: `apps/web`
   - Runtime: Docker
   - Set `VITE_API_URL` to API service URL

### Environment Variables

**API Service:**
| Variable | Required | Description |
|----------|----------|-------------|
| DATABASE_URL | Yes | From Render Postgres |
| PORT | Yes | `3001` |
| FRONTEND_URL | Yes | Web service URL |
| ENABLE_SCHEDULER | No | `true` for cron jobs |
| OPENAI_API_KEY | Yes | Document classification |
| MISTRAL_API_KEY | Yes | OCR |
| ANTHROPIC_API_KEY | Yes | AI agents |
| TYPEFORM_WEBHOOK_SECRET | Yes | Webhook verification |
| RESEND_API_KEY | Yes | Email sending |
| EMAIL_FROM | Yes | Sender email |

**Web Service (Build-time):**
| Variable | Required | Description |
|----------|----------|-------------|
| VITE_API_URL | Yes | API service URL |

---

## Option 2: Railway

### Setup Steps

1. Go to https://railway.app/new
2. Deploy from GitHub repo
3. Add PostgreSQL database
4. Add API service (Root Directory: `apps/api`)
5. Add Web service (Root Directory: `apps/web`)
6. Configure environment variables
7. Generate domains for both services

See `railway.toml` files in each app directory for config.

---

## Database Migrations

After first deploy, run migrations:

```bash
# Render
render ssh tax-agent-api
npx prisma db push

# Railway
railway run -s tax-agent-api npx prisma db push
```

## Troubleshooting

### "Column not found" errors
Database schema is out of sync. Run `prisma db push`.

### API returns 500 errors
Check logs for actual error message. Common issues:
- Missing environment variables
- Database connection failed
- Storage provider not configured

### Web can't reach API
- Check CORS: `FRONTEND_URL` must match web domain
- Check `VITE_API_URL` is set correctly (needs rebuild)
