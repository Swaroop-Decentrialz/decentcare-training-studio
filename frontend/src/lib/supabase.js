import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.warn('⚠ Supabase env vars missing — falling back to localStorage')
}

export const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null

// ─── Generic fallback: localStorage when Supabase not configured ─────────────
const ls = {
  get: (key) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null } catch { return null } },
  set: (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); return true } catch { return false } },
}

// ─── Scenarios ───────────────────────────────────────────────────────────────
export async function loadScenarios() {
  if (!supabase) return ls.get('dc_scenarios')
  const { data, error } = await supabase
    .from('scenarios')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) { console.error(error); return ls.get('dc_scenarios') }
  // Re-group by agent_id
  const grouped = {}
  data.forEach(row => {
    if (!grouped[row.agent_id]) grouped[row.agent_id] = []
    grouped[row.agent_id].push({
      id: row.id, type: row.type, input: row.input,
      expectedOutput: row.expected_output, tags: row.tags || [],
      notes: row.notes || '', active: row.active,
      createdAt: new Date(row.created_at).getTime()
    })
  })
  return grouped
}

export async function upsertScenario(agentId, scenario) {
  if (!supabase) return ls.set('dc_scenarios_pending', { agentId, scenario })
  const { error } = await supabase.from('scenarios').upsert({
    id: scenario.id, agent_id: agentId, type: scenario.type,
    input: scenario.input, expected_output: scenario.expectedOutput,
    tags: scenario.tags, notes: scenario.notes, active: scenario.active,
    created_at: new Date(scenario.createdAt).toISOString()
  }, { onConflict: 'id' })
  if (error) console.error('upsertScenario:', error)
  return !error
}

export async function deleteScenario(id) {
  if (!supabase) return true
  const { error } = await supabase.from('scenarios').delete().eq('id', id)
  if (error) console.error('deleteScenario:', error)
  return !error
}

export async function saveAllScenarios(scenariosMap) {
  if (!supabase) { ls.set('dc_scenarios', scenariosMap); return true }
  const rows = []
  Object.entries(scenariosMap).forEach(([agentId, list]) => {
    list.forEach(s => rows.push({
      id: s.id, agent_id: agentId, type: s.type,
      input: s.input, expected_output: s.expectedOutput,
      tags: s.tags, notes: s.notes, active: s.active,
      created_at: new Date(s.createdAt).toISOString()
    }))
  })
  if (!rows.length) return true
  const { error } = await supabase.from('scenarios').upsert(rows, { onConflict: 'id' })
  if (error) console.error('saveAllScenarios:', error)
  return !error
}

// ─── Knowledge Base ───────────────────────────────────────────────────────────
export async function loadKB() {
  if (!supabase) return ls.get('dc_kb')
  const { data, error } = await supabase
    .from('knowledge_base')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) { console.error(error); return ls.get('dc_kb') }
  return data.map(row => ({
    id: row.id, cat: row.category, priority: row.priority,
    title: row.title, content: row.content, agents: row.agents || [],
    tags: row.tags || [], active: row.active,
    createdAt: new Date(row.created_at).getTime()
  }))
}

export async function saveAllKB(entries) {
  if (!supabase) { ls.set('dc_kb', entries); return true }
  const rows = entries.map(k => ({
    id: k.id, category: k.cat, priority: k.priority,
    title: k.title, content: k.content, agents: k.agents,
    tags: k.tags, active: k.active,
    created_at: new Date(k.createdAt).toISOString()
  }))
  if (!rows.length) return true
  const { error } = await supabase.from('knowledge_base').upsert(rows, { onConflict: 'id' })
  if (error) console.error('saveAllKB:', error)
  return !error
}

export async function deleteKBEntry(id) {
  if (!supabase) return true
  const { error } = await supabase.from('knowledge_base').delete().eq('id', id)
  if (error) console.error('deleteKBEntry:', error)
  return !error
}

