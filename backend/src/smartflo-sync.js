import fetch from 'node-fetch'
import { createClient } from '@supabase/supabase-js'

const SMARTFLO_BASE = process.env.SMARTFLO_BASE || 'https://api-smartflo.tatateleservices.com'

// Supabase client (service role key bypasses RLS)
let supabase
function getSupabase() {
  if (!supabase) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  }
  return supabase
}

// ── Authenticate with SmartFlo ───────────────────────────────────────────────
async function getSmartFloToken() {
  const res = await fetch(`${SMARTFLO_BASE}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      email: process.env.SMARTFLO_USERNAME,
      password: process.env.SMARTFLO_PASSWORD,
    }),
  })
  const body = await res.json()
  if (!body.success && !res.ok) throw new Error(`SmartFlo auth failed: ${body?.message || res.status}`)
  return body.access_token || body.token || body.data?.token
}

// ── Fetch one page of call records ───────────────────────────────────────────
async function fetchCallPage(token, { startDate, endDate, page = 1, limit = 50 }) {
  const params = new URLSearchParams({ limit: String(limit), page: String(page) })
  if (startDate) params.set('start_date', startDate)
  if (endDate)   params.set('end_date', endDate)

  const url = `${SMARTFLO_BASE}/v1/call/records?${params}`
  console.log(`[SmartFlo-Sync] GET ${url} (page ${page})`)

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
    timeout: 15000,
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`SmartFlo API error ${res.status}: ${body?.message || ''}`)
  return body
}

// ── Map SmartFlo record → call_intelligence row (omit AI fields) ─────────────
function mapRecord(r) {
  return {
    id: `sf_${r.call_id}`,
    call_id: r.call_id,
    direction: r.direction,
    status: r.status,
    date: r.date,
    time: r.time,
    duration: r.call_duration || 0,
    answered_seconds: r.answered_seconds || 0,
    agent_name: r.agent_name,
    client_number: r.client_number,
    did_number: r.did_number,
    recording_url: r.recording_url,
    imported_at: new Date().toISOString(),
    // AI fields deliberately omitted so upserts don't overwrite existing enrichment
  }
}

// ── Main sync function ───────────────────────────────────────────────────────
export async function syncCalls({ startDate, endDate } = {}) {
  if (!startDate) {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    startDate = yesterday.toISOString().slice(0, 10)
  }
  if (!endDate) {
    endDate = new Date().toISOString().slice(0, 10)
  }

  console.log(`[SmartFlo-Sync] Starting sync for ${startDate} → ${endDate}`)

  const token = await getSmartFloToken()
  console.log('[SmartFlo-Sync] Authenticated successfully')

  let page = 1
  let allRecords = []
  const PAGE_LIMIT = 50

  while (true) {
    const data = await fetchCallPage(token, { startDate, endDate, page, limit: PAGE_LIMIT })
    const records = data.results || data.data || []
    allRecords.push(...records)

    console.log(`[SmartFlo-Sync] Page ${page}: ${records.length} records (total: ${allRecords.length})`)

    if (records.length < PAGE_LIMIT) break
    page++
    if (page > 20) {
      console.warn('[SmartFlo-Sync] Hit 20-page safety cap')
      break
    }
  }

  if (allRecords.length === 0) {
    console.log('[SmartFlo-Sync] No records found')
    return { fetched: 0, upserted: 0 }
  }

  const rows = allRecords.map(mapRecord)
  const db = getSupabase()

  let upserted = 0
  const CHUNK = 100
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const { error, data } = await db
      .from('call_intelligence')
      .upsert(chunk, { onConflict: 'call_id', ignoreDuplicates: false })
      .select('id')

    if (error) {
      console.error(`[SmartFlo-Sync] Upsert error (chunk ${Math.floor(i / CHUNK) + 1}):`, error)
      throw error
    }
    upserted += data?.length || chunk.length
  }

  console.log(`[SmartFlo-Sync] Done. Fetched ${allRecords.length}, upserted ${upserted}`)
  return { fetched: allRecords.length, upserted }
}
