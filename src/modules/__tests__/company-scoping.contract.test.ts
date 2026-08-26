import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

/**
 * Cross-cutting contract test: every exported `update*`/`transition*`
 * function in a `*.service.ts` file must reference `actor.companyId`
 * somewhere in its own body. This targets the single most-repeated bug
 * class this project has found and fixed (Sampling, Buyer Enquiry, Deal,
 * Job Order, Job Work Order, 26 simple-lookup masters, tax rates, purchase
 * orders — see CLAUDE.md's own history) — a mutation function that takes an
 * `id` but never independently verifies it belongs to the caller's company,
 * letting a client from Company A silently mutate Company B's row.
 *
 * Deliberately crude (source-text matching, not a real AST/type-flow
 * analysis) — good enough to catch the exact bug class above without the
 * cost of a real static-analysis pass, and cheap to re-run on every commit.
 *
 * ALLOWLIST: reviewed by hand, once, when this test was written. Adding a
 * name here is a deliberate exception, not a way to silence a real finding
 * — each entry states why it's actually safe.
 */
const ALLOWLIST: Record<string, string> = {
  // Global lookup, not company-scoped at all by design (confirmed in
  // CLAUDE.md: "UnitOfMeasure — deliberately global with no companyId
  // column at all").
  updateUnit: "UnitOfMeasure has no companyId column — it is a deliberately global, non-tenant-scoped master.",
};

interface MatchedFunction {
  name: string;
  file: string;
  body: string;
}

function extractFunctionBody(source: string, matchStart: number, braceOpenIndex: number): string {
  let depth = 0;
  for (let i = braceOpenIndex; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(braceOpenIndex, i + 1);
    }
  }
  throw new Error(`Could not find matching closing brace for function starting at ${matchStart}`);
}

function findServiceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      results.push(...findServiceFiles(fullPath));
    } else if (entry.endsWith(".service.ts") && !entry.endsWith(".test.ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

function findMatchedFunctions(): MatchedFunction[] {
  const files = findServiceFiles(path.join(process.cwd(), "src", "modules"));
  const results: MatchedFunction[] = [];
  const declRegex = /export async function ((?:update|transition)[A-Z]\w*)\s*\([^)]*\)[^{]*\{/g;

  for (const file of files) {
    const source = readFileSync(file, "utf-8");
    for (const match of source.matchAll(declRegex)) {
      const name = match[1];
      const braceOpenIndex = match.index! + match[0].length - 1;
      const body = extractFunctionBody(source, match.index!, braceOpenIndex);
      results.push({ name, file: path.relative(process.cwd(), file), body });
    }
  }
  return results;
}

describe("contract: every update*/transition* service function references actor.companyId", () => {
  const matched = findMatchedFunctions();

  // A sanity floor, not a magic number tied to today's exact count — this
  // just fails loudly if the glob/regex above ever stops matching anything
  // at all (e.g. after a big refactor), which would otherwise make every
  // test below vacuously pass over zero functions.
  it("finds a realistic number of candidate functions (sanity check on the scan itself)", () => {
    expect(matched.length).toBeGreaterThan(40);
  });

  it.each(matched.filter((m) => !(m.name in ALLOWLIST)))("$name ($file) references actor.companyId", ({ name, file, body }) => {
    expect(body, `${name} in ${file} has no "actor.companyId" reference — likely a missing tenant-scoping check`).toContain(
      "actor.companyId"
    );
  });

  it("every allowlist entry still exists in the codebase (no stale exceptions)", () => {
    const matchedNames = new Set(matched.map((m) => m.name));
    for (const name of Object.keys(ALLOWLIST)) {
      expect(matchedNames.has(name), `Allowlisted function "${name}" no longer exists — remove its stale entry`).toBe(true);
    }
  });
});
