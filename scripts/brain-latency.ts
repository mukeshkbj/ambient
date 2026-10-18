import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { claudeBrain } from "../src/calls/brain.js";
import { startCall, step, type CallState } from "../src/calls/session.js";
import { parsePhoneNumber, type CallBrief, type CallInput } from "../src/calls/types.js";

const model = process.env.CALLER_MODEL ?? "claude-opus-5-5";
const runs = Number(process.env.RUNS ?? 10);

const brief: CallBrief = {
  goal: "Book a plumber visit to fix a leaking kitchen sink this week",
  business: { name: "Joe's Plumbing", phone: parsePhoneNumber("4155550134") },
  ownerName: "Maya",
  maxUsd: 150,
  facts: ["The address is 12 Elm Street", "Maya is home after 9am on weekdays"]
};

const transcripts: CallInput[][] = [
  [{ kind: "heard", text: "Joe's Plumbing, how can I help?" }],
  [{ kind: "heard", text: "Joe's Plumbing." }, { kind: "heard", text: "What's the address?" }],
  [{ kind: "heard", text: "Hi, yeah, we can come Tuesday at ten. It'll be one eighty." }],
  [{ kind: "heard", text: "We're booked solid until next month, sorry." }],
  [{ kind: "heard", text: "Can I get a card number to hold the slot?" }],
  [{ kind: "heard", text: "Am I talking to a robot?" }],
  [{ kind: "heard", text: "Okay, one forty, Tuesday at ten works." }],
  [{ kind: "heard", text: "What kind of leak is it?" }],
  [{ kind: "heard", text: "Sorry, who is this for again?" }],
  [{ kind: "heard", text: "We only do commercial work." }]
];

function stateFor(inputs: CallInput[]): CallState {
  let state = startCall(brief, "latency").state;
  for (const input of [{ kind: "answered" } as const, ...inputs]) state = step(state, input, new Date().toISOString()).state;
  return state;
}

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? NaN;
};

const client = new Anthropic();
const brain = claudeBrain({ stream: (request, options) => client.beta.messages.stream(request, options), model, fallbacks: true });
const samples: Array<{ transcript: number; firstStepMs: number; totalMs: number; first: string }> = [];

for (let n = 0; n < runs; n++) {
  const transcript = n % transcripts.length;
  const started = performance.now();
  let firstStepMs = NaN;
  let first = "";
  for await (const brainStep of brain.respond(stateFor(transcripts[transcript]!), new AbortController().signal)) {
    if (Number.isNaN(firstStepMs)) {
      firstStepMs = performance.now() - started;
      first = brainStep.kind === "say" ? brainStep.text : brainStep.kind;
    }
  }
  const totalMs = performance.now() - started;
  samples.push({ transcript, firstStepMs, totalMs, first });
  console.log(`#${n} transcript ${transcript}: first ${firstStepMs.toFixed(0)} ms (${JSON.stringify(first)}), total ${totalMs.toFixed(0)} ms`);
}

const firsts = samples.map(sample => sample.firstStepMs).filter(Number.isFinite);
const summary = {
  model,
  date: new Date().toISOString(),
  runs,
  firstStepMs: { p50: percentile(firsts, 50), p95: percentile(firsts, 95) },
  totalMs: { p50: percentile(samples.map(sample => sample.totalMs), 50), p95: percentile(samples.map(sample => sample.totalMs), 95) },
  samples
};
mkdirSync("docs/receipts", { recursive: true });
const file = `docs/receipts/brain-latency-${summary.date.slice(0, 10)}.json`;
writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`);
console.log(`p50 ${summary.firstStepMs.p50.toFixed(0)} ms, p95 ${summary.firstStepMs.p95.toFixed(0)} ms to first step; wrote ${file}`);
