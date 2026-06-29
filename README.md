# cc-proxy — Claude Code 多模型代理

轻量级 TypeScript 代理，将 Claude Code 的 Anthropic Messages API 请求路由到 DeepSeek、Zhipu GLM、OpenCode Go 等后端，通过标准 SSE 流返回响应。

## 架构

```
Claude Code ──→ /v1/messages ──→ resolveModel() ──→ Provider.streamResponse()
                      │                                    │
                      │                          {events, usage}
                      │                                    │
                      ▼                                    ▼
              SSE 流回写客户端                    insertEgress(usage)
```

## 支持的 Provider

| Provider | 协议 | 说明 |
|----------|------|------|
| `deepseek` | 原生 Anthropic Messages API | 透传，从 JSON body 提取 usage |
| `zhipu` | 原生 Anthropic Messages API | 透传，从 JSON body 提取 usage |
| `opencode_go` | OpenAI Chat Completions | ANTH→OAI 请求转换，OAI SSE→ANTH SSE，从最后 chunk 提取 usage |

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 填入 API Key 和模型路由

# 3. 编译
npm run build

# 4. 启动
npm start
```

## 配置

核心配置通过环境变量完成，详见 `.env.example`。

### 模型路由

```
MODEL_SONNET=deepseek/deepseek-chat       # Sonnet 路由到 DeepSeek
MODEL_HAIKU=zhipu/glm-4-flash             # Haiku 路由到 Zhipu
MODEL_OPUS=deepseek/deepseek-reasoner     # Opus 路由到 DeepSeek Reasoner
```

路由格式：`{provider}/{model}`，provider 为 `deepseek`、`zhipu` 或 `opencode_go`。

### Per-tier 参数

```
MODEL_SONNET_TEMPERATURE=0.1
MODEL_SONNET_THINKING=low
```

### 凭证

```
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_BASE_URL=https://api.deepseek.com/anthropic

ZHIPU_API_KEY=xxx
ZHIPU_BASE_URL=https://open.bigmodel.cn/api/anthropic/v1

OPENCODE_API_KEY=sk-xxx
OPENCODE_BASE_URL=https://opencode.ai/zen/go/v1
```

## 模型路由规则

1. **`provider/model` 格式** → 显式路由到指定 Provider
2. **`provider-` 前缀** → 显式路由（兼容旧格式）
3. **tier 匹配**（sonnet/opus/haiku） → 查 `MODEL_{TIER}` 配置
4. **其他** → 抛出 `Unknown model` 错误

无兜底默认值，未配置则直接报错。

## Egress 日志

SQLite `data/egress.db`，记录每次请求的 token 用量：

```
id | sent_at | gateway_model | provider | provider_model | input_tokens | output_tokens | status
```

查询：
```bash
npm run stats              # 总量
npm run stats -- --by-model  # 按模型
```

## 开发

```bash
npm run dev        # tsx watch 热重载
npm run build      # tsc 编译
npm run typecheck  # 类型检查
npm test           # vitest
```

### 项目结构

```
src/
├── index.ts                   # 入口：Config + Provider 注册 + Server 启动
├── config.ts                  # Zod schema + 环境变量加载
├── server.ts                  # HTTP Server：路由注册 + CORS + Auth
├── model-router.ts            # 模型路由：tier 映射 + provider 前缀解析
├── sse.ts                     # Anthropic SSE 事件构建器
├── db.ts                      # SQLite egress_log
├── stats-cli.ts               # CLI 统计查询
├── routes/
│   ├── messages.ts            # POST /v1/messages
│   ├── health.ts              # GET /health
│   └── models.ts              # GET /v1/models
├── providers/
│   ├── base.ts                # Provider 接口定义
│   ├── deepseek.ts            # DeepSeek 原生透传
│   ├── zhipu.ts               # Zhipu 原生透传
│   ├── openai-compatible.ts   # OpenAI 兼容基类
│   └── opencode-go.ts         # OpenCode Go
└── conversion/
    ├── anthropic-to-openai.ts # ANTH → OAI 请求转换
    └── openai-sse-to-anthropic.ts # OAI SSE → ANTH SSE 转换
```

## 部署

Windows 后台静默启动：

```bash
npm run build
cscript //nologo scripts/start-proxy.vbs
```

停止：`netstat -ano | findstr ":8787"` 查 PID，`taskkill /F /PID <PID>`
