import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import fetch from 'node-fetch'

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
  allowedHeaders: ['Content-Type', 'Authorization', 'x-smartflo-token'],
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

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ DecentCare backend running on port ${PORT}`)
  console.log(`   SmartFlo proxy → ${SMARTFLO_BASE}`)
  console.log(`   CORS origins: ${allowedOrigins.join(', ')}`)
})
