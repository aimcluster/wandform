export type BuilderEvent =
  | { type: "presence"; count: number }
  | { type: "update"; by: string; payload: unknown; at: string }
  | { type: "joined"; id: string };

export class BuilderRoom {
  private sessions = new Set<WebSocket>();

  constructor(private state: DurableObjectState) {
    void state;
  }

  async fetch(request: Request): Promise<Response> {
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
          this.broadcast({
            type: "update",
            by: sessionId,
            payload: parsed.payload ?? null,
            at: new Date().toISOString(),
          });
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
