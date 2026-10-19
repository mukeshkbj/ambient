import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { TASK_HTML } from "../src/task-view.js";

type Stub = { textContent: string; innerHTML: string; className: string; dataset: Record<string, string>; style: { setProperty(): void }; classList: { add(): void; remove(): void; toggle(): void }; appendChild(child: Stub): void; children: Stub[]; onclick?: () => void; disabled?: boolean; type?: string; offsetWidth: number };

function card() {
  const element = (): Stub => {
    let html = "";
    const node: Stub = {
      textContent: "", className: "", dataset: {}, offsetWidth: 0, children: [],
      get innerHTML() { return html; },
      set innerHTML(value: string) { html = value; node.children = []; },
      style: { setProperty() {} },
      classList: { add() {}, remove() {}, toggle() {} },
      appendChild(child) { node.children.push(child); }
    };
    return node;
  };
  const elements = new Map<string, Stub>();
  const document = { body: element(), getElementById: (id: string) => elements.get(id) ?? elements.set(id, element()).get(id)!, createElement: element };
  const script = /<script>([\s\S]*)<\/script>/.exec(TASK_HTML)![1]!;
  const context = vm.createContext({ document, parent: { postMessage() {} }, addEventListener() {}, setTimeout() {}, setInterval() { return 0; }, clearInterval() {}, Date, Number, String, Math, Map, Intl });
  vm.runInContext(script, context);
  const render = (data: unknown) => (context as unknown as { render(data: unknown): void }).render(data);
  return { render, text: (id: string) => document.getElementById(id).textContent, html: (id: string) => document.getElementById(id).innerHTML, buttons: () => document.getElementById("actions").children.map(child => child.textContent) };
}

const board = (states: Array<[string, string, number?, string?]>) => states.map(([business, state, amountUsd, when]) => ({ business, state, ...(amountUsd !== undefined ? { amountUsd } : {}), ...(when ? { when } : {}) }));

describe("the Echo Show card", () => {
  it("asks once to call every business it found", () => {
    const view = card();
    view.render({
      task: { status: "running", instruction: "Get quotes from plumbers to fix the kitchen sink, under 150", steps: [] },
      approvals: [{ kind: "dial", command: "I found Pete's Pipes, Drain Bros and Rapid Rooter. Call all three and book the best quote under your limit?", choices: ["once", "deny"] }]
    });
    expect(view.text("stake")).toBe("Call all three at once?");
    expect(view.buttons()).toEqual(["Call all three", "Not now"]);
  });

  it("shows the quotes coming in while the calls run", () => {
    const view = card();
    view.render({
      task: { status: "running", instruction: "Get quotes from plumbers to fix the kitchen sink, under 150", steps: [], board: board([["Pete's Pipes", "quoted", 140, "Tuesday the 20th at 9 am"], ["Drain Bros", "talking"], ["Rapid Rooter", "calling"]]) }
    });
    expect(view.text("chip")).toBe("Calling 3 at once");
    expect(view.text("stake")).toBe("Getting quotes");
    expect(view.text("sub")).toBe("1 of 3 quoted. Ambient books the cheapest under your limit and releases the rest.");
  });

  it("names the booked business and says it was the cheapest", () => {
    const view = card();
    view.render({
      task: {
        status: "completed", instruction: "Get quotes from plumbers to fix the kitchen sink, under 150",
        steps: ["Ambient to Drain Bros: Okay, so just to confirm, one hundred twenty-five dollars total, Tuesday the 20th at 11 am. Is that right?", "Drain Bros: Yes, that's right.", "Pete's Pipes: We can do Tuesday the 20th at 9 am for one forty, all in."],
        outcome: { kind: "confirmed", summary: "Drain Bros confirmed Tuesday the 20th at 11 am for one hundred twenty-five dollars.", amountUsd: 125, when: "Tuesday the 20th at 11 am" },
        board: board([["Pete's Pipes", "released", 140], ["Drain Bros", "booked", 125], ["Rapid Rooter", "released", 160]])
      }
    });
    expect(view.text("chip")).toBe("Booked · confirmed by Drain Bros");
    expect(view.text("sub")).toBe("Ambient read back the total and the time. Drain Bros said “Yes, that's right.”");
    expect(view.text("hint")).toBe("Cheapest of 3 quotes ($140 passed, $160 passed), within your $150 limit.");
  });

  it("quotes the read-back and the yes that booked it, with their times", () => {
    const view = card();
    view.render({
      task: {
        status: "completed", instruction: "Call Joe's Plumbing and book a visit to fix the kitchen sink, under 150", subject: "Joe's Plumbing", steps: [],
        outcome: {
          kind: "confirmed", summary: "Joe's Plumbing confirmed Tuesday the 20th at 10 am for one hundred sixty dollars.", amountUsd: 160, when: "Tuesday the 20th at 10 am",
          proof: { readBack: "Let me say it back, one hundred sixty dollars total, Tuesday the 20th at 10 am. Is that right?", readBackAt: "2026-10-19T17:04:12.000Z", yes: "Yes, that's right. See you then.", yesAt: "2026-10-19T17:04:14.000Z" }
        }
      }
    });
    expect(view.text("sub")).toBe("");
    expect(view.html("foot")).toContain("“Yes, that's right. See you then.”");
    expect(view.html("foot")).toMatch(/Joe&#39;s Plumbing · \d{1,2}:04:14 [AP]M|Joe's Plumbing · \d{1,2}:04:14 [AP]M/);
    expect(view.buttons()).toEqual(["Hear them say yes"]);
  });
});
