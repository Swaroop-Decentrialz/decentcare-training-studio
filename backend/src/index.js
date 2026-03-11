import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import fetch from 'node-fetch'
import cron from 'node-cron'
import { syncCalls } from './smartflo-sync.js'

const app  = express()
const PORT = process.env.PORT || 3001
const SMARTFLO_BASE = process.env.SMARTFLO_BASE || 'https://api-smartflo.tatateleservices.com'

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',').map(s => s.trim())

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman) + listed origins
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true)
    cb(new Error(`CORS blocked: ${origin}`))
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-smartflo-token', 'x-cron-secret'],
}))

app.use(express.json())

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'decentcare-backend', ts: new Date().toISOString() })
})

// ─── SmartFlo proxy — Call Records ────────────────────────────────────────────
// Frontend sends SmartFlo token in x-smartflo-token header
// Backend proxies to SmartFlo so the token never appears in browser network logs
app.get('/api/smartflo/calls', async (req, res) => {
  const token = req.headers['x-smartflo-token']
  if (!token) return res.status(401).json({ error: 'Missing x-smartflo-token header' })

  try {
    const params = new URLSearchParams()
    if (req.query.limit)      params.set('limit',      req.query.limit)
    if (req.query.page)       params.set('page',        req.query.page || 1)
    if (req.query.start_date) params.set('start_date',  req.query.start_date)
    if (req.query.end_date)   params.set('end_date',    req.query.end_date)
    if (req.query.direction && req.query.direction !== 'all')
      params.set('direction', req.query.direction)

    const url = `${SMARTFLO_BASE}/v1/call/records?${params}`
    console.log(`[SmartFlo] GET ${url}`)

    const sfRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
      timeout: 15000,
    })

    const body = await sfRes.json()

    if (!sfRes.ok) {
      console.error(`[SmartFlo] Error ${sfRes.status}:`, body)
      return res.status(sfRes.status).json({ error: body?.message || `SmartFlo error ${sfRes.status}`, detail: body })
    }

    return res.json(body)
  } catch (err) {
    console.error('[SmartFlo] Fetch error:', err.message)
    return res.status(502).json({ error: 'SmartFlo API unreachable', detail: err.message })
  }
})

// ─── SmartFlo proxy — Auth Token (generate/refresh) ──────────────────────────
app.post('/api/smartflo/auth', async (req, res) => {
  const { username, password } = req.body
  if (!username || !password)
    return res.status(400).json({ error: 'username and password required' })

  try {
    const sfRes = await fetch(`${SMARTFLO_BASE}/v1/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const body = await sfRes.json()
    if (!sfRes.ok) return res.status(sfRes.status).json({ error: body?.message || 'Auth failed', detail: body })
    return res.json(body)
  } catch (err) {
    return res.status(502).json({ error: 'SmartFlo auth unreachable', detail: err.message })
  }
})

// ─── SmartFlo proxy — Live Calls ─────────────────────────────────────────────
app.get('/api/smartflo/live', async (req, res) => {
  const token = req.headers['x-smartflo-token']
  if (!token) return res.status(401).json({ error: 'Missing x-smartflo-token header' })

  try {
    const sfRes = await fetch(`${SMARTFLO_BASE}/v1/live_calls`, {
      headers: { Authorization: `Bearer ${token}`, accept: 'application/json' }
    })
    const body = await sfRes.json()
    if (!sfRes.ok) return res.status(sfRes.status).json({ error: body?.message })
    return res.json(body)
  } catch (err) {
    return res.status(502).json({ error: err.message })
  }
})

// ─── Cron: Manual fetch trigger ──────────────────────────────────────────────
app.post('/api/cron/fetch-calls', async (req, res) => {
  const secret = req.headers['x-cron-secret'] || req.query.secret
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized — invalid or missing CRON_SECRET' })
  }

  try {
    const startDate = req.query.start_date || req.body?.start_date
    const endDate   = req.query.end_date   || req.body?.end_date
    const result = await syncCalls({ startDate, endDate })
    return res.json({ ok: true, ...result })
  } catch (err) {
    console.error('[Cron/fetch-calls] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
})

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ DecentCare backend running on port ${PORT}`)
  console.log(`   SmartFlo proxy → ${SMARTFLO_BASE}`)
  console.log(`   CORS origins: ${allowedOrigins.join(', ')}`)

  // Daily 6 AM IST auto-fetch
  if (process.env.SMARTFLO_USERNAME && process.env.SUPABASE_URL) {
    cron.schedule('0 6 * * *', async () => {
      console.log('[Cron] Daily SmartFlo sync triggered at', new Date().toISOString())
      try {
        const result = await syncCalls()
        console.log('[Cron] Sync complete:', result)
      } catch (err) {
        console.error('[Cron] Sync failed:', err.message)
      }
    }, { timezone: 'Asia/Kolkata' })
    console.log('   Cron: daily SmartFlo sync at 06:00 IST')
  } else {
    console.log('   Cron: SmartFlo sync DISABLED (missing SMARTFLO_USERNAME or SUPABASE_URL)')
  }
})
