import { z } from "zod";

const thinkingLevelSchema = z.enum(["off", "low", "high", "max"]);

export type ProviderConfig = z.infer<typeof providerConfigBase>;

/** Shared provider config schema — apiKey + baseUrl only. */
const providerConfigBase = z.object({
  apiKey: z.string().optional().default(""),
  baseUrl: z.string().url(),
});

/** Load a single provider's raw env values (just apiKey + baseUrl). */
function providerEnv(
  prefix: string,
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    apiKey: env[`${prefix}_API_KEY`],
    baseUrl: env[`${prefix}_BASE_URL`],
  };
}

const configSchema = z.object({
  port: z.coerce.number().int().default(8082),
  host: z.string().default("0.0.0.0"),
  authToken: z.string().optional(),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Per-tier model overrides (optional; format: "provider/model")
  modelOpus: z.string().optional(),
  modelSonnet: z.string().optional(),
  modelHaiku: z.string().optional(),

  // Per-tier temperature / thinking (optional)
  modelOpusTemperature: z.coerce.number().min(0).max(2).optional(),
  modelOpusThinkingLevel: thinkingLevelSchema.optional(),
  modelSonnetTemperature: z.coerce.number().min(0).max(2).optional(),
  modelSonnetThinkingLevel: thinkingLevelSchema.optional(),
  modelHaikuTemperature: z.coerce.number().min(0).max(2).optional(),
  modelHaikuThinkingLevel: thinkingLevelSchema.optional(),

  deepseek: providerConfigBase.extend({
    baseUrl: z.string().url().default("https://api.deepseek.com/anthropic"),
  }),

  zhipu: providerConfigBase.extend({
    baseUrl: z.string().url().default("https://open.bigmodel.cn/api/anthropic/v1"),
  }),

  opencodeGo: providerConfigBase.extend({
    baseUrl: z.string().url().default("https://opencode.ai/zen/go/v1"),
  }),
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
  raw.modelOpus = env.MODEL_OPUS;
  raw.modelSonnet = env.MODEL_SONNET;
  raw.modelHaiku = env.MODEL_HAIKU;
  raw.modelOpusTemperature = env.MODEL_OPUS_TEMPERATURE;
  raw.modelOpusThinkingLevel = env.MODEL_OPUS_THINKING;
  raw.modelSonnetTemperature = env.MODEL_SONNET_TEMPERATURE;
  raw.modelSonnetThinkingLevel = env.MODEL_SONNET_THINKING;
  raw.modelHaikuTemperature = env.MODEL_HAIKU_TEMPERATURE;
  raw.modelHaikuThinkingLevel = env.MODEL_HAIKU_THINKING;

  raw.deepseek = providerEnv("DEEPSEEK", env);

  raw.zhipu = providerEnv("ZHIPU", env);

  // OpenCode Go uses a mix of OPENCODE_ and OPENCODE_GO_ prefixes
  raw.opencodeGo = {
    apiKey: env.OPENCODE_API_KEY,
    baseUrl: env.OPENCODE_GO_BASE_URL,
  };

  const parsed = configSchema.parse(raw);
  return parsed;
}
