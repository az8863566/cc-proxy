import { z } from "zod";

const thinkingLevelSchema = z.enum(["off", "low", "high", "max"]);

export type ProviderConfig = z.infer<typeof providerConfig>;

/** Shared provider config schema — extended per-provider for custom defaults. */
const providerConfigBase = z.object({
  apiKey: z.string().optional().default(""),
  baseUrl: z.string().url(),
  defaultModel: z.string(),
  thinkingLevel: thinkingLevelSchema.optional(),
  temperature: z.number().optional(),
});

function providerModelSchema(defaultModel: string, baseUrl: string, tempMin = 0, tempMax = 2) {
  return providerConfigBase.extend({
    baseUrl: z.string().url().default(baseUrl),
    defaultModel: z.string().default(defaultModel),
    temperature: z.coerce.number().min(tempMin).max(tempMax).optional(),
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const providerConfig = providerModelSchema("", "");

/** Load a single provider's raw env values (5 fields). */
function providerEnv(
  prefix: string,
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    apiKey: env[`${prefix}_API_KEY`],
    baseUrl: env[`${prefix}_BASE_URL`],
    defaultModel: env[`${prefix}_DEFAULT_MODEL`],
    thinkingLevel: env[`${prefix}_THINKING_LEVEL`],
    temperature: env[`${prefix}_TEMPERATURE`],
  };
}

const configSchema = z.object({
  port: z.coerce.number().int().default(8082),
  host: z.string().default("0.0.0.0"),
  authToken: z.string().optional(),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),

  defaultProvider: z.enum(["deepseek", "zhipu", "opencode_go"]).default("deepseek"),
  defaultModel: z.string().default("deepseek-v4-pro"),

  // Per-tier model overrides (optional; format: "provider/model" or bare model name)
  modelOpus: z.string().optional(),
  modelSonnet: z.string().optional(),
  modelHaiku: z.string().optional(),

  // Per-tier temperature / thinking (optional; overrides provider defaults)
  modelOpusTemperature: z.coerce.number().min(0).max(2).optional(),
  modelOpusThinkingLevel: thinkingLevelSchema.optional(),
  modelSonnetTemperature: z.coerce.number().min(0).max(2).optional(),
  modelSonnetThinkingLevel: thinkingLevelSchema.optional(),
  modelHaikuTemperature: z.coerce.number().min(0).max(2).optional(),
  modelHaikuThinkingLevel: thinkingLevelSchema.optional(),

  enableThinking: z
    .preprocess((v) => v !== "false" && v !== "0", z.boolean())
    .default(true),
  thinkingLevel: thinkingLevelSchema.default("high"),

  temperature: z.coerce.number().min(0).max(2).optional(),

  deepseek: providerModelSchema(
    "deepseek-v4-pro",
    "https://api.deepseek.com/anthropic",
  ),

  zhipu: providerModelSchema(
    "glm-5.2",
    "https://open.bigmodel.cn/api/paas/v4",
    0.01,
    1,
  ),

  opencodeGo: providerModelSchema(
    "opencode/gpt-5.5",
    "https://opencode.ai/zen/go/v1",
  ),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined>): Config {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: Record<string, any> = {};

  // Top-level
  raw.port = env.PORT;
  raw.host = env.HOST;
  raw.authToken = env.ANTHROPIC_AUTH_TOKEN;
  raw.logLevel = env.LOG_LEVEL;
  raw.defaultProvider = env.DEFAULT_PROVIDER;
  raw.defaultModel = env.DEFAULT_MODEL;
  raw.modelOpus = env.MODEL_OPUS;
  raw.modelSonnet = env.MODEL_SONNET;
  raw.modelHaiku = env.MODEL_HAIKU;
  raw.modelOpusTemperature = env.MODEL_OPUS_TEMPERATURE;
  raw.modelOpusThinkingLevel = env.MODEL_OPUS_THINKING;
  raw.modelSonnetTemperature = env.MODEL_SONNET_TEMPERATURE;
  raw.modelSonnetThinkingLevel = env.MODEL_SONNET_THINKING;
  raw.modelHaikuTemperature = env.MODEL_HAIKU_TEMPERATURE;
  raw.modelHaikuThinkingLevel = env.MODEL_HAIKU_THINKING;
  raw.enableThinking = env.ENABLE_THINKING;
  raw.thinkingLevel = env.THINKING_LEVEL;
  raw.temperature = env.TEMPERATURE;

  raw.deepseek = providerEnv("DEEPSEEK", env);

  raw.zhipu = providerEnv("ZHIPU", env);

  // OpenCode Go uses a mix of OPENCODE_ and OPENCODE_GO_ prefixes
  raw.opencodeGo = {
    apiKey: env.OPENCODE_API_KEY,
    baseUrl: env.OPENCODE_GO_BASE_URL,
    defaultModel: env.OPENCODE_GO_DEFAULT_MODEL,
    thinkingLevel: env.OPENCODE_GO_THINKING_LEVEL,
    temperature: env.OPENCODE_GO_TEMPERATURE,
  };

  const parsed = configSchema.parse(raw);
  return parsed;
}
