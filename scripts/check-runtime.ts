import { readConfig } from "../src/config.js";
import { buildRuntimeRegistry } from "../src/runtimes/registry.js";
import { AmbientStore } from "../src/store.js";

const query = process.argv[2];
if (!query) {
  console.error("Usage: pnpm check:runtime <assistant id or name>");
  process.exit(1);
}

const timeoutMs = Number(process.env.AMBIENT_CHECK_TIMEOUT_MS ?? 120_000);
const prompt = process.env.AMBIENT_CHECK_PROMPT ?? "Reply with a short hello.";
const pollMs = 1_000;

const config = readConfig();
const store = new AmbientStore(":memory:", config.retentionDays);
const registry = buildRuntimeRegistry(config, process.env, store);

let entry;
try {
  entry = registry.resolve(query);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const { descriptor, engine } = entry;
const report: Record<string, unknown> = {
  runtime: descriptor.id,
  label: descriptor.label,
  adapter: descriptor.adapter,
  capabilities: descriptor.capabilities
};

entry.start();
const deadline = Date.now() + timeoutMs;
try {
  await engine.discover().catch(() => undefined);
  const started = Date.now();
  let run;
  try {
    run = await engine.ask(prompt, undefined, true);
  } catch (error) {
    report.result = { ok: false, stage: "submit", error: error instanceof Error ? error.message : String(error) };
    report.state = engine.runtime().state;
    console.log(JSON.stringify(report, null, 2));
    process.exit(2);
  }
  while (Date.now() < deadline) {
    const view = engine.getWork(run.id);
    if (["completed", "failed", "cancelled", "unknown"].includes(view.status)) break;
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  const final = engine.getWork(run.id);
  report.state = engine.runtime().state;
  report.result = {
    ok: final.status === "completed",
    runId: final.id,
    status: final.status,
    elapsedMs: Date.now() - started,
    ...(final.answer ? { answer: final.answer.slice(0, 500) } : {}),
    ...(final.failure ? { failure: final.failure } : {}),
    ...(final.progress ? { progress: final.progress } : {})
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(final.status === "completed" ? 0 : 2);
} finally {
  await registry.close();
}
