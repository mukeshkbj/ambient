import { randomUUID, timingSafeEqual } from "node:crypto";
import { chatChunk, CHAT_DONE, type AssemblyAi } from "./assemblyai.js";
import type { Line } from "./line.js";
import { disclosure } from "./rules.js";
import type { LineInput, PhoneNumber } from "./types.js";

export type PageEvent = { type: "speak" } | { type: "hangup" };
export type PageReport = { type: "ready" } | { type: "interrupted"; spokenSoFar: string } | { type: "played"; text: string } | { type: "ended" };
export type ChatWriter = { write(chunk: string): void; end(): void };

type RoomsOptions = {
  ai: AssemblyAi;
  publicBaseUrl: string;
  voice?: string;
  joinTimeoutMs?: number;
  chatTimeoutMs?: number;
  hangUpTimeoutMs?: number;
};

const AGENT_PROMPT = "You relay a phone call. Reply with exactly the text you are given.";

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map(part => (part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : "")).join("");
}

export class CallRoom implements Line {
  readonly secret = randomUUID();
  joinUrl: string | undefined;
  private callId = "";
  private ownerName = "";
  private about: string | undefined;
  private agentId: string | undefined;
  private readonly listeners = new Set<(input: LineInput) => void>();
  private readonly pages = new Set<(event: PageEvent) => void>();
  private pending: { writer: ChatWriter; timer: NodeJS.Timeout } | undefined;
  private queued = "";
  private draft = "";
  private heardSoFar: string[] = [];
  private answered = false;
  private readonly pageKeys = new Set<string>();
  private ended = false;
  private joinTimer: NodeJS.Timeout | undefined;

  constructor(private readonly rooms: CallRooms, private readonly options: RoomsOptions) {}

  async dial(_to: PhoneNumber, callId: string, ownerName: string, about?: string): Promise<void> {
    this.callId = callId;
    this.ownerName = ownerName;
    this.about = about;
    this.joinUrl = `${this.options.publicBaseUrl}/call/${callId}`;
    this.agentId = await this.options.ai.createAgent({
      name: `ambient-${callId}`,
      greeting: disclosure(ownerName),
      systemPrompt: AGENT_PROMPT,
      voice: this.options.voice ?? "jane",
      baseUrl: `${this.options.publicBaseUrl}/call/${callId}/v1`,
      secret: this.secret
    });
    this.rooms.register(callId, this);
    this.joinTimer = setTimeout(() => {
      if (!this.answered) this.finish("no_answer");
    }, this.options.joinTimeoutMs ?? 120_000);
    this.joinTimer.unref();
  }

  info(): { ownerName: string; about?: string } {
    return { ownerName: this.ownerName, ...(this.about ? { about: this.about } : {}) };
  }

  async session(): Promise<{ token: string; agentId: string; ownerName: string; pageKey: string; wsUrl: string }> {
    if (!this.agentId) throw new Error("This call is not ready yet");
    if (this.pageKeys.size >= 3) throw new Error("This call was already answered");
    const pageKey = randomUUID();
    this.pageKeys.add(pageKey);
    return { token: await this.options.ai.mintToken(), agentId: this.agentId, ownerName: this.ownerName, pageKey, wsUrl: this.options.ai.wsUrl };
  }

  acceptsPage(key: string | undefined): boolean {
    return key !== undefined && this.pageKeys.has(key);
  }

  attach(listener: (event: PageEvent) => void): () => void {
    this.pages.add(listener);
    return () => this.pages.delete(listener);
  }

  pageEvent(report: PageReport): void {
    if (this.ended) return;
    switch (report.type) {
      case "ready":
        if (this.answered) return;
        this.answered = true;
        clearTimeout(this.joinTimer);
        this.send({ kind: "answered" });
        return;
      case "interrupted":
        this.draft = "";
        this.queued = "";
        this.send({ kind: "interrupted", spokenSoFar: report.spokenSoFar });
        return;
      case "played":
        this.send({ kind: "played", text: report.text });
        return;
      case "ended":
        this.finish("hangup");
    }
  }

