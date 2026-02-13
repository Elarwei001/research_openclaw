---
title: "Session Management"
description: "Session is the core concept of OpenClaw, managing conversation state, context, token usage, and cache optimization between users and agents."
---

# Session Management

Session is the core concept of OpenClaw, responsible for managing conversation state, context, token usage, and cache optimization between users and agents.

## Table of Contents

1. [Overview](#overview)
2. [Session Architecture](#session-architecture)
3. [Core Modules](#core-modules)
4. [Session Key System](#session-key-system)
5. [Message Flow and Collaboration](#message-flow-and-collaboration)
6. [Token Management](#token-management)
7. [Cache Management](#cache-management)
8. [Session Lifecycle](#session-lifecycle)

---

## Overview

A Session can be understood as a "conversation session" that contains:

```
┌─────────────────────────────────────────────────────────────┐
│                         Session                              │
├─────────────────────────────────────────────────────────────┤
│  • sessionId: UUID unique identifier                         │
│  • sessionKey: routing key (e.g., "agent:main:main")        │
│  • conversation history (transcript)                         │
│  • token usage statistics                                    │
│  • model/provider configuration                              │
│  • user preferences (thinking level, verbose mode...)       │
│  • delivery context (channel, to, accountId...)             │
└─────────────────────────────────────────────────────────────┘
```

## Session Architecture

### Overall Architecture Diagram

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
│                    │  Session Router │  ← Routes to session based    │
│                    └────────┬────────┘    on message source          │
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
│                    │  Session Store  │  ← Persisted in sessions.json │
│                    └─────────────────┘                               │
│                             │                                         │
│                             ▼                                         │
│                    ┌─────────────────┐                               │
│                    │   Transcript    │  ← .jsonl files for history   │
│                    │     Files       │                               │
│                    └─────────────────┘                               │
└──────────────────────────────────────────────────────────────────────┘
```

## Core Modules

### 1. Session Store (`src/config/sessions/store.ts`)

Responsible for persistent storage of session metadata.

```typescript
// Core data structure
type SessionEntry = {
  sessionId: string;          // UUID
  updatedAt: number;          // Last update timestamp
  sessionFile?: string;       // Transcript file path
  
  // Token statistics
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  totalTokensFresh?: boolean; // Whether token data is fresh
  contextTokens?: number;     // Model context window size
  
  // Model configuration
  modelProvider?: string;
  model?: string;
  providerOverride?: string;
  modelOverride?: string;
  
  // User preferences
  thinkingLevel?: string;     // off/low/medium/high
  verboseLevel?: string;
  sendPolicy?: "allow" | "deny";
  
  // Delivery context
  lastChannel?: string;
  lastTo?: string;
  lastAccountId?: string;
  deliveryContext?: DeliveryContext;
  
  // ...more fields
};
```

**Storage Location:**
```
~/.openclaw/
├── sessions/
│   └── sessions.json          # Session metadata
├── agents/
│   ├── main/
│   │   └── sessions/
│   │       ├── sessions.json  # Agent-specific sessions
│   │       └── *.jsonl        # Transcript files
│   └── {agent-id}/
│       └── sessions/
```

### 2. Session Types (`src/config/sessions/types.ts`)

Defines session types and utility functions.

```typescript
// Session scope
type SessionScope = "per-sender" | "global";

// Chat type
type SessionChatType = "direct" | "group" | "channel";

// Session origin information
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

Routes messages to the correct session.

### 4. Transcript Manager (`src/config/sessions/transcript.ts`)

Manages reading and writing of conversation history.

### 5. Session Reset (`src/config/sessions/reset.ts`)

Handles session reset logic (/new, /reset commands).

---

## Session Key System

Session Key is the routing identifier for sessions, using a hierarchical structure:

### Key Format

```
agent:{agentId}:{sessionType}:{identifier}
```

### Common Session Key Types

| Type | Format | Example |
|------|--------|---------|
| Main Session | `agent:{agentId}:main` | `agent:main:main` |
| Direct Chat | `agent:{agentId}:{channel}:{userId}` | `agent:main:telegram:123456` |
| Group Chat | `agent:{agentId}:{channel}:group:{groupId}` | `agent:main:discord:group:789` |
| Cron Job | `agent:{agentId}:cron:{jobId}` | `agent:main:cron:daily-check` |
| Cron Run | `agent:{agentId}:cron:{jobId}:run:{uuid}` | `agent:main:cron:daily-check:run:abc-123` |
| Subagent | `agent:{agentId}:subagent:{label}:{uuid}` | `agent:main:subagent:researcher:def-456` |

### Key Resolution Flow

```
User message arrives
     │
     ▼
┌─────────────────────────────────────┐
│  1. Extract message context          │
│     - channel (telegram/discord/..) │
│     - chatType (direct/group)       │
│     - senderId                      │
│     - groupId (if group)            │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  2. Determine Agent ID               │
│     - From channel binding config    │
│     - Or use default agent (main)    │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  3. Build Session Key                │
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
│  4. Load or create Session Entry     │
│     loadSessionStore(storePath)     │
│     store[sessionKey]               │
└─────────────────────────────────────┘
```

---

## Message Flow and Collaboration

### Single Request Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                        User sends message                             │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  1. Channel Handler receives message                                  │
│     - Parse message content, sender info                              │
│     - Determine if response needed (group activation, mentions...)   │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  2. Session Resolution                                                │
│     - Calculate sessionKey from message context                       │
│     - Load SessionEntry from sessions.json                           │
│     - Create new SessionEntry if not exists                          │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  3. Message Queue                                                     │
│     - Check queue mode (steer/followup/collect/queue)                │
│     - Debounce handling                                               │
│     - Queue capacity check                                            │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  4. Agent Turn Execution                                              │
│     a. Load transcript (conversation history)                         │
│     b. Build system prompt (workspace files, skills, tools...)       │
│     c. Token budget check → may trigger Compaction                   │
│     d. Call LLM Provider                                             │
│     e. Process tool calls (if any)                                   │
│     f. Generate response                                              │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  5. Response Delivery                                                 │
│     - Determine delivery target from SessionEntry.deliveryContext    │
│     - Send response through corresponding channel                    │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  6. Session Update                                                    │
│     - Update transcript file (append messages)                       │
│     - Update SessionEntry (tokens, updatedAt, ...)                   │
│     - Persist to sessions.json                                       │
└──────────────────────────────────────────────────────────────────────┘
```

### Multi-Session Collaboration Scenarios

#### Scenario 1: Subagent Invocation

```
┌─────────────┐         ┌─────────────┐
│   Main      │         │  Subagent   │
│  Session    │         │  Session    │
└──────┬──────┘         └──────┬──────┘
       │                       │
       │  sessions_spawn()     │
       │──────────────────────▶│
       │                       │
       │                       │ Execute task
       │                       │
       │  Result via announce  │
       │◀──────────────────────│
       │                       │
```

#### Scenario 2: Cron Isolated Session

```
┌─────────────┐         ┌─────────────┐
│   Main      │         │   Cron      │
│  Session    │         │  Isolated   │
└──────┬──────┘         └──────┬──────┘
       │                       │
       │                       │ Cron triggers
       │                       │──────────▶ Execute agentTurn independently
       │                       │
       │  announce (optional)  │
       │◀──────────────────────│ Send summary to main
       │                       │
```

#### Scenario 3: Cross-Agent Sessions

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

## Token Management

### Token Statistics Fields

```typescript
interface SessionEntry {
  inputTokens?: number;      // Cumulative input tokens
  outputTokens?: number;     // Cumulative output tokens
  totalTokens?: number;      // Current context tokens (estimated)
  totalTokensFresh?: boolean;// Whether it's up-to-date
  contextTokens?: number;    // Model context window size
}
```

### Token Calculation Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                     Agent Turn starts                                 │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  1. Load history messages                                             │
│     messages = readSessionMessages(sessionId, storePath)              │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  2. Estimate current token usage                                      │
│     estimatedTokens = estimateMessagesTokens(messages)                │
│     + systemPromptTokens                                              │
│     + newMessageTokens                                                │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  3. Check if exceeds context window                                   │
│     if (estimatedTokens > contextTokens * threshold)                  │
│       → Trigger Compaction                                           │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  4. Update statistics after LLM call                                  │
│     usage = response.usage                                            │
│     sessionEntry.inputTokens += usage.input                          │
│     sessionEntry.outputTokens += usage.output                        │
│     sessionEntry.totalTokens = deriveSessionTotalTokens(usage)       │
│     sessionEntry.totalTokensFresh = true                             │
└──────────────────────────────────────────────────────────────────────┘
```

### Compaction (Context Compression)

Automatically triggered when conversation history becomes too long:

```typescript
// src/agents/compaction.ts

async function compactSession(params: {
  messages: AgentMessage[];
  contextTokens: number;
  reserveTokens: number;
}) {
  // 1. Calculate range of messages to compress
  const targetTokens = contextTokens - reserveTokens;
  
  // 2. Split messages into chunks
  const chunks = splitMessagesByTokenShare(messages, 2);
  
  // 3. Generate summary for each chunk
  const summaries = await Promise.all(
    chunks.map(chunk => generateSummary(chunk))
  );
  
  // 4. Merge summaries
  const mergedSummary = await mergeSummaries(summaries);
  
  // 5. Return compressed messages (summary + recent messages)
  return [summaryMessage, ...recentMessages];
}
```

**Compaction Strategies:**

| Strategy | Description | Configuration |
|----------|-------------|---------------|
| Auto | Automatically triggers when context approaches limit | Default |
| Manual | Manually trigger via /compact command | - |
| Disabled | Disable compression, error on overflow | `compaction.enabled: false` |

---

## Cache Management

OpenClaw supports multi-layer cache strategies to optimize token usage and response latency.

### 1. Provider-Level Prompt Caching

Leverages native prompt caching capabilities of LLM providers:

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Prompt Structure                               │
├──────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────┐                         │
│  │  Static Prefix (cacheable)              │                         │
│  │  - System Prompt                        │  ← cache_control        │
│  │  - Workspace Files                      │     breakpoint          │
│  │  - Skills                               │                         │
│  └─────────────────────────────────────────┘                         │
│  ┌─────────────────────────────────────────┐                         │
│  │  Dynamic Suffix (changes each time)     │                         │
│  │  - Conversation history                 │                         │
│  │  - Current user message                 │                         │
│  └─────────────────────────────────────────┘                         │
└──────────────────────────────────────────────────────────────────────┘
```

**Provider Cache Methods:**

| Provider | Cache Method | Configuration |
|----------|-------------|---------------|
| Anthropic Direct | `cacheRetention` parameter | `cacheRetention: "short"/"long"` |
| OpenRouter + Anthropic | `cache_control` blocks | Automatic |
| OpenAI | Automatic (no config needed) | - |
| DeepSeek | Automatic (no config needed) | - |
| Gemini 2.5+ | Automatic (no config needed) | - |

### 2. Session Store Cache

In-memory cache for session metadata:

```typescript
// src/config/sessions/store.ts

const SESSION_STORE_CACHE = new Map<string, SessionStoreCacheEntry>();
const DEFAULT_SESSION_STORE_TTL_MS = 45_000; // 45 seconds

type SessionStoreCacheEntry = {
  store: Record<string, SessionEntry>;
  loadedAt: number;
  storePath: string;
  mtimeMs?: number;  // File modification time for invalidation
};

function loadSessionStore(storePath: string): Record<string, SessionEntry> {
  // 1. Check cache
  const cached = SESSION_STORE_CACHE.get(storePath);
  if (cached && isSessionStoreCacheValid(cached)) {
    return cached.store;
  }
  
  // 2. Load from file
  const store = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
  
  // 3. Update cache
  SESSION_STORE_CACHE.set(storePath, {
    store,
    loadedAt: Date.now(),
    storePath,
    mtimeMs: getFileMtimeMs(storePath)
  });
  
  return store;
}
```

### 3. Cache TTL Tracking

Track cache state to optimize heartbeat and context pruning:

```typescript
// src/agents/pi-embedded-runner/cache-ttl.ts

// Record last cache timestamp
function appendCacheTtlTimestamp(sessionManager, {
  timestamp: Date.now(),
  provider,
  modelId
});

// Check if cache is still valid
function isCacheStillValid(lastTimestamp: number, ttlMs: number): boolean {
  return Date.now() - lastTimestamp < ttlMs;
}
```

### Cache Optimization Configuration Example

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

## Session Lifecycle

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Session Lifecycle                             │
└─────────────────────────────────────────────────────────────────────┘

   Create                    Active                    Reset/Delete
    │                         │                            │
    ▼                         ▼                            ▼
┌────────┐              ┌──────────┐                ┌──────────┐
│  New   │─────────────▶│   In     │───────────────▶│  Reset   │
│ message│              │ Convo    │   /new         │ /delete  │
│ arrives│              │          │                │          │
└────────┘              └────┬─────┘                └──────────┘
                             │
                             │ Idle timeout
                             │ (idle reset)
                             ▼
                       ┌──────────┐
                       │  Auto    │
                       │  Reset   │
                       └──────────┘
```

### Reset Triggers

| Trigger | Condition | Behavior |
|---------|-----------|----------|
| User command | `/new`, `/reset` | Immediate reset |
| Idle timeout | Exceeds `idleMinutes` without activity | Reset on next message |
| Manual delete | `sessions.delete` | Delete entry + archive transcript |
| Cron cleanup | `sessionRetention` expired | Clean up isolated cron sessions |

### Reset Behavior

```typescript
// Fields preserved on reset
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

// Fields cleared on reset
const CLEARED_FIELDS = [
  'sessionId',        // Generate new one
  'sessionFile',      // Point to new transcript
  'totalTokens',
  'inputTokens', 
  'outputTokens',
  'compactionCount',
  'skillsSnapshot'
];
```

---

## Related Files

| Module | File Path | Description |
|--------|-----------|-------------|
| Session Types | `src/config/sessions/types.ts` | Type definitions |
| Session Store | `src/config/sessions/store.ts` | Storage management |
| Session Key | `src/routing/session-key.ts` | Key parsing and building |
| Transcript | `src/config/sessions/transcript.ts` | Conversation history management |
| Reset Logic | `src/config/sessions/reset.ts` | Reset logic |
| Compaction | `src/agents/compaction.ts` | Context compression |
| Context Pruning | `src/agents/pi-extensions/context-pruning.ts` | Context pruning |
| Cache TTL | `src/agents/pi-embedded-runner/cache-ttl.ts` | Cache tracking |
| Gateway Session Utils | `src/gateway/session-utils.ts` | Gateway layer utilities |

---

## References

- [OpenClaw Docs: Session Management](https://docs.openclaw.ai/concepts/session)
- [OpenClaw Docs: Compaction](https://docs.openclaw.ai/concepts/compaction)
- [OpenClaw Docs: Token Use](https://docs.openclaw.ai/token-use)
