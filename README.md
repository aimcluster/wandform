# WandForm

WandForm is an AI-native form builder on **Cloudflare Workers** designed to compete with Tally / Youform.

## Stack

- **Workers + Hono** for API + pages
- **D1** for forms/submissions/tenant metadata
- **Durable Objects** for realtime builder presence and update events (WebSocket room)
- **Cloudflare SaaS readiness** modeled in schema (`tenants`, `tenant_domains`) for custom-hostname routing

## Features in this MVP

- Create forms from dashboard (`/`)
- Public form page (`/f/:id`) and submission capture
- Submission API listing (`/api/forms/:id/submissions`)
- Realtime builder room (`/builder/:id`) via Durable Object websocket
- Tenant/domain tables ready for Cloudflare for SaaS onboarding

## Quickstart

```bash
npm install

# 1) Create D1 DB (first time)
wrangler d1 create wandform
# Copy database_id into wrangler.jsonc

# 2) Apply migrations locally
npm run migrate

# 3) Run locally
npm run dev
```

## Scripts

- `npm run dev` — local worker dev server
- `npm run build` — deploy dry-run build
- `npm run deploy` — deploy to Cloudflare
- `npm run migrate` — apply local D1 migrations

## Cloudflare for SaaS Notes

The table `tenant_domains` is pre-created to track tenant custom domains and Cloudflare custom-hostname IDs.

Typical next step:
1. Add tenant onboarding API
2. Use Cloudflare API to create custom hostnames
3. Map hostnames to tenant IDs before rendering forms

## Realtime + PartyKit option

Current realtime is DO-native and production-safe for basic collaboration signals.
If you need richer collaborative cursors/doc sync, you can swap/augment with PartyKit and keep D1/Workers as source of truth.

## Strategy docs

- Market research snapshot: `docs/market-research-2026-02-27.md`
- Execution plan: `docs/execution-plan.md`
