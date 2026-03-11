import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import fetch from 'node-fetch'
import cron from 'node-cron'
import { createClient } from '@supabase/supabase-js'
import { syncCalls } from './smartflo-sync.js'

const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null

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

// ─── SmartFlo proxy — Recording audio ────────────────────────────────────────
// Proxies SmartFlo recording URLs so frontend can play audio without CORS issues
app.get('/api/smartflo/recording', async (req, res) => {
  const url = req.query.url
  if (!url) return res.status(400).json({ error: 'Missing url query parameter' })

  try {
    console.log(`[Recording] Proxying: ${url}`)
    const sfRes = await fetch(url, { timeout: 30000 })
    if (!sfRes.ok) {
      console.error(`[Recording] Error ${sfRes.status}`)
      return res.status(sfRes.status).json({ error: `Recording fetch failed: ${sfRes.status}` })
    }

    const contentType = sfRes.headers.get('content-type') || 'audio/mpeg'
    const contentLength = sfRes.headers.get('content-length')
    res.setHeader('Content-Type', contentType)
    if (contentLength) res.setHeader('Content-Length', contentLength)
    res.setHeader('Accept-Ranges', 'bytes')

    sfRes.body.pipe(res)
  } catch (err) {
    console.error('[Recording] Proxy error:', err.message)
    return res.status(502).json({ error: 'Recording unreachable', detail: err.message })
  }
})

// ─── Transcribe: Deepgram + Claude analysis ─────────────────────────────────
app.post('/api/transcribe', async (req, res) => {
  const { callId, recordingUrl } = req.body
  if (!callId) return res.status(400).json({ error: 'callId required' })
  if (!supabase) return res.status(500).json({ error: 'Supabase not configured' })
  if (!process.env.DEEPGRAM_API_KEY) return res.status(500).json({ error: 'DEEPGRAM_API_KEY not set' })

  try {
    // 1. Fetch call from Supabase
    const { data: call, error: fetchErr } = await supabase
      .from('call_intelligence')
      .select('*')
      .eq('id', callId)
      .single()

    if (fetchErr || !call) return res.status(404).json({ error: 'Call not found', detail: fetchErr })
    const url = recordingUrl || call.recording_url
    if (!url) return res.status(400).json({ error: 'No recording URL for this call' })

    console.log(`[Transcribe] Processing ${callId} — ${url}`)

    // 2. Download audio (recording URLs have embedded tokens, no extra auth needed)
    const audioRes = await fetch(url, { timeout: 60000 })
    if (!audioRes.ok) return res.status(502).json({ error: `Audio download failed: ${audioRes.status}` })
    const audioBuffer = await audioRes.buffer()
    console.log(`[Transcribe] Downloaded ${audioBuffer.length} bytes`)

    if (audioBuffer.length < 100) {
      await supabase.from('call_intelligence').update({
        transcript: 'Recording too short or empty',
        processed_at: new Date().toISOString(),
      }).eq('id', callId)
      return res.json({ ok: true, callId, transcript: 'Recording too short or empty', skippedAnalysis: true })
    }

    // 3. Send to Deepgram — nova-2, Hindi-English code-switch, smart format
    const dgParams = new URLSearchParams({
      model: 'nova-2',
      language: 'hi',
      detect_language: 'true',
      smart_format: 'true',
      punctuate: 'true',
      diarize: 'true',
    })
    const dgRes = await fetch(`https://api.deepgram.com/v1/listen?${dgParams}`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
        'Content-Type': 'audio/mpeg',
      },
      body: audioBuffer,
    })

    if (!dgRes.ok) {
      const dgErr = await dgRes.text()
      console.error('[Transcribe] Deepgram error:', dgRes.status, dgErr)
      return res.status(502).json({ error: 'Deepgram transcription failed', detail: dgErr })
    }

    const dgData = await dgRes.json()
    const transcript = dgData.results?.channels?.[0]?.alternatives?.[0]?.transcript || ''
    const detectedLang = dgData.results?.channels?.[0]?.detected_language || 'unknown'
    console.log(`[Transcribe] Deepgram done: ${transcript.length} chars, lang=${detectedLang}`)

    if (!transcript || transcript.trim().length === 0) {
      await supabase.from('call_intelligence').update({
        transcript: 'No speech detected in recording',
        processed_at: new Date().toISOString(),
      }).eq('id', callId)
      return res.json({ ok: true, callId, transcript: 'No speech detected', skippedAnalysis: true })
    }

    // 4. Send transcript to Claude Haiku for analysis (fast + cheap)
    let analysis = { summary: '', topics: [], sentiment: 'neutral', key_insights: [], training_opportunity: null }

    if (process.env.ANTHROPIC_API_KEY) {
      const prompt = `You are analyzing a hospital patient call for DecentCare, a surgical care platform.

Call metadata:
- Direction: ${call.direction}
- Agent: ${call.agent_name}
- Duration: ${call.duration}s
- Date: ${call.date} ${call.time}
- Status: ${call.status}

Transcript:
${transcript}

Analyze this call transcript. Respond in JSON only (no markdown):
{
  "summary": "2-3 sentence summary of what the call was about",
  "topics": ["array of topic ids from: pricing, insurance, scheduling, pre-op, post-op, complaint, emergency, multilingual, cancellation, general"],
  "sentiment": "positive|neutral|negative",
  "key_insights": ["insight 1", "insight 2"],
  "training_opportunity": "One specific scenario this call suggests adding to agent training, or null if none"
}`

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }],
        }),
      })

      if (claudeRes.ok) {
        const claudeData = await claudeRes.json()
        const text = claudeData.content?.[0]?.text || '{}'
        const clean = text.replace(/```json|```/g, '').trim()
        try { analysis = JSON.parse(clean) } catch (e) { console.error('[Transcribe] Claude JSON parse error:', e.message) }
      } else {
        const errBody = await claudeRes.text()
        console.error('[Transcribe] Claude API error:', claudeRes.status, errBody)
      }
    }

    // 5. Update Supabase
    const { error: updateErr } = await supabase
      .from('call_intelligence')
      .update({
        transcript,
        summary: analysis.summary || '',
        topics: analysis.topics || [],
        sentiment: analysis.sentiment || 'neutral',
        key_insights: analysis.key_insights || [],
        training_opportunity: analysis.training_opportunity || null,
        processed_at: new Date().toISOString(),
      })
      .eq('id', callId)

    if (updateErr) {
      console.error('[Transcribe] Update error:', updateErr)
      return res.status(500).json({ error: 'Failed to update call', detail: updateErr })
    }

    console.log(`[Transcribe] Done: ${callId}`)
    return res.json({ ok: true, callId, transcript, analysis })
  } catch (err) {
    console.error('[Transcribe] Error:', err.message)
    return res.status(500).json({ error: err.message })
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
