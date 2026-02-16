# OpenClaw Module Architecture

本文档基于源码目录结构和 import 依赖关系，系统性梳理 OpenClaw 的模块边界。

## 1. 方法论

### 抽象依据
1. **源码目录结构** - `src/` 下的顶层目录代表主要模块
2. **Import 依赖分析** - 分析核心文件的 import 语句确定模块间调用关系
3. **功能内聚性** - 按职责边界分组，确保模块边界清晰

### 验证过程
```bash
# 1. 列出顶层目录结构
find src -type d -maxdepth 2 | sort

# 2. 分析关键文件的 import 依赖
head -50 src/auto-reply/reply/get-reply.ts | grep -E "^import"
head -80 src/agents/pi-embedded-runner/run/attempt.ts | grep -E "^import"
```

---

## 2. 模块架构图

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              OPENCLAW SYSTEM ARCHITECTURE                            │
│                              (Based on Source Code Analysis)                         │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                 CHANNEL ADAPTERS                                     │
│                                src/telegram/, src/discord/, etc.                     │
├──────────────┬──────────────┬──────────────┬──────────────┬──────────────┬──────────┤
│   Telegram   │   Discord    │   WhatsApp   │    Signal    │    Slack     │   Web    │
│  monitor.ts  │  monitor.ts  │  monitor.ts  │  monitor.ts  │  monitor.ts  │  web/    │
│    bot.ts    │  handlers.ts │   client.ts  │  handlers.ts │   http.ts    │ inbound/ │
│   send.ts    │   send.ts    │   send.ts    │   send.ts    │   send.ts    │          │
└──────┬───────┴──────┬───────┴──────┬───────┴──────┬───────┴──────┬───────┴────┬─────┘
       │              │              │              │              │            │
       └──────────────┴──────────────┴──────┬───────┴──────────────┴────────────┘
                                            │
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    ROUTING                                           │
│                                  src/routing/                                        │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  resolve-route.ts          │  session-key.ts           │  bindings.ts                │
│  ─────────────────         │  ───────────────          │  ───────────                │
│  • Route resolution        │  • Session key generation │  • Agent bindings           │
│  • Agent selection         │  • Key parsing/building   │  • Channel→Agent mapping    │
│  • Chat type detection     │  • DM scope handling      │                             │
└─────────────────────────────────────────┬───────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                  AUTO-REPLY                                          │
│                                src/auto-reply/                                       │
├────────────────────────────┬────────────────────────────┬───────────────────────────┤
│      reply/                │      Commands              │      Utilities            │
│      ──────                │      ────────              │      ─────────            │
│  get-reply.ts (entry)      │  commands-registry.ts      │  chunk.ts                 │
│  get-reply-run.ts          │  command-auth.ts           │  heartbeat.ts             │
│  get-reply-directives.ts   │  command-detection.ts      │  envelope.ts              │
│  agent-runner.ts           │                            │  status.ts                │
│  session.ts                │                            │  templating.ts            │
│  typing.ts                 │                            │                           │
└────────────────────────────┴──────────────┬─────────────┴───────────────────────────┘
                                            │
                              ┌─────────────┴─────────────┐
                              │                           │
                              ▼                           ▼
