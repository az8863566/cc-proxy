import { queryStats } from "./db.js";

function parseArgs(): { since?: string; until?: string; byModel: boolean } {
  const args = process.argv.slice(2);
  const result: { since?: string; until?: string; byModel: boolean } = { byModel: false };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--since" && args[i + 1]) {
      result.since = args[i + 1];
      i++;
    } else if (args[i] === "--until" && args[i + 1]) {
      result.until = args[i + 1];
      i++;
    } else if (args[i] === "--by-model") {
      result.byModel = true;
    }
  }
  return result;
}

function pad(n: number | null): string {
  return (n ?? 0).toLocaleString();
}

const filter = parseArgs();

if (filter.byModel) {
  const rows = queryStats(filter);
  console.log("By Model:");
  for (const r of rows) {
    console.log(`  ${(r.gateway_model ?? "unknown").padEnd(32)} Input: ${pad(r.input_tokens).padStart(12)}  Output: ${pad(r.output_tokens).padStart(12)}`);
  }
} else {
  const rows = queryStats(filter);
  if (rows.length === 0) {
    console.log("Total: no records");
  } else {
    console.log(`Total:\n  Input:  ${pad(rows[0].input_tokens)} tokens\n  Output: ${pad(rows[0].output_tokens)} tokens`);
  }
}
