import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ToolInput = Record<string, unknown>;

/**
 * A tool the Bedrock agent can call. `requiresApproval` pauses the agent loop
 * until the user answers; `describe` renders that pause in speakable words.
 * `run` returns the text handed back to the model as the tool result.
 */
export type AgentTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiresApproval?: boolean;
  describe?(input: ToolInput): { command: string; description: string };
  run(input: ToolInput, ctx: { dataDir: string }): string | Promise<string>;
};

function words(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

const SAMPLE_SEARCH_INDEX = [
  { title: "Airframe 14 review", tags: ["laptop", "laptops", "airframe", "computer"], snippet: "The 14-inch Airframe is the lightest laptop under $1,200 at 2.6 lb, with a rated 18-hour battery." },
  { title: "Camber 13 review", tags: ["laptop", "laptops", "camber", "computer"], snippet: "The Camber 13 costs about $220 less than the Airframe but lasts roughly 40 minutes less per charge." },
  { title: "Trailblazer X2 review", tags: ["laptop", "laptops", "trailblazer"], snippet: "The Trailblazer X2 is heavier at 3.4 lb but adds a dedicated GPU for video work." },
  { title: "Neighborhood guide", tags: ["restaurant", "restaurants", "dinner", "food", "table"], snippet: "Popular dinner spots nearby include Lupa (Italian), Molinari (seafood), and Cedar & Rye (seasonal)." }
];

function calendarPath(dataDir: string): string {
  return join(dataDir, "calendar.json");
}

type CalendarEvent = { title: string; date: string; time?: string; notes?: string };

function readCalendar(dataDir: string): CalendarEvent[] {
  const path = calendarPath(dataDir);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed as CalendarEvent[] : [];
  } catch {
    return [];
  }
}

function writeCalendar(dataDir: string, events: CalendarEvent[]): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(calendarPath(dataDir), `${JSON.stringify(events, null, 2)}\n`);
}

const SAMPLE_RESTAURANTS = [
  { name: "Lupa", cuisine: "Italian", openings: ["7:00 PM", "9:15 PM"], depositUsd: 40 },
  { name: "Molinari", cuisine: "seafood", openings: ["6:30 PM", "8:00 PM"], depositUsd: 0 },
  { name: "Cedar & Rye", cuisine: "seasonal", openings: ["7:30 PM"], depositUsd: 0 }
];

export function defaultTools(): AgentTool[] {
  return [
    {
      name: "web_search",
      description: "Look up a topic in a bundled reference index. This is sample data for evaluation, not a live web search.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "What to look up" } },
        required: ["query"]
      },
      run(input) {
        const query = words(input.query).toLowerCase();
        const hits = SAMPLE_SEARCH_INDEX.filter(item => item.tags.some(tag => query.includes(tag)));
        const results = (hits.length > 0 ? hits : SAMPLE_SEARCH_INDEX).slice(0, 3)
          .map(({ title, snippet }) => ({ title, snippet }));
        return JSON.stringify({ provider: "sample index", results });
      }
    },
    {
      name: "reservation_search",
      description: "Find restaurant tables near the user through the connected reservation provider.",
      inputSchema: {
        type: "object",
        properties: {
          cuisine: { type: "string" },
          date: { type: "string", description: "Day to dine, e.g. 'Saturday October 17'" },
          time: { type: "string", description: "Preferred time, e.g. '7pm'" },
          partySize: { type: "number" }
        },
        required: ["date", "time", "partySize"]
      },
      run(input) {
        const partySize = Number(input.partySize) || 2;
        const cuisine = words(input.cuisine).toLowerCase();
        const results = SAMPLE_RESTAURANTS
          .filter(item => !cuisine || item.cuisine.toLowerCase().includes(cuisine))
          .map(item => ({ restaurant: item.name, cuisine: item.cuisine, openings: item.openings, depositUsd: item.depositUsd, partySize }));
        return JSON.stringify({ provider: "demo reservations", results });
      }
    },
    {
      name: "reservation_book",
      description: "Book a restaurant table. Charges the listed deposit to the card on file. Consequential — always requires the user's approval.",
      requiresApproval: true,
      inputSchema: {
        type: "object",
        properties: {
          restaurant: { type: "string" },
          date: { type: "string" },
          time: { type: "string" },
          partySize: { type: "number" },
          depositUsd: { type: "number" }
        },
        required: ["restaurant", "date", "time", "partySize"]
      },
      describe(input) {
        const deposit = Number(input.depositUsd) || 0;
        const command = `Book ${words(input.restaurant, "a restaurant")} for ${Number(input.partySize) || 2} on ${words(input.date, "the requested day")} at ${words(input.time, "the requested time")}`;
        return {
          command: deposit > 0 ? `${command} — $${deposit} deposit` : command,
          description: deposit > 0
            ? `${command}. The restaurant charges a $${deposit} deposit to your card on file.`
            : `${command}.`
        };
      },
      run(input) {
        return JSON.stringify({
          provider: "demo reservations",
          confirmed: true,
          restaurant: words(input.restaurant),
          date: words(input.date),
          time: words(input.time),
          partySize: Number(input.partySize) || 2,
          note: "demo provider — no real reservation was placed"
        });
      }
    },
    {
      name: "calendar_list",
      description: "List events on the user's local calendar, optionally for one date.",
      inputSchema: {
        type: "object",
        properties: { date: { type: "string", description: "Only list events on this date" } }
      },
      run(input, ctx) {
        const date = words(input.date).toLowerCase();
        const events = readCalendar(ctx.dataDir)
          .filter(event => !date || event.date.toLowerCase().includes(date));
        return JSON.stringify({ events });
      }
    },
    {
      name: "calendar_add",
      description: "Add an event to the user's calendar. Consequential — always requires the user's approval.",
      requiresApproval: true,
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          date: { type: "string" },
          time: { type: "string" },
          notes: { type: "string" }
        },
        required: ["title", "date"]
      },
      describe(input) {
        const command = `Add "${words(input.title, "an event")}" to your calendar on ${words(input.date, "the requested day")}${words(input.time) ? ` at ${words(input.time)}` : ""}`;
        return { command, description: `${command}.` };
      },
      run(input, ctx) {
        const event: CalendarEvent = {
          title: words(input.title, "Untitled"),
          date: words(input.date, "unspecified"),
          ...(words(input.time) ? { time: words(input.time) } : {}),
          ...(words(input.notes) ? { notes: words(input.notes) } : {})
        };
        const events = readCalendar(ctx.dataDir);
        events.push(event);
        writeCalendar(ctx.dataDir, events);
        return JSON.stringify({ added: event });
      }
    }
  ];
}
