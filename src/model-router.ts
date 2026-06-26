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

/**
 * Resolve a Claude model name to a provider + model pair.
 *
 * Rules:
 * 1. "provider/model" format → direct routing (explicit)
 * 2. Gateway model IDs (prefix matching) → direct routing (explicit)
 * 3. Claude tier names (sonnet, opus, haiku) → fallback to default
 * 4. Everything else → default provider + default model
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

const PROVIDER_IDS: ProviderId[] = ["deepseek", "zhipu", "opencode_go"];

function normalizeProviderId(raw: string): ProviderId | null {
  const map: Record<string, ProviderId> = {
    deepseek: "deepseek",
    zhipu: "zhipu",
    glm: "zhipu",
    opencode_go: "opencode_go",
    opencode: "opencode_go",
  };
  return map[raw.toLowerCase()] ?? null;
}

/** Parse "provider/model" into {providerId, model}; if no "/", use default provider */
function parseTierModel(
  raw: string | undefined,
  defaultProvider: ProviderId,
  defaultModel: string,
): { providerId: ProviderId; providerModel: string } {
  if (!raw) return { providerId: defaultProvider, providerModel: defaultModel };

  const slashIdx = raw.indexOf("/");
  if (slashIdx === -1) {
    // Bare model name → default provider
    return { providerId: defaultProvider, providerModel: raw };
  }

  const prefix = raw.slice(0, slashIdx);
  const id = normalizeProviderId(prefix);
  if (id) {
    return { providerId: id, providerModel: raw.slice(slashIdx + 1) };
  }

  // Unrecognized prefix → treat whole string as model name with default provider
  return { providerId: defaultProvider, providerModel: raw };
}

/** Map Claude tier names to per-tier {provider, model} or defaults */
function resolveTier(
  claudeModel: string,
  config: Config,
): { providerId: ProviderId; providerModel: string; temperature?: number; thinkingLevel?: string } {
  const lower = claudeModel.toLowerCase();
  const isOpus = lower.includes("opus");
  const isSonnet = lower.includes("sonnet");
  const isHaiku = lower.includes("haiku");

  if (isOpus && config.modelOpus) {
    const base = parseTierModel(config.modelOpus, config.defaultProvider, config.defaultModel);
    return { ...base, temperature: config.modelOpusTemperature, thinkingLevel: config.modelOpusThinkingLevel };
  }
  if (isSonnet && config.modelSonnet) {
    const base = parseTierModel(config.modelSonnet, config.defaultProvider, config.defaultModel);
    return { ...base, temperature: config.modelSonnetTemperature, thinkingLevel: config.modelSonnetThinkingLevel };
  }
  if (isHaiku && config.modelHaiku) {
    const base = parseTierModel(config.modelHaiku, config.defaultProvider, config.defaultModel);
    return { ...base, temperature: config.modelHaikuTemperature, thinkingLevel: config.modelHaikuThinkingLevel };
  }

  // Claude named model without specific override → default provider + default model
  if (isOpus || isSonnet || isHaiku) {
    return { providerId: config.defaultProvider, providerModel: config.defaultModel };
  }

  // Unknown model → pass through as-is with default provider
  return { providerId: config.defaultProvider, providerModel: claudeModel };
}
