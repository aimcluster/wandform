# Durable Objects + Built-in DB Exploration

Date: 2026-02-28

## Goal

Explore using **Durable Objects with built-in SQLite storage** for realtime collaboration and hot state in WandForm.

## What we implemented in this spike

1. **BuilderRoom Durable Object now persists updates** in SQLite-backed DO storage.
2. Added SQL schema inside the DO:
   - `room_updates(id, by_actor, payload_json, at)`
3. Added history endpoint flow:
   - Worker route: `GET /api/realtime/:formId/history?limit=20`
   - DO handler returns latest persisted updates.
4. Builder UI now loads recent history before live websocket events.

## Why this matters

Durable Objects are a strong fit for:

- per-form realtime collaboration rooms,
- ordered updates within a room,
- low-latency edge-local room state,
- simple persistence without an external DB hop.

## DO built-in DB vs D1 (pragmatic split)

Use **Durable Object SQLite** for:

- room/session state,
- recent collaborative activity,
- coordination, locks, and sequencing.

Use **D1** for:

- canonical long-lived form definitions,
- submissions and reporting,
- cross-tenant queries and back-office analytics.

## Recommended hybrid architecture for WandForm

- **DO SQLite**: realtime builder channels, comments/timeline cache, anti-abuse counters.
- **D1**: source of record for forms/submissions/events analytics.
- Periodic sync from DO hot state to D1 for historical analytics where needed.

## Next iteration ideas

1. Persist comments + review decisions in DO with retention policy.
2. Add alarm-based compaction in DO (keep latest N updates).
3. Add optional fan-out to D1 analytics pipeline.
4. Add room-level auth checks per tenant/workspace.

## Validation notes

- Build passes with this spike (`wrangler deploy --dry-run`).
- Endpoint shape is intentionally minimal and can be expanded safely.
