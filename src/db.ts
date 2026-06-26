import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const DATA_DIR = join(import.meta.dirname, "..", "data");
const DB_PATH = join(DATA_DIR, "egress.db");

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS egress_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      sent_at         TEXT NOT NULL,
      gateway_model   TEXT NOT NULL,
      provider        TEXT NOT NULL,
      provider_model  TEXT NOT NULL,
      input_tokens    INTEGER,
      output_tokens   INTEGER,
      status          TEXT NOT NULL DEFAULT 'success'
    )
  `);
  return db;
}

export interface EgressRecord {
  sent_at: string;
  gateway_model: string;
  provider: string;
  provider_model: string;
  input_tokens?: number;
  output_tokens?: number;
  status?: string;
}

export function insertEgress(record: EgressRecord): void {
  try {
    const db = getDb();
    db.prepare(
      `INSERT INTO egress_log (sent_at, gateway_model, provider, provider_model, input_tokens, output_tokens, status)
       VALUES (@sent_at, @gateway_model, @provider, @provider_model, @input_tokens, @output_tokens, @status)`,
    ).run({
      sent_at: record.sent_at,
      gateway_model: record.gateway_model,
      provider: record.provider,
      provider_model: record.provider_model,
      input_tokens: record.input_tokens ?? null,
      output_tokens: record.output_tokens ?? null,
      status: record.status ?? "success",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cc-proxy] db insert error: ${msg}`);
  }
}

export interface StatsFilter {
  since?: string;
  until?: string;
  byModel?: boolean;
}

export interface StatsRow {
  input_tokens: number;
  output_tokens: number;
  gateway_model?: string;
}

export function queryStats(filter: StatsFilter): StatsRow[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: Record<string, string> = {};

  if (filter.since) {
    conditions.push("sent_at >= @since");
    params.since = filter.since;
  }
  if (filter.until) {
    conditions.push("sent_at <= @until");
    params.until = filter.until;
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  if (filter.byModel) {
    return db
      .prepare(
        `SELECT gateway_model, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens
         FROM egress_log ${where}
         GROUP BY gateway_model ORDER BY gateway_model`,
      )
      .all(params) as StatsRow[];
  }

  return db
    .prepare(
      `SELECT COALESCE(SUM(input_tokens), 0) AS input_tokens, COALESCE(SUM(output_tokens), 0) AS output_tokens
       FROM egress_log ${where}`,
    )
    .all(params) as StatsRow[];
}
