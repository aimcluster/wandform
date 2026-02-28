import { Hono } from "hono";
import { cors } from "hono/cors";
import { BuilderRoom } from "./durable/builder-room";

type FormField = {
  id: string;
  label: string;
  type: "text" | "email" | "number" | "textarea";
  required?: boolean;
  placeholder?: string;
};

type FormSchema = {
  fields: FormField[];
};

type EventType = "view" | "start" | "complete" | "submit_error" | "field_focus";

type Env = {
  Bindings: {
    WAND_DB: D1Database;
    BUILDER_ROOM: DurableObjectNamespace;
    APP_NAME?: string;
    PARTYKIT_URL?: string;
  };
};

const app = new Hono<Env>();
app.use("/api/*", cors());

const defaultTenantId = "default-tenant";
const allowedEventTypes = new Set<EventType>(["view", "start", "complete", "submit_error", "field_focus"]);

const safeJson = async (req: Request): Promise<any | null> => {
  try {
    return await req.json();
  } catch {
    return null;
  }
};

const ensureDefaultTenant = async (db: D1Database) => {
  await db
    .prepare("INSERT OR IGNORE INTO tenants (id, name) VALUES (?1, ?2)")
    .bind(defaultTenantId, "Default")
    .run();
};

const logEvent = async (
  db: D1Database,
  formId: string,
  eventType: EventType,
  fieldId?: string | null,
  metadata?: unknown,
) => {
  const eventId = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO form_events (id, form_id, event_type, field_id, metadata_json) VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(eventId, formId, eventType, fieldId ?? null, metadata ? JSON.stringify(metadata) : null)
    .run();
};

