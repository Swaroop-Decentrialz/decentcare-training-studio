# DecentCare AI Training Studio

AI Agent Training Portal for surgical patient journey automation — 8 AI agents, Knowledge Base, Call Intelligence.

## Structure

```
decentcare/
├── frontend/          # Vite + React → deploy to Vercel
│   ├── src/
│   │   ├── App.jsx        # Main application (1500+ lines)
│   │   ├── main.jsx       # React entry point
│   │   └── lib/
│   │       └── supabase.js  # All DB helpers
│   ├── vite.config.js
│   ├── vercel.json
│   └── package.json
│
├── backend/           # Express proxy → deploy to Railway
│   ├── src/
│   │   └── index.js       # SmartFlo API proxy
│   ├── railway.toml
│   └── package.json
│
├── supabase-schema.sql   # Run in Supabase SQL editor
├── DEPLOY.md             # Step-by-step deployment guide
└── README.md
```

## Quick Start

See **[DEPLOY.md](./DEPLOY.md)** for full instructions.

## Features

- **Agent Training** — 8 AI agents with scenario training (Ideal Flow, Edge Cases, Guardrails, Escalations)
- **Knowledge Base** — Clinical protocols, insurance rules, FAQs, hospital policies with P1/P2/P3 priority tiers
- **File Upload** — PDF/TXT/MD/CSV parsing, extracted text stored in Supabase
- **Call Intelligence** — Tata SmartFlo API integration, Claude AI transcription, topic tagging, training opportunity detection
- **Export** — JSON, JSONL (fine-tuning ready), CSV, Markdown
