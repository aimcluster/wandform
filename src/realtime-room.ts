export class FormBuilderRoom {
  private readonly state: DurableObjectState;
  private readonly clients: Set<WebSocket> = new Set();

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const isWebSocket = request.headers.get("Upgrade")?.toLowerCase() === "websocket";
    if (!isWebSocket) {
      return new Response("Expected a WebSocket request", { status: 426 });
    }

    const webSocketPair = new WebSocketPair();
    const [clientSocket, serverSocket] = Object.values(webSocketPair);

    this.acceptClient(serverSocket);

    return new Response(null, {
      status: 101,
      webSocket: clientSocket
    });
  }

  private acceptClient(socket: WebSocket): void {
    socket.accept();
    this.clients.add(socket);

    socket.addEventListener("message", (event) => {
      this.handleMessage(socket, event);
    });

    socket.addEventListener("close", () => {
      this.handleDisconnect(socket);
    });

    socket.addEventListener("error", () => {
      this.handleDisconnect(socket);
    });

    this.broadcast({
      type: "presence",
      count: this.clients.size
    });
  }

  private handleMessage(socket: WebSocket, event: MessageEvent): void {
    if (typeof event.data !== "string") {
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(event.data) as Record<string, unknown>;
    } catch {
      socket.send(
        JSON.stringify({
          type: "error",
          message: "Invalid JSON payload"
        })
      );
      return;
    }

    const messageType = payload.type;

    if (messageType === "ping") {
      socket.send(
        JSON.stringify({
          type: "pong",
          at: new Date().toISOString()
        })
      );
      return;
    }

    if (messageType === "form_update") {
      this.broadcast({
        type: "last_update",
        at: new Date().toISOString(),
        actor: typeof payload.actor === "string" && payload.actor.length > 0 ? payload.actor : "anonymous",
        detail:
          typeof payload.detail === "string" && payload.detail.length > 0
            ? payload.detail
            : "form changed"
      });
    }
  }

  private handleDisconnect(socket: WebSocket): void {
    if (!this.clients.delete(socket)) {
      return;
    }

    this.broadcast({
      type: "presence",
      count: this.clients.size
    });
  }

  private broadcast(payload: unknown): void {
    const message = JSON.stringify(payload);

    for (const client of this.clients) {
      try {
        client.send(message);
      } catch {
        this.clients.delete(client);
      }
    }
  }
}
