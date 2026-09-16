import WebSocket from "ws";

export type LocalConnectorOptions = {
  bridgeUrl: string;
  bridgeToken: string;
  runtimeId: string;
  hermesUrl: string;
  hermesToken?: string;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
};

function websocketUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error("Connector bridge URL must use HTTP or WebSocket transport");
  return url.toString();
}

function hermesUrl(value: string, token?: string): string {
  const url = new URL(value);
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

function closeSocket(socket: WebSocket | undefined): void {
  if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) return;
  socket.close();
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export class LocalHermesConnector {
  private stopped = false;
  private current: Promise<void> | undefined;
  private bridge: WebSocket | undefined;
  private hermes: WebSocket | undefined;
  private retryDelay: number;
  private readonly minDelay: number;
  private readonly maxDelay: number;

  constructor(private readonly options: LocalConnectorOptions) {
    this.minDelay = options.reconnectMinMs ?? 1_000;
    this.maxDelay = Math.max(this.minDelay, options.reconnectMaxMs ?? 30_000);
    this.retryDelay = this.minDelay;
  }

  start(): void {
    void this.runLoop();
  }

  async close(): Promise<void> {
    this.stopped = true;
    closeSocket(this.bridge);
    closeSocket(this.hermes);
    await this.current;
  }

  private async runLoop(): Promise<void> {
    while (!this.stopped) {
      this.current = this.runOnce();
      await this.current;
      this.current = undefined;
      if (this.stopped) break;
      await wait(this.retryDelay);
      this.retryDelay = Math.min(this.maxDelay, this.retryDelay * 2);
    }
  }

  private runOnce(): Promise<void> {
    return new Promise(resolve => {
      let ended = false;
      const end = () => {
        if (ended) return;
        ended = true;
        closeSocket(this.bridge);
        closeSocket(this.hermes);
        this.bridge = undefined;
        this.hermes = undefined;
        resolve();
      };
      const bridge = new WebSocket(websocketUrl(this.options.bridgeUrl), {
        headers: {
          authorization: `Bearer ${this.options.bridgeToken}`,
          "x-ambient-runtime-id": this.options.runtimeId
        }
      });
      this.bridge = bridge;
      bridge.on("open", () => {
        if (ended || this.stopped) return end();
        const hermes = new WebSocket(hermesUrl(this.options.hermesUrl, this.options.hermesToken));
        this.hermes = hermes;
        hermes.on("open", () => {
          if (ended || this.stopped) return end();
          this.retryDelay = this.minDelay;
        });
        hermes.on("message", data => {
          const text = data.toString();
          if (bridge.readyState === WebSocket.OPEN) bridge.send(text);
        });
        hermes.on("error", () => end());
        hermes.on("close", () => end());
      });
      bridge.on("message", data => {
        const text = data.toString();
        if (this.hermes?.readyState === WebSocket.OPEN) this.hermes.send(text);
      });
      bridge.on("error", () => end());
      bridge.on("close", () => end());
    });
  }
}
