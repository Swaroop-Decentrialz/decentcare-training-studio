# DecentCare AI Training Studio — Deployment Guide
## Stack: Vite+React → Vercel | Express proxy → Railway | Postgres → Supabase

---

## STEP 1 — Supabase (Database)

1. Go to https://supabase.com → sign in with your DecentTrialz account
2. Click **New project** → name it `decentcare-training` → set a strong DB password → pick region closest to India (ap-south-1)
3. Once created, go to **SQL Editor** → click **New query**
4. Copy the entire contents of `supabase-schema.sql` and paste → click **Run**
5. You should see 4 tables created: `scenarios`, `knowledge_base`, `kb_files`, `call_intelligence`
6. Go to **Settings → API** → copy:
   - `Project URL` → this is your `VITE_SUPABASE_URL`
   - `anon public` key → this is your `VITE_SUPABASE_ANON_KEY`

---

## STEP 2 — GitHub (Source Control)

```bash
# In your terminal, from the decentcare/ folder:
git init
git add .
git commit -m "feat: DecentCare AI Training Studio v1"

# Create a new repo on github.com named: decentcare-training-studio
# Then:
git remote add origin https://github.com/YOUR_USERNAME/decentcare-training-studio.git
git branch -M main
git push -u origin main
```

> **Tip:** Use the same GitHub account linked to your DecentTrialz repos.

---

## STEP 3 — Railway (Backend Proxy)

1. Go to https://railway.app → sign in with your existing account
2. Click **New Project** → **Deploy from GitHub repo**
3. Select `decentcare-training-studio` → set **Root Directory** to `backend`
4. Railway will auto-detect Node.js and run `npm start`
5. Once deployed, go to **Settings → Networking** → click **Generate Domain**
6. Copy the domain (e.g. `https://decentcare-backend-production.up.railway.app`)
7. Go to **Variables** and add:

```
CORS_ORIGINS=http://localhost:5173,https://your-vercel-app.vercel.app
```
(You'll update this with the real Vercel URL after step 4)

8. Save the Railway domain — you'll need it for `VITE_RAILWAY_URL`

---

## STEP 4 — Vercel (Frontend)

1. Go to https://vercel.com → sign in with your existing account
2. Click **Add New → Project** → import `decentcare-training-studio`
3. Set **Root Directory** to `frontend`
4. Set **Framework Preset** to `Vite`
5. Under **Environment Variables**, add all 4:

| Key | Value |
|-----|-------|
| `VITE_SUPABASE_URL` | from Supabase step 6 |
| `VITE_SUPABASE_ANON_KEY` | from Supabase step 6 |
| `VITE_RAILWAY_URL` | from Railway step 6 |
| `VITE_ANTHROPIC_KEY` | your Anthropic API key (sk-ant-...) |

6. Click **Deploy**
7. Copy the Vercel URL (e.g. `https://decentcare-training.vercel.app`)

---

## STEP 5 — Final wiring

Go back to Railway → your backend service → Variables:
```
CORS_ORIGINS=http://localhost:5173,https://decentcare-training.vercel.app
```
Click **Redeploy**.

---

## STEP 6 — SmartFlo API Key (in the app)

1. Open your deployed Vercel app
2. Click **📞 Call Intelligence** → **⚙ API Config**
3. Log in to SmartFlo portal → Settings → API → Generate Token
4. Paste the token → set date range → click **Save & Pull Calls**

The token goes from browser → Railway proxy → SmartFlo API.
It is **never stored** in your database or Vercel.

---

## Local Development

```bash
# Terminal 1 — Backend
cd backend
cp .env.example .env   # fill in values
npm install
npm run dev            # runs on :3001

# Terminal 2 — Frontend  
cd frontend
cp .env.example .env.local   # fill in values
npm install
npm run dev            # runs on :5173, proxies /api → :3001
```

---

## Architecture Diagram

```
Browser (Vercel)
    │
    ├── Supabase JS SDK ──────────────────→ Supabase Postgres
    │   (scenarios, KB, files, calls)
    │
    └── /api/smartflo/* ──────────────────→ Railway Express
                                                │
                                                └──→ Tata SmartFlo API
                                                     (x-smartflo-token header)

Claude API calls (transcription) go directly from browser → api.anthropic.com
using VITE_ANTHROPIC_KEY
```

---

## Environment Variables Summary

### Frontend (Vercel)
| Variable | Where to get it |
|----------|----------------|
| `VITE_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Settings → API → anon key |
| `VITE_RAILWAY_URL` | Railway → your service → domain |
| `VITE_ANTHROPIC_KEY` | console.anthropic.com → API keys |

### Backend (Railway)
| Variable | Value |
|----------|-------|
| `PORT` | set automatically by Railway |
| `CORS_ORIGINS` | comma-separated list of your frontend URLs |

---

## Costs at Scale

| Service | Free Tier | When you'll hit limits |
|---------|-----------|----------------------|
| Supabase | 500MB DB, 2GB transfer | ~50k+ calls stored |
| Vercel | 100GB bandwidth | Very unlikely |
| Railway | $5/mo after trial | After free trial ends |
| Anthropic | Pay per token | ~$0.003 per call transcription |