┌─────────────────────────────────────────┐ ┌─────────────────────────────────────────┐
│            SESSION STORE                 │ │              AGENT CORE                  │
│         src/config/sessions/             │ │              src/agents/                 │
├─────────────────────────────────────────┤ ├─────────────────────────────────────────┤
│  store.ts                               │ │  ┌─────────────────────────────────────┐│
│  ─────────                              │ │  │         pi-embedded-runner/         ││
│  • Session metadata (index)             │ │  │  run/attempt.ts - Core run logic    ││
│  • Session lifecycle (create/update)    │ │  │  abort.ts, cache-ttl.ts, history.ts ││
│  • UUID registry                        │ │  └─────────────────────────────────────┘│
│  • Pruning (inactive sessions)          │ │                                         │
├─────────────────────────────────────────┤ │  ┌─────────────────────────────────────┐│
│  transcript.ts                          │ │  │      pi-embedded-subscribe.ts       ││
│  ──────────────                         │ │  │  • Stream handling                  ││
│  • History read/write                   │ │  │  • Tool execution events            ││
│  • Message append                       │ │  │  • Block reply chunking             ││
│  • JSONL storage                        │ │  └─────────────────────────────────────┘│
├─────────────────────────────────────────┤ │                                         │
│  reset.ts                               │ │  ┌─────────────────────────────────────┐│
│  ────────                               │ │  │           compaction.ts             ││
│  • Session reset                        │ │  │  • Threshold detection (80k tokens) ││
│  • History clearing                     │ │  │  • Summary generation               ││
│                                         │ │  │  • History pruning                  ││
└─────────────────────────────────────────┘ │  └─────────────────────────────────────┘│
                                            │                                         │
                                            │  ┌─────────────────────────────────────┐│
                                            │  │          System Prompt              ││
                                            │  │  system-prompt.ts                   ││
                                            │  │  system-prompt-params.ts            ││
                                            │  │  bootstrap-files.ts                 ││
                                            │  │  bootstrap-hooks.ts                 ││
                                            │  └─────────────────────────────────────┘│
                                            │                                         │
                                            │  ┌─────────────────────────────────────┐│
                                            │  │              Tools                  ││
                                            │  │  pi-tools.ts - Tool creation        ││
                                            │  │  tools/ - Implementations           ││
                                            │  │  • browser.ts, cron.ts, exec.ts     ││
                                            │  │  • memory.ts, message.ts, etc.      ││
                                            │  └─────────────────────────────────────┘│
                                            │                                         │
                                            │  ┌─────────────────────────────────────┐│
                                            │  │             Skills                  ││
                                            │  │  skills/ - Skill management         ││
                                            │  │  skills-install.ts, skills-status.ts││
                                            │  └─────────────────────────────────────┘│
                                            │                                         │
                                            │  ┌─────────────────────────────────────┐│
                                            │  │         Model Management            ││
                                            │  │  model-selection.ts                 ││
                                            │  │  model-auth.ts, model-fallback.ts   ││
                                            │  └─────────────────────────────────────┘│
                                            └─────────────────────────────────────────┘
                                                              │
                                                              ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    GATEWAY                                           │
│                                  src/gateway/                                        │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  server.impl.ts            │  server-http.ts            │  server-chat.ts            │
│  ───────────────           │  ───────────────           │  ───────────────           │
│  • Gateway implementation  │  • HTTP endpoints          │  • WebSocket chat          │
│  • Service lifecycle       │  • REST API                │  • Streaming               │
├────────────────────────────┼────────────────────────────┼────────────────────────────┤
│  session-utils.ts          │  config-reload.ts          │  hooks.ts                  │
│  ─────────────────         │  ─────────────────         │  ─────────                 │
│  • Session utilities       │  • Hot reload              │  • Plugin hooks            │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                            │
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                  INFRASTRUCTURE                                      │
├──────────────────────┬──────────────────────┬──────────────────────┬────────────────┤
│    src/config/       │     src/infra/       │    src/logging/      │   src/cron/    │
│    ───────────       │     ──────────       │    ────────────      │   ──────────   │
│  config.ts           │  backoff.ts          │  subsystem.ts        │  service/      │
│  types.ts            │  errors.ts           │  format.ts           │  isolated-agent│
│  cache-utils.ts      │  net/                │                      │                │
└──────────────────────┴──────────────────────┴──────────────────────┴────────────────┘
                                            │
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL INTEGRATIONS                                   │
├────────────────┬────────────────┬────────────────┬────────────────┬─────────────────┤
│  src/providers │  src/browser/  │    src/tts/    │  src/memory/   │ src/media-      │
│  ────────────  │  ────────────  │    ─────────   │  ───────────   │ understanding/  │
│  LLM providers │  Browser ctrl  │  Text-to-Speech│  Memory search │ Media analysis  │
│  (via pi-ai)   │  (Playwright)  │  (ElevenLabs)  │  (Embeddings)  │ (Vision models) │
└────────────────┴────────────────┴────────────────┴────────────────┴─────────────────┘
```

---

## 3. 模块详细说明

### 3.1 Channel Adapters (src/telegram/, src/discord/, etc.)

**职责**: 平台特定的消息收发适配

| 文件 | 职责 |
|------|------|
| `monitor.ts` | 启动监控，连接平台 API |
| `bot.ts` / `handlers.ts` | 消息处理逻辑 |
| `send.ts` | 发送消息到平台 |
| `bot-message-context.ts` | 构建消息上下文 |

**核心依赖**:
```typescript
// telegram/monitor.ts
import { createTelegramBot } from "./bot.js";
import { isRecoverableTelegramNetworkError } from "./network-errors.js";
```

---

### 3.2 Routing (src/routing/)

**职责**: 路由解析和 Session Key 生成

| 文件 | 职责 |
|------|------|
| `resolve-route.ts` | 解析消息路由到哪个 Agent/Session |
| `session-key.ts` | 生成和解析 Session Key |
| `bindings.ts` | 管理 Channel→Agent 绑定 |

**Session Key 格式**:
```
agent:main:telegram:group:-100123456
  │    │       │      │        │
  │    │       │      │        └── Peer ID
  │    │       │      └── Peer Kind (direct/group/channel)
  │    │       └── Channel
  │    └── Agent ID
  └── Prefix
