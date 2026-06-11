/* Parser eval harness.
 *
 *   npm run eval:parser                 -> heuristic engine (no key needed)
 *   npm run eval:parser -- --engine=claude  -> live Claude (needs ANTHROPIC_API_KEY)
 *
 * Each line of evals/prompts.jsonl is {prompt, expect}. Only the fields listed
 * in `expect` are checked; `"clarify": true` asserts clarifyingQuestion != null.
 * Exits non-zero when accuracy < 95%.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { heuristicParse } from "../src/lib/heuristic";
import type { Intent } from "../src/lib/intent";

type Case = { prompt: string; expect: Record<string, unknown> };

const engine = process.argv.includes("--engine=claude") ? "claude" : "heuristic";

async function parseClaude(prompt: string): Promise<Intent> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { parseWithClaude } = await import("../src/lib/claudeParse");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";
  return parseWithClaude(client, model, prompt);
}

function check(intent: Intent, expect: Record<string, unknown>): string[] {
  const failures: string[] = [];
  for (const [key, want] of Object.entries(expect)) {
    if (key === "clarify") {
      const has = intent.clarifyingQuestion != null;
      if (has !== want) failures.push(`clarify: wanted ${want}, got ${has}`);
      continue;
    }
    const got = (intent as unknown as Record<string, unknown>)[key];
    if (got !== want) failures.push(`${key}: wanted ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
  return failures;
}

async function main() {
  const file = resolve(__dirname, "../evals/prompts.jsonl");
  const cases: Case[] = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

  let passed = 0;
  const failures: Array<{ prompt: string; problems: string[] }> = [];

  for (const c of cases) {
    if (engine === "claude" && !process.env.ANTHROPIC_API_KEY) {
      console.error("ANTHROPIC_API_KEY not set — cannot run claude engine.");
      process.exit(2);
    }
    const intent = engine === "claude" ? await parseClaude(c.prompt) : heuristicParse(c.prompt);
    const problems = check(intent, c.expect);
    if (problems.length === 0) passed++;
    else failures.push({ prompt: c.prompt, problems });
  }

  const accuracy = (passed / cases.length) * 100;
  console.log(`\nengine: ${engine}`);
  console.log(`passed: ${passed}/${cases.length}  (${accuracy.toFixed(1)}%)\n`);
  for (const f of failures) {
    console.log(`FAIL  "${f.prompt}"`);
    for (const p of f.problems) console.log(`      ${p}`);
  }
  if (accuracy < 95) {
    console.error(`\nBelow the 95% bar.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
