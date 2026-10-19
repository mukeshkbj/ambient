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
    const control = (text: string) => [...text].some(char => char.charCodeAt(0) < 32 && !["\t", "\n", "\r"].includes(char));
    const bad = ["src", "test", "scripts", "web", "alexa"].flatMap(files).filter(path => control(readFileSync(path, "utf8")));
    expect(bad).toEqual([]);
  });
});
