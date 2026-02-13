---
title: "Session 会话管理"
description: "Session 是 OpenClaw 的核心概念，负责管理用户与 Agent 之间的对话状态、上下文、token 使用和 cache 优化。"
---

# Session Management

Session 是 OpenClaw 的核心概念，负责管理用户与 Agent 之间的对话状态、上下文、token 使用和 cache 优化。

## 目录

1. [概述](#概述)
2. [Session 架构](#session-架构)
3. [核心模块](#核心模块)
4. [Session Key 体系](#session-key-体系)
5. [消息流转与协作](#消息流转与协作)
6. [Token 管理](#token-管理)
7. [Cache 管理](#cache-管理)
8. [Session 生命周期](#session-生命周期)

---

## 概述

Session 可以理解为一次"对话会话"，它包含：

```
┌─────────────────────────────────────────────────────────────┐
│                         Session                              │
├─────────────────────────────────────────────────────────────┤
│  • sessionId: UUID 唯一标识                                  │
│  • sessionKey: 路由键 (e.g., "agent:main:main")             │
│  • 对话历史 (transcript)                                     │
│  • Token 使用统计                                            │
│  • Model/Provider 配置                                       │
│  • 用户偏好 (thinking level, verbose mode...)               │
│  • 投递上下文 (channel, to, accountId...)                   │
└─────────────────────────────────────────────────────────────┘
```

## Session 架构

### 整体架构图

```
┌──────────────────────────────────────────────────────────────────────┐
│                           Gateway Server                              │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐             │
│   │  Telegram   │    │   Discord   │    │   Webchat   │   ...       │
│   │   Channel   │    │   Channel   │    │   Channel   │             │
│   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘             │
│          │                  │                  │                      │
│          └──────────────────┼──────────────────┘                      │
│                             ▼                                         │
│                    ┌─────────────────┐                               │
│                    │  Session Router │  ← 根据消息来源路由到对应 Session│
│                    └────────┬────────┘                               │
│                             │                                         │
│          ┌──────────────────┼──────────────────┐                      │
│          ▼                  ▼                  ▼                      │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐             │
│   │   Session   │    │   Session   │    │   Session   │             │
│   │    Main     │    │  Telegram   │    │   Cron:X    │             │
│   │  (default)  │    │   Group:Y   │    │ (isolated)  │             │
│   └──────┬──────┘    └──────┬──────┘    └──────┬──────┘             │
│          │                  │                  │                      │
│          └──────────────────┼──────────────────┘                      │
│                             ▼                                         │
│                    ┌─────────────────┐                               │
│                    │  Session Store  │  ← sessions.json 持久化        │
│                    └─────────────────┘                               │
│                             │                                         │
│                             ▼                                         │
│                    ┌─────────────────┐                               │
│                    │   Transcript    │  ← .jsonl 文件存储对话历史     │
│                    │     Files       │                               │
│                    └─────────────────┘                               │
└──────────────────────────────────────────────────────────────────────┘
```

## 核心模块

### 1. Session Store (`src/config/sessions/store.ts`)

负责 Session 元数据的持久化存储。

```typescript
// 核心数据结构
type SessionEntry = {
  sessionId: string;          // UUID
  updatedAt: number;          // 最后更新时间戳
  sessionFile?: string;       // transcript 文件路径
  
  // Token 统计
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  totalTokensFresh?: boolean; // token 数据是否是最新的
  contextTokens?: number;     // 模型上下文窗口大小
  
  // Model 配置
  modelProvider?: string;
  model?: string;
  providerOverride?: string;
  modelOverride?: string;
  
  // 用户偏好
  thinkingLevel?: string;     // off/low/medium/high
  verboseLevel?: string;
  sendPolicy?: "allow" | "deny";
  
  // 投递上下文
  lastChannel?: string;
  lastTo?: string;
  lastAccountId?: string;
  deliveryContext?: DeliveryContext;
  
  // ...更多字段
};
```

**存储位置：**
```
~/.openclaw/
├── sessions/
│   └── sessions.json          # Session 元数据
├── agents/
│   ├── main/
│   │   └── sessions/
│   │       ├── sessions.json  # Agent-specific sessions
│   │       └── *.jsonl        # Transcript 文件
│   └── {agent-id}/
│       └── sessions/
```

### 2. Session Types (`src/config/sessions/types.ts`)

定义 Session 的类型和工具函数。

```typescript
// Session 作用域
type SessionScope = "per-sender" | "global";

// 聊天类型
type SessionChatType = "direct" | "group" | "channel";

// Session 来源信息
type SessionOrigin = {
  label?: string;
  provider?: string;      // telegram, discord, etc.
  surface?: string;       // chat, voice, etc.
  chatType?: SessionChatType;
  from?: string;
  to?: string;
  accountId?: string;
};
```

### 3. Session Router (`src/routing/session-key.ts`)

负责将消息路由到正确的 Session。

### 4. Transcript Manager (`src/config/sessions/transcript.ts`)

管理对话历史的读写。

### 5. Session Reset (`src/config/sessions/reset.ts`)

处理 Session 重置逻辑（/new, /reset 命令）。

---

## Session Key 体系

Session Key 是 Session 的路由标识符，采用层级结构：

### Key 格式

```
agent:{agentId}:{sessionType}:{identifier}
```

### 常见 Session Key 类型

| 类型 | 格式 | 示例 |
|------|------|------|
| Main Session | `agent:{agentId}:main` | `agent:main:main` |
| Direct Chat | `agent:{agentId}:{channel}:{userId}` | `agent:main:telegram:123456` |
| Group Chat | `agent:{agentId}:{channel}:group:{groupId}` | `agent:main:discord:group:789` |
| Cron Job | `agent:{agentId}:cron:{jobId}` | `agent:main:cron:daily-check` |
| Cron Run | `agent:{agentId}:cron:{jobId}:run:{uuid}` | `agent:main:cron:daily-check:run:abc-123` |
| Subagent | `agent:{agentId}:subagent:{label}:{uuid}` | `agent:main:subagent:researcher:def-456` |

### Key 解析流程

```
用户消息到达
     │
     ▼
┌─────────────────────────────────────┐
│  1. 提取消息上下文                   │
│     - channel (telegram/discord/..) │
│     - chatType (direct/group)       │
│     - senderId                      │
│     - groupId (if group)            │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  2. 确定 Agent ID                    │
│     - 从 channel binding 配置        │
│     - 或使用默认 agent (main)        │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  3. 构建 Session Key                 │
│     buildAgentPeerSessionKey({      │
│       agentId,                      │
│       channel,                      │
│       peerId,                       │
│       peerKind                      │
│     })                              │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  4. 加载或创建 Session Entry         │
│     loadSessionStore(storePath)     │
│     store[sessionKey]               │
└─────────────────────────────────────┘
```

---

## 消息流转与协作

### 单次请求流程

```
┌──────────────────────────────────────────────────────────────────────┐
│                        用户发送消息                                   │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  1. Channel Handler 接收消息                                          │
│     - 解析消息内容、发送者信息                                         │
│     - 判断是否需要响应 (group activation, mentions...)               │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  2. Session Resolution                                                │
│     - 根据消息上下文计算 sessionKey                                   │
│     - 从 sessions.json 加载 SessionEntry                             │
│     - 如果不存在，创建新的 SessionEntry                               │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  3. 消息入队 (Message Queue)                                          │
│     - 检查队列模式 (steer/followup/collect/queue)                    │
│     - 防抖处理 (debounce)                                            │
│     - 队列容量检查                                                    │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  4. Agent Turn 执行                                                   │
│     a. 加载 Transcript (对话历史)                                     │
│     b. 构建 System Prompt (workspace files, skills, tools...)        │
│     c. Token 预算检查 → 可能触发 Compaction                          │
│     d. 调用 LLM Provider                                             │
│     e. 处理工具调用 (如有)                                            │
│     f. 生成响应                                                       │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  5. 响应投递                                                          │
│     - 根据 SessionEntry.deliveryContext 确定投递目标                 │
│     - 通过对应 Channel 发送响应                                       │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  6. Session 更新                                                      │
│     - 更新 transcript 文件 (追加消息)                                 │
│     - 更新 SessionEntry (tokens, updatedAt, ...)                     │
│     - 持久化到 sessions.json                                          │
└──────────────────────────────────────────────────────────────────────┘
```

### 多 Session 协作场景

#### 场景 1: Subagent 调用

```
┌─────────────┐         ┌─────────────┐
│   Main      │         │  Subagent   │
│  Session    │         │  Session    │
└──────┬──────┘         └──────┬──────┘
       │                       │
       │  sessions_spawn()     │
       │──────────────────────▶│
       │                       │
       │                       │ 执行任务
       │                       │
       │  结果通过 announce    │
       │◀──────────────────────│
       │                       │
```

#### 场景 2: Cron Isolated Session

```
┌─────────────┐         ┌─────────────┐
│   Main      │         │   Cron      │
│  Session    │         │  Isolated   │
└──────┬──────┘         └──────┬──────┘
       │                       │
       │                       │ Cron 触发
       │                       │──────────▶ 独立执行 agentTurn
       │                       │
       │  announce (可选)      │
       │◀──────────────────────│ 发送摘要到 main
       │                       │
```

#### 场景 3: 跨 Agent 会话

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   Agent A   │         │   Agent B   │         │   Agent C   │
│  (main)     │         │  (research) │         │  (code)     │
└──────┬──────┘         └──────┬──────┘         └──────┬──────┘
       │                       │                       │
       │  sessions_send()      │                       │
       │──────────────────────▶│                       │
       │                       │                       │
       │                       │  sessions_send()      │
       │                       │──────────────────────▶│
       │                       │                       │
       │                       │◀──────────────────────│
       │◀──────────────────────│                       │
```

---

## Token 管理

### Token 统计字段

```typescript
interface SessionEntry {
  inputTokens?: number;      // 累计输入 tokens
  outputTokens?: number;     // 累计输出 tokens
  totalTokens?: number;      // 当前上下文 tokens (估算)
  totalTokensFresh?: boolean;// 是否是最新的
  contextTokens?: number;    // 模型上下文窗口大小
}
```

### Token 计算流程

```
┌──────────────────────────────────────────────────────────────────────┐
│                     Agent Turn 开始                                   │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  1. 加载历史消息                                                       │
│     messages = readSessionMessages(sessionId, storePath)              │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  2. 估算当前 token 使用                                               │
│     estimatedTokens = estimateMessagesTokens(messages)                │
│     + systemPromptTokens                                              │
│     + newMessageTokens                                                │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  3. 检查是否超出上下文窗口                                            │
│     if (estimatedTokens > contextTokens * threshold)                  │
│       → 触发 Compaction                                              │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  4. LLM 调用后更新统计                                                │
│     usage = response.usage                                            │
│     sessionEntry.inputTokens += usage.input                          │
│     sessionEntry.outputTokens += usage.output                        │
│     sessionEntry.totalTokens = deriveSessionTotalTokens(usage)       │
│     sessionEntry.totalTokensFresh = true                             │
└──────────────────────────────────────────────────────────────────────┘
```

### Compaction (上下文压缩)

当对话历史过长时，自动触发压缩：

```typescript
// src/agents/compaction.ts

async function compactSession(params: {
  messages: AgentMessage[];
  contextTokens: number;
  reserveTokens: number;
}) {
  // 1. 计算需要压缩的消息范围
  const targetTokens = contextTokens - reserveTokens;
  
  // 2. 将消息分块
  const chunks = splitMessagesByTokenShare(messages, 2);
  
  // 3. 生成每块的摘要
  const summaries = await Promise.all(
    chunks.map(chunk => generateSummary(chunk))
  );
  
  // 4. 合并摘要
  const mergedSummary = await mergeSummaries(summaries);
  
  // 5. 返回压缩后的消息 (摘要 + 最近消息)
  return [summaryMessage, ...recentMessages];
}
```

**Compaction 策略：**

| 策略 | 说明 | 配置 |
|------|------|------|
| Auto | 自动在上下文接近限制时触发 | 默认 |
| Manual | 通过 /compact 命令手动触发 | - |
| Disabled | 禁用压缩，超限时报错 | `compaction.enabled: false` |

---

## Cache 管理

OpenClaw 支持多层 cache 策略，优化 token 使用和响应延迟。

### 1. Provider-Level Prompt Caching

利用 LLM Provider 的原生 prompt caching 能力：

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Prompt 结构                                    │
├──────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────┐                         │
│  │  Static Prefix (可 cache)               │                         │
│  │  - System Prompt                        │  ← cache_control        │
│  │  - Workspace Files                      │     breakpoint          │
│  │  - Skills                               │                         │
│  └─────────────────────────────────────────┘                         │
│  ┌─────────────────────────────────────────┐                         │
│  │  Dynamic Suffix (每次不同)              │                         │
│  │  - 对话历史                             │                         │
│  │  - 当前用户消息                         │                         │
│  └─────────────────────────────────────────┘                         │
└──────────────────────────────────────────────────────────────────────┘
```

**各 Provider Cache 方式：**

| Provider | Cache 方式 | 配置 |
|----------|-----------|------|
| Anthropic 直连 | `cacheRetention` 参数 | `cacheRetention: "short"/"long"` |
| OpenRouter + Anthropic | `cache_control` 块 | 自动添加 |
| OpenAI | 自动 (无需配置) | - |
| DeepSeek | 自动 (无需配置) | - |
| Gemini 2.5+ | 自动 (无需配置) | - |

### 2. Session Store Cache

Session 元数据的内存缓存：

```typescript
// src/config/sessions/store.ts

const SESSION_STORE_CACHE = new Map<string, SessionStoreCacheEntry>();
const DEFAULT_SESSION_STORE_TTL_MS = 45_000; // 45 秒

type SessionStoreCacheEntry = {
  store: Record<string, SessionEntry>;
  loadedAt: number;
  storePath: string;
  mtimeMs?: number;  // 文件修改时间，用于失效检测
};

function loadSessionStore(storePath: string): Record<string, SessionEntry> {
  // 1. 检查缓存
  const cached = SESSION_STORE_CACHE.get(storePath);
  if (cached && isSessionStoreCacheValid(cached)) {
    return cached.store;
  }
  
  // 2. 从文件加载
  const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
  
  // 3. 更新缓存
  SESSION_STORE_CACHE.set(storePath, {
    store,
    loadedAt: Date.now(),
    storePath,
    mtimeMs: getFileMtimeMs(storePath)
  });
  
  return store;
}
```

### 3. Cache TTL 跟踪

跟踪 cache 状态以优化 heartbeat 和 context pruning：

```typescript
// src/agents/pi-embedded-runner/cache-ttl.ts

// 记录最后一次 cache 时间戳
function appendCacheTtlTimestamp(sessionManager, {
  timestamp: Date.now(),
  provider,
  modelId
});

// 检查 cache 是否仍然有效
function isCacheStillValid(lastTimestamp: number, ttlMs: number): boolean {
  return Date.now() - lastTimestamp < ttlMs;
}
```

### Cache 优化配置示例

```json
{
  "agents": {
    "defaults": {
      "contextPruning": {
        "mode": "cache-ttl",
        "ttl": "5m"
      },
      "models": {
        "anthropic/claude-sonnet-4-5": {
          "params": {
            "cacheRetention": "long"
          }
        }
      }
    }
  },
  "heartbeat": {
    "every": "55m"
  }
}
```

---

## Session 生命周期

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Session 生命周期                              │
└─────────────────────────────────────────────────────────────────────┘

   创建                    活跃                     重置/删除
    │                       │                          │
    ▼                       ▼                          ▼
┌────────┐            ┌──────────┐              ┌──────────┐
│ 新消息 │───────────▶│  对话中  │─────────────▶│  重置    │
│ 到达   │            │          │   /new       │  /delete │
└────────┘            └────┬─────┘              └──────────┘
                           │
                           │ 空闲超时
                           │ (idle reset)
                           ▼
                     ┌──────────┐
                     │ 自动重置 │
                     └──────────┘
```

### 重置触发条件

| 触发器 | 条件 | 行为 |
|--------|------|------|
| 用户命令 | `/new`, `/reset` | 立即重置 |
| 空闲超时 | 超过 `idleMinutes` 无活动 | 下次消息时重置 |
| 手动删除 | `sessions.delete` | 删除 entry + 归档 transcript |
| Cron 清理 | `sessionRetention` 过期 | 清理 isolated cron sessions |

### 重置行为

```typescript
// 重置时保留的字段
const PRESERVED_FIELDS = [
  'thinkingLevel',
  'verboseLevel', 
  'sendPolicy',
  'modelOverride',
  'providerOverride',
  'label',
  'displayName',
  'deliveryContext',
  'lastChannel',
  'lastTo',
  'lastAccountId'
];

// 重置时清除的字段
const CLEARED_FIELDS = [
  'sessionId',        // 生成新的
  'sessionFile',      // 指向新 transcript
  'totalTokens',
  'inputTokens', 
  'outputTokens',
  'compactionCount',
  'skillsSnapshot'
];
```

---

## 相关文件

| 模块 | 文件路径 | 说明 |
|------|----------|------|
| Session Types | `src/config/sessions/types.ts` | 类型定义 |
| Session Store | `src/config/sessions/store.ts` | 存储管理 |
| Session Key | `src/routing/session-key.ts` | Key 解析与构建 |
| Transcript | `src/config/sessions/transcript.ts` | 对话历史管理 |
| Reset Logic | `src/config/sessions/reset.ts` | 重置逻辑 |
| Compaction | `src/agents/compaction.ts` | 上下文压缩 |
| Context Pruning | `src/agents/pi-extensions/context-pruning.ts` | 上下文修剪 |
| Cache TTL | `src/agents/pi-embedded-runner/cache-ttl.ts` | Cache 跟踪 |
| Gateway Session Utils | `src/gateway/session-utils.ts` | Gateway 层工具 |

---

## 参考资料

- [OpenClaw Docs: Session Management](https://docs.openclaw.ai/concepts/session)
- [OpenClaw Docs: Compaction](https://docs.openclaw.ai/concepts/compaction)
- [OpenClaw Docs: Token Use](https://docs.openclaw.ai/token-use)
