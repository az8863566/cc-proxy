import { loadConfig } from "./config.js";
import { DeepSeekProvider } from "./providers/deepseek.js";
import { ZhipuProvider } from "./providers/zhipu.js";
import { OpenCodeGoProvider } from "./providers/opencode-go.js";
import { createApp } from "./server.js";
import type { ProviderConfig, Config } from "./config.js";

const config = loadConfig(process.env);

/**
 * Resolve final provider config with thinking + temperature overrides.
 * Priority: Provider-level env → Global env → built-in default.
 */
function resolveProviderConfig(
  base: ProviderConfig,
  globalConfig: Config,
): ProviderConfig {
  const resolved = { ...base };

  // Thinking: provider-level overrides global
  if (resolved.thinkingLevel === undefined) {
    resolved.thinkingLevel = globalConfig.thinkingLevel;
  }
  // Global disable overrides everything
  if (!globalConfig.enableThinking) {
    resolved.thinkingLevel = "off";
  }

  // Temperature: provider-level overrides global
  if (resolved.temperature === undefined && globalConfig.temperature !== undefined) {
    resolved.temperature = globalConfig.temperature;
  }

  return resolved;
}

// Validate at least one provider API key is configured
const hasAnyKey =
  config.deepseek.apiKey || config.zhipu.apiKey || config.opencodeGo.apiKey;

if (!hasAnyKey) {
  console.error(
    "[cc-proxy] FATAL: At least one of DEEPSEEK_API_KEY, ZHIPU_API_KEY, or OPENCODE_API_KEY is required",
  );
  process.exit(1);
}

const providers = new Map();
const activeProviders: string[] = [];

// DeepSeek
if (config.deepseek.apiKey) {
  const resolved = resolveProviderConfig(config.deepseek, config);
  providers.set("deepseek", new DeepSeekProvider(resolved));
  activeProviders.push("deepseek");
}

// Zhipu
if (config.zhipu.apiKey) {
  const resolved = resolveProviderConfig(config.zhipu, config);
  providers.set("zhipu", new ZhipuProvider(resolved));
  activeProviders.push("zhipu");
}

// OpenCode Go
if (config.opencodeGo.apiKey) {
  const resolved = resolveProviderConfig(config.opencodeGo, config);
  providers.set("opencode_go", new OpenCodeGoProvider(resolved));
  activeProviders.push("opencode_go");
}

const server = createApp(config, providers);

server.listen(config.port, config.host, () => {
  console.log(`[cc-proxy] listening on http://${config.host}:${config.port}`);
  console.log(`[cc-proxy] providers: ${activeProviders.join(", ")}`);
  if (config.enableThinking) {
    console.log(
      `[cc-proxy] thinking: enabled, level=${config.thinkingLevel}`,
    );
  } else {
    console.log(`[cc-proxy] thinking: disabled`);
  }
  console.log(`[cc-proxy] log level: ${config.logLevel}`);
});

function shutdown() {
  console.log("\n[cc-proxy] shutting down...");
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
