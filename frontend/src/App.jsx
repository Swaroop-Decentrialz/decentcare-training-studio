import { useState, useRef, useEffect, useCallback } from "react";
import {
  loadScenarios, saveAllScenarios,
  loadKB, saveAllKB,
  loadFiles, saveAllFiles,
  loadCalls, saveAllCalls, upsertCall,
} from "./lib/supabase.js";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const AGENTS = [
  { id:"lead-qual",      name:"Lead Qualification",       stage:"Stage 1",    icon:"🎯", color:"#7C3AED", bg:"#F5F3FF" },
  { id:"risk-assess",    name:"Pre-Op Risk Assessment",   stage:"Stage 5",    icon:"🔬", color:"#DC2626", bg:"#FEF2F2" },
  { id:"virtual-assist", name:"Virtual Health Assistant", stage:"Stages 2–6", icon:"💬", color:"#0891B2", bg:"#ECFEFF" },
  { id:"dropoff",        name:"Drop-off Prevention",      stage:"All Stages", icon:"📊", color:"#D97706", bg:"#FFFBEB" },
  { id:"postop",         name:"Post-Op Monitoring",       stage:"Stage 6",    icon:"🩺", color:"#059669", bg:"#ECFDF5" },
  { id:"financial",      name:"Financial Counseling",     stage:"Stage 4",    icon:"💰", color:"#E11D48", bg:"#FFF1F2" },
  { id:"clinical-doc",   name:"Clinical Documentation",   stage:"Stage 3",    icon:"📋", color:"#2563EB", bg:"#EFF6FF" },
  { id:"scheduling",     name:"Intelligent Scheduling",   stage:"Stage 5",    icon:"📅", color:"#7C3AED", bg:"#F5F3FF" },
];

const STYPES = [
  { id:"ideal",      label:"Ideal Flow",   color:"#059669", bg:"#ECFDF5" },
  { id:"edge",       label:"Edge Case",    color:"#D97706", bg:"#FFFBEB" },
  { id:"guardrail",  label:"Guardrail",    color:"#DC2626", bg:"#FEF2F2" },
  { id:"escalation", label:"Escalation",  color:"#7C3AED", bg:"#F5F3FF" },
];

// KB categories with tier / priority metadata
const KB_CATS = [
  { id:"clinical",   label:"Clinical Protocols & SOPs",  icon:"🏥", color:"#DC2626", bg:"#FEF2F2",
    desc:"Standard operating procedures, care protocols, WHO/NABH checklists" },
  { id:"insurance",  label:"Insurance & Billing Rules",  icon:"💳", color:"#D97706", bg:"#FFFBEB",
    desc:"TPA rules, pre-auth criteria, claim limits, billing codes" },
  { id:"faqs",       label:"Drug & Procedure FAQs",      icon:"💊", color:"#0891B2", bg:"#ECFEFF",
    desc:"Common patient questions about drugs, procedures, recovery" },
  { id:"policy",     label:"Hospital-Specific Policies", icon:"📜", color:"#7C3AED", bg:"#F5F3FF",
    desc:"Internal rules, escalation paths, consent requirements" },
];

const KB_PRIORITIES = [
  { id:"P1", label:"P1 — Override",   color:"#DC2626", bg:"#FEF2F2",
    desc:"Overrides agent response. Non-negotiable rule." },
  { id:"P2", label:"P2 — Reference",  color:"#D97706", bg:"#FFFBEB",
    desc:"Agent must consult before responding." },
  { id:"P3", label:"P3 — Supplement", color:"#059669", bg:"#ECFDF5",
    desc:"Helpful context, used when relevant." },
];


// ─────────────────────────────────────────────────────────────────────────────
// CALL INTELLIGENCE CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const CI_TOPICS = [
  { id:"pricing",      label:"Pricing & Cost",          icon:"💰", color:"#059669", bg:"#ECFDF5" },
  { id:"insurance",    label:"Insurance & Claims",       icon:"🏦", color:"#D97706", bg:"#FFFBEB" },
  { id:"scheduling",   label:"Appointment Scheduling",  icon:"📅", color:"#2563EB", bg:"#EFF6FF" },
  { id:"pre-op",       label:"Pre-Op Instructions",      icon:"🏥", color:"#7C3AED", bg:"#F5F3FF" },
  { id:"post-op",      label:"Post-Op Follow-up",        icon:"🩺", color:"#0891B2", bg:"#ECFEFF" },
  { id:"complaint",    label:"Complaints & Escalations", icon:"⚠️",  color:"#DC2626", bg:"#FEF2F2" },
  { id:"emergency",    label:"Emergency / Urgent",       icon:"🚨", color:"#DC2626", bg:"#FEF2F2" },
  { id:"multilingual", label:"Language / Regional",      icon:"🌐", color:"#6B7280", bg:"#F9FAFB" },
  { id:"cancellation", label:"Cancellation / No-Show",   icon:"❌", color:"#E11D48", bg:"#FFF1F2" },
  { id:"general",      label:"General Inquiry",          icon:"💬", color:"#6B7280", bg:"#F9FAFB" },
];

const SMARTFLO_BASE = "https://api-smartflo.tatateleservices.com";

const SEED_SC = {
  "lead-qual": [
    { id:"lq1", type:"ideal",     input:"Patient asks about knee replacement surgery cost",         expectedOutput:"Capture demographics, insurance info, urgency level, schedule callback",          tags:["pricing","orthopedic"],       notes:"Most common entry",              active:true, createdAt:Date.now()-864e5 },
    { id:"lq2", type:"guardrail", input:"Patient is in acute distress or emergency situation",      expectedOutput:"NEVER continue lead flow. Provide emergency helpline: 108 immediately",           tags:["emergency","safety"],         notes:"Critical safety override",       active:true, createdAt:Date.now()-72e4 },
    { id:"lq3", type:"edge",      input:"Patient speaks only in Tamil or regional language",        expectedOutput:"Detect language, switch regional NLU model, escalate if confidence < 0.7",       tags:["multilingual"],              notes:"Language detection first",        active:true, createdAt:Date.now()-5e7 },
  ],
  "virtual-assist": [
    { id:"va1", type:"ideal",     input:"Patient asks what to eat before surgery tomorrow",         expectedOutput:"NPO: no food 8hrs, no water 4hrs before procedure. Send WhatsApp reminder.",     tags:["pre-op","diet"],             notes:"",                               active:true, createdAt:Date.now()-4e7 },
    { id:"va2", type:"guardrail", input:"Patient asks for specific drug dosage",                    expectedOutput:"NEVER provide dosage. Route to nurse/doctor immediately.",                       tags:["medical-advice","safety"],   notes:"Hard clinical guardrail",         active:true, createdAt:Date.now()-3e7 },
    { id:"va3", type:"escalation",input:"Patient reports fever above 101°F post-surgery",          expectedOutput:"Flag clinical alert, notify on-call nurse within 5 min.",                        tags:["post-op","complication"],    notes:"Time-sensitive",                 active:true, createdAt:Date.now()-2e7 },
  ],
  "risk-assess": [
    { id:"ra1", type:"ideal",     input:"Patient with Type 2 diabetes submits pre-op labs",        expectedOutput:"Cross-check HbA1c vs WHO threshold, flag anaesthesiologist if >7.5",            tags:["diabetes","labs"],           notes:"",                               active:true, createdAt:Date.now()-864e5 },
    { id:"ra2", type:"edge",      input:"Patient on blood thinners scheduled for surgery",         expectedOutput:"Alert surgical team, check INR, recommend cardiology consult",                   tags:["anticoagulant","cardiology"], notes:"",                               active:true, createdAt:Date.now()-72e4 },
  ],
  "financial": [
    { id:"fc1", type:"ideal",     input:"Patient wants EMI for bariatric surgery Rs 3.5L",         expectedOutput:"Show insurance coverage, EMI via Razorpay, offer 6/12/24 month plans",          tags:["emi","bariatric","insurance"],notes:"High-value conversion",           active:true, createdAt:Date.now()-864e5 },
    { id:"fc2", type:"guardrail", input:"Patient asks agent to approve their insurance claim",     expectedOutput:"NEVER approve claims autonomously. Route to human counselor.",                   tags:["insurance","compliance"],    notes:"Compliance boundary",             active:true, createdAt:Date.now()-72e4 },
  ],
};

const SEED_KB = [
  { id:"kb1", cat:"clinical",  priority:"P1", title:"NPO Protocol — Pre-Operative Fasting",
    content:"Adults: No solid food for 8 hours, no clear liquids for 2 hours before anaesthesia. Paediatric patients: adjusted per anaesthesiologist order. Exceptions require written surgical consent.",
    agents:["virtual-assist","risk-assess"], tags:["fasting","pre-op","anaesthesia"], active:true, createdAt:Date.now()-864e5 },
  { id:"kb2", cat:"clinical",  priority:"P1", title:"Emergency Escalation Protocol",
    content:"Any patient reporting chest pain, difficulty breathing, loss of consciousness, or acute bleeding must be immediately redirected to emergency services (108). Agent must STOP all other flows and log the escalation.",
    agents:["lead-qual","virtual-assist","postop"], tags:["emergency","safety","escalation"], active:true, createdAt:Date.now()-72e4 },
  { id:"kb3", cat:"insurance", priority:"P2", title:"Star Health — Pre-Auth Requirements",
    content:"Pre-auth mandatory for all elective surgeries above Rs 50,000. Submit: diagnosis code (ICD-10), estimated cost, surgeon credentials, hospital accreditation number. SLA: 4 hours for urgent, 24 hours standard.",
    agents:["financial","lead-qual"], tags:["star-health","pre-auth","insurance"], active:true, createdAt:Date.now()-5e7 },
  { id:"kb4", cat:"insurance", priority:"P2", title:"EMI Eligibility Rules",
    content:"EMI available for procedures above Rs 30,000. Patient must provide: Aadhaar, PAN, 3-month bank statement. Max tenure 24 months. Interest-free for 6 months on select procedures. Partner banks: HDFC, Axis, ICICI.",
    agents:["financial"], tags:["emi","eligibility","billing"], active:true, createdAt:Date.now()-4e7 },
  { id:"kb5", cat:"faqs",      priority:"P3", title:"Bariatric Surgery — Common Patient Questions",
    content:"Q: How long is recovery? A: 2–4 weeks for desk work, 6 weeks for physical labour. Q: Will I need supplements? A: Yes, lifelong vitamin B12, iron, calcium. Q: Is it reversible? A: Sleeve gastrectomy is not; gastric band is.",
    agents:["virtual-assist","lead-qual","financial"], tags:["bariatric","faq","recovery"], active:true, createdAt:Date.now()-3e7 },
  { id:"kb6", cat:"faqs",      priority:"P3", title:"Knee Replacement — Post-Op Care",
    content:"Week 1–2: Ice, elevation, physiotherapy starts Day 1. Week 3–6: Walking with support. 3 months: Return to light activity. 6 months: Full recovery expected. Red flags: fever >101°F, wound discharge, sudden swelling.",
    agents:["postop","virtual-assist"], tags:["knee","ortho","post-op"], active:true, createdAt:Date.now()-2e7 },
  { id:"kb7", cat:"policy",    priority:"P1", title:"Consent Requirements — Surgical Procedures",
    content:"Written informed consent mandatory before all surgical procedures. Must include: risks, alternatives, anaesthesia type, estimated cost. Consent must be obtained by treating surgeon, not agent. Agent cannot substitute for consent.",
    agents:["lead-qual","risk-assess","clinical-doc"], tags:["consent","compliance","legal"], active:true, createdAt:Date.now()-1e7 },
  { id:"kb8", cat:"policy",    priority:"P2", title:"Data Privacy — DPDP Act 2023 Compliance",
    content:"Patient data collection requires explicit opt-in consent. Data retention max 7 years post-treatment. Patient has right to deletion. No health data sharing with third parties without consent. All exports must be encrypted.",
    agents:["lead-qual","virtual-assist","clinical-doc","financial"], tags:["dpdp","privacy","compliance"], active:true, createdAt:Date.now()-864e5 },
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
let _ctr = 1000;
const uid   = () => `x${++_ctr}_${Date.now()}`;
const stc   = t => STYPES.find(x=>x.id===t)?.color   || "#6B7280";
const stbg  = t => STYPES.find(x=>x.id===t)?.bg      || "#F9FAFB";
const stl   = t => STYPES.find(x=>x.id===t)?.label   || t;
const kcc   = c => KB_CATS.find(x=>x.id===c)?.color  || "#6B7280";
const kcbg  = c => KB_CATS.find(x=>x.id===c)?.bg     || "#F9FAFB";
const kcl   = c => KB_CATS.find(x=>x.id===c)?.label  || c;
const kpi   = p => KB_PRIORITIES.find(x=>x.id===p)?.color || "#6B7280";
const kpibg = p => KB_PRIORITIES.find(x=>x.id===p)?.bg    || "#F9FAFB";

// ─────────────────────────────────────────────────────────────────────────────
// FILE PARSING HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const FILE_ICONS = { pdf:"📄", txt:"📝", md:"📋", doc:"📘", docx:"📘", csv:"📊", default:"📎" };
const fIcon = name => { const ext=name.split(".").pop().toLowerCase(); return FILE_ICONS[ext]||FILE_ICONS.default; };
const fSize = b => b<1024?`${b}B`:b<1048576?`${(b/1024).toFixed(1)}KB`:`${(b/1048576).toFixed(1)}MB`;
const ACCEPTED = [".pdf",".txt",".md",".csv",".doc",".docx"];

async function parseFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    const ext = file.name.split(".").pop().toLowerCase();
    if (["txt","md","csv"].includes(ext)) {
      reader.onload = e => resolve(e.target.result);
      reader.readAsText(file);
    } else if (ext === "pdf") {
      // Extract text from PDF using basic approach
      reader.onload = e => {
        try {
          const bytes = new Uint8Array(e.target.result);
          let text = "";
          const str = new TextDecoder("latin1").decode(bytes);
          // Pull readable strings from PDF (basic extraction)
          const matches = str.match(/\(([^\)]{4,200})\)/g) || [];
          const chunks = str.match(/BT[\s\S]*?ET/g) || [];
          chunks.forEach(chunk => {
            const parts = chunk.match(/\(([^\)]+)\)/g)||[];
            parts.forEach(p=>{ const t=p.slice(1,-1).replace(/\\n/g,"\n").replace(/\\t/g," "); if(t.trim().length>3) text+=t+" "; });
          });
          // Fallback: extract printable ASCII runs
          if (text.trim().length < 50) {
            let run="", runs=[];
            for(let i=0;i<Math.min(bytes.length,200000);i++){
              const ch=bytes[i];
              if(ch>=32&&ch<=126){ run+=String.fromCharCode(ch); }
              else if(run.length>6){ runs.push(run); run=""; }
              else run="";
            }
            text = runs.filter(r=>/[a-zA-Z]{3,}/.test(r)).join(" ");
          }
          resolve(text.slice(0,8000).trim() || "[PDF content could not be extracted — please paste text manually]");
        } catch { resolve("[PDF parse error — please paste text manually]"); }
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = e => resolve(e.target.result || "");
      reader.readAsText(file);
    }
  });
}

