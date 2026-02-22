# Session Cache Management in OpenClaw

This document explains how OpenClaw manages session caching to maximize KV-cache hit rates when calling LLM providers (primarily Anthropic).

## Overview

LLM providers like Anthropic offer **prompt caching**: if the prefix of a request matches a previously cached prompt, the provider can reuse the computed KV-cache, reducing both latency and cost. OpenClaw employs several strategies to maximize cache hits:

1. **Static system prompt construction**
2. **Cache control markers** at API level
3. **Session pruning** to reduce cache-write size after TTL expiry
4. **Compaction** as a last resort for long sessions

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                    OpenClaw Layer                                │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │  System Prompt   │  │ Context Pruning  │  │  Compaction   │  │
│  │  (static build)  │  │ (cache-ttl mode) │  │  (summarize)  │  │
│  └────────┬─────────┘  └────────┬─────────┘  └───────┬───────┘  │
│           │                     │                     │          │
│           └─────────────────────┼─────────────────────┘          │
│                                 │                                │
│                    ┌────────────▼────────────┐                   │
│                    │     pi-ai Library       │                   │
│                    │  (cache_control marks)  │                   │
│                    └────────────┬────────────┘                   │
│                                 │                                │
└─────────────────────────────────┼────────────────────────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │    LLM Provider API       │
                    │  (Anthropic / OpenRouter) │
                    └───────────────────────────┘
```

## 1. Cache Control at API Level (pi-ai)

The `pi-ai` library handles `cache_control` markers for Anthropic API calls.

### Where cache_control is placed

From `pi-ai/providers/anthropic.js`:

```javascript
// System prompt blocks get cache_control
params.system = [
  {
    type: "text",
    text: sanitizeSurrogates(context.systemPrompt),
    ...(cacheControl ? { cache_control: cacheControl } : {}),
  },
];

// Last user message gets cache_control on its last content block
if (cacheControl && params.length > 0) {
  const lastMessage = params[params.length - 1];
  if (lastMessage.role === "user") {
    const lastBlock = lastMessage.content[lastMessage.content.length - 1];
    lastBlock.cache_control = cacheControl;
  }
}
```

### cacheRetention options

| Value | TTL | Use Case |
|-------|-----|----------|
| `none` | No caching | Testing/debugging |
| `short` | 5 minutes | Default, short conversations |
| `long` | 1 hour | Long sessions, heartbeat-driven |

**Configuration** (in `openclaw.json`):
```json
{
  "agents": {
    "defaults": {
      "models": {
        "anthropic/claude-sonnet-4-20250514": {
          "params": {
            "cacheRetention": "long"
          }
        }
      }
    }
  }
}
```

### Provider differences

| Provider | Cache Implementation |
|----------|---------------------|
| Anthropic (direct) | `cache_control: { type: "ephemeral", ttl: "1h" }` for `long` |
| OpenRouter + Anthropic | `cache_control: { type: "ephemeral" }` hardcoded (5m TTL) |
| OpenAI / Gemini / DeepSeek | Automatic caching, no explicit markers needed |

## 2. System Prompt Stability

The system prompt is built by `system-prompt.ts` and includes:

1. **Core instructions** (static)
2. **Tool definitions** (filtered by policy)
3. **Workspace path** (static for a session)
4. **Context files** (SOUL.md, USER.md, etc.)
5. **Runtime info** (agent id, channel, capabilities)

### Prefix stability factors

| Factor | Impact on Cache |
|--------|-----------------|
| Tool policy changes | Cache miss |
| Context file edits (SOUL.md) | Cache miss |
| Config changes | Cache miss (after restart) |
| New user messages | Cache hit (prefix unchanged) |
| Model switch | Cache miss (different model) |

### Why context files are injected at the end

Context files appear at the end of the system prompt so that:
1. The core instruction prefix remains stable
2. User edits to SOUL.md/USER.md only invalidate the tail

```
┌────────────────────────────────────────┐
│ Static core instructions               │ ← Cached
│ Static tool definitions                │ ← Cached
│ Static workspace info                  │ ← Cached
├────────────────────────────────────────┤
│ # Project Context                      │
│ ## SOUL.md                             │ ← Changes here
│ ## USER.md                             │   invalidate tail only
└────────────────────────────────────────┘
```

## 3. Session Pruning (cache-ttl mode)

Session pruning reduces the **cacheWrite** size after TTL expiry. It does NOT modify persisted session history.

### How it works

From `context-pruning/extension.ts`:

```typescript
api.on("context", (event, ctx) => {
  // Only prune if cache TTL has expired
  if (Date.now() - runtime.lastCacheTouchAt < ttlMs) {
    return undefined;  // Keep existing messages, use cached prefix
  }
  
  // Prune old tool results
  const next = pruneContextMessages({ messages, settings });
  
  // Reset TTL window
  runtime.lastCacheTouchAt = Date.now();
  
  return { messages: next };
});
```

### What gets pruned

| Message Type | Prunable? | Notes |
|--------------|-----------|-------|
| User messages | ❌ Never | Always preserved |
| Assistant messages | ❌ Never | Always preserved |
| Tool results | ✅ Yes | Unless protected or has images |

### Pruning modes

1. **Soft trim**: Keep head + tail, insert `...` in middle
   - Triggered at `softTrimRatio` (default 0.3 of context)
   - Keeps first 1500 + last 1500 chars

2. **Hard clear**: Replace with placeholder
   - Triggered at `hardClearRatio` (default 0.5 of context)
   - Placeholder: `"[Old tool result content cleared]"`

### Protected regions

```
┌─────────────────────────────────────┐
│ [identity reads: SOUL.md, USER.md]  │ ← Never pruned (before first user)
├─────────────────────────────────────┤
│ [old tool results]                  │ ← Prunable zone
├─────────────────────────────────────┤
│ [last N assistant messages]         │ ← Protected (keepLastAssistants)
│ [tool results after cutoff]         │ ← Protected
└─────────────────────────────────────┘
```

## 4. Cache TTL Tracking

OpenClaw tracks when cache was last "touched" to determine pruning timing.

From `cache-ttl.ts`:

```typescript
export const CACHE_TTL_CUSTOM_TYPE = "openclaw.cache-ttl";

