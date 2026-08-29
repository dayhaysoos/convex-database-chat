import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const componentDir = join(process.cwd(), "convex", "component");
const declaration = readFileSync(
  join(componentDir, "_generated", "component.ts"),
  "utf8"
);

describe("component declaration freshness (#17)", () => {
  it("declares every public function exported by the component source", () => {
    const sourceFiles = readdirSync(componentDir).filter(
      (file) =>
        file.endsWith(".ts") &&
        !file.endsWith(".test.ts") &&
        file !== "convex.config.ts"
    );

    const missing: string[] = [];
    for (const file of sourceFiles) {
      const source = readFileSync(join(componentDir, file), "utf8").replace(
        /\/\*[\s\S]*?\*\//g,
        ""
      );
      for (const match of source.matchAll(
        /export const (\w+) = (?:query|mutation|action)\(/g
      )) {
        const fn = match[1];
        if (!declaration.includes(fn)) {
          missing.push(`${file}: ${fn}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