app.get("/", (c) => {
  const appName = c.env.APP_NAME ?? "WandForm";
  return c.html(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${appName} · Dashboard</title>
  <style>
    body{font-family:Inter,system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;background:#0a1020;color:#eef3ff}
    .card{background:#131d38;border:1px solid #293a67;border-radius:12px;padding:1rem;margin-bottom:1rem}
    input,textarea,button{width:100%;margin:.4rem 0;padding:.6rem;border-radius:8px;border:1px solid #324679;background:#0f1730;color:#eef3ff}
    button{cursor:pointer;background:#3b82f6;border:none}
    a{color:#8dc4ff}
    .row{display:grid;grid-template-columns:1fr 1fr;gap:1rem}
    ul{padding-left:1rem}
  </style>
</head>
<body>
  <h1>⚡ ${appName} Dashboard</h1>
  <div class="row">
    <section class="card">
      <h2>Create Form</h2>
      <input id="name" placeholder="Form name" value="Lead Capture" />
      <textarea id="schema" rows="10">{
  "fields": [
    {"id":"name","label":"Name","type":"text","required":true},
    {"id":"email","label":"Email","type":"email","required":true},
    {"id":"notes","label":"Notes","type":"textarea"}
  ]
}</textarea>
      <button id="create">Create Form</button>
      <p id="createOut"></p>
    </section>
    <section class="card">
      <h2>Forms</h2>
      <ul id="forms"></ul>
    </section>
  </div>
<script>
const formsEl = document.getElementById('forms');
async function loadForms(){
  const res = await fetch('/api/forms');
  const data = await res.json();
  formsEl.innerHTML = (data.forms||[]).map(f => '<li><b>' + f.name + '</b><br/><a href="/f/' + f.id + '" target="_blank">Public</a> · <a href="/builder/' + f.id + '" target="_blank">Builder</a> · <a href="/api/forms/' + f.id + '/submissions" target="_blank">Submissions JSON</a> · <a href="/api/forms/' + f.id + '/analytics" target="_blank">Analytics JSON</a></li>').join('');
}

document.getElementById('create').onclick = async () => {
  const out = document.getElementById('createOut');
  try {
    const name = document.getElementById('name').value;
    const schema = JSON.parse(document.getElementById('schema').value);
    const res = await fetch('/api/forms', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({name, schema})});
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'Create failed');
    out.textContent = 'Created ' + data.form.id;
    loadForms();
  } catch (e) {
    out.textContent = e.message;
  }
};
loadForms();
</script>
</body>
</html>`);
});

app.get("/builder/:id", async (c) => {
  const id = c.req.param("id");
  return c.html(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Builder ${id}</title>
  <style>
  body{font-family:Inter,system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;background:#0a1020;color:#eef3ff}
  .card{background:#131d38;border:1px solid #293a67;border-radius:12px;padding:1rem;margin-bottom:1rem}
  textarea,button{width:100%;margin:.4rem 0;padding:.6rem;border-radius:8px;border:1px solid #324679;background:#0f1730;color:#eef3ff}
  button{cursor:pointer;background:#3b82f6;border:none}
  .muted{color:#9cb2df}
  </style>
</head>
<body>
  <h1>🛠 Builder: ${id}</h1>
  <div class="card">
    <p>Realtime presence: <b id="presence">0</b></p>
    <p class="muted">Every broadcast here is powered by a Durable Object room.</p>
    <textarea id="update" rows="5" placeholder='{"change":"updated field order"}'></textarea>
    <button id="send">Broadcast update</button>
    <pre id="log"></pre>
  </div>
<script>
const log = document.getElementById('log');
const presence = document.getElementById('presence');
const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
const ws = new WebSocket(wsProto + '://' + location.host + '/api/realtime/${id}');

const prepend = (obj) => {
  log.textContent = JSON.stringify(obj, null, 2) + '\n' + log.textContent;
};

const loadHistory = async () => {
  try {
    const res = await fetch('/api/realtime/${id}/history?limit=20');
    const data = await res.json();
    for (const item of (data.updates || []).slice().reverse()) {
      prepend({ type: 'history', ...item });
    }
  } catch {}
};

ws.onmessage = (e) => {
  try {
    const msg = JSON.parse(e.data);
    if (msg.type === 'presence') presence.textContent = msg.count;
    prepend(msg);
  } catch {}
};

document.getElementById('send').onclick = () => {
  try {
    const payload = JSON.parse(document.getElementById('update').value || '{}');
    ws.send(JSON.stringify({type:'update', payload}));
  } catch (e) {
    alert('Invalid JSON payload');
  }
};

loadHistory();
</script>
</body>
</html>`);
});

app.get("/f/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.WAND_DB.prepare("SELECT id, name, schema_json FROM forms WHERE id = ?1")
    .bind(id)
    .first<{ id: string; name: string; schema_json: string }>();

  if (!row) {
    return c.html("<h1>Form not found</h1>", 404);
  }

  await logEvent(c.env.WAND_DB, id, "view", null, {
    ua: c.req.header("user-agent") ?? "",
  });

  const schema = JSON.parse(row.schema_json) as FormSchema;
  const fieldsHtml = schema.fields
    .map((f) => {
      if (f.type === "textarea") {
        return `<label>${f.label}<br/><textarea data-field="${f.id}" name="${f.id}" ${f.required ? "required" : ""} placeholder="${f.placeholder ?? ""}"></textarea></label>`;
      }
      return `<label>${f.label}<br/><input data-field="${f.id}" type="${f.type}" name="${f.id}" ${f.required ? "required" : ""} placeholder="${f.placeholder ?? ""}"/></label>`;
    })
    .join("<br/>");

  return c.html(`<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${row.name}</title>
<style>body{font-family:Inter,system-ui,sans-serif;max-width:700px;margin:2rem auto;padding:0 1rem;background:#0a1020;color:#eef3ff}form{background:#131d38;padding:1rem;border-radius:12px;border:1px solid #293a67}input,textarea,button{width:100%;margin:.4rem 0;padding:.6rem;border-radius:8px;border:1px solid #324679;background:#0f1730;color:#eef3ff}button{background:#3b82f6;border:none;cursor:pointer}</style>
</head><body>
<h1>${row.name}</h1>
<form id="form">${fieldsHtml}<button>Submit</button></form>
<p id="out"></p>
<script>
const form = document.getElementById('form');
const out = document.getElementById('out');
let started = false;
const focused = new Set();

const track = async (payload) => {
  try {
    await fetch('/api/forms/${id}/events', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(payload)
    });
  } catch {}
};

form.addEventListener('input', () => {
  if (!started) {
    started = true;
    track({ type: 'start' });
  }
});

form.querySelectorAll('[data-field]').forEach((el) => {
  el.addEventListener('focus', () => {
    const fieldId = el.getAttribute('data-field');
    if (!fieldId || focused.has(fieldId)) return;
    focused.add(fieldId);
    track({ type: 'field_focus', fieldId });
  });
});

form.onsubmit = async (e)=>{
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  const res = await fetch('/api/forms/${id}/submissions', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({data})});
  const json = await res.json();
  if (!res.ok) {
    await track({ type: 'submit_error', metadata: { message: json.error || 'failed' } });
  }
  out.textContent = res.ok ? 'Submitted ✅' : ('Error: '+(json.error||'failed'));
  if(res.ok) form.reset();
};
</script>
</body></html>`);
});

app.get("/api/forms", async (c) => {
  await ensureDefaultTenant(c.env.WAND_DB);
  const result = await c.env.WAND_DB.prepare(
    "SELECT id, name, created_at FROM forms WHERE tenant_id = ?1 ORDER BY created_at DESC LIMIT 100",
  )
    .bind(defaultTenantId)
    .all();
  return c.json({ forms: result.results });
});

app.post("/api/forms", async (c) => {
  const body = await safeJson(c.req.raw);
  if (!body || typeof body.name !== "string" || !body.schema?.fields) {
    return c.json({ error: "Invalid body. Expected {name, schema:{fields:[]}}" }, 400);
  }

  await ensureDefaultTenant(c.env.WAND_DB);

  const id = crypto.randomUUID();
  const schema = body.schema as FormSchema;
  if (!Array.isArray(schema.fields) || schema.fields.length === 0) {
    return c.json({ error: "schema.fields must be a non-empty array" }, 400);
  }

  await c.env.WAND_DB.prepare(
    `INSERT INTO forms (id, tenant_id, name, slug, schema_json) VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(id, defaultTenantId, body.name.trim(), body.name.trim().toLowerCase().replace(/\s+/g, "-"), JSON.stringify(schema))
    .run();

  return c.json({ form: { id, name: body.name, schema } }, 201);
});

app.get("/api/forms/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.WAND_DB.prepare("SELECT id, name, schema_json, created_at FROM forms WHERE id = ?1")
    .bind(id)
    .first<{ id: string; name: string; schema_json: string; created_at: string }>();
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({
    id: row.id,
    name: row.name,
    schema: JSON.parse(row.schema_json),
    createdAt: row.created_at,
  });
});

app.post("/api/forms/:id/events", async (c) => {
  const formId = c.req.param("id");
  const body = await safeJson(c.req.raw);
  const type = body?.type as EventType | undefined;

  if (!type || !allowedEventTypes.has(type)) {
    return c.json({ error: "Invalid event type" }, 400);
  }

  const exists = await c.env.WAND_DB.prepare("SELECT id FROM forms WHERE id = ?1").bind(formId).first();
  if (!exists) return c.json({ error: "Form not found" }, 404);

  const fieldId = typeof body?.fieldId === "string" ? body.fieldId.slice(0, 128) : null;
  const metadata = body?.metadata ?? null;

  await logEvent(c.env.WAND_DB, formId, type, fieldId, metadata);
  return c.json({ ok: true }, 201);
});

app.post("/api/forms/:id/submissions", async (c) => {
  const formId = c.req.param("id");
  const body = await safeJson(c.req.raw);
  if (!body || typeof body.data !== "object") {
    await logEvent(c.env.WAND_DB, formId, "submit_error", null, { reason: "invalid_body" });
    return c.json({ error: "Invalid body. Expected {data:{...}}" }, 400);
  }

  const exists = await c.env.WAND_DB.prepare("SELECT id FROM forms WHERE id = ?1").bind(formId).first();

  if (!exists) {
    await logEvent(c.env.WAND_DB, formId, "submit_error", null, { reason: "form_not_found" });
    return c.json({ error: "Form not found" }, 404);
  }

  const submissionId = crypto.randomUUID();
  const metadata = {
    ua: c.req.header("user-agent") ?? "",
    ip: c.req.header("CF-Connecting-IP") ?? "",
  };

  await c.env.WAND_DB.prepare(
    "INSERT INTO submissions (id, form_id, data_json, metadata_json) VALUES (?1, ?2, ?3, ?4)",
  )
    .bind(submissionId, formId, JSON.stringify(body.data), JSON.stringify(metadata))
    .run();

  await logEvent(c.env.WAND_DB, formId, "complete", null, { submissionId });

  return c.json({ ok: true, id: submissionId }, 201);
});

app.get("/api/forms/:id/submissions", async (c) => {
  const formId = c.req.param("id");
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);
  const result = await c.env.WAND_DB.prepare(
    "SELECT id, data_json, metadata_json, created_at FROM submissions WHERE form_id = ?1 ORDER BY created_at DESC LIMIT ?2",
  )
    .bind(formId, limit)
    .all();

  return c.json({
    submissions: (result.results ?? []).map((r: any) => ({
      id: r.id,
      data: JSON.parse(r.data_json),
      metadata: r.metadata_json ? JSON.parse(r.metadata_json) : null,
      createdAt: r.created_at,
    })),
  });
});

app.get("/api/forms/:id/analytics", async (c) => {
  const formId = c.req.param("id");
  const exists = await c.env.WAND_DB.prepare("SELECT id FROM forms WHERE id = ?1").bind(formId).first();
  if (!exists) return c.json({ error: "Form not found" }, 404);

  const grouped = await c.env.WAND_DB.prepare(
    "SELECT event_type, COUNT(*) as count FROM form_events WHERE form_id = ?1 GROUP BY event_type",
  )
    .bind(formId)
    .all<{ event_type: EventType; count: number }>();

  const byType: Record<string, number> = {};
  for (const row of grouped.results ?? []) {
    byType[row.event_type] = Number(row.count ?? 0);
  }

  const views = byType.view ?? 0;
  const starts = byType.start ?? 0;
  const completes = byType.complete ?? 0;
  const submitErrors = byType.submit_error ?? 0;

  const topFields = await c.env.WAND_DB.prepare(
    "SELECT field_id, COUNT(*) as count FROM form_events WHERE form_id = ?1 AND event_type = 'field_focus' AND field_id IS NOT NULL GROUP BY field_id ORDER BY count DESC LIMIT 10",
  )
    .bind(formId)
    .all<{ field_id: string; count: number }>();

  return c.json({
    counts: {
      views,
      starts,
      completes,
      submitErrors,
    },
    conversion: {
      startRate: views > 0 ? Number((starts / views).toFixed(4)) : 0,
      completionRateFromViews: views > 0 ? Number((completes / views).toFixed(4)) : 0,
      completionRateFromStarts: starts > 0 ? Number((completes / starts).toFixed(4)) : 0,
    },
    topFocusedFields: (topFields.results ?? []).map((row) => ({
      fieldId: row.field_id,
      focusCount: Number(row.count ?? 0),
    })),
  });
});

app.get("/api/realtime/:formId/history", async (c) => {
  const formId = c.req.param("formId");
  const limitRaw = Number(c.req.query("limit") ?? "20");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
  const stub = c.env.BUILDER_ROOM.get(c.env.BUILDER_ROOM.idFromName(`form:${formId}`));
  return stub.fetch(new Request(`https://builder.internal/history?limit=${limit}`));
});

app.get("/api/realtime/:formId", async (c) => {
  const formId = c.req.param("formId");
  const stub = c.env.BUILDER_ROOM.get(c.env.BUILDER_ROOM.idFromName(`form:${formId}`));
  return stub.fetch(c.req.raw);
});

app.get("/health", (c) => c.json({ ok: true, app: c.env.APP_NAME ?? "WandForm" }));

export { BuilderRoom };
export default app;
