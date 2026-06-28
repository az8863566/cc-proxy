import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig } from "./config.js";
import { DeepSeekProvider } from "./providers/deepseek.js";
import { ZhipuProvider } from "./providers/zhipu.js";
import { OpenCodeGoProvider } from "./providers/opencode-go.js";
import { createApp } from "./server.js";
import type { ProviderConfig, Config } from "./config.js";
import type { Provider } from "./providers/base.js";

// Force .env values into process.env so project config always wins over system env
(function loadEnvOverrides() {
  try {
    const content = readFileSync(resolve(".env"), "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const rawValue = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes
      const value = (rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;
      process.env[trimmed.slice(0, eqIdx).trim()] = value;
    }
  } catch {
    // .env file not found, skip
  }
})();

const config = loadConfig(process.env);

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
    providers.set(id, factory(providerConfig));
    activeProviders.push(id);
  }
}

const server = createApp(config, providers);

server.listen(config.port, config.host, () => {
  console.log(`[cc-proxy] listening on http://${config.host}:${config.port}`);
  console.log(`[cc-proxy] providers: ${activeProviders.join(", ")}`);
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