const fmtT  = ts => { if(!ts)return"Never"; const d=Math.floor((Date.now()-ts)/1000); if(d<60)return"Just now"; if(d<3600)return`${Math.floor(d/60)}m ago`; if(d<86400)return`${Math.floor(d/3600)}h ago`; return new Date(ts).toLocaleDateString(); };

// Storage handled via Supabase — see src/lib/supabase.js

// ─────────────────────────────────────────────────────────────────────────────
// DOWNLOADS
// ─────────────────────────────────────────────────────────────────────────────
const dlFile = (c,mime,n) => { const a=Object.assign(document.createElement("a"),{href:URL.createObjectURL(new Blob([c],{type:mime})),download:n}); a.click(); };
const stamp  = () => new Date().toISOString().slice(0,10);
const dlJSON = (sc,kb) => dlFile(JSON.stringify({exportedAt:new Date().toISOString(),scenarios:sc,knowledgeBase:kb},null,2),"application/json",`decentcare-full-${stamp()}.json`);
const dlJSONL= sc => { const ls=[]; AGENTS.forEach(a=>{(sc[a.id]||[]).filter(s=>s.active).forEach(s=>{ls.push(JSON.stringify({messages:[{role:"system",content:`You are DecentCare ${a.name}.`},{role:"user",content:s.input},{role:"assistant",content:s.expectedOutput}],metadata:{agent:a.id,type:s.type,tags:s.tags||[]}}))})}); dlFile(ls.join("\n"),"application/x-ndjson",`decentcare-finetune-${stamp()}.jsonl`); };
const dlCSV  = sc => { const rows=[["Agent","Stage","Type","Active","Input","Expected Output","Tags","Notes"]]; AGENTS.forEach(a=>{(sc[a.id]||[]).forEach(s=>{rows.push([a.name,a.stage,s.type,s.active?"Yes":"No",`"${s.input.replace(/"/g,'""')}"`,`"${s.expectedOutput.replace(/"/g,'""')}"`,`"${(s.tags||[]).join('|')}"`,`"${(s.notes||'').replace(/"/g,'""')}"`])})}); dlFile(rows.map(r=>r.join(",")).join("\n"),"text/csv",`decentcare-scenarios-${stamp()}.csv`); };
const dlKBMD = kb => { let md=`# DecentCare Knowledge Base\n_${new Date().toLocaleString()}_\n\n`; KB_CATS.forEach(c=>{const items=kb.filter(k=>k.cat===c.id); if(!items.length)return; md+=`## ${c.icon} ${c.label}\n\n`; items.forEach(k=>{md+=`### [${k.priority}] ${k.title}\n\n${k.content}\n\n_Tags: ${(k.tags||[]).join(', ')}_\n\n---\n\n`;})}); dlFile(md,"text/markdown",`decentcare-kb-${stamp()}.md`); };

