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
    const { store, registry: reg } = registry([["hermes", "Hermes"], ["beta", "Beta Agent"]]);
    expect(reg.resolve().descriptor.id).toBe("hermes");
    reg.select("beta agent");
    expect(reg.resolve().descriptor.id).toBe("beta");
    expect(reg.selectedId()).toBe("beta");
    expect(reg.list().find(item => item.id === "beta")?.selected).toBe(true);
    store.close();
  });

  it("resolves fuzzy names across id, label, and prefixes", () => {
    const { store, registry: reg } = registry([["beta", "Beta Agent"], ["openclaw", "OpenClaw"]]);
    expect(reg.resolve("beta").descriptor.id).toBe("beta");
    expect(reg.resolve("Beta Agent").descriptor.id).toBe("beta");
    expect(reg.resolve("bet").descriptor.id).toBe("beta");
    expect(reg.resolve("openclaw").descriptor.id).toBe("openclaw");
    store.close();
  });

  it("names the available assistants when the name is unknown", () => {
    const { store, registry: reg } = registry([["hermes", "Hermes"], ["gamma", "Gamma Agent"]]);
    expect(() => reg.resolve("nova")).toThrow('Unknown assistant "nova". Available: Hermes, Gamma Agent.');
    store.close();
  });

  it("persists selection across registry instances", () => {
    const store = new AmbientStore();
    const first = new RuntimeRegistry(store, [
      fakeRuntimeEntry("hermes", "Hermes", fakeAssistant().client, store),
      fakeRuntimeEntry("gamma", "Gamma Agent", fakeAssistant().client, store)
    ]);
    first.select("gamma");
    const second = new RuntimeRegistry(store, [
      fakeRuntimeEntry("hermes", "Hermes", fakeAssistant().client, store),
      fakeRuntimeEntry("gamma", "Gamma Agent", fakeAssistant().client, store)
    ]);
    expect(second.selectedId()).toBe("gamma");
    store.close();
  });
});
