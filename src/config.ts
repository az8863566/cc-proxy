import { z } from "zod";

const thinkingLevelSchema = z.enum(["off", "low", "high", "max"]);

const providerConfig = z.object({
  apiKey: z.string().min(1),
  baseUrl: z.string().url(),
  defaultModel: z.string().min(1),
  thinkingLevel: thinkingLevelSchema.optional(),
  temperature: z.number().optional(),
});

export type ProviderConfig = z.infer<typeof providerConfig>;

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

  deepseek: z.object({
    apiKey: z.string().optional().default(""),
    baseUrl: z.string().url().default("https://api.deepseek.com/anthropic"),
    defaultModel: z.string().default("deepseek-v4-pro"),
    thinkingLevel: thinkingLevelSchema.optional(),
    temperature: z.coerce.number().min(0).max(2).optional(),
  }),

  zhipu: z.object({
    apiKey: z.string().optional().default(""),
    baseUrl: z.string().url().default("https://open.bigmodel.cn/api/paas/v4"),
    defaultModel: z.string().default("glm-5.2"),
    thinkingLevel: thinkingLevelSchema.optional(),
    temperature: z.coerce.number().min(0.01).max(1).optional(),
  }),

  opencodeGo: z.object({
    apiKey: z.string().optional().default(""),
    baseUrl: z
      .string()
      .url()
      .default("https://opencode.ai/zen/go/v1"),
    defaultModel: z.string().default("opencode/gpt-5.5"),
    thinkingLevel: thinkingLevelSchema.optional(),
    temperature: z.coerce.number().min(0).max(2).optional(),
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

  // DeepSeek
  raw.deepseek = {
    apiKey: env.DEEPSEEK_API_KEY,
    baseUrl: env.DEEPSEEK_BASE_URL,
    defaultModel: env.DEEPSEEK_DEFAULT_MODEL,
    thinkingLevel: env.DEEPSEEK_THINKING_LEVEL,
    temperature: env.DEEPSEEK_TEMPERATURE,
  };

  // Zhipu
  raw.zhipu = {
    apiKey: env.ZHIPU_API_KEY,
    baseUrl: env.ZHIPU_BASE_URL,
    defaultModel: env.ZHIPU_DEFAULT_MODEL,
    thinkingLevel: env.ZHIPU_THINKING_LEVEL,
    temperature: env.ZHIPU_TEMPERATURE,
  };

  // OpenCode Go
  raw.opencodeGo = {
    apiKey: env.OPENCODE_API_KEY,
    baseUrl: env.OPENCODE_GO_BASE_URL,
    defaultModel: env.OPENCODE_GO_DEFAULT_MODEL,
    thinkingLevel: env.OPENCODE_GO_THINKING_LEVEL,
    temperature: env.OPENCODE_GO_TEMPERATURE,
  };

  const parsed = configSchema.parse(raw);

  // Zhipu temperature clamp (must be > 0)
  if (parsed.zhipu.temperature !== undefined && parsed.zhipu.temperature <= 0) {
    parsed.zhipu.temperature = 0.01;
  }

  return parsed;
}