export function appendCacheTtlTimestamp(sessionManager, data) {
  sm.appendCustomEntry(CACHE_TTL_CUSTOM_TYPE, {
    timestamp: Date.now(),
    provider,
    modelId
  });
}
```

This timestamp is stored in the session and persists across restarts.

## 5. Compaction (Last Resort)

When context exceeds model limits, compaction summarizes old messages.

### Impact on cache

| Action | Cache Impact |
|--------|--------------|
| Compaction runs | Cache miss (prefix changes) |
| Post-compaction messages | Cache builds fresh |

### Compaction strategy

1. Split messages into chunks by token share
2. Summarize each chunk
3. Merge partial summaries
4. Replace old messages with summary entry

```
Before compaction:
[system] [msg1] [msg2] ... [msg100] [new_msg]
         └─────────────────┘
              prefix

After compaction:
[system] [summary_entry] [recent_msgs] [new_msg]
         └─────────────────────────────┘
              new prefix (cache miss)
```

## 6. Optimal Configuration

### For long sessions with Anthropic

```json
{
  "agents": {
    "defaults": {
      "contextPruning": {
        "mode": "cache-ttl",
        "ttl": "5m"
      },
      "models": {
        "anthropic/claude-sonnet-4-20250514": {
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

### Why these values?

| Setting | Value | Rationale |
|---------|-------|-----------|
| `contextPruning.ttl` | 5m | Match Anthropic's short cache TTL |
| `cacheRetention` | long | 1h cache on direct Anthropic |
| `heartbeat.every` | 55m | Keep cache warm before 1h expiry |

## 7. Cost Impact

### Anthropic pricing (as of 2025)

| Token Type | Price (per 1M) |
|------------|----------------|
| Input | $15.00 |
| Cache Read | $1.50 (10x cheaper) |
| Cache Write | $18.75 (1.25x input) |

### Optimization effect

```
Without optimization:
  Every request: full input tokens → $15/M

With optimization:
  First request: cache write → $18.75/M (one-time)
  Subsequent: cache read → $1.50/M (90% savings)
```

## 8. Debugging Cache Behavior

### Check cache usage in logs

Look for `message_start` event in Anthropic responses:
```javascript
output.usage.cacheRead = event.message.usage.cache_read_input_tokens;
output.usage.cacheWrite = event.message.usage.cache_creation_input_tokens;
```

### /status command

Shows compaction count:
```
🧹 Compactions: 19
📚 Context: 181k/200k (90%)
```

### Session pruning logs

Enable verbose logging to see pruning decisions:
```
[context-pruning] Pruned 5 tool results, saved ~12k chars
```

## Summary

OpenClaw's cache management strategy:

1. **Keep prefix stable**: Static system prompt, context files at end
2. **Mark cache breakpoints**: `cache_control` on system + last user message
3. **Prune after TTL**: Reduce cacheWrite size when cache expires
4. **Track timestamps**: Know when to prune vs. rely on cache
5. **Compact as last resort**: Summarize when context overflows

The goal is to maximize **cache reads** (cheap) and minimize **cache writes** (expensive) by keeping the conversation prefix as stable as possible across requests.
