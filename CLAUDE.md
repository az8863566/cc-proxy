# cc-proxy — Claude Code 多模型代理

> 轻量级 Anthropic Messages API 代理，支持多后端（DeepSeek、Zhipu GLM、OpenCode Go），
> 向 Claude Code 暴露标准的 `/v1/messages` SSE 流接口。

## 架构总览

```
Claude Code ──→ /v1/messages ──→ resolveModel() ──→ Provider.streamResponse()
                      │                                       │
                      │                                {events, usage}
                      │                                       │
                      ▼                                       ▼
              SSE 流回写客户端                       insertEgress(usage)
```

### 项目结构

```
src/
├── index.ts                      # 入口：Config 加载 + Provider 注册 + Server 启动
├── config.ts                     # Zod schema + loadConfig（所有环境变量映射）
├── server.ts                     # HTTP Server：路由注册表 + CORS + Auth
├── model-router.ts               # 模型路由：tier 映射 + 显式 provider/ 前缀解析
├── sse.ts                        # Anthropic SSE 事件构建器
├── db.ts                         # SQLite egress_log + insertEgress + queryStats
├── routes/
│   ├── messages.ts               # POST /v1/messages 核心处理器
│   ├── health.ts                 # GET /health
│   └── models.ts                 # GET /v1/models
├── providers/
│   ├── base.ts                   # Provider 接口 + Usage / StreamHandle 类型
│   ├── deepseek.ts               # DeepSeek — 原生 Anthropic Messages API 透传
│   ├── openai-compatible.ts      # OpenAI Chat Completions 抽象基类
│   ├── zhipu.ts                  # Zhipu GLM — 原生 Anthropic Messages API 透传
│   └── opencode-go.ts            # OpenCode Go — extends OpenAICompatibleProvider
└── conversion/
    ├── anthropic-to-openai.ts    # ANTH → OAI 请求体转换
    └── openai-sse-to-anthropic.ts # OAI SSE → ANTH SSE 流转换（含 usage 捕获）
```

## Provider 类型

| Provider | 协议 | 行为 | Usage 来源 |
|----------|------|------|-----------|
| `deepseek`, `zhipu` | 原生 Anthropic Messages API | 透传：取完整 JSON，解 usage，构 SSE | JSON body `usage.input_tokens / output_tokens` |
| `opencode_go` | OpenAI Chat Completions | 转换：ANTH→OAI 请求，OAI SSE→ANTH SSE | 最后一条 SSE chunk 的 `usage.prompt_tokens / completion_tokens` |

## 核心接口

```typescript
interface Provider {
  streamResponse(request, signal?, overrides?): StreamHandle;
  listModels(): Promise<string[]>;
  checkHealth(): Promise<boolean>;
}

interface StreamHandle {
  events: AsyncIterable<string>;  // Anthropic SSE 事件流
  usage: Promise<Usage>;          // 流结束后 resolve 真实的 input/output tokens
}

interface Usage {
  input_tokens: number;
  output_tokens: number;
}
```

### 关键约束

- **Provider 不改 model**：路由层 patch `request.model = resolved.providerModel`，Provider 直接使用
- **全局参数已移除**：temperature/thinkingLevel 只来自 per-tier `MODEL_{TIER}_TEMPERATURE` / `MODEL_{TIER}_THINKING`，通过 `overrides` 传入 Provider
- **无兜底**：tier 映射未配置直接抛异常，不尝试验证或回退
- **Usage 由 Provider 提取**：每个 Provider 从各自上游响应中提取真实 usage，`messages.ts` 只管 `await usage` 后入库
- **SSE 协议解耦**：`messages.ts` 不解析任何 SSE 事件内容（无 sniffUsage），只透传写出

## 环境变量

路由配置异常时直接抛出错误，无兜底默认值。所有环境变量定义见 `.env.example`，此处仅记录关键配置规则：

### 路由配置格式

```
MODEL_{TIER}={provider}/{model}    # tier → 后端映射（provider: deepseek/zhipu/opencode_go）
MODEL_{TIER}_TEMPERATURE=0.1       # 可选，per-tier 温度
MODEL_{TIER}_THINKING=low          # 可选，per-tier 思考方式: off/low/high/max
```

### 凭证配置

每个 Provider 只需 `API_KEY` + `BASE_URL`，前缀与 provider 名称对应（如 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`）。具体端点和默认值见 `.env.example`。

## 模型路由规则

`model-router.ts` 执行顺序（无兜底，未配置则抛异常）：

1. **`provider/model` 格式** → 显式路由到指定 Provider，model 传原值
2. **`provider-` 前缀** → 显式路由（兼容旧格式）
3. **tier 匹配**（sonnet/opus/haiku） → 查 `MODEL_{TIER}` 配置映射到 Provider+model
4. **其他** → 抛出 `Unknown model` 错误

## Egress 日志

SQLite `data/egress.db` → 表 `egress_log`：

```
id | sent_at | gateway_model | provider | provider_model
  | input_tokens | output_tokens | status
```

- 流结束后通过 `StreamHandle.usage` Promise 获取真实用量
- 上游未返回 usage 时 fallback 到字符估算（仅 output）
- 查询：访问 `/stats` 页面查看统计 / `/api/stats` 获取 JSON 数据

## 开发命令

```bash
npm run dev        # tsx watch src/index.ts
npm start          # tsx --env-file=.env src/index.ts
npm run build      # tsc
npm run typecheck  # tsc --noEmit
npm test           # vitest run
```

## 部署

VBS 后台启动（静默无窗口）：
- `scripts/start-proxy.vbs` → `scripts/start-proxy.bat` → `node --env-file=.env dist/index.js`
- 双击 `.vbs` 或 `cscript //nologo scripts/start-proxy.vbs` 启动
- 后端：编译后的 `dist/` 目录

重启服务（始终使用此脚本）：
```bash
npm run build                  # 编译 TypeScript
scripts/restart-proxy.bat      # 重启服务
```

## 设计约束

- **最小改：** 不改不必要的东西，只修具体问题
- **Provider 不分担路由职责：** `providerId` 由路由层确定，Provider 只负责发请求和提取 usage
- **model 由路由控制：** Provider 不覆盖 `request.model`，错误模型名直接抛给下游
- **无 sniffUsage：** 路由层不解析 SSE 事件内容，usage 由 Provider 保证准确
