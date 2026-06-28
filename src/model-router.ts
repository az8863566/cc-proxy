import type { Config } from "./config.js";

export type ProviderId = "deepseek" | "zhipu" | "opencode_go";

export interface ResolvedModel {
  providerId: ProviderId;
  providerModel: string;
  originalModel: string;
  /** True when the user explicitly chose a provider (prefix syntax), not tier-based resolution */
  explicitProvider: boolean;
  /** Per-tier overrides (undefined = use provider default) */
  temperature?: number;
  thinkingLevel?: string;
}

/** Provider metadata registry — single source of truth for routing. */
export const PROVIDER_REGISTRY: Array<{
  id: ProviderId;
  aliases: string[];
}> = [
  { id: "deepseek", aliases: ["deepseek"] },
  { id: "zhipu", aliases: ["zhipu", "glm"] },
  { id: "opencode_go", aliases: ["opencode_go", "opencode"] },
];

const PROVIDER_IDS: ProviderId[] = PROVIDER_REGISTRY.map((p) => p.id);

const PROVIDER_ALIAS_MAP: Record<string, ProviderId> = Object.fromEntries(
  PROVIDER_REGISTRY.flatMap((p) => p.aliases.map((alias) => [alias, p.id])),
);

function normalizeProviderId(raw: string): ProviderId | null {
  return PROVIDER_ALIAS_MAP[raw.toLowerCase()] ?? null;
}

/**
 * Resolve a Claude model name to a provider + model pair.
 *
 * Rules:
 * 1. "provider/model" format → direct routing (explicit)
 * 2. Gateway model IDs (prefix matching) → direct routing (explicit)
 * 3. Claude tier names (sonnet, opus, haiku) → match MODEL_{TIER} config or throw
 * 4. Everything else → throw (no default fallback)
 */
export function resolveModel(
  modelName: string,
  config: Config,
): ResolvedModel {
  // Rule 1: "provider/model" format
  const slashIdx = modelName.indexOf("/");
  if (slashIdx !== -1) {
    const prefix = modelName.slice(0, slashIdx);
    const id = normalizeProviderId(prefix);
    if (id) {
      return {
        providerId: id,
        providerModel: modelName.slice(slashIdx + 1),
        originalModel: modelName,
        explicitProvider: true,
      };
    }
  }

  // Rule 2: Gateway prefix matching (e.g. "deepseek-" prefix)
  for (const id of PROVIDER_IDS) {
    if (modelName.startsWith(id + "-")) {
      const rest = modelName.slice(id.length + 1);
      return {
        providerId: id,
        providerModel: rest,
        originalModel: modelName,
        explicitProvider: true,
      };
    }
  }

  // Rule 3 & 4: Claude tier → per-tier or default provider+model (not explicit)
  const tier = resolveTier(modelName, config);
  return {
    providerId: tier.providerId,
    providerModel: tier.providerModel,
    originalModel: modelName,
    explicitProvider: false,
    temperature: tier.temperature,
    thinkingLevel: tier.thinkingLevel,
  };
}

/** Parse "provider/model" into {providerId, model}; if no "/", use raw string with default provider */
function parseTierModel(
  raw: string | undefined,
): { providerId: ProviderId; providerModel: string } | null {
  if (!raw) return null;

  const slashIdx = raw.indexOf("/");
  if (slashIdx === -1) {
    // Bare model name → no provider prefix, treat whole string as model
    // (caller must handle error when no default provider exists)
    return null;
  }

  const prefix = raw.slice(0, slashIdx);
  const id = normalizeProviderId(prefix);
  if (id) {
    return { providerId: id, providerModel: raw.slice(slashIdx + 1) };
  }

  // Unrecognized prefix → can't parse
  return null;
}

/** Map Claude tier names to per-tier {provider, model} or throw on missing config */
function resolveTier(
  claudeModel: string,
  config: Config,
): { providerId: ProviderId; providerModel: string; temperature?: number; thinkingLevel?: string } {
  const lower = claudeModel.toLowerCase();
  const isOpus = lower.includes("opus");
  const isSonnet = lower.includes("sonnet");
  const isHaiku = lower.includes("haiku");

  if (isOpus && config.modelOpus) {
    const base = parseTierModel(config.modelOpus);
    if (base) return { ...base, temperature: config.modelOpusTemperature, thinkingLevel: config.modelOpusThinkingLevel };
    throw new Error(`Invalid MODEL_OPUS format: "${config.modelOpus}". Use "provider/model".`);
  }
  if (isSonnet && config.modelSonnet) {
    const base = parseTierModel(config.modelSonnet);
    if (base) return { ...base, temperature: config.modelSonnetTemperature, thinkingLevel: config.modelSonnetThinkingLevel };
    throw new Error(`Invalid MODEL_SONNET format: "${config.modelSonnet}". Use "provider/model".`);
  }
  if (isHaiku && config.modelHaiku) {
    const base = parseTierModel(config.modelHaiku);
    if (base) return { ...base, temperature: config.modelHaikuTemperature, thinkingLevel: config.modelHaikuThinkingLevel };
    throw new Error(`Invalid MODEL_HAIKU format: "${config.modelHaiku}". Use "provider/model".`);
  }

  // Known tier name without config → throw
  if (isOpus || isSonnet || isHaiku) {
    throw new Error(
      `No route configured for tier "${claudeModel}". Set MODEL_OPUS/SONNET/HAIKU in .env (format: "provider/model").`,
    );
  }

  // Unknown model → can't route without a default provider
  throw new Error(`Unknown model "${claudeModel}" — cannot resolve route. Use "provider/model" syntax or configure MODEL_OPUS/SONNET/HAIKU.`);
}