  accepts(authorization: string | undefined): boolean {
    const expected = Buffer.from(`Bearer ${this.secret}`);
    const given = Buffer.from(authorization ?? "");
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  chat(body: unknown, authorization: string | undefined, writer: ChatWriter): boolean {
    if (!this.accepts(authorization)) return false;
    const messages = body && typeof body === "object" && "messages" in body && Array.isArray(body.messages) ? body.messages as { role?: unknown; content?: unknown }[] : [];
    const users = messages.filter(message => message.role === "user").map(message => contentText(message.content).trim());
    const fresh = this.freshTurns(users);
    if (fresh.length > 0) this.draft = "";
    this.closePending();
    if (this.queued) {
      const text = this.queued;
      this.queued = "";
      writer.write(chatChunk(text));
      this.endWriter(writer);
      for (const heard of fresh) this.send({ kind: "heard", text: heard });
      return true;
    }
    const timer = setTimeout(() => this.closePending(), this.options.chatTimeoutMs ?? 8_000);
    timer.unref();
    this.pending = { writer, timer };
    for (const text of fresh) this.send({ kind: "heard", text });
    return true;
  }

  say(text: string, last: boolean): void {
    if (this.ended) return;
    if (this.pending) {
      if (text) this.pending.writer.write(chatChunk(text));
      if (last) this.closePending();
      return;
    }
    this.draft += text;
    if (!last) return;
    this.queued = this.queued ? `${this.queued} ${this.draft}` : this.draft;
    this.draft = "";
    this.notify({ type: "speak" });
  }

  hangUp(): void {
    if (this.ended) return;
    if (!this.answered || this.pages.size === 0) {
      this.finish("hangup");
      return;
    }
    this.notify({ type: "hangup" });
    setTimeout(() => this.finish("hangup"), this.options.hangUpTimeoutMs ?? 20_000).unref();
  }

  onInput(listener: (input: LineInput) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private freshTurns(users: string[]): string[] {
    const seen = this.heardSoFar;
    const lines = (size: number) => users.slice(0, size).every((text, at) => seen[seen.length - size + at] === text);
    let overlap = Math.min(seen.length, users.length);
    while (overlap > 0 && !lines(overlap)) overlap -= 1;
    const fresh = (overlap === 0 && seen.length > 0 ? users.slice(-1) : users.slice(overlap)).filter(Boolean);
    this.heardSoFar = [...seen, ...fresh];
    return fresh;
  }

  private closePending(): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.endWriter(this.pending.writer);
    this.pending = undefined;
  }

  private endWriter(writer: ChatWriter): void {
    writer.write(chatChunk("", true));
    writer.write(CHAT_DONE);
    writer.end();
  }

  private finish(reason: "hangup" | "no_answer"): void {
    if (this.ended) return;
    this.closePending();
    this.ended = true;
    clearTimeout(this.joinTimer);
    this.rooms.unregister(this.callId);
    if (this.agentId) void this.options.ai.retireAgent(this.agentId).catch(() => {});
    this.send({ kind: "line_ended", reason });
  }

  private notify(event: PageEvent): void {
    for (const page of this.pages) page(event);
  }

  private send(input: LineInput): void {
    for (const listener of this.listeners) listener(input);
  }
}

export class CallRooms {
  private readonly rooms = new Map<string, CallRoom>();

  constructor(private readonly options: RoomsOptions) {}

  line(): CallRoom {
    return new CallRoom(this, this.options);
  }

  room(callId: string): CallRoom | undefined {
    return this.rooms.get(callId);
  }

  register(callId: string, room: CallRoom): void {
    this.rooms.set(callId, room);
  }

  unregister(callId: string): void {
    this.rooms.delete(callId);
  }
}
