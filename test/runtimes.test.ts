import { describe, expect, it } from "vitest";
import { RuntimeRegistry } from "../src/runtimes/registry.js";
import { AmbientStore } from "../src/store.js";
import { fakeAssistant, fakeRuntimeEntry } from "./fake.js";

function registry(entries: Array<[string, string]>) {
  const store = new AmbientStore();
  const registry = new RuntimeRegistry(
    store,
    entries.map(([id, label]) => fakeRuntimeEntry(id, label, fakeAssistant().client, store))
  );
  return { store, registry };
}

describe("RuntimeRegistry", () => {
  it("resolves the default and the sticky selection", () => {
    const { store, registry: reg } = registry([["hermes", "Hermes"], ["grokbot", "Grok Bot"]]);
    expect(reg.resolve().descriptor.id).toBe("hermes");
    reg.select("grok bot");
    expect(reg.resolve().descriptor.id).toBe("grokbot");
    expect(reg.selectedId()).toBe("grokbot");
    expect(reg.list().find(item => item.id === "grokbot")?.selected).toBe(true);
    store.close();
  });

  it("resolves fuzzy names across id, label, and prefixes", () => {
    const { store, registry: reg } = registry([["grokbot", "Grok Bot"], ["openclaw", "OpenClaw"]]);
    expect(reg.resolve("grokbot").descriptor.id).toBe("grokbot");
    expect(reg.resolve("Grok Bot").descriptor.id).toBe("grokbot");
    expect(reg.resolve("grok").descriptor.id).toBe("grokbot");
    expect(reg.resolve("openclaw").descriptor.id).toBe("openclaw");
    store.close();
  });

  it("names the available assistants when the name is unknown", () => {
    const { store, registry: reg } = registry([["hermes", "Hermes"], ["muse", "Muse"]]);
    expect(() => reg.resolve("nova")).toThrow('Unknown assistant "nova". Available: Hermes, Muse.');
    store.close();
  });

  it("persists selection across registry instances", () => {
    const store = new AmbientStore();
    const first = new RuntimeRegistry(store, [
      fakeRuntimeEntry("hermes", "Hermes", fakeAssistant().client, store),
      fakeRuntimeEntry("muse", "Muse", fakeAssistant().client, store)
    ]);
    first.select("muse");
    const second = new RuntimeRegistry(store, [
      fakeRuntimeEntry("hermes", "Hermes", fakeAssistant().client, store),
      fakeRuntimeEntry("muse", "Muse", fakeAssistant().client, store)
    ]);
    expect(second.selectedId()).toBe("muse");
    store.close();
  });
});
