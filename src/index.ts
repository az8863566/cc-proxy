import { loadConfig } from "./config.js";
import { DeepSeekProvider } from "./providers/deepseek.js";
import { ZhipuProvider } from "./providers/zhipu.js";
import { OpenCodeGoProvider } from "./providers/opencode-go.js";
import { createApp } from "./server.js";
import type { ProviderConfig, Config } from "./config.js";
import type { Provider } from "./providers/base.js";

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

// Provider registry — add new providers here only
const providerFactories: Array<{
  id: string;
  configKey: "deepseek" | "zhipu" | "opencodeGo";
  factory: (cfg: ProviderConfig) => Provider;
}> = [
  {
    id: "deepseek",
    configKey: "deepseek",
    factory: (cfg) => new DeepSeekProvider(cfg),
  },
  {
    id: "zhipu",
    configKey: "zhipu",
    factory: (cfg) => new ZhipuProvider(cfg),
  },
  {
    id: "opencode_go",
    configKey: "opencodeGo",
    factory: (cfg) => new OpenCodeGoProvider(cfg),
  },
];

// Validate at least one provider API key is configured
const configuredKeys = providerFactories
  .map((f) => config[f.configKey].apiKey)
  .filter(Boolean);

if (configuredKeys.length === 0) {
  console.error(
    "[cc-proxy] FATAL: At least one provider API key is required (DEEPSEEK_API_KEY, ZHIPU_API_KEY, or OPENCODE_API_KEY)",
  );
  process.exit(1);
}

const providers = new Map<string, Provider>();
const activeProviders: string[] = [];

for (const { id, configKey, factory } of providerFactories) {
  const providerConfig = config[configKey];
  if (providerConfig.apiKey) {
    const resolved = resolveProviderConfig(providerConfig, config);
    providers.set(id, factory(resolved));
    activeProviders.push(id);
  }
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
