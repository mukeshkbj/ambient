import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(?:ts|html|json)$/.test(name) ? [path] : [];
  });
}

describe("source files", () => {
  it("contain no control characters, which an escaped backslash turns into", () => {
    const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;
    const bad = ["src", "test", "scripts", "web", "alexa"].flatMap(files).filter(path => control.test(readFileSync(path, "utf8")));
    expect(bad).toEqual([]);
  });
});