```

---

### 3.3 Auto-Reply (src/auto-reply/)

**职责**: 消息处理的核心协调层

| 文件 | 职责 |
|------|------|
| `reply/get-reply.ts` | **入口点** - 接收消息，协调处理 |
| `reply/get-reply-run.ts` | 准备并执行 Agent 回复 |
| `reply/agent-runner.ts` | 调用 Agent Core |
| `commands-registry.ts` | `/status`, `/reset` 等命令注册 |
| `heartbeat.ts` | 心跳检测逻辑 |

**核心依赖** (get-reply.ts):
```typescript
import { loadConfig } from "../../config/config.js";
import { applyLinkUnderstanding } from "../../link-understanding/apply.js";
import { applyMediaUnderstanding } from "../../media-understanding/apply.js";
import { runPreparedReply } from "./get-reply-run.js";
import { initSessionState } from "./session.js";
```

---

### 3.4 Session Store (src/config/sessions/)

**职责**: Session 元数据和对话历史持久化

| 文件 | 职责 |
|------|------|
| `store.ts` | Session 元数据存储（sessions.json） |
| `transcript.ts` | 对话历史管理（*.jsonl） |
| `reset.ts` | Session 重置逻辑 |
| `paths.ts` | 文件路径解析 |
| `types.ts` | SessionEntry 类型定义 |

**存储结构**:
```
~/.openclaw/agents/{agentId}/sessions/
├── sessions.json     # 元数据索引
└── {sessionId}.jsonl # 对话历史
```

---

### 3.5 Agent Core (src/agents/)

**职责**: LLM 交互的核心逻辑

#### 3.5.1 Runner (pi-embedded-runner/)

| 文件 | 职责 |
|------|------|
| `run/attempt.ts` | **核心运行逻辑** - 构建 prompt、调用 LLM、处理响应 |
| `abort.ts` | 中断处理 |
| `cache-ttl.ts` | Cache TTL 管理 |
| `history.ts` | 历史限制 |

#### 3.5.2 Subscribe (pi-embedded-subscribe.ts)

| 职责 |
|------|
| 流式响应处理 |
| Tool execution 事件 (`tool_execution_start/end`) |
| Block reply 分块 |

#### 3.5.3 Compaction (compaction.ts)

| 职责 |
|------|
| Token 阈值检测 (默认 80k) |
| 调用 LLM 生成摘要 |
| 历史修剪 |

#### 3.5.4 System Prompt

| 文件 | 职责 |
|------|------|
| `system-prompt.ts` | 构建完整 system prompt |
| `system-prompt-params.ts` | 参数类型定义 |
| `bootstrap-files.ts` | 注入 workspace 文件 |
| `bootstrap-hooks.ts` | Hook 系统 |

#### 3.5.5 Tools

| 文件 | 职责 |
|------|------|
| `pi-tools.ts` | 创建工具定义 |
| `tools/*.ts` | 具体工具实现 |

---

### 3.6 Gateway (src/gateway/)

**职责**: HTTP/WebSocket 服务器

| 文件 | 职责 |
|------|------|
| `server.impl.ts` | Gateway 服务器实现 |
| `server-http.ts` | HTTP 端点 |
| `server-chat.ts` | WebSocket 聊天 |
| `session-utils.ts` | Session 工具函数 |

---

## 4. 模块间调用关系

```
User Message
    │
    ▼
Channel Adapter (telegram/bot-message-dispatch.ts)
    │
    ├─► Routing (routing/resolve-route.ts)
    │       └─► Session Key Generation
    │
    ▼
Auto-Reply (auto-reply/reply/get-reply.ts)
    │
    ├─► Session Store (config/sessions/store.ts)
    │       ├─► Load/Create Session
    │       └─► Load Transcript
    │
    ├─► Agent Core (agents/pi-embedded-runner/run/attempt.ts)
    │       ├─► System Prompt Build
    │       ├─► Tool Registration
    │       ├─► LLM Invocation (via pi-ai)
    │       └─► Stream Subscribe
    │
    └─► Compaction Check (agents/compaction.ts)
            └─► If needed: Generate Summary
    │
    ▼
Reply via Channel Adapter
```

---

## 5. 源码验证

以下是关键 import 语句，验证模块边界：

### auto-reply/reply/get-reply.ts
```typescript
import { loadConfig } from "../../config/config.js";
import { applyLinkUnderstanding } from "../../link-understanding/apply.js";
import { applyMediaUnderstanding } from "../../media-understanding/apply.js";
import { runPreparedReply } from "./get-reply-run.js";
import { initSessionState } from "./session.js";
```

### agents/pi-embedded-runner/run/attempt.ts
```typescript
import { resolveBootstrapContextForRun } from "../../bootstrap-files.js";
import { subscribeEmbeddedPiSession } from "../../pi-embedded-subscribe.js";
import { createOpenClawCodingTools } from "../../pi-tools.js";
import { buildSystemPromptParams } from "../../system-prompt-params.js";
```

### config/sessions/store.ts
```typescript
import { acquireSessionWriteLock } from "../../agents/session-write-lock.js";
import { loadConfig } from "../config.js";
import { deriveSessionMetaPatch } from "./metadata.js";
```

---

## 6. 与之前文档的对比

| 之前的抽象 | 基于源码的真实模块 | 差异 |
|-----------|-------------------|------|
| "Router" | `src/routing/` | ✅ 对应 |
| "Session Manager" | `src/config/sessions/` | ✅ 位置不同 (在 config/ 下) |
| "Agent Runner" | `src/agents/pi-embedded-runner/` | ✅ 对应 |
| "Compaction Engine" | `src/agents/compaction.ts` | ✅ 是单文件，不是目录 |
| "Reply Handler" | `src/auto-reply/` | ✅ 对应，但职责更广 |
| "Token Tracker" | 无独立模块 | ❌ 分散在 store.ts 和 usage.ts |

---

## 7. 结论

基于源码分析，OpenClaw 的模块边界清晰：

1. **Channel Adapters** - 平台适配，各自独立
2. **Routing** - 小而精，职责单一
3. **Auto-Reply** - 核心协调层，是"胶水代码"
4. **Session Store** - 在 config/ 下，不是独立顶层模块
5. **Agent Core** - 最复杂的模块，包含多个子模块
6. **Gateway** - 服务器层，与业务逻辑解耦

这个架构遵循了**清晰的分层**和**关注点分离**原则。
