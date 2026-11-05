import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../src");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(css|tsx?)$/.test(entry.name) ? [full] : [];
  });
}

// Payload 4 removed the v3 admin tokens (`--theme-elevation-*`, `--theme-error-*`,
// `--style-radius-*`…). A `var()` of one resolves to nothing, which breaks dark mode. Use the
// v4 tokens (`--color-*`, `--field-color-*`, `--radius-*`, `--spacer-*`).
describe("Payload 4 admin tokens", () => {
  it("no Payload 3 theme tokens in styles or inline styles", () => {
    const offenders = sourceFiles(SRC).flatMap((file) => {
      const code = fs.readFileSync(file, "utf8");
      return [...code.matchAll(/var\(--((?:theme|style|font)-[a-z0-9-]+)/g)].map(
        (m) => `${path.relative(SRC, file)}: --${m[1]}`
      );
    });
    expect(offenders).toEqual([]);
  });

  it("the admin component has no hard-coded colors", () => {
    const css = fs.readFileSync(path.join(SRC, "admin/components/VariantsField.css"), "utf8");
    expect(css.match(/#[0-9a-f]{3,8}\b|rgba?\(/giu)).toBeNull();
  });
});