// ─────────────────────────────────────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  // nav
  const [page,   setPg]  = useState("agents");   // "agents" | "kb" | "ci"
  // Call Intelligence state
  const [ciCalls,   setCiCalls]   = useState([]);
  const [ciConfig,  setCiConfig]  = useState({apiKey:"",dateFrom:"",dateTo:"",direction:"all"});
  const [ciFilter,  setCiFilter]  = useState("all");
  const [ciSearch,  setCiSearch]  = useState("");
  const [ciView,    setCiView]    = useState(null);
  const [pulling,   setPulling]   = useState(false);
  const [pullMsg,   setPullMsg]   = useState("");
  const [showConn,  setShowConn]  = useState(false);
  const [processingId, setProcessingId] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [fetchMsg, setFetchMsg] = useState("");
  const [selectedCalls, setSelectedCalls] = useState(new Set());
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({done:0, total:0});
  const [hideMissed, setHideMissed] = useState(true);
  // agents page
  const [agent,  setAg]  = useState("lead-qual");
  const [tab,    setTab] = useState("scenarios");
  const [sc,     setSc]  = useState(SEED_SC);
  const [ft,     setFt]  = useState("all");
  const [q,      setQ]   = useState("");
  const [addSc,  setAddSc] = useState(false);
  const [scForm, setScFm]  = useState({type:"ideal",input:"",expectedOutput:"",tags:"",notes:""});
  const [ti,     setTI]  = useState("");
  const [tr,     setTR]  = useState(null);
  const [testing,setTg]  = useState(false);
  // kb page
  const [kb,     setKb]  = useState(SEED_KB);
  const [kbCat,  setKbCat] = useState("all");
  const [kbPri,  setKbPri] = useState("all");
  const [kbQ,    setKbQ]   = useState("");
  const [addKb,  setAddKb] = useState(false);
  const [kbForm, setKbFm]  = useState({cat:"clinical",priority:"P2",title:"",content:"",agents:[],tags:""});
  const [kbView, setKbView]= useState(null);   // expanded entry id
  const [kbTab,  setKbTab] = useState("entries"); // "entries" | "files"
  const [files,  setFiles] = useState([]);        // uploaded file objects
  const [dragOver,setDrag] = useState(false);
  const [parsing, setParsing] = useState(false);
  const fileRef = useRef(null);
  // global
  const [dlOpen, setDL]  = useState(false);
  const [toast,  setTs]  = useState(null);
  const [svSt,   setSvSt]= useState("idle");
  const [savedAt,setSA]  = useState(null);
  const [loading,setLd]  = useState(true);
  const saveRef = useRef(null);
  // fileRef declared above with kb state

  // ── Boot — load from Supabase ────────────────────────────────────────────
  useEffect(()=>{
    const stop = setTimeout(()=>setLd(false), 4000);
    (async()=>{
      try {
        const [scenarios, kbEntries, uploadedFiles, calls] = await Promise.all([
          loadScenarios(), loadKB(), loadFiles(), loadCalls()
        ]);
        if(scenarios && Object.keys(scenarios).length) setSc(prev=>({...prev,...scenarios}));
        if(kbEntries?.length) setKb(kbEntries);
        if(uploadedFiles?.length) setFiles(uploadedFiles);
        if(calls?.length) setCiCalls(calls);
        setSA(Date.now());
      } catch(err) { console.error('Boot error:', err); }
      clearTimeout(stop); setLd(false);
    })();
    return ()=>clearTimeout(stop);
  },[]);

  // ── Auto-save to Supabase (debounced 1.2s) ────────────────────────────────
  useEffect(()=>{
    if(loading) return;
    clearTimeout(saveRef.current);
    setSvSt("saving");
    saveRef.current=setTimeout(async()=>{
      try {
        const [ok1,ok2,ok3,ok4] = await Promise.all([
          saveAllScenarios(sc), saveAllKB(kb),
          saveAllFiles(files),  saveAllCalls(ciCalls),
        ]);
        setSvSt(ok1&&ok2?"saved":"error");
        if(ok1&&ok2) setSA(Date.now());
      } catch(err) { console.error('Save error:',err); setSvSt("error"); }
      setTimeout(()=>setSvSt("idle"),2200);
    },1200);
    return ()=>clearTimeout(saveRef.current);
  },[sc,kb,files,ciCalls,loading]);

  const toast$ = msg => { setTs(msg); setTimeout(()=>setTs(null),2600); };

  // ── Scenario CRUD ─────────────────────────────────────────────────────────
  const agSc     = sc[agent]||[];
  const cur      = AGENTS.find(a=>a.id===agent);
  const totalSc  = AGENTS.reduce((a,ag)=>a+(sc[ag.id]?.length||0),0);
  const activeSc = AGENTS.reduce((a,ag)=>a+(sc[ag.id]?.filter(s=>s.active).length||0),0);

  const filtSc = agSc.filter(s=>
    (ft==="all"||s.type===ft) &&
    (!q||s.input.toLowerCase().includes(q.toLowerCase())||(s.tags||[]).some(t=>t.includes(q.toLowerCase())))
  );

  const addScenario = () => {
    if(!scForm.input||!scForm.expectedOutput) return;
    const s={id:uid(),...scForm,tags:scForm.tags.split(",").map(t=>t.trim()).filter(Boolean),active:true,createdAt:Date.now()};
    setSc(p=>({...p,[agent]:[...(p[agent]||[]),s]}));
    setScFm({type:"ideal",input:"",expectedOutput:"",tags:"",notes:""}); setAddSc(false); toast$("✓ Scenario saved");
  };
  const toggleSc = id => setSc(p=>({...p,[agent]:p[agent].map(s=>s.id===id?{...s,active:!s.active}:s)}));
  const delSc    = id => { setSc(p=>({...p,[agent]:p[agent].filter(s=>s.id!==id)})); toast$("Scenario removed"); };

  // ── Test ──────────────────────────────────────────────────────────────────
  const runTest = async () => {
    if(!ti) return; setTg(true); setTR(null);
    await new Promise(r=>setTimeout(r,1100));
    const words = str=>str.toLowerCase().split(/\s+/).filter(w=>w.length>4);
    const score = s=>words(s.input).filter(w=>ti.toLowerCase().includes(w)).length;
    const active=agSc.filter(s=>s.active);
    const guards=active.filter(s=>s.type==="guardrail");
    const hg=guards.reduce((b,g)=>score(g)>score(b||{input:""}) ? g:b, null);
    const hn=active.reduce((b,s)=>score(s)>score(b||{input:""}) ? s:b, null);
    const hit=(hg&&score(hg)>0)?hg:(hn&&score(hn)>0)?hn:null;
    // Also check KB P1 overrides
    const kbHit=kb.filter(k=>k.active&&k.priority==="P1").find(k=>
      words(k.title+' '+k.content).filter(w=>ti.toLowerCase().includes(w)).length>0
    );
    const conf=hit?(hit.type==="guardrail"?99:Math.floor(78+Math.random()*18)):Math.floor(18+Math.random()*28);
    setTR({scenario:hit,kbHit,type:hit?hit.type:"no-match",confidence:conf,
      output:hit?hit.expectedOutput:"No matching scenario found. Consider adding this as a new training case."});
    setTg(false);
  };

  // ── KB CRUD ───────────────────────────────────────────────────────────────
  const filtKb = kb.filter(k=>
    (kbCat==="all"||k.cat===kbCat) &&
    (kbPri==="all"||k.priority===kbPri) &&
    (!kbQ||k.title.toLowerCase().includes(kbQ.toLowerCase())||k.content.toLowerCase().includes(kbQ.toLowerCase())||(k.tags||[]).some(t=>t.includes(kbQ.toLowerCase())))
  );

  const addKbEntry = () => {
    if(!kbForm.title||!kbForm.content) return;
    const e={id:uid(),...kbForm,tags:kbForm.tags.split(",").map(t=>t.trim()).filter(Boolean),active:true,createdAt:Date.now()};
    setKb(p=>[...p,e]); setKbFm({cat:"clinical",priority:"P2",title:"",content:"",agents:[],tags:""}); setAddKb(false); toast$("✓ KB entry saved");
  };
  const toggleKb = id => setKb(p=>p.map(k=>k.id===id?{...k,active:!k.active}:k));
  const delKb    = id => { setKb(p=>p.filter(k=>k.id!==id)); setKbView(null); toast$("KB entry removed"); };
  const delFile  = id => { setFiles(p=>p.filter(f=>f.id!==id)); toast$("File removed"); };

  const handleFiles = async (fileList) => {
    const newFiles = Array.from(fileList).filter(f => {
      const ext = "."+f.name.split(".").pop().toLowerCase();
      return ACCEPTED.includes(ext) && f.size < 10*1024*1024; // 10MB max
    });
    if(!newFiles.length) { toast$("⚠ Unsupported file type or file too large (max 10MB)"); return; }
    setParsing(true);
    for (const file of newFiles) {
      const content = await parseFile(file);
      const entry = {
        id: uid(), name: file.name, size: file.size, type: file.type,
        ext: file.name.split(".").pop().toLowerCase(),
        content, uploadedAt: Date.now(), cat: kbForm.cat || "clinical", agents: [], tags: []
      };
      setFiles(p=>[...p, entry]);
    }
    setParsing(false);
    toast$(`✓ ${newFiles.length} file${newFiles.length>1?"s":""} uploaded and parsed`);
  };

  const onDrop = e => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); };
  const onDragOver = e => { e.preventDefault(); setDrag(true); };
  const onDragLeave = () => setDrag(false);
  const toggleKbAgent = ag => setKbFm(p=>({...p,agents:p.agents.includes(ag)?p.agents.filter(x=>x!==ag):[...p.agents,ag]}));


  // ── CALL INTELLIGENCE ─────────────────────────────────────────────────────
  const ciHiddenCount = hideMissed ? ciCalls.filter(c => c.duration===0 || c.status==="missed" || c.status==="not_answered").length : 0;
  const ciFiltered = ciCalls.filter(call => {
    if (hideMissed && (call.duration===0 || call.status==="missed" || call.status==="not_answered")) return false;
    const matchDir = ciFilter==="all" || call.direction===ciFilter || call.status===ciFilter ||
      (ciFilter==="missed" && (call.status==="missed"||call.status==="not_answered")) ||
      (CI_TOPICS.find(t=>t.id===ciFilter) && (call.topics||[]).includes(ciFilter));
    const matchQ = !ciSearch || call.agent_name?.toLowerCase().includes(ciSearch.toLowerCase()) ||
      call.client_number?.includes(ciSearch) || (call.transcript||"").toLowerCase().includes(ciSearch.toLowerCase()) ||
      (call.summary||"").toLowerCase().includes(ciSearch.toLowerCase());
    return matchDir && matchQ;
  });

  const pullCalls = async () => {
    if(!ciConfig.apiKey) { toast$("⚠ Enter your SmartFlo API key first"); setShowConn(true); return; }
    setPulling(true); setPullMsg("Authenticating with SmartFlo…");
    try {
      // Build query params
      const params = new URLSearchParams({ limit:50, page:1 });
      if(ciConfig.dateFrom) params.append("start_date", ciConfig.dateFrom);
      if(ciConfig.dateTo)   params.append("end_date",   ciConfig.dateTo);
      if(ciConfig.direction!=="all") params.append("direction", ciConfig.direction);

      setPullMsg("Fetching call records from SmartFlo API…");
      const railwayUrl = import.meta.env.VITE_RAILWAY_URL || '';
      const resp = await fetch(`${railwayUrl}/api/smartflo/calls?${params}`, {
        headers: { "x-smartflo-token": ciConfig.apiKey, accept: "application/json" }
      });

      if(!resp.ok) throw new Error(`API error ${resp.status}: ${resp.statusText}`);
      const data = await resp.json();
      const records = data.results || [];
      setPullMsg(`Got ${records.length} calls. Processing…`);

      // Map to our format (skip already-imported call_ids)
      const existing = new Set(ciCalls.map(c=>c.call_id));
      const newCalls = records
        .filter(r => !existing.has(r.call_id))
        .map(r => ({
          id: uid(), call_id: r.call_id, direction: r.direction,
          status: r.status, date: r.date, time: r.time,
          duration: r.call_duration, answered_seconds: r.answered_seconds,
          agent_name: r.agent_name, client_number: r.client_number,
          did_number: r.did_number, recording_url: r.recording_url,
          transcript: null, summary: null, topics: [], sentiment: null,
          importedAt: Date.now()
        }));

      setCiCalls(prev => [...newCalls, ...prev]);
      setPullMsg(`✓ Imported ${newCalls.length} new calls (${records.length - newCalls.length} already existed).`);
      setTimeout(()=>{ setPulling(false); setPullMsg(""); }, 3000);
    } catch(err) {
      setPullMsg(""); setPulling(false);
      toast$(`✗ ${err.message}`);
    }
  };

  const fetchLatestCalls = async () => {
    setFetching(true); setFetchMsg("Triggering backend fetch...");
    try {
      const railwayUrl = import.meta.env.VITE_RAILWAY_URL || '';
      const resp = await fetch(`${railwayUrl}/api/cron/fetch-calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-cron-secret': import.meta.env.VITE_CRON_SECRET || '' },
      });
      if (!resp.ok) { const err = await resp.json().catch(()=>({})); throw new Error(err.error || `HTTP ${resp.status}`); }
      const result = await resp.json();
      setFetchMsg(`Fetched ${result.fetched} calls. Refreshing...`);
      const calls = await loadCalls();
      if (calls?.length) setCiCalls(calls);
      setFetchMsg(`Done! ${result.fetched} calls synced.`);
      toast$(`✓ ${result.fetched} calls fetched, ${result.upserted} saved`);
      setTimeout(() => { setFetching(false); setFetchMsg(""); }, 3000);
    } catch (err) {
      setFetchMsg(""); setFetching(false);
      toast$(`✗ Fetch failed: ${err.message}`);
    }
  };

  const transcribeAndTag = async (callId) => {
    const call = ciCalls.find(c=>c.id===callId);
    if(!call || processingId) return;
    setProcessingId(callId);
    try {
      const railwayUrl = import.meta.env.VITE_RAILWAY_URL || '';
      const resp = await fetch(`${railwayUrl}/api/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId }),
      });
      if (!resp.ok) { const err = await resp.json().catch(()=>({})); throw new Error(err.error || `HTTP ${resp.status}`); }
      const result = await resp.json();

      setCiCalls(prev => prev.map(c => c.id===callId ? {
        ...c,
        transcript: result.transcript || "Transcript unavailable",
        summary: result.analysis?.summary || "",
        topics: result.analysis?.topics || [],
        sentiment: result.analysis?.sentiment || "neutral",
        key_insights: result.analysis?.key_insights || [],
        training_opportunity: result.analysis?.training_opportunity || null,
        processed_at: new Date().toISOString(),
      } : c));
      toast$("✓ Call transcribed with Deepgram + analyzed");
    } catch(err) {
      toast$("✗ Processing failed: " + err.message);
    }
    setProcessingId(null);
  };

  const processAll = async () => {
    const unprocessed = ciCalls.filter(c=>!c.transcript);
    setBatchProcessing(true); setBatchProgress({done:0, total:Math.min(unprocessed.length,10)});
    for(let i=0;i<Math.min(unprocessed.length,10);i++) {
      await transcribeAndTag(unprocessed[i].id);
      setBatchProgress({done:i+1, total:Math.min(unprocessed.length,10)});
      await new Promise(r=>setTimeout(r,500));
    }
    setBatchProcessing(false); setSelectedCalls(new Set());
  };

  const batchTranscribe = async () => {
    const ids = [...selectedCalls];
    if(!ids.length) return;
    setBatchProcessing(true); setBatchProgress({done:0, total:ids.length});
    for(let i=0;i<ids.length;i++) {
      await transcribeAndTag(ids[i]);
      setBatchProgress({done:i+1, total:ids.length});
      await new Promise(r=>setTimeout(r,500));
    }
    setBatchProcessing(false); setSelectedCalls(new Set());
  };

  const toggleSelectCall = (callId) => {
    setSelectedCalls(prev => {
      const next = new Set(prev);
      if(next.has(callId)) next.delete(callId); else next.add(callId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if(selectedCalls.size===ciFiltered.length && ciFiltered.length>0) {
      setSelectedCalls(new Set());
    } else {
      setSelectedCalls(new Set(ciFiltered.map(c=>c.id)));
    }
  };

  const addCallAsScenario = (call) => {
    if(!call.training_opportunity) return;
    setScFm({type:"edge", input:call.training_opportunity, expectedOutput:"", tags:call.topics||[], notes:`From call ${call.call_id} on ${call.date}`});
    setPg("agents"); setAddSc(true);
    toast$("Pre-filled scenario from call insight");
  };

  const sentColor = s => s==="positive"?"#059669":s==="negative"?"#DC2626":"#D97706";
  const sentBg    = s => s==="positive"?"#ECFDF5":s==="negative"?"#FEF2F2":"#FFFBEB";
  const sentIcon  = s => s==="positive"?"😊":s==="negative"?"😟":"😐";

  if(loading) return (
    <div style={{fontFamily:"'Inter',sans-serif",background:"#F8FAFC",minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{textAlign:"center",color:"#6B7280"}}><div style={{fontSize:36,marginBottom:12}}>⚕️</div><div style={{fontSize:14,fontWeight:500}}>Loading…</div></div>
    </div>
  );

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div style={{fontFamily:"'Inter',sans-serif",background:"#F8FAFC",minHeight:"100vh",color:"#111827",display:"flex",flexDirection:"column"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:#F1F5F9} ::-webkit-scrollbar-thumb{background:#CBD5E1;border-radius:2px}
        .nav-item{display:flex;align-items:center;gap:8px;padding:7px 12px;border-radius:8px;cursor:pointer;font-size:13.5px;color:#6B7280;font-weight:500;transition:all .15s}
        .nav-item:hover{background:#F1F5F9;color:#111827}
        .nav-item.on{background:#EEF2FF;color:#4F46E5;font-weight:600}
        .pg-btn{display:flex;align-items:center;gap:7px;padding:8px 16px;border-radius:8px;font-size:13.5px;font-weight:500;cursor:pointer;border:none;transition:all .15s;font-family:'Inter',sans-serif}
        .pg-btn.on{background:#EEF2FF;color:#4F46E5;font-weight:700}
        .pg-btn:not(.on){background:transparent;color:#6B7280}
        .pg-btn:not(.on):hover{background:#F1F5F9;color:#374151}
        .card{background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:20px}
        .bp{background:#4F46E5;color:#fff;border:none;font-weight:600;cursor:pointer;transition:all .15s;font-family:'Inter',sans-serif}
        .bp:hover{background:#4338CA} .bp:disabled{opacity:.4;cursor:not-allowed}
        .bo{background:#fff;border:1.5px solid #E5E7EB;color:#374151;font-weight:500;cursor:pointer;transition:all .15s;font-family:'Inter',sans-serif}
        .bo:hover{border-color:#D1D5DB;background:#F9FAFB}
        .inp{background:#fff;border:1.5px solid #E5E7EB;color:#111827;border-radius:8px;padding:9px 13px;font-family:'Inter',sans-serif;font-size:14px;width:100%;transition:border-color .15s;resize:vertical}
        .inp:focus{outline:none;border-color:#6366F1;box-shadow:0 0 0 3px rgba(99,102,241,.08)}
        .srow{background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:14px 16px;transition:all .15s}
        .srow:hover{border-color:#D1D5DB;box-shadow:0 1px 6px rgba(0,0,0,.06)}
        .krow{background:#fff;border:1px solid #E5E7EB;border-radius:10px;padding:0;overflow:hidden;transition:all .15s}
        .krow:hover{border-color:#D1D5DB;box-shadow:0 1px 6px rgba(0,0,0,.06)}
        .pill{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:20px;font-size:11px;font-weight:600}
        .tag{background:#F1F5F9;color:#6B7280;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:500;display:inline-block}
        .flt{padding:5px 13px;border-radius:20px;border:1.5px solid #E5E7EB;background:#fff;font-family:'Inter',sans-serif;font-size:12px;font-weight:500;color:#6B7280;cursor:pointer;transition:all .15s}
        .flt.on{font-weight:600}
        .tab-btn{padding:7px 16px;border-radius:8px;border:none;background:transparent;font-family:'Inter',sans-serif;font-size:13.5px;font-weight:500;color:#6B7280;cursor:pointer;transition:all .15s;border-bottom:2px solid transparent;border-radius:8px 8px 0 0}
        .tab-btn.on{background:#EEF2FF;color:#4F46E5;font-weight:600;border-bottom-color:#4F46E5}
        .mov{position:fixed;inset:0;background:rgba(0,0,0,.4);backdrop-filter:blur(4px);z-index:100;display:flex;align-items:center;justify-content:center;animation:fi .2s}
        .mod{background:#fff;border:1px solid #E5E7EB;border-radius:16px;padding:28px;width:600px;max-width:96vw;max-height:92vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.12)}
        .ag-chip{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:500;cursor:pointer;border:1.5px solid #E5E7EB;background:#fff;transition:all .15s;font-family:'Inter',sans-serif}
        .ag-chip.on{border-color:#4F46E5;background:#EEF2FF;color:#4F46E5}
        .tw{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:200;animation:su .25s ease}
        .dlc{background:#fff;border:1.5px solid #E5E7EB;border-radius:12px;padding:16px;cursor:pointer;transition:all .15s}
        .dlc:hover{border-color:#6366F1;box-shadow:0 2px 12px rgba(99,102,241,.12);transform:translateY(-1px)}
        @keyframes fi{from{opacity:0}to{opacity:1}}
        @keyframes su{from{transform:translateX(-50%) translateY(8px);opacity:0}to{transform:translateX(-50%) translateY(0);opacity:1}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}} .pls{animation:pulse 1.3s infinite}
        @keyframes spin{to{transform:rotate(360deg)}}
      `}</style>

      {/* ══ TOP NAV ══════════════════════════════════════════════════════════ */}
      <div style={{background:"#fff",borderBottom:"1px solid #E5E7EB",padding:"0 24px",height:56,display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:50,gap:16}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:32,height:32,background:"#4F46E5",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>⚕️</div>
          <span style={{fontSize:15,fontWeight:700,letterSpacing:"-.3px"}}>DecentCare</span>
          <span style={{fontSize:13,color:"#9CA3AF",marginLeft:2}}>AI Training Studio</span>
        </div>

        {/* Page switcher */}
        <div style={{display:"flex",gap:4,background:"#F8FAFC",borderRadius:10,padding:3,border:"1px solid #E5E7EB"}}>
          <button className={`pg-btn${page==="agents"?" on":""}`} onClick={()=>setPg("agents")}>🤖 Agent Training</button>
          <button className={`pg-btn${page==="kb"?" on":""}`} onClick={()=>setPg("kb")}>📚 Knowledge Base</button>
          <button className={`pg-btn${page==="ci"?" on":""}`} onClick={()=>setPg("ci")}>CI Call Intelligence</button>
        </div>

        <div style={{display:"flex",alignItems:"center",gap:14}}>
          <div style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:"#9CA3AF"}}>
            {svSt==="saving"&&<><span style={{width:7,height:7,border:"1.5px solid #F59E0B",borderTopColor:"transparent",borderRadius:"50%",display:"inline-block",animation:"spin .7s linear infinite"}} /><span style={{color:"#F59E0B"}}>Saving…</span></>}
            {svSt==="saved" &&<><span style={{width:7,height:7,borderRadius:"50%",background:"#10B981",display:"inline-block"}} /><span style={{color:"#10B981"}}>Saved</span></>}
            {svSt==="error" &&<span style={{color:"#EF4444"}}>⚠ Save failed</span>}
            {svSt==="idle"  &&savedAt&&<><span style={{width:7,height:7,borderRadius:"50%",background:"#D1D5DB",display:"inline-block"}} /><span>Saved {fmtT(savedAt)}</span></>}
          </div>
          <button className="bo" style={{padding:"6px 14px",borderRadius:8,fontSize:13,display:"flex",alignItems:"center",gap:5}} onClick={()=>setDL(true)}>⬇ Export</button>
          <button className="bp" style={{padding:"6px 14px",borderRadius:8,fontSize:13}}>🚀 Push to Production</button>
        </div>
      </div>

      <div style={{display:"flex",flex:1}}>
        {/* ══ SIDEBAR ════════════════════════════════════════════════════════ */}
        <div style={{width:220,flexShrink:0,borderRight:"1px solid #E5E7EB",background:"#fff",padding:"20px 12px",position:"sticky",top:56,height:"calc(100vh - 56px)",overflowY:"auto"}}>
          {page==="agents" ? (<>
            <div style={{fontSize:11,fontWeight:600,color:"#9CA3AF",letterSpacing:.8,marginBottom:6,paddingLeft:4}}>PRE-SURGERY</div>
            {AGENTS.slice(0,4).map(ag=>{
              const cnt=(sc[ag.id]||[]).length; const on=ag.id===agent;
              return (
                <div key={ag.id} className={`nav-item${on?" on":""}`} onClick={()=>{setAg(ag.id);setFt("all");setQ("");setTR(null);setTI("");}}>
                  <span style={{fontSize:15}}>{ag.icon}</span>
                  <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis"}}>{ag.name}</span>
                  {cnt>0&&<span style={{fontSize:11,background:on?"#C7D2FE":"#F3F4F6",color:on?"#4F46E5":"#9CA3AF",borderRadius:10,padding:"1px 7px",fontWeight:600}}>{cnt}</span>}
                </div>
              );
            })}
            <div style={{fontSize:11,fontWeight:600,color:"#9CA3AF",letterSpacing:.8,margin:"16px 0 6px",paddingLeft:4}}>POST-SURGERY</div>
            {AGENTS.slice(4).map(ag=>{
              const cnt=(sc[ag.id]||[]).length; const on=ag.id===agent;
              return (
                <div key={ag.id} className={`nav-item${on?" on":""}`} onClick={()=>{setAg(ag.id);setFt("all");setQ("");setTR(null);setTI("");}}>
                  <span style={{fontSize:15}}>{ag.icon}</span>
                  <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis"}}>{ag.name}</span>
                  {cnt>0&&<span style={{fontSize:11,background:on?"#C7D2FE":"#F3F4F6",color:on?"#4F46E5":"#9CA3AF",borderRadius:10,padding:"1px 7px",fontWeight:600}}>{cnt}</span>}
                </div>
              );
            })}
            <div style={{marginTop:20,borderTop:"1px solid #F3F4F6",paddingTop:16}}>
              <div style={{fontSize:11,fontWeight:600,color:"#9CA3AF",letterSpacing:.8,marginBottom:8,paddingLeft:4}}>SCENARIO TYPES</div>
              {STYPES.map(t=>(
                <div key={t.id} style={{display:"flex",alignItems:"center",gap:7,padding:"3px 4px",marginBottom:3}}>
                  <div style={{width:7,height:7,borderRadius:"50%",background:t.color,flexShrink:0}} />
                  <span style={{fontSize:12,color:"#6B7280",fontWeight:500}}>{t.label}</span>
                </div>
              ))}
            </div>
          </>) : page==="kb" ? (<>
            <div style={{fontSize:11,fontWeight:600,color:"#9CA3AF",letterSpacing:.8,marginBottom:6,paddingLeft:4}}>CATEGORIES</div>
            {[{id:"all",label:"All Entries",icon:"📋",color:"#4F46E5"},...KB_CATS].map(c=>{
              const cnt=c.id==="all"?kb.length:kb.filter(k=>k.cat===c.id).length;
              const on=kbCat===c.id;
              return (
                <div key={c.id} className={`nav-item${on?" on":""}`} onClick={()=>setKbCat(c.id)}>
                  <span style={{fontSize:15}}>{c.icon}</span>
                  <span style={{flex:1,overflow:"hidden",textOverflow:"ellipsis"}}>{c.id==="all"?"All Entries":c.label.split(" ").slice(0,2).join(" ")}</span>
                  <span style={{fontSize:11,background:on?"#C7D2FE":"#F3F4F6",color:on?"#4F46E5":"#9CA3AF",borderRadius:10,padding:"1px 7px",fontWeight:600}}>{cnt}</span>
                </div>
              );
            })}
            <div style={{marginTop:20,borderTop:"1px solid #F3F4F6",paddingTop:16}}>
              <div style={{fontSize:11,fontWeight:600,color:"#9CA3AF",letterSpacing:.8,marginBottom:8,paddingLeft:4}}>PRIORITY TIERS</div>
              {KB_PRIORITIES.map(p=>(
                <div key={p.id} style={{display:"flex",alignItems:"flex-start",gap:7,padding:"4px 4px",marginBottom:5}}>
                  <div style={{width:7,height:7,borderRadius:"50%",background:kpi(p.id),flexShrink:0,marginTop:4}} />
                  <div>
                    <div style={{fontSize:12,color:"#374151",fontWeight:600}}>{p.id}</div>
                    <div style={{fontSize:11,color:"#9CA3AF"}}>{p.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </>) : null}
          {page==="ci"&&(<>
            <div style={{fontSize:11,fontWeight:600,color:"#9CA3AF",letterSpacing:.8,marginBottom:6,paddingLeft:4}}>CALL FILTERS</div>
            {[
              {id:"all",     label:"All Calls",  icon:"📞", cnt:ciCalls.length},
              {id:"inbound", label:"Inbound",    icon:"📥", cnt:ciCalls.filter(x=>x.direction==="inbound").length},
              {id:"outbound",label:"Outbound",   icon:"📤", cnt:ciCalls.filter(x=>x.direction==="outbound").length},
              {id:"missed",  label:"Missed",     icon:"📵", cnt:ciCalls.filter(x=>x.status==="missed"||x.status==="not_answered").length},
            ].map(item=>{
              const on=ciFilter===item.id;
              return (
                <div key={item.id} className={`nav-item${on?" on":""}`} onClick={()=>setCiFilter(item.id)}>
                  <span>{item.icon}</span>
                  <span style={{flex:1}}>{item.label}</span>
                  <span style={{fontSize:11,background:on?"#C7D2FE":"#F3F4F6",color:on?"#4F46E5":"#9CA3AF",borderRadius:10,padding:"1px 7px",fontWeight:600}}>{item.cnt}</span>
                </div>
              );
            })}
            <div style={{fontSize:11,fontWeight:600,color:"#9CA3AF",letterSpacing:.8,margin:"16px 0 6px",paddingLeft:4}}>TOPIC BUCKETS</div>
            {CI_TOPICS.map(t=>{
              const cnt=ciCalls.filter(x=>(x.topics||[]).includes(t.id)).length;
              return (
                <div key={t.id} className={`nav-item${ciFilter===t.id?" on":""}`} onClick={()=>setCiFilter(ciFilter===t.id?"all":t.id)}>
                  <span>{t.icon}</span>
                  <span style={{flex:1,fontSize:12.5,overflow:"hidden",textOverflow:"ellipsis"}}>{t.label}</span>
                  {cnt>0&&<span style={{fontSize:11,background:"#F3F4F6",color:"#9CA3AF",borderRadius:10,padding:"1px 6px",fontWeight:600}}>{cnt}</span>}
                </div>
              );
            })}
          </>)}
        </div>

        {/* ══ MAIN ═══════════════════════════════════════════════════════════ */}
        <div style={{flex:1,padding:"28px",overflow:"auto",minWidth:0}}>

          {/* ── AGENTS PAGE ─────────────────────────────────────────────── */}
          {page==="agents" && (<>
            <div style={{marginBottom:22,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <h1 style={{fontSize:22,fontWeight:700,letterSpacing:"-.4px"}}>{cur?.icon} {cur?.name}</h1>
                <p style={{fontSize:13.5,color:"#9CA3AF",marginTop:3}}>{cur?.stage} · <span style={{color:cur?.color,fontWeight:600}}>{agSc.filter(s=>s.active).length} active</span> · {agSc.filter(s=>s.type==="guardrail").length} guardrails · {agSc.filter(s=>s.type==="edge").length} edge cases</p>
              </div>
              <div style={{display:"flex",gap:8}}>
                <button className="bo" style={{padding:"8px 16px",borderRadius:9,fontSize:13.5}} onClick={()=>setTab("test")}>⚡ Test Agent</button>
                <button className="bp" style={{padding:"8px 16px",borderRadius:9,fontSize:13.5}} onClick={()=>setAddSc(true)}>+ Add Scenario</button>
              </div>
            </div>

            {/* Stat row */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:22}}>
              {[
                {label:"Total Scenarios",value:agSc.length,                                    color:"#4F46E5",icon:"📝"},
                {label:"Active",         value:agSc.filter(s=>s.active).length,                color:"#059669",icon:"✅"},
                {label:"Guardrails",     value:agSc.filter(s=>s.type==="guardrail").length,    color:"#DC2626",icon:"🛡️"},
                {label:"KB Entries",     value:kb.filter(k=>k.agents.includes(agent)).length,  color:"#0891B2",icon:"📚"},
              ].map(s=>(
                <div key={s.label} className="card" style={{padding:"16px 20px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div><div style={{fontSize:26,fontWeight:700,color:s.color,lineHeight:1}}>{s.value}</div><div style={{fontSize:12.5,color:"#9CA3AF",marginTop:4,fontWeight:500}}>{s.label}</div></div>
                    <div style={{fontSize:22,opacity:.7}}>{s.icon}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div style={{display:"flex",gap:4,marginBottom:18,borderBottom:"1px solid #E5E7EB"}}>
              {["scenarios","test","coverage"].map(t=>(
                <button key={t} className={`tab-btn${tab===t?" on":""}`} style={{marginBottom:-1}} onClick={()=>setTab(t)}>
                  {t==="scenarios"?"📝 Scenarios":t==="test"?"⚡ Live Test":"📊 Coverage"}
                </button>
              ))}
            </div>

            {/* ── SCENARIOS ── */}
            {tab==="scenarios"&&(<>
              <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
                <div style={{position:"relative",flex:1,minWidth:180}}>
                  <span style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",color:"#9CA3AF"}}>🔍</span>
                  <input className="inp" style={{paddingLeft:34}} placeholder="Search scenarios or tags…" value={q} onChange={e=>setQ(e.target.value)} />
                </div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {[{id:"all",label:"All",color:"#6B7280",bg:"#F9FAFB"},...STYPES].map(t=>(
                    <button key={t.id} className={`flt${ft===t.id?" on":""}`}
                      style={{borderColor:ft===t.id?t.color:"#E5E7EB",background:ft===t.id?t.bg:"#fff",color:ft===t.id?t.color:"#6B7280"}}
                      onClick={()=>setFt(t.id)}>{t.label}</button>
                  ))}
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {filtSc.length===0&&(
                  <div style={{textAlign:"center",padding:"52px",color:"#9CA3AF"}}>
                    <div style={{fontSize:32,marginBottom:10}}>📭</div>
                    <div style={{fontSize:15,fontWeight:500,color:"#6B7280"}}>No scenarios yet</div>
                    <button className="bp" style={{marginTop:16,padding:"8px 18px",borderRadius:9,fontSize:13}} onClick={()=>setAddSc(true)}>+ Add Scenario</button>
                  </div>
                )}
                {filtSc.map(s=>(
                  <div key={s.id} className="srow" style={{opacity:s.active?1:.5}}>
                    <div style={{display:"flex",gap:14,alignItems:"flex-start"}}>
                      <span className="pill" style={{background:stbg(s.type),color:stc(s.type),flexShrink:0,marginTop:2}}>
                        <span style={{width:5,height:5,borderRadius:"50%",background:stc(s.type),display:"inline-block"}} />{stl(s.type)}
                      </span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1px 1fr",gap:14}}>
                          <div>
                            <div style={{fontSize:11,fontWeight:600,color:"#9CA3AF",marginBottom:3,textTransform:"uppercase",letterSpacing:.5}}>Trigger</div>
                            <div style={{fontSize:13.5,color:"#111827",lineHeight:1.55}}>{s.input}</div>
                          </div>
                          <div style={{background:"#E5E7EB"}} />
                          <div>
                            <div style={{fontSize:11,fontWeight:600,color:"#9CA3AF",marginBottom:3,textTransform:"uppercase",letterSpacing:.5}}>Expected Output</div>
                            <div style={{fontSize:13.5,color:"#6B7280",lineHeight:1.55}}>{s.expectedOutput}</div>
                          </div>
                        </div>
                        <div style={{display:"flex",gap:6,marginTop:9,flexWrap:"wrap",alignItems:"center"}}>
                          {(s.tags||[]).map(t=><span key={t} className="tag">{t}</span>)}
                          {s.notes&&<span style={{fontSize:12,color:"#9CA3AF",fontStyle:"italic"}}>💡 {s.notes}</span>}
                          <span style={{fontSize:11,color:"#D1D5DB",marginLeft:"auto"}}>Added {fmtT(s.createdAt)}</span>
                        </div>
                      </div>
                      <div style={{display:"flex",gap:5,flexShrink:0}}>
                        <button className="bo" style={{width:30,height:30,borderRadius:7,fontSize:12,display:"flex",alignItems:"center",justifyContent:"center",padding:0}} onClick={()=>toggleSc(s.id)}>{s.active?"⏸":"▶"}</button>
                        <button className="bo" style={{width:30,height:30,borderRadius:7,fontSize:11,display:"flex",alignItems:"center",justifyContent:"center",padding:0,color:"#EF4444",borderColor:"#FEE2E2"}} onClick={()=>delSc(s.id)}>✕</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>)}

            {/* ── TEST ── */}
            {tab==="test"&&(
              <div style={{maxWidth:680}}>
                <div className="card" style={{marginBottom:18}}>
                  <div style={{fontSize:15,fontWeight:600,marginBottom:4}}>Live Agent Simulation</div>
                  <div style={{fontSize:13,color:"#9CA3AF",marginBottom:16}}>Tests against all active scenarios <b>and</b> P1 KB overrides for this agent.</div>
                  <textarea className="inp" rows={4} placeholder="Enter patient input…" value={ti} onChange={e=>setTI(e.target.value)} style={{marginBottom:12}} />
                  <button className="bp" style={{padding:"9px 22px",borderRadius:9,fontSize:14,display:"flex",alignItems:"center",gap:8}} onClick={runTest} disabled={testing||!ti}>
                    {testing?<><span className="pls">⏳</span> Analysing…</>:<>⚡ Run Simulation</>}
                  </button>
                </div>
                {tr&&(
                  <div className="card" style={{borderLeft:`3px solid ${stc(tr.type)}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                        <span className="pill" style={{background:stbg(tr.type),color:stc(tr.type)}}>
                          <span style={{width:5,height:5,borderRadius:"50%",background:stc(tr.type),display:"inline-block"}} />{tr.type==="no-match"?"No Match":stl(tr.type)}
                        </span>
                        {tr.type==="guardrail"&&<span style={{fontSize:12,color:"#DC2626",fontWeight:600}}>🛡️ Guardrail triggered</span>}
                        {tr.kbHit&&<span className="pill" style={{background:"#ECFEFF",color:"#0891B2"}}>📚 KB P1 override active: {tr.kbHit.title}</span>}
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:11,color:"#9CA3AF",fontWeight:500}}>Confidence</div>
                        <div style={{fontSize:24,fontWeight:700,color:tr.confidence>70?"#059669":tr.confidence>50?"#D97706":"#DC2626"}}>{tr.confidence}%</div>
                      </div>
                    </div>
                    <div style={{background:"#F8FAFC",borderRadius:8,padding:"12px 14px",marginBottom:10}}>
                      <div style={{fontSize:11,fontWeight:600,color:"#9CA3AF",marginBottom:4}}>AGENT RESPONSE</div>
                      <div style={{fontSize:14,color:"#111827",lineHeight:1.6}}>{tr.output}</div>
                    </div>
                    {tr.kbHit&&(
                      <div style={{background:"#ECFEFF",borderRadius:8,padding:"10px 13px",marginBottom:10,border:"1px solid #A5F3FC"}}>
                        <div style={{fontSize:11,fontWeight:600,color:"#0891B2",marginBottom:3}}>📚 KB CONTEXT APPLIED — {tr.kbHit.title}</div>
                        <div style={{fontSize:12.5,color:"#0E7490",lineHeight:1.5}}>{tr.kbHit.content.slice(0,180)}…</div>
                      </div>
                    )}
                    <div style={{background:"#F3F4F6",borderRadius:4,height:5,overflow:"hidden"}}>
                      <div style={{width:`${tr.confidence}%`,height:"100%",background:tr.confidence>70?"#059669":tr.confidence>50?"#D97706":"#DC2626",borderRadius:4,transition:"width .6s"}} />
                    </div>
                    {tr.type==="no-match"&&<button className="bp" style={{marginTop:14,padding:"7px 16px",borderRadius:9,fontSize:13}} onClick={()=>{setAddSc(true);setScFm(p=>({...p,input:ti}));}}>+ Add as Training Scenario</button>}
                  </div>
                )}
                <div style={{marginTop:18}}>
                  <div style={{fontSize:12,fontWeight:600,color:"#9CA3AF",marginBottom:8,textTransform:"uppercase",letterSpacing:.5}}>Quick Samples</div>
                  {agSc.slice(0,4).map(s=>(
                    <button key={s.id} className="bo" style={{padding:"7px 12px",borderRadius:8,fontSize:13,textAlign:"left",display:"flex",alignItems:"center",gap:7,marginBottom:5,width:"100%"}} onClick={()=>setTI(s.input)}>
                      <span style={{width:6,height:6,borderRadius:"50%",background:stc(s.type),flexShrink:0,display:"inline-block"}} />
                      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.input}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── COVERAGE ── */}
            {tab==="coverage"&&(
              <div style={{maxWidth:700}}>
                <div style={{fontSize:14,fontWeight:600,marginBottom:12}}>Coverage by Scenario Type</div>
                <div style={{display:"flex",flexDirection:"column",gap:9,marginBottom:22}}>
                  {STYPES.map(t=>{
                    const cnt=agSc.filter(s=>s.type===t.id).length;
                    const pct=agSc.length?Math.round(cnt/agSc.length*100):0;
                    return (
                      <div key={t.id} className="card" style={{padding:"13px 18px"}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                          <span className="pill" style={{background:t.bg,color:t.color}}>
                            <span style={{width:5,height:5,borderRadius:"50%",background:t.color,display:"inline-block"}} />{t.label}
                          </span>
                          <span style={{fontSize:13,fontWeight:600,color:t.color}}>{cnt} · {pct}%</span>
                        </div>
                        <div style={{background:"#F3F4F6",borderRadius:4,height:6,overflow:"hidden"}}>
                          <div style={{width:`${pct}%`,height:"100%",background:t.color,borderRadius:4,transition:"width .8s"}} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="card" style={{borderLeft:"3px solid #F59E0B"}}>
                  <div style={{fontSize:14,fontWeight:600,marginBottom:10}}>⚠️ Suggested Coverage Gaps</div>
                  {["Multilingual edge cases (Hindi, Tamil, Telugu)","Insurance rejection & appeal workflows","No-show follow-up escalation","Emotionally distressed patient handling","After-hours and holiday scenarios"].map((g,i)=>(
                    <div key={i} style={{display:"flex",gap:8,fontSize:13.5,color:"#6B7280",marginBottom:8}}>
                      <span style={{color:"#F59E0B",fontWeight:700}}>→</span>{g}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>)}

          {/* ── KB PAGE ─────────────────────────────────────────────────── */}
          {page==="kb"&&(<>
            <div style={{marginBottom:22,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <h1 style={{fontSize:22,fontWeight:700,letterSpacing:"-.4px"}}>📚 Knowledge Base</h1>
                <p style={{fontSize:13.5,color:"#9CA3AF",marginTop:3}}>
                  <span style={{color:"#4F46E5",fontWeight:600}}>{kb.filter(k=>k.active).length} active entries</span> · {kb.filter(k=>k.priority==="P1").length} P1 overrides · {kb.filter(k=>k.priority==="P2").length} P2 references · {kb.filter(k=>k.priority==="P3").length} P3 supplements
                </p>
              </div>
              <div style={{display:"flex",gap:8}}>
                <button className="bo" style={{padding:"8px 16px",borderRadius:9,fontSize:13.5,display:"flex",alignItems:"center",gap:6}} onClick={()=>{setKbTab("files");fileRef.current?.click();}}>⬆ Upload File</button>
                <button className="bp" style={{padding:"8px 16px",borderRadius:9,fontSize:13.5}} onClick={()=>setAddKb(true)}>+ Add Entry</button>
              </div>
            </div>

            {/* KB stats */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:22}}>
              {KB_CATS.map(c=>(
                <div key={c.id} className="card" style={{padding:"16px 20px",borderLeft:`3px solid ${c.color}`,cursor:"pointer"}} onClick={()=>setKbCat(c.id)}>
                  <div style={{fontSize:22,marginBottom:6}}>{c.icon}</div>
                  <div style={{fontSize:24,fontWeight:700,color:c.color}}>{kb.filter(k=>k.cat===c.id).length}</div>
                  <div style={{fontSize:12,color:"#9CA3AF",fontWeight:500,marginTop:3,lineHeight:1.4}}>{c.label.split("&")[0].trim()}</div>
                </div>
              ))}
            </div>

            {/* Priority tier explainer */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:22}}>
              {KB_PRIORITIES.map(p=>(
                <div key={p.id} style={{background:p.bg,border:`1px solid ${p.color}30`,borderRadius:10,padding:"12px 16px",cursor:"pointer",borderLeft:`3px solid ${p.color}`}} onClick={()=>setKbPri(kbPri===p.id?"all":p.id)}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                    <span style={{fontSize:13,fontWeight:700,color:p.color}}>{p.id}</span>
                    <span style={{fontSize:18,fontWeight:700,color:p.color}}>{kb.filter(k=>k.priority===p.id).length}</span>
                  </div>
                  <div style={{fontSize:12.5,fontWeight:600,color:"#374151"}}>{p.label.split("—")[1]?.trim()}</div>
                  <div style={{fontSize:11,color:"#9CA3AF",marginTop:2}}>{p.desc}</div>
                </div>
              ))}
            </div>

            {/* KB sub-tab bar */}
            <div style={{display:"flex",gap:4,marginBottom:18,borderBottom:"1px solid #E5E7EB"}}>
              {[{id:"entries",label:`📝 Entries (${filtKb.length})`},{id:"files",label:`📎 Files (${files.length})`}].map(t=>(
                <button key={t.id} className={`tab-btn${kbTab===t.id?" on":""}`} style={{marginBottom:-1}} onClick={()=>setKbTab(t.id)}>{t.label}</button>
              ))}
            </div>

            {/* Hidden file input */}
            <input ref={fileRef} type="file" multiple accept={ACCEPTED.join(",")} style={{display:"none"}} onChange={e=>handleFiles(e.target.files)} />

            {/* Filters — only shown for entries tab */}
            <div style={{display:kbTab==="entries"?"flex":"none",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
              <div style={{position:"relative",flex:1,minWidth:180}}>
                <span style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",color:"#9CA3AF"}}>🔍</span>
                <input className="inp" style={{paddingLeft:34}} placeholder="Search knowledge base…" value={kbQ} onChange={e=>setKbQ(e.target.value)} />
              </div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {[{id:"all",label:"All Priorities",color:"#6B7280",bg:"#F9FAFB"},...KB_PRIORITIES.map(p=>({id:p.id,label:p.id,color:kpi(p.id),bg:kpibg(p.id)}))].map(p=>(
                  <button key={p.id} className={`flt${kbPri===p.id?" on":""}`}
                    style={{borderColor:kbPri===p.id?p.color:"#E5E7EB",background:kbPri===p.id?p.bg:"#fff",color:kbPri===p.id?p.color:"#6B7280"}}
                    onClick={()=>setKbPri(p.id)}>{p.label}</button>
                ))}
              </div>
            </div>

            {/* KB entries — shown in entries tab */}
            <div style={{display:kbTab==="entries"?"block":"none"}}>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {filtKb.length===0&&(
                <div style={{textAlign:"center",padding:"52px",color:"#9CA3AF"}}>
                  <div style={{fontSize:32,marginBottom:10}}>📭</div>
                  <div style={{fontSize:15,fontWeight:500,color:"#6B7280"}}>No KB entries found</div>
                  <button className="bp" style={{marginTop:16,padding:"8px 18px",borderRadius:9,fontSize:13}} onClick={()=>setAddKb(true)}>+ Add KB Entry</button>
                </div>
              )}
              {filtKb.map(k=>{
                const isOpen=kbView===k.id;
                const cat=KB_CATS.find(c=>c.id===k.cat);
                return (
                  <div key={k.id} className="krow" style={{opacity:k.active?1:.5}}>
                    {/* Row header */}
                    <div style={{padding:"13px 16px",display:"flex",gap:12,alignItems:"flex-start",cursor:"pointer"}} onClick={()=>setKbView(isOpen?null:k.id)}>
                      <div style={{flexShrink:0,paddingTop:2,display:"flex",gap:6}}>
                        <span className="pill" style={{background:kpibg(k.priority),color:kpi(k.priority)}}>{k.priority}</span>
                        <span className="pill" style={{background:kcbg(k.cat),color:kcc(k.cat)}}>{cat?.icon} {cat?.label.split(" ")[0]}</span>
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:14,fontWeight:600,color:"#111827",marginBottom:4}}>{k.title}</div>
                        <div style={{fontSize:13,color:"#6B7280",lineHeight:1.4,whiteSpace:isOpen?"normal":"nowrap",overflow:isOpen?"visible":"hidden",textOverflow:isOpen?"clip":"ellipsis"}}>{k.content}</div>
                        {!isOpen&&(
                          <div style={{display:"flex",gap:5,marginTop:7,flexWrap:"wrap",alignItems:"center"}}>
                            {(k.tags||[]).map(t=><span key={t} className="tag">{t}</span>)}
                            <span style={{fontSize:11,color:"#D1D5DB",marginLeft:"auto"}}>Updated {fmtT(k.createdAt)}</span>
                          </div>
                        )}
                      </div>
                      <div style={{display:"flex",gap:5,flexShrink:0,alignItems:"center"}}>
                        <span style={{fontSize:12,color:"#9CA3AF"}}>{isOpen?"▲":"▼"}</span>
                      </div>
                    </div>

                    {/* Expanded view */}
                    {isOpen&&(
                      <div style={{padding:"0 16px 16px",borderTop:"1px solid #F3F4F6"}}>
                        <div style={{background:"#F8FAFC",borderRadius:8,padding:"12px 14px",marginTop:12,marginBottom:12}}>
                          <div style={{fontSize:11,fontWeight:600,color:"#9CA3AF",marginBottom:6,textTransform:"uppercase",letterSpacing:.5}}>Full Content</div>
                          <div style={{fontSize:14,color:"#374151",lineHeight:1.7,whiteSpace:"pre-wrap"}}>{k.content}</div>
                        </div>
                        <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:12}}>
                          <div style={{flex:1,minWidth:200}}>
                            <div style={{fontSize:11,fontWeight:600,color:"#9CA3AF",marginBottom:6,textTransform:"uppercase",letterSpacing:.5}}>Linked Agents</div>
                            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                              {k.agents?.length>0 ? k.agents.map(aid=>{
                                const ag=AGENTS.find(a=>a.id===aid);
                                return ag?<span key={aid} className="pill" style={{background:ag.bg,color:ag.color}}>{ag.icon} {ag.name}</span>:null;
                              }) : <span style={{fontSize:12,color:"#9CA3AF"}}>Not linked to specific agents</span>}
                            </div>
                          </div>
                          <div>
                            <div style={{fontSize:11,fontWeight:600,color:"#9CA3AF",marginBottom:6,textTransform:"uppercase",letterSpacing:.5}}>Tags</div>
                            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{(k.tags||[]).map(t=><span key={t} className="tag">{t}</span>)}</div>
                          </div>
                        </div>
                        <div style={{display:"flex",gap:7,justifyContent:"flex-end"}}>
                          <button className="bo" style={{padding:"6px 13px",borderRadius:8,fontSize:12}} onClick={()=>toggleKb(k.id)}>{k.active?"⏸ Disable":"▶ Enable"}</button>
                          <button className="bo" style={{padding:"6px 13px",borderRadius:8,fontSize:12,color:"#EF4444",borderColor:"#FEE2E2"}} onClick={()=>delKb(k.id)}>🗑 Delete</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            </div>{/* end entries div */}

            {/* ── FILES TAB ── */}
            {kbTab==="files"&&(
              <div>
                {/* Drop zone */}
                <div
                  onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
                  onClick={()=>fileRef.current?.click()}
                  style={{border:`2px dashed ${dragOver?"#4F46E5":"#D1D5DB"}`,borderRadius:12,padding:"36px 24px",textAlign:"center",cursor:"pointer",transition:"all .2s",background:dragOver?"#EEF2FF":"#F8FAFC",marginBottom:20}}>
                  {parsing ? (
                    <div style={{color:"#4F46E5"}}>
                      <div style={{fontSize:28,marginBottom:8,animation:"pulse 1s infinite"}}>⏳</div>
                      <div style={{fontSize:14,fontWeight:600}}>Parsing file content…</div>
                      <div style={{fontSize:12,color:"#9CA3AF",marginTop:4}}>Extracting text for agent use</div>
                    </div>
                  ) : (
                    <div>
                      <div style={{fontSize:32,marginBottom:8}}>{dragOver?"📂":"📁"}</div>
                      <div style={{fontSize:15,fontWeight:600,color:dragOver?"#4F46E5":"#374151"}}>Drop files here or click to browse</div>
                      <div style={{fontSize:13,color:"#9CA3AF",marginTop:6}}>Supports PDF, TXT, MD, CSV, DOC, DOCX · Max 10MB per file</div>
                      <div style={{marginTop:14,display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
                        {["📄 PDF","📝 TXT","📋 MD","📊 CSV","📘 DOC / DOCX"].map(l=>(
                          <span key={l} style={{background:"#fff",border:"1px solid #E5E7EB",borderRadius:6,padding:"3px 10px",fontSize:12,color:"#6B7280"}}>{l}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Files list */}
                {files.length===0 ? (
                  <div style={{textAlign:"center",padding:"32px",color:"#9CA3AF"}}>
                    <div style={{fontSize:13}}>No files uploaded yet. Drag and drop or click above.</div>
                  </div>
                ) : (
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {files.map(f=>(
                      <div key={f.id} className="krow">
                        <div style={{padding:"13px 16px",display:"flex",gap:12,alignItems:"flex-start",cursor:"pointer"}} onClick={()=>setKbView(kbView===f.id?null:f.id)}>
                          <div style={{width:40,height:40,borderRadius:9,background:"#EEF2FF",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>{fIcon(f.name)}</div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:14,fontWeight:600,color:"#111827",marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</div>
                            <div style={{display:"flex",gap:12,fontSize:12,color:"#9CA3AF"}}>
                              <span>{fSize(f.size)}</span>
                              <span>·</span>
                              <span>{f.ext.toUpperCase()}</span>
                              <span>·</span>
                              <span>Uploaded {fmtT(f.uploadedAt)}</span>
                              <span>·</span>
                              <span style={{color:"#059669",fontWeight:500}}>✓ Parsed</span>
                            </div>
                            {kbView===f.id&&(
                              <div style={{marginTop:12}}>
                                <div style={{fontSize:11,fontWeight:600,color:"#9CA3AF",marginBottom:6,textTransform:"uppercase",letterSpacing:.5}}>Extracted Content Preview</div>
                                <div style={{background:"#F8FAFC",borderRadius:8,padding:"12px 14px",fontSize:13,color:"#374151",lineHeight:1.7,maxHeight:220,overflowY:"auto",whiteSpace:"pre-wrap",fontFamily:"monospace",border:"1px solid #E5E7EB"}}>
                                  {f.content?.slice(0,2000)}{f.content?.length>2000?"…":""}
                                </div>
                                <div style={{marginTop:10,display:"flex",gap:8,justifyContent:"flex-end"}}>
                                  <button className="bo" style={{padding:"5px 12px",borderRadius:7,fontSize:12,display:"flex",alignItems:"center",gap:5}}
                                    onClick={e=>{e.stopPropagation(); setKbFm(p=>({...p,title:f.name.replace(/\.[^.]+$/,""),content:f.content||"",tags:[f.ext]})); setAddKb(true); setKbTab("entries");}}>
                                    + Use as KB Entry
                                  </button>
                                  <button className="bo" style={{padding:"5px 12px",borderRadius:7,fontSize:12,color:"#EF4444",borderColor:"#FEE2E2"}} onClick={e=>{e.stopPropagation();delFile(f.id);}}>🗑 Remove</button>
                                </div>
                              </div>
                            )}
                          </div>
                          <span style={{fontSize:12,color:"#9CA3AF",flexShrink:0}}>{kbView===f.id?"▲":"▼"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>)}

          {/* ── CALL INTELLIGENCE PAGE ─────────────────────────────────────── */}
          {page==="ci"&&(<>
            {/* Header */}
            <div style={{marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
              <div>
                <h1 style={{fontSize:22,fontWeight:700,letterSpacing:"-.4px",display:"flex",alignItems:"center",gap:10}}><span style={{width:30,height:30,background:"#4F46E5",borderRadius:8,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:13,color:"#fff",fontWeight:700}}>CI</span> Call Intelligence</h1>
                <p style={{fontSize:13.5,color:"#9CA3AF",marginTop:3}}>
                  <span style={{color:"#4F46E5",fontWeight:600}}>{ciCalls.length} calls</span> imported · <span style={{color:"#059669",fontWeight:600}}>{ciCalls.filter(c=>c.transcript).length} transcribed</span> · {ciCalls.filter(c=>c.training_opportunity).length} training opportunities
                </p>
              </div>
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <button className="bo" style={{padding:"8px 16px",borderRadius:9,fontSize:13,display:"flex",alignItems:"center",gap:6}} onClick={()=>setShowConn(true)}>API Config</button>
                <button className="bp" style={{padding:"8px 16px",borderRadius:9,fontSize:13,display:"flex",alignItems:"center",gap:6}} onClick={fetchLatestCalls} disabled={fetching}>
                  {fetching ? <><span style={{animation:"spin .7s linear infinite",display:"inline-block",width:12,height:12,border:"2px solid #fff",borderTopColor:"transparent",borderRadius:"50%"}} /> {fetchMsg||"Fetching..."}</> : "Fetch Latest Calls"}
                </button>
                <button className="bo" style={{padding:"8px 16px",borderRadius:9,fontSize:13,display:"flex",alignItems:"center",gap:6}} onClick={pullCalls} disabled={pulling}>
                  {pulling ? <><span style={{animation:"spin .7s linear infinite",display:"inline-block",width:12,height:12,border:"2px solid #374151",borderTopColor:"transparent",borderRadius:"50%"}} /> {pullMsg||"Pulling..."}</> : "Pull via Token"}
                </button>
              </div>
            </div>

            {/* Stats */}
            <div style={{display:"flex",gap:16,marginBottom:12,flexWrap:"wrap"}}>
              {[
                {label:"Total",      value:ciCalls.length,                                         color:"#4F46E5"},
                {label:"Transcribed",value:ciCalls.filter(c=>c.transcript).length,                 color:"#059669"},
                {label:"Positive",   value:ciCalls.filter(c=>c.sentiment==="positive").length,     color:"#059669"},
                {label:"Negative",   value:ciCalls.filter(c=>c.sentiment==="negative").length,     color:"#DC2626"},
                {label:"Training",   value:ciCalls.filter(c=>c.training_opportunity).length,       color:"#D97706"},
              ].map(s=>(
                <div key={s.label} style={{display:"flex",alignItems:"baseline",gap:5}}>
                  <span style={{fontSize:20,fontWeight:700,color:s.color}}>{s.value}</span>
                  <span style={{fontSize:12,color:"#9CA3AF",fontWeight:500}}>{s.label}</span>
                </div>
              ))}
            </div>

            {/* Topic bucket overview */}
            {ciCalls.some(c=>c.topics?.length>0)&&(
              <div style={{marginBottom:20}}>
                <div style={{fontSize:13,fontWeight:600,color:"#374151",marginBottom:10}}>Topic Distribution</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {CI_TOPICS.map(t=>{
                    const cnt=ciCalls.filter(c=>(c.topics||[]).includes(t.id)).length;
                    if(!cnt) return null;
                    return (
                      <div key={t.id} onClick={()=>setCiFilter(ciFilter===t.id?"all":t.id)}
                        style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",borderRadius:20,background:ciFilter===t.id?t.bg:"#F8FAFC",border:`1.5px solid ${ciFilter===t.id?t.color:"#E5E7EB"}`,cursor:"pointer",transition:"all .15s"}}>
                        <span style={{fontSize:13}}>{t.icon}</span>
                        <span style={{fontSize:12.5,fontWeight:600,color:ciFilter===t.id?t.color:"#6B7280"}}>{t.label}</span>
                        <span style={{fontSize:11,background:t.color,color:"#fff",borderRadius:10,padding:"1px 7px",fontWeight:700}}>{cnt}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Search */}
            <div style={{position:"relative",marginBottom:10}}>
              <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"#9CA3AF"}}>🔍</span>
              <input className="inp" style={{paddingLeft:36}} placeholder="Search by agent name, patient number, transcript content…" value={ciSearch} onChange={e=>setCiSearch(e.target.value)} />
            </div>

            {/* Empty state */}
            {ciCalls.length===0&&(
              <div className="card" style={{textAlign:"center",padding:"52px 24px"}}>
                <div style={{width:56,height:56,background:"#EEF2FF",borderRadius:14,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:22,color:"#4F46E5",fontWeight:700,marginBottom:16}}>CI</div>
                <div style={{fontSize:17,fontWeight:700,color:"#111827",marginBottom:8}}>No Calls Imported Yet</div>
                <div style={{fontSize:14,color:"#9CA3AF",maxWidth:420,margin:"0 auto 24px",lineHeight:1.6}}>
                  Connect your Tata Tele SmartFlo account to pull call recordings, auto-transcribe them with AI, tag topics, and surface training opportunities.
                </div>
                <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"}}>
                  <button className="bp" style={{padding:"10px 20px",borderRadius:9,fontSize:14}} onClick={fetchLatestCalls} disabled={fetching}>
                    {fetching ? (fetchMsg||"Fetching...") : "Fetch Latest Calls"}
                  </button>
                  <button className="bo" style={{padding:"10px 20px",borderRadius:9,fontSize:14}} onClick={()=>setShowConn(true)}>Configure API Key</button>
                  <button className="bo" style={{padding:"10px 20px",borderRadius:9,fontSize:14}} onClick={pullCalls}>Pull via Token</button>
                </div>
                <div style={{marginTop:20,padding:"14px 20px",background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:10,display:"inline-block",textAlign:"left",maxWidth:520}}>
                  <div style={{fontSize:12,color:"#92400E",lineHeight:1.6}}>
                    <b>💡 How it works:</b> Pull calls via SmartFlo API → Claude AI generates transcripts and tags each call with topic buckets → Surface training opportunities → One-click add to Agent Training scenarios.
                  </div>
                </div>
              </div>
            )}

            {/* Calls list */}
            {ciCalls.length>0&&(
              <div style={{display:"flex",flexDirection:"column",gap:8,paddingBottom:selectedCalls.size>0?70:0}}>
                <div style={{display:"flex",alignItems:"center",gap:12,padding:"6px 0",justifyContent:"space-between"}}>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <input type="checkbox" style={{width:16,height:16,accentColor:"#4F46E5",cursor:"pointer"}}
                      checked={selectedCalls.size>0&&selectedCalls.size===ciFiltered.length}
                      onChange={toggleSelectAll} />
                    <span style={{fontSize:12,color:"#6B7280",fontWeight:500}}>
                      {selectedCalls.size>0?`${selectedCalls.size} selected`:`Select all (${ciFiltered.length})`}
                    </span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:12,color:"#6B7280",fontWeight:500}}>
                      <input type="checkbox" checked={hideMissed} onChange={()=>setHideMissed(h=>!h)} style={{width:14,height:14,accentColor:"#4F46E5",cursor:"pointer"}} />
                      Hide missed / 0s calls
                      {ciHiddenCount>0&&<span style={{fontSize:10,background:"#FEF2F2",color:"#DC2626",borderRadius:8,padding:"1px 6px",fontWeight:700}}>{ciHiddenCount}</span>}
                    </label>
                  </div>
                </div>
                {ciFiltered.length===0&&<div style={{textAlign:"center",padding:"40px",color:"#9CA3AF",fontSize:14}}>No calls match this filter.</div>}
                {ciFiltered.map(call=>{
                  const isOpen=ciView===call.id;
                  const isProcessing=processingId===call.id;
                  return (
                    <div key={call.id} className="krow">
                      {/* Row */}
                      <div style={{padding:"12px 16px",display:"flex",gap:12,alignItems:"center",cursor:"pointer"}} onClick={()=>setCiView(isOpen?null:call.id)}>
                        {/* Checkbox for all calls */}
                        <input type="checkbox" style={{width:16,height:16,accentColor:"#4F46E5",cursor:"pointer",flexShrink:0}}
                          checked={selectedCalls.has(call.id)} onClick={e=>e.stopPropagation()} onChange={()=>toggleSelectCall(call.id)} />
                        {/* Direction icon */}
                        <div style={{width:38,height:38,borderRadius:9,background:(call.status==="missed"||call.status==="not_answered")?"#FEF2F2":call.direction==="inbound"?"#EFF6FF":"#F5F3FF",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:13,fontWeight:700,color:(call.status==="missed"||call.status==="not_answered")?"#DC2626":call.direction==="inbound"?"#2563EB":"#7C3AED"}}>
                          {(call.status==="missed"||call.status==="not_answered")?"✕":call.direction==="inbound"?"IN":"OUT"}
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3,flexWrap:"wrap"}}>
                            <span style={{fontSize:13.5,fontWeight:600,color:"#111827"}}>{call.agent_name||"Unknown Agent"}</span>
                            <span style={{fontSize:12,color:"#9CA3AF"}}>→</span>
                            <span style={{fontSize:13,color:"#6B7280",fontFamily:"monospace"}}>{call.client_number}</span>
                            {call.sentiment&&<span style={{fontSize:11,background:sentBg(call.sentiment),color:sentColor(call.sentiment),borderRadius:4,padding:"1px 7px",fontWeight:600}}>{sentIcon(call.sentiment)} {call.sentiment}</span>}
                            {call.training_opportunity&&<span style={{fontSize:11,background:"#FFFBEB",color:"#D97706",borderRadius:4,padding:"1px 7px",fontWeight:600}}>🎓 Training op</span>}
                          </div>
                          <div style={{display:"flex",gap:10,fontSize:12,color:"#9CA3AF",flexWrap:"wrap",alignItems:"center"}}>
                            <span>{call.date} {call.time}</span>
                            <span>{call.duration}s</span>
                            <span style={{fontSize:11,fontWeight:600,padding:"2px 8px",borderRadius:10,textTransform:"capitalize",
                              background:(call.status==="answered"?"#ECFDF5":(call.status==="missed"||call.status==="not_answered")?"#FEF2F2":"#F3F4F6"),
                              color:(call.status==="answered"?"#059669":(call.status==="missed"||call.status==="not_answered")?"#DC2626":"#6B7280")
                            }}>{call.status==="not_answered"?"Missed":call.status}</span>
                            {call.transcript&&<span style={{fontSize:11,fontWeight:600,padding:"2px 8px",borderRadius:10,background:"#ECFDF5",color:"#059669"}}>Transcribed</span>}
                          </div>
                          {(call.topics||[]).length>0&&(
                            <div style={{display:"flex",gap:4,marginTop:5,flexWrap:"wrap"}}>
                              {call.topics.map(tid=>{
                                const t=CI_TOPICS.find(x=>x.id===tid);
                                return t?<span key={tid} style={{fontSize:10,background:t.bg,color:t.color,borderRadius:4,padding:"1px 7px",fontWeight:600}}>{t.icon} {t.label}</span>:null;
                              })}
                            </div>
                          )}
                        </div>
                        {/* Audio player */}
                        {call.recording_url && call.duration > 0 ? (
                          <audio controls preload="none" onClick={e=>e.stopPropagation()}
                            src={`${import.meta.env.VITE_RAILWAY_URL||''}/api/smartflo/recording?url=${encodeURIComponent(call.recording_url)}`}
                            style={{height:32,maxWidth:200,flexShrink:0}} />
                        ) : (
                          <span style={{fontSize:10,color:"#9CA3AF",background:"#F3F4F6",padding:"3px 8px",borderRadius:6,flexShrink:0,whiteSpace:"nowrap"}}>No recording</span>
                        )}
                        <div style={{display:"flex",gap:6,flexShrink:0,alignItems:"center"}}>
                          {!call.transcript&&(
                            <button className="bp" style={{padding:"5px 11px",borderRadius:7,fontSize:12,display:"flex",alignItems:"center",gap:5}} disabled={!!processingId}
                              onClick={e=>{e.stopPropagation();transcribeAndTag(call.id);}}>
                              {isProcessing?<><span style={{animation:"spin .7s linear infinite",display:"inline-block",width:10,height:10,border:"1.5px solid #fff",borderTopColor:"transparent",borderRadius:"50%"}} /> Processing…</>:"Transcribe"}
                            </button>
                          )}
                          <div style={{width:28,height:28,borderRadius:7,background:"#F3F4F6",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:"#6B7280",flexShrink:0,transition:"all .15s"}}>{isOpen?"▲":"▼"}</div>
                        </div>
                      </div>

                      {/* Expanded */}
                      {isOpen&&(
                        <div style={{padding:"0 16px 16px",borderTop:"1px solid #F3F4F6"}}>
                          {!call.transcript&&!isProcessing&&(
                            <div style={{textAlign:"center",padding:"24px",color:"#9CA3AF"}}>
                              <div style={{fontSize:13,marginBottom:12}}>This call hasn't been transcribed yet.</div>
                              <button className="bp" style={{padding:"8px 18px",borderRadius:9,fontSize:13}} onClick={()=>transcribeAndTag(call.id)}>🤖 Transcribe & Tag with AI</button>
                            </div>
                          )}
                          {isProcessing&&(
                            <div style={{textAlign:"center",padding:"24px",color:"#4F46E5"}}>
                              <div style={{fontSize:24,marginBottom:8,animation:"pulse 1s infinite"}}>🤖</div>
                              <div style={{fontSize:13,fontWeight:500}}>Claude is transcribing and analysing this call…</div>
                            </div>
                          )}
                          {call.transcript&&!isProcessing&&(
                            <div style={{marginTop:12}}>
                              {/* Summary */}
                              {call.summary&&(
                                <div style={{background:"#EFF6FF",borderRadius:8,padding:"10px 14px",marginBottom:12,border:"1px solid #DBEAFE"}}>
                                  <div style={{fontSize:11,fontWeight:600,color:"#2563EB",marginBottom:4}}>📋 CALL SUMMARY</div>
                                  <div style={{fontSize:13.5,color:"#1E40AF",lineHeight:1.6}}>{call.summary}</div>
                                </div>
                              )}
                              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
                                {/* Transcript */}
                                <div>
                                  <div style={{fontSize:11,fontWeight:600,color:"#9CA3AF",marginBottom:6,textTransform:"uppercase",letterSpacing:.5}}>Transcript</div>
                                  <div style={{background:"#F8FAFC",borderRadius:8,padding:"12px 14px",fontSize:12.5,color:"#374151",lineHeight:1.8,maxHeight:200,overflowY:"auto",whiteSpace:"pre-wrap",fontFamily:"monospace",border:"1px solid #E5E7EB"}}>
                                    {call.transcript}
                                  </div>
                                </div>
                                {/* Insights */}
                                <div>
                                  <div style={{fontSize:11,fontWeight:600,color:"#9CA3AF",marginBottom:6,textTransform:"uppercase",letterSpacing:.5}}>Key Insights</div>
                                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                                    {(call.key_insights||[]).map((ins,i)=>(
                                      <div key={i} style={{background:"#F8FAFC",borderRadius:7,padding:"8px 12px",fontSize:13,color:"#374151",border:"1px solid #E5E7EB"}}>
                                        <span style={{color:"#4F46E5",fontWeight:700,marginRight:6}}>→</span>{ins}
                                      </div>
                                    ))}
                                    {call.training_opportunity&&(
                                      <div style={{background:"#FFFBEB",borderRadius:7,padding:"8px 12px",fontSize:13,color:"#92400E",border:"1px solid #FDE68A"}}>
                                        <div style={{fontSize:11,fontWeight:700,marginBottom:3}}>🎓 TRAINING OPPORTUNITY</div>
                                        {call.training_opportunity}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                                {call.training_opportunity&&(
                                  <button className="bp" style={{padding:"6px 14px",borderRadius:8,fontSize:12,display:"flex",alignItems:"center",gap:5}} onClick={()=>addCallAsScenario(call)}>
                                    + Add to Agent Training
                                  </button>
                                )}
                                <button className="bo" style={{padding:"6px 14px",borderRadius:8,fontSize:12}} onClick={e=>{e.stopPropagation(); setCiCalls(prev=>prev.map(x=>x.id===call.id?{...x,transcript:null,summary:null,topics:[],sentiment:null,key_insights:[],training_opportunity:null,processedAt:null}:x));}}>
                                  🔄 Re-process
                                </button>
                                <button className="bo" style={{padding:"6px 14px",borderRadius:8,fontSize:12,color:"#EF4444",borderColor:"#FEE2E2"}} onClick={e=>{e.stopPropagation();setCiCalls(prev=>prev.filter(x=>x.id!==call.id));setCiView(null);}}>
                                  🗑 Remove
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Sticky bottom bar when calls are selected */}
            {selectedCalls.size>0&&(
              <div style={{position:"fixed",bottom:0,left:0,right:0,background:"#fff",borderTop:"2px solid #4F46E5",padding:"12px 24px",display:"flex",alignItems:"center",justifyContent:"center",gap:16,zIndex:100,boxShadow:"0 -4px 20px rgba(0,0,0,.1)"}}>
                <span style={{fontSize:13,fontWeight:600,color:"#374151"}}>{selectedCalls.size} call{selectedCalls.size>1?"s":""} selected</span>
                {batchProcessing?(
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{animation:"spin .7s linear infinite",display:"inline-block",width:14,height:14,border:"2px solid #4F46E5",borderTopColor:"transparent",borderRadius:"50%"}} />
                    <span style={{fontSize:13,fontWeight:600,color:"#4F46E5"}}>Processing {batchProgress.done}/{batchProgress.total}...</span>
                    <div style={{width:120,height:6,background:"#E5E7EB",borderRadius:3,overflow:"hidden"}}>
                      <div style={{height:"100%",background:"#4F46E5",borderRadius:3,transition:"width .3s ease",width:`${batchProgress.total?((batchProgress.done/batchProgress.total)*100):0}%`}} />
                    </div>
                  </div>
                ):(
                  <button className="bp" style={{padding:"8px 20px",borderRadius:9,fontSize:13,display:"flex",alignItems:"center",gap:6}} onClick={batchTranscribe}>
                    Transcribe Selected
                  </button>
                )}
                <button className="bo" style={{padding:"8px 16px",borderRadius:9,fontSize:13}} onClick={()=>setSelectedCalls(new Set())} disabled={batchProcessing}>Clear</button>
              </div>
            )}
          </>)}

        </div>
      </div>

      {/* ══ ADD SCENARIO MODAL ════════════════════════════════════════════════ */}
      {addSc&&(
        <div className="mov" onClick={e=>{if(e.target===e.currentTarget)setAddSc(false);}}>
          <div className="mod">
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div><div style={{fontSize:17,fontWeight:700}}>Add Training Scenario</div><div style={{fontSize:13,color:"#9CA3AF",marginTop:2}}>{cur?.icon} {cur?.name}</div></div>
              <button className="bo" style={{width:30,height:30,borderRadius:7,fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",padding:0}} onClick={()=>setAddSc(false)}>✕</button>
            </div>
            <div style={{marginBottom:16}}>
              <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:8}}>Scenario Type</label>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {STYPES.map(t=>(
                  <div key={t.id} onClick={()=>setScFm(p=>({...p,type:t.id}))}
                    style={{padding:"10px 12px",borderRadius:9,border:`1.5px solid ${scForm.type===t.id?t.color:"#E5E7EB"}`,background:scForm.type===t.id?t.bg:"#fff",cursor:"pointer",transition:"all .15s"}}>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <div style={{width:7,height:7,borderRadius:"50%",background:t.color}} />
                      <span style={{fontSize:13,fontWeight:600,color:scForm.type===t.id?t.color:"#374151"}}>{t.label}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:6}}>Patient Input / Trigger *</label>
              <textarea className="inp" rows={3} placeholder="What does the patient say or do?" value={scForm.input} onChange={e=>setScFm(p=>({...p,input:e.target.value}))} />
            </div>
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:6}}>Expected Agent Output *</label>
              <textarea className="inp" rows={3} placeholder="How should the agent respond?" value={scForm.expectedOutput} onChange={e=>setScFm(p=>({...p,expectedOutput:e.target.value}))} />
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:22}}>
              <div>
                <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:6}}>Tags <span style={{fontWeight:400,color:"#9CA3AF"}}>(comma separated)</span></label>
                <input className="inp" placeholder="pricing, insurance…" value={scForm.tags} onChange={e=>setScFm(p=>({...p,tags:e.target.value}))} />
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:6}}>Notes</label>
                <input className="inp" placeholder="Why does this matter?" value={scForm.notes} onChange={e=>setScFm(p=>({...p,notes:e.target.value}))} />
              </div>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button className="bo" style={{padding:"9px 18px",borderRadius:9,fontSize:14}} onClick={()=>setAddSc(false)}>Cancel</button>
              <button className="bp" style={{padding:"9px 20px",borderRadius:9,fontSize:14}} onClick={addScenario} disabled={!scForm.input||!scForm.expectedOutput}>Save to Training Set</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ ADD KB MODAL ══════════════════════════════════════════════════════ */}
      {addKb&&(
        <div className="mov" onClick={e=>{if(e.target===e.currentTarget)setAddKb(false);}}>
          <div className="mod" style={{width:660}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div><div style={{fontSize:17,fontWeight:700}}>Add Knowledge Base Entry</div><div style={{fontSize:13,color:"#9CA3AF",marginTop:2}}>This knowledge will be available to linked agents</div></div>
              <button className="bo" style={{width:30,height:30,borderRadius:7,fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",padding:0}} onClick={()=>setAddKb(false)}>✕</button>
            </div>

            {/* Category */}
            <div style={{marginBottom:16}}>
              <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:8}}>Category</label>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {KB_CATS.map(c=>(
                  <div key={c.id} onClick={()=>setKbFm(p=>({...p,cat:c.id}))}
                    style={{padding:"10px 12px",borderRadius:9,border:`1.5px solid ${kbForm.cat===c.id?c.color:"#E5E7EB"}`,background:kbForm.cat===c.id?c.bg:"#fff",cursor:"pointer",transition:"all .15s"}}>
                    <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:2}}><span style={{fontSize:16}}>{c.icon}</span><span style={{fontSize:13,fontWeight:600,color:kbForm.cat===c.id?c.color:"#374151"}}>{c.label.split("&")[0].trim()}</span></div>
                    <div style={{fontSize:11,color:"#9CA3AF"}}>{c.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Priority */}
            <div style={{marginBottom:16}}>
              <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:8}}>Priority Tier</label>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                {KB_PRIORITIES.map(p=>(
                  <div key={p.id} onClick={()=>setKbFm(x=>({...x,priority:p.id}))}
                    style={{padding:"10px 12px",borderRadius:9,border:`1.5px solid ${kbForm.priority===p.id?kpi(p.id):"#E5E7EB"}`,background:kbForm.priority===p.id?kpibg(p.id):"#fff",cursor:"pointer",transition:"all .15s"}}>
                    <div style={{fontSize:13,fontWeight:700,color:kbForm.priority===p.id?kpi(p.id):"#374151",marginBottom:2}}>{p.id}</div>
                    <div style={{fontSize:11,color:"#9CA3AF"}}>{p.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:6}}>Title *</label>
              <input className="inp" placeholder="e.g. NPO Protocol — Pre-Operative Fasting" value={kbForm.title} onChange={e=>setKbFm(p=>({...p,title:e.target.value}))} />
            </div>
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:6}}>Content *</label>
              <textarea className="inp" rows={5} placeholder="Enter the full knowledge content, protocol steps, or rule details…" value={kbForm.content} onChange={e=>setKbFm(p=>({...p,content:e.target.value}))} />
            </div>

            {/* Link to agents */}
            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:8}}>Link to Agents <span style={{fontWeight:400,color:"#9CA3AF"}}>(select which agents can access this)</span></label>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {AGENTS.map(ag=>(
                  <button key={ag.id} className={`ag-chip${kbForm.agents.includes(ag.id)?" on":""}`} onClick={()=>toggleKbAgent(ag.id)}>
                    {ag.icon} {ag.name}
                  </button>
                ))}
              </div>
            </div>

            <div style={{marginBottom:22}}>
              <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:6}}>Tags <span style={{fontWeight:400,color:"#9CA3AF"}}>(comma separated)</span></label>
              <input className="inp" placeholder="fasting, pre-op, anaesthesia…" value={kbForm.tags} onChange={e=>setKbFm(p=>({...p,tags:e.target.value}))} />
            </div>

            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button className="bo" style={{padding:"9px 18px",borderRadius:9,fontSize:14}} onClick={()=>setAddKb(false)}>Cancel</button>
              <button className="bp" style={{padding:"9px 20px",borderRadius:9,fontSize:14}} onClick={addKbEntry} disabled={!kbForm.title||!kbForm.content}>Save to Knowledge Base</button>
            </div>
          </div>
        </div>
      )}


      {/* ══ SMARTFLO API CONFIG MODAL ════════════════════════════════════════ */}
      {showConn&&(
        <div className="mov" onClick={e=>{if(e.target===e.currentTarget)setShowConn(false);}}>
          <div className="mod" style={{width:520}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div>
                <div style={{fontSize:17,fontWeight:700}}>SmartFlo API Configuration</div>
                <div style={{fontSize:13,color:"#9CA3AF",marginTop:2}}>Connect your Tata Tele SmartFlo account</div>
              </div>
              <button className="bo" style={{width:30,height:30,borderRadius:7,fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",padding:0}} onClick={()=>setShowConn(false)}>✕</button>
            </div>

            <div style={{background:"#EFF6FF",border:"1px solid #DBEAFE",borderRadius:8,padding:"10px 14px",marginBottom:18}}>
              <div style={{fontSize:12,color:"#1E40AF",lineHeight:1.6}}>
                <b>How to get your API key:</b> Log in to SmartFlo → Settings → API Connect → Generate Token. The token is valid for 24 hours. Use <code style={{background:"#DBEAFE",padding:"1px 4px",borderRadius:3}}>POST /v1/auth/token</code> to refresh.
              </div>
            </div>

            <div style={{marginBottom:14}}>
              <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:6}}>Bearer Token / API Key *</label>
              <input className="inp" type="password" placeholder="Paste your SmartFlo Bearer token here…" value={ciConfig.apiKey} onChange={e=>setCiConfig(p=>({...p,apiKey:e.target.value}))} />
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
              <div>
                <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:6}}>From Date</label>
                <input className="inp" type="date" value={ciConfig.dateFrom} onChange={e=>setCiConfig(p=>({...p,dateFrom:e.target.value}))} />
              </div>
              <div>
                <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:6}}>To Date</label>
                <input className="inp" type="date" value={ciConfig.dateTo} onChange={e=>setCiConfig(p=>({...p,dateTo:e.target.value}))} />
              </div>
            </div>

            <div style={{marginBottom:22}}>
              <label style={{fontSize:12,fontWeight:600,color:"#374151",display:"block",marginBottom:8}}>Call Direction</label>
              <div style={{display:"flex",gap:8}}>
                {["all","inbound","outbound"].map(d=>(
                  <button key={d} onClick={()=>setCiConfig(p=>({...p,direction:d}))}
                    style={{padding:"7px 16px",borderRadius:8,border:`1.5px solid ${ciConfig.direction===d?"#4F46E5":"#E5E7EB"}`,background:ciConfig.direction===d?"#EEF2FF":"#fff",color:ciConfig.direction===d?"#4F46E5":"#6B7280",fontSize:13,fontWeight:ciConfig.direction===d?600:400,cursor:"pointer",textTransform:"capitalize",fontFamily:"Inter,sans-serif"}}>
                    {d==="all"?"All Calls":d}
                  </button>
                ))}
              </div>
            </div>

            <div style={{background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:8,padding:"10px 14px",marginBottom:18}}>
              <div style={{fontSize:12,color:"#92400E",lineHeight:1.5}}>
                🔒 Your API key is stored locally in this browser session only and never sent to any server other than SmartFlo's API (<code style={{fontSize:11}}>api-smartflo.tatateleservices.com</code>).
              </div>
            </div>

            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button className="bo" style={{padding:"9px 18px",borderRadius:9,fontSize:14}} onClick={()=>setShowConn(false)}>Cancel</button>
              <button className="bp" style={{padding:"9px 20px",borderRadius:9,fontSize:14}} onClick={()=>{setShowConn(false);pullCalls();}}>Save & Pull Calls</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ EXPORT MODAL ══════════════════════════════════════════════════════ */}
      {dlOpen&&(
        <div className="mov" onClick={e=>{if(e.target===e.currentTarget)setDL(false);}}>
          <div className="mod" style={{width:540}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div><div style={{fontSize:17,fontWeight:700}}>Export Training Data</div><div style={{fontSize:13,color:"#9CA3AF",marginTop:2}}>{totalSc} scenarios · {kb.length} KB entries</div></div>
              <button className="bo" style={{width:30,height:30,borderRadius:7,fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",padding:0}} onClick={()=>setDL(false)}>✕</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
              {[
                {fmt:"Full JSON",    icon:"{ }",  color:"#4F46E5", desc:"Scenarios + KB in one file. Full backup with all metadata.",                   fn:()=>{dlJSON(sc,kb);  toast$("✓ Full JSON exported"); setDL(false);}},
                {fmt:"JSONL",        icon:"≡",    color:"#059669", desc:"Fine-tuning ready. user/assistant pairs for OpenAI, Anthropic, or Mistral.",    fn:()=>{dlJSONL(sc);   toast$("✓ JSONL exported"); setDL(false);}},
                {fmt:"CSV",          icon:"⊞",    color:"#D97706", desc:"Scenarios as spreadsheet. Opens in Excel or Google Sheets.",                     fn:()=>{dlCSV(sc);    toast$("✓ CSV exported"); setDL(false);}},
                {fmt:"KB Markdown",  icon:"📚",   color:"#0891B2", desc:"Knowledge Base as readable docs. Share with clinical and QA teams.",             fn:()=>{dlKBMD(kb);   toast$("✓ KB Markdown exported"); setDL(false);}},
              ].map(d=>(
                <div key={d.fmt} className="dlc" onClick={d.fn}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                    <div style={{width:38,height:38,borderRadius:9,background:`${d.color}12`,border:`1.5px solid ${d.color}25`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,color:d.color,fontWeight:700,fontFamily:"monospace",flexShrink:0}}>{d.icon}</div>
                    <div><div style={{fontSize:14,fontWeight:600,color:"#111827"}}>{d.fmt}</div><div style={{fontSize:11,color:d.color,fontWeight:500}}>Download</div></div>
                  </div>
                  <div style={{fontSize:12.5,color:"#9CA3AF",lineHeight:1.5}}>{d.desc}</div>
                </div>
              ))}
            </div>
            <div style={{background:"#FFFBEB",border:"1px solid #FDE68A",borderRadius:8,padding:"11px 14px"}}>
              <div style={{fontSize:12,color:"#92400E",lineHeight:1.5}}>💡 <b>Tip:</b> Use <b>JSONL</b> for fine-tuning LLMs. Use <b>Full JSON</b> for importing back into this portal. Use <b>KB Markdown</b> to share clinical guidelines with your team.</div>
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast&&(
        <div className="tw">
          <div style={{background:"#111827",color:"#fff",padding:"10px 18px",borderRadius:9,fontSize:13,fontWeight:500,boxShadow:"0 4px 20px rgba(0,0,0,.2)"}}>{toast}</div>
        </div>
      )}
    </div>
  );
}