// ─── Uploaded Files ───────────────────────────────────────────────────────────
export async function loadFiles() {
  if (!supabase) return ls.get('dc_files')
  const { data, error } = await supabase
    .from('kb_files')
    .select('*')
    .order('uploaded_at', { ascending: false })
  if (error) { console.error(error); return ls.get('dc_files') }
  return data.map(row => ({
    id: row.id, name: row.name, size: row.size,
    ext: row.ext, content: row.content, cat: row.category,
    agents: row.agents || [], tags: row.tags || [],
    uploadedAt: new Date(row.uploaded_at).getTime()
  }))
}

export async function saveAllFiles(files) {
  if (!supabase) { ls.set('dc_files', files); return true }
  // Only save metadata + extracted text (not raw binary)
  const rows = files.map(f => ({
    id: f.id, name: f.name, size: f.size, ext: f.ext,
    content: (f.content || '').slice(0, 50000), // cap at 50k chars
    category: f.cat, agents: f.agents, tags: f.tags,
    uploaded_at: new Date(f.uploadedAt).toISOString()
  }))
  if (!rows.length) return true
  const { error } = await supabase.from('kb_files').upsert(rows, { onConflict: 'id' })
  if (error) console.error('saveAllFiles:', error)
  return !error
}

// ─── Call Intelligence ────────────────────────────────────────────────────────
export async function loadCalls() {
  if (!supabase) return ls.get('dc_calls')
  const { data, error } = await supabase
    .from('call_intelligence')
    .select('*')
    .order('imported_at', { ascending: false })
  if (error) { console.error(error); return ls.get('dc_calls') }
  return data.map(row => ({
    id: row.id, call_id: row.call_id, direction: row.direction,
    status: row.status, date: row.date, time: row.time,
    duration: row.duration, answered_seconds: row.answered_seconds,
    agent_name: row.agent_name, client_number: row.client_number,
    did_number: row.did_number, recording_url: row.recording_url,
    transcript: row.transcript, summary: row.summary,
    topics: row.topics || [], sentiment: row.sentiment,
    key_insights: row.key_insights || [],
    training_opportunity: row.training_opportunity,
    importedAt: new Date(row.imported_at).getTime(),
    processedAt: row.processed_at ? new Date(row.processed_at).getTime() : null
  }))
}

export async function saveAllCalls(calls) {
  if (!supabase) { ls.set('dc_calls', calls); return true }
  const rows = calls.map(c => ({
    id: c.id, call_id: c.call_id, direction: c.direction,
    status: c.status, date: c.date, time: c.time,
    duration: c.duration, answered_seconds: c.answered_seconds,
    agent_name: c.agent_name, client_number: c.client_number,
    did_number: c.did_number, recording_url: c.recording_url,
    transcript: c.transcript, summary: c.summary,
    topics: c.topics, sentiment: c.sentiment,
    key_insights: c.key_insights,
    training_opportunity: c.training_opportunity,
    imported_at: new Date(c.importedAt).toISOString(),
    processed_at: c.processedAt ? new Date(c.processedAt).toISOString() : null
  }))
  if (!rows.length) return true
  const { error } = await supabase.from('call_intelligence').upsert(rows, { onConflict: 'id' })
  if (error) console.error('saveAllCalls:', error)
  return !error
}

export async function upsertCall(call) {
  if (!supabase) return true
  const { error } = await supabase.from('call_intelligence').upsert({
    id: call.id, call_id: call.call_id, direction: call.direction,
    status: call.status, date: call.date, time: call.time,
    duration: call.duration, answered_seconds: call.answered_seconds,
    agent_name: call.agent_name, client_number: call.client_number,
    did_number: call.did_number, recording_url: call.recording_url,
    transcript: call.transcript, summary: call.summary,
    topics: call.topics, sentiment: call.sentiment,
    key_insights: call.key_insights,
    training_opportunity: call.training_opportunity,
    imported_at: new Date(call.importedAt).toISOString(),
    processed_at: call.processedAt ? new Date(call.processedAt).toISOString() : null
  }, { onConflict: 'id' })
  if (error) console.error('upsertCall:', error)
  return !error
}
