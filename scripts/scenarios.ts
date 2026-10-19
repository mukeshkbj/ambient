import { pathToFileURL } from "node:url";
import { runCall, type CallHandle } from "../src/calls/call.js";
import { SCENARIOS, type Scenario } from "../src/calls/scenarios.js";
import type { CallBrief, CallOutcome, Speaker } from "../src/calls/types.js";

export type ScenarioResult = { transcript: string[]; outcome: CallOutcome; asked: string[] };

const speakerName = (brief: CallBrief, speaker: Speaker) => (speaker === "agent" ? "Ambient" : speaker === "owner" ? brief.ownerName : brief.business.name);

export async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const asked: string[] = [];
  const call: CallHandle = runCall({
    brief: scenario.brief,
    callId: "scenario",
    line: scenario.line(),
    brain: scenario.brain,
    tickMs: 5,
    log: () => {},
    emit: event => {
      if (event.type !== "approval.request") return;
      asked.push(String(event.payload.command));
      if (scenario.owner) call.ownerDecided(String(event.payload.requestId), scenario.owner);
    }
  });
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${scenario.title}: the call never ended`)), 5000).unref());
  const state = await Promise.race([call.done, timeout]);
  if (state.phase.kind !== "ended") throw new Error(`${scenario.title}: the call did not end`);
  return {
    transcript: state.turns.map(turn => `${speakerName(scenario.brief, turn.speaker)}: ${turn.text}`),
    outcome: state.phase.outcome,
    asked
  };
}

function describeOutcome(outcome: CallOutcome): string {
  return outcome.kind === "confirmed" ? `confirmed. ${outcome.summary}` : `${outcome.kind}. ${outcome.reason}`;
}

async function main(): Promise<void> {
  const wrong: string[] = [];
  for (const scenario of SCENARIOS) {
    const { transcript, outcome, asked } = await runScenario(scenario);
    console.log(`=== ${scenario.title}\n${scenario.story}\n`);
    for (const line of transcript) console.log(`  ${line}`);
    console.log(`\n  Owner asked: ${asked.length > 0 ? asked.join(" | ") : "never"}\n  Outcome: ${describeOutcome(outcome)}\n`);
    if (outcome.kind !== scenario.expect.kind) wrong.push(`${scenario.title}: expected ${scenario.expect.kind}, got ${outcome.kind}`);
    for (const pattern of scenario.expect.transcript) {
      if (!pattern.test(transcript.join("\n"))) wrong.push(`${scenario.title}: the transcript does not match ${pattern}`);
    }
  }
  if (wrong.length > 0) {
    console.error(`scenarios: FAILED\n${wrong.map(line => `  ${line}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`scenarios: ok, ${SCENARIOS.length} calls ended as expected through the real reducer`);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
