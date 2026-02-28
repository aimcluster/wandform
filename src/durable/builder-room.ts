type SqlApi = {
  exec: (query: string, ...bindings: unknown[]) => Iterable<Record<string, unknown>>;
};

export type BuilderEvent =
  | { type: "presence"; count: number }
  | { type: "update"; id: string; by: string; payload: unknown; at: string }
  | { type: "joined"; id: string };

export class BuilderRoom {
  private sessions = new Set<WebSocket>();

  constructor(private state: DurableObjectState) {
    this.state.blockConcurrencyWhile(async () => {
      this.ensureSchema();
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname.endsWith("/history")) {
      const limitRaw = Number(url.searchParams.get("limit") ?? "20");
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
      const updates = this.loadHistory(limit);
      return Response.json({ updates });
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    const sessionId = crypto.randomUUID();
    this.sessions.add(server);
    this.broadcast({ type: "joined", id: sessionId });
    this.broadcastPresence();

    server.addEventListener("message", (event) => {
      try {
        const parsed = JSON.parse(String(event.data));
        if (parsed?.type === "update") {
          const row = {
            id: crypto.randomUUID(),
            by: sessionId,
            payload: parsed.payload ?? null,
            at: new Date().toISOString(),
          };
          this.persistUpdate(row);
          this.broadcast({ type: "update", ...row });
        }
      } catch {
        // ignore malformed frames
      }
    });

    const onClose = () => {
      this.sessions.delete(server);
      this.broadcastPresence();
    };

    server.addEventListener("close", onClose);
    server.addEventListener("error", onClose);

    return new Response(null, { status: 101, webSocket: client });
  }

  private getSql(): SqlApi {
    return (this.state.storage as unknown as { sql: SqlApi }).sql;
  }

  private ensureSchema() {
    const sql = this.getSql();
    sql.exec(
      "CREATE TABLE IF NOT EXISTS room_updates (id TEXT PRIMARY KEY, by_actor TEXT NOT NULL, payload_json TEXT NOT NULL, at TEXT NOT NULL)",
    );
    sql.exec("CREATE INDEX IF NOT EXISTS idx_room_updates_at ON room_updates(at DESC)");
  }

  private persistUpdate(update: { id: string; by: string; payload: unknown; at: string }) {
    this.getSql().exec(
      "INSERT INTO room_updates (id, by_actor, payload_json, at) VALUES (?1, ?2, ?3, ?4)",
      update.id,
      update.by,
      JSON.stringify(update.payload ?? null),
      update.at,
    );
  }

  private loadHistory(limit: number) {
    const rows = this.getSql().exec(
      "SELECT id, by_actor, payload_json, at FROM room_updates ORDER BY at DESC LIMIT ?1",
      limit,
    );

    const updates: Array<{ id: string; by: string; payload: unknown; at: string }> = [];
    for (const row of rows) {
      updates.push({
        id: String(row.id ?? ""),
        by: String(row.by_actor ?? ""),
        payload: this.tryParseJson(row.payload_json),
        at: String(row.at ?? ""),
      });
    }

    return updates;
  }

  private tryParseJson(value: unknown) {
    if (typeof value !== "string") return value ?? null;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  private broadcast(event: BuilderEvent) {
    const msg = JSON.stringify(event);
    for (const ws of this.sessions) {
      try {
        ws.send(msg);
      } catch {
        this.sessions.delete(ws);
      }
    }
  }

  private broadcastPresence() {
    this.broadcast({ type: "presence", count: this.sessions.size });
  }
}
