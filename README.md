# Supabase Log Alerts with AWS SES

Automated email notifications for severe Edge Function logs using AWS SES and Supabase Management API.

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  Supabase Dashboard Cron (15/30 min)                        │
│  - Triggers edge function via HTTP POST                     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Edge Function (log-alerts)                                 │
│  - Fetches logs from Management API                         │
│  - Filters for error/fatal/panic levels                     │
│  - Sends email alerts via AWS SES                           │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Supabase Management API                                    │
│  GET /v1/projects/{ref}/analytics/endpoints/logs.all        │
│  - Queries edge_logs table                                  │
│  - 30 requests/min rate limit                               │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  AWS SES                                                    │
│  - Delivers alert emails                                    │
└─────────────────────────────────────────────────────────────┘
```

## Setup

### 1. Get Supabase Access Token

1. Go to [supabase.com/account/tokens](https://supabase.com/account/tokens)
2. Click **New Access Token**
3. Copy the token (starts with `sbp_`)

### 2. Get Project Reference

1. Go to your Supabase Dashboard
2. Project Settings → General
3. Copy **Reference ID** (e.g., `abcdefgh12345678`)

### 3. Configure Environment Variables

```bash
cp supabase/functions/log-alerts/.env.example supabase/functions/log-alerts/.env
```

Edit the `.env` file:

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAxxxxxxxxxxxxxxxx
AWS_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FROM_EMAIL=alerts@yourcompany.com
ALERT_EMAILS=admin@yourcompany.com,devops@yourcompany.com

SUPABASE_PROJECT_REF=your-project-ref
SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

ALLOWED_FUNCTION_IDS=5e0cf560-85a8-4a69-833e-4f3181f4a35c
CHECK_INTERVAL_MINUTES=15
```

### 4. Set Secrets

```bash
supabase secrets set --env-file supabase/functions/log-alerts/.env
```

### 5. Deploy

```bash
supabase functions deploy log-alerts
```

### 6. Setup Cron Job in Supabase Dashboard

1. Go to **Database** → **Cron Jobs** in Supabase Dashboard
2. Click **New Cron Job**
3. Configure:
   - **Name**: `log-alerts-check`
   - **Schedule**: `*/15 * * * *` (every 15 min) or `*/30 * * * *` (every 30 min)
   - **Type**: HTTP Request
   - **Method**: POST
   - **URL**: `https://<project-ref>.supabase.co/functions/v1/log-alerts`
   - **Headers**: `Authorization: Bearer <anon-key>`

## Configuration Options

| Variable | Description | Default |
|----------|-------------|---------|
| `ALLOWED_FUNCTION_IDS` | Comma-separated function IDs to monitor (empty = all) | - |
| `CHECK_INTERVAL_MINUTES` | Time window to look back for logs | 15 |
| `ALERT_EMAILS` | Comma-separated recipient emails | - |

## How Logs Are Fetched

The function uses this SQL query via Management API:

```sql
SELECT 
  timestamp,
  event_message,
  event_type,
  metadata.parsed.function_id,
  metadata.parsed.level,
  id
FROM edge_logs
WHERE timestamp > '${lastCheckTime}'
  AND metadata.parsed.level IN ('error', 'fatal', 'panic')
ORDER BY timestamp DESC
```

## Manual Trigger

You can manually trigger a log check:

```bash
curl -X POST https://<project-ref>.supabase.co/functions/v1/log-alerts \
  -H "Authorization: Bearer <anon-key>"
```

## Cost

- **Supabase**: Free tier includes Edge Function invocations
- **AWS SES**: 62,000 free emails/month from EC2
- **No Log Drains required** = No paid plan needed

## Troubleshooting

### No emails received

1. Check function logs: `supabase functions logs log-alerts`
2. Verify AWS credentials and SES email verification
3. Check if `ALLOWED_FUNCTION_IDS` is set correctly
4. Ensure Access Token has `analytics:read` scope

### Rate limit errors

The Management API has a 30 req/min limit. The 15/30-minute interval keeps you well under this.

### Cron job not triggering

1. Verify the cron job is enabled in Dashboard
2. Check the function URL is correct
3. Ensure the Authorization header has the correct anon key
