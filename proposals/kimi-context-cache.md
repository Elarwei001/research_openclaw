# Kimi Context Cache Implementation Proposal

## Issue Background

- **Issue**: [#7073 - Support Kimi K2.5 Cache](https://github.com/openclaw/openclaw/issues/7073)
- **Problem**: High token consumption in long-context scenarios
- **Solution**: Leverage Kimi's Caching API

---

## ✅ Terminology Clarification: `context_id` = `cache_id`

**Issue states**: "Kimi API supports Context caching via `context_id`"

**Official Moonshot API uses**: `cache_id` via `/v1/caching` API

**Confirmed**: After researching [Tencent Cloud article](https://cloud.tencent.com/developer/article/2434148) and [MoonshotAI Cookbook](https://github.com/MoonshotAI/MoonshotAI-Cookbook/tree/master/examples/context_caching), the `context_id` mentioned in Issue #7073 is the same as `cache_id`. The terminology difference comes from:

| Term | Where it appears | Actual meaning |
|------|------------------|----------------|
| `context_id` | Issue #7073, maintainer comments | Informal name for the caching feature |
| `id` | API response field | The cache identifier (e.g., `cache-essqmysd6h1111dauub1`) |
| `cache_id` | Used in `role: "cache"` message | Reference to the cache when querying |
| `context_cache_object` | API response `object` field | The object type name |

**Conclusion**: There is only ONE caching mechanism — the explicit `/v1/caching` API. The issue author used `context_id` loosely to refer to `cache_id`.

---

## Caching Mechanism Comparison: Kimi vs Other Models

### 1. Anthropic Claude (including OpenRouter/Bedrock)

**Mechanism**: Inline Cache Control

```typescript
// Mark cache boundaries within message content
messages: [
  {
    role: "system",
    content: [
      { type: "text", text: "System prompt...", cache_control: { type: "ephemeral" } }
    ]
  }
]

// Specify cache retention policy in request options
options: { cacheRetention: "short" | "long" | "none" }
```

**Characteristics**:
- ✅ Stateless: No cache lifecycle management needed, each request is self-contained
- ✅ Automatic: Provider automatically determines cache hits
- ✅ Transparent: `usage` field directly returns `cache_read_input_tokens`
- ✅ No additional API calls

---

### 2. OpenAI (Responses API)

**Mechanism**: Server-side Conversation State

```typescript
// First request
POST /v1/responses
{ messages: [...], store: true }
// Response includes conversation_id

// Subsequent requests reference the conversation
POST /v1/responses
{ conversation_id: "conv_xxx", messages: [newMessage] }
```

**Characteristics**:
- ✅ Auto-managed: Server-side retains conversation context
- ✅ Incremental: Subsequent requests only send new messages
- ⚠️ Session-bound: conversation_id implicitly links to history

---

### 3. Google Gemini

**Mechanism**: Context Caching API (Independent Cache Management)

```typescript
// Create cache
const cache = await cacheManager.create({
  model: "gemini-1.5-pro",
  systemInstruction: "...",
  contents: [...],
  ttlSeconds: 3600
});

// Use cache
const model = genAI.getGenerativeModelFromCachedContent(cache);
const result = await model.generateContent("User question");
```

**Characteristics**:
- ⚠️ Explicit management: Requires separate cache creation/deletion
- ⚠️ Stateful: Requires persisting cache.name
- ✅ Flexible: Can pre-create caches for multiple sessions

---

### 4. Moonshot Kimi

**Mechanism**: Caching API (Independent Cache Management + Special Role)

```typescript
// 1. Create cache (separate API)
POST /v1/caching
{ 
  model: "moonshot-v1", 
  messages: [...], 
  tools: [...],      // Optional: can cache tool definitions too
  name: "MyCache",   // Optional: human-readable name
  ttl: 3600          // Cache lifetime in seconds
}
// Returns:
{
  id: "cache-essqmysd6h1111dauub1",  // The cache_id to use
  object: "context_cache_object",
  status: "pending",
  tokens: 72,
  expired_at: 1718847499
}

// 2. Use cache (special role)
POST /v1/chat/completions
{
  messages: [
    { 
      role: "cache", 
      content: "cache_id=cache-essqmysd6h1111dauub1;reset_ttl=3600"  // Can extend TTL on use
    },
    { role: "user", content: "Question" }
  ]
}
```

**Characteristics**:
- ⚠️ Explicit management: Requires separate cache creation/deletion
- ⚠️ Stateful: Requires persisting cache_id
- ⚠️ Non-standard role: `role: "cache"` is not OpenAI-compatible format
- ⚠️ Extra HTTP call required: Cache creation is a separate request
- ✅ Can cache tools: Tool definitions can be included in cache
- ✅ TTL extension: Can reset TTL on each use via `reset_ttl` parameter

---

## Why Existing Mechanisms Cannot Be Simply Reused for Kimi

### Problem 1: OpenClaw's Caching is Stateless

OpenClaw's current `extra-params.ts` design uses a **stateless decorator pattern**:

```typescript
// Each request is independent, no session state is stored
function createStreamFnWithExtraParams(...) {
  return (model, context, options) => {
    // Only modifies payload, stores no IDs
    return underlying(model, context, { ...options, cacheRetention });
  };
}
```

Kimi requires **stateful management**:
- First request: Call `/v1/caching` to create cache, store `cache_id`
- Subsequent requests: Read `cache_id`, inject `role: "cache"` message
- Session end/change: Delete old cache

### Problem 2: Kimi Uses Non-standard `role: "cache"`

OpenClaw's message processing pipeline assumes standard OpenAI format:

```typescript
type Role = "system" | "user" | "assistant" | "tool";
```

Kimi's `role: "cache"` will be rejected by type checking and may be filtered by message processing middleware.

### Problem 3: Additional HTTP Calls Required

OpenClaw's streamFn only handles `/chat/completions` requests. Kimi's cache creation requires calling `/v1/caching` first, which exceeds the current streamFn decorator's responsibility scope.

### Problem 4: Complex Cache Invalidation Conditions

Need to detect the following changes and rebuild cache:
- System prompt changes
- Model changes
- TTL expiration

This requires hash computation, timestamp tracking, and other logic not needed by Anthropic/OpenRouter solutions.

---

## Solution Comparison

### Solution A: Session-Level Cache Manager

**Architecture**:

```
┌─────────────────────────────────────────────────────────┐
│                    OpenClaw Session                      │
├─────────────────────────────────────────────────────────┤
│  KimiCacheManager                                        │
│  ├── cacheId: string | null                             │
│  ├── systemPromptHash: string                           │
│  └── createdAt: number                                  │
├─────────────────────────────────────────────────────────┤
│  Lifecycle Hooks:                                        │
│  • onSessionStart → check/create cache                  │
│  • onMessageSend → inject cache role                    │
│  • onSystemPromptChange → invalidate & recreate         │
│  • onSessionEnd → cleanup cache                         │
└─────────────────────────────────────────────────────────┘
```

**Implementation Location**: `src/agents/moonshot-cache-manager.ts`

**Pros**:
- ✅ Complete lifecycle management
- ✅ Automatic invalidation and rebuild handling
- ✅ Can support cache warm-up (e.g., long documents)

**Cons**:
- ❌ Requires modifying session core code, high invasiveness
- ❌ Increases session state complexity
- ❌ Need to handle concurrent creation race conditions
- ❌ Estimated ~200-300 lines of new code

---

### Solution B: StreamFn Wrapper with Lazy Cache

**Architecture**:

```typescript
// Add Kimi-specific decorator in extra-params.ts
function createKimiCacheWrapper(baseStreamFn, cfg): StreamFn {
  const cacheStore = new Map<string, { id: string; hash: string; exp: number }>();
  
  return async (model, context, options) => {
    const sessionKey = options?.sessionKey;
    const systemHash = hash(context.system);
    
    let cacheId = cacheStore.get(sessionKey)?.id;
    if (!cacheId || needsRefresh(cacheStore.get(sessionKey), systemHash)) {
      cacheId = await createKimiCache(model, context.system, cfg);
      cacheStore.set(sessionKey, { id: cacheId, hash: systemHash, exp: Date.now() + TTL });
    }
    
    // Inject cache role
    const modifiedContext = injectCacheRole(context, cacheId);
    return baseStreamFn(model, modifiedContext, options);
  };
}
```

**Implementation Location**: `src/agents/pi-embedded-runner/extra-params.ts` (extending existing pattern)

**Pros**:
- ✅ Follows existing streamFn decorator pattern
- ✅ Low invasiveness, only activates for Kimi provider
- ✅ Lazy loading, creates cache on first request
- ✅ Estimated ~80-120 lines of new code

**Cons**:
- ❌ First request has additional latency (cache creation)
- ❌ Cache stored in memory, lost after gateway restart
- ❌ Concurrent requests may create multiple caches (needs locking)

---

### Solution C: Provider-Level Cache (Upstream Passthrough)

**Architecture**:

Let pi-ai or provider configuration layer handle Kimi caching, OpenClaw only passes configuration:

```yaml
# openclaw.yaml
agents:
  defaults:
    models:
      moonshot/kimi-k2-turbo:
        params:
          contextCache:
            enabled: true
            ttl: 3600
            minTokens: 4000
```

OpenClaw passes `contextCache` to pi-ai, and pi-ai's Moonshot provider implements caching logic.

**Pros**:
- ✅ Lowest invasiveness to OpenClaw
- ✅ Caching logic can be reused by other pi-ai users
- ✅ Follows separation of concerns principle

**Cons**:
- ❌ Requires modifying pi-ai (upstream dependency)
- ❌ Upstream PR merge timeline uncontrollable
- ❌ pi-ai may not want to support non-standard APIs

---

### Solution D: Hybrid Approach

**Phase 1**: Implement Solution B in OpenClaw first (quick delivery)
**Phase 2**: After gathering experience, submit Solution C PR to pi-ai
**Phase 3**: After pi-ai merges, migrate OpenClaw to Solution C

**Pros**:
- ✅ Fast value delivery
- ✅ Long-term maintainability
- ✅ Can validate API behavior before abstracting

**Cons**:
- ❌ Requires two implementations (short-term + long-term)
- ❌ Short-term solution may become permanent

---

## Solution Comparison Table

| Dimension | Solution A | Solution B | Solution C | Solution D |
|-----------|------------|------------|------------|------------|
| Lines of Code | ~250 | ~100 | ~50 (OpenClaw) | ~150 total |
| Invasiveness | High | Low | Lowest | Low→Lowest |
| Time to Ship | 2-3 days | 1 day | Depends on upstream | 1 day + follow-up |
| Maintainability | Medium | Medium | High | High |
| Cache After Restart | Persistable | Lost | Depends on impl | Lost→Persistable |
| Concurrency Safety | Needs lock | Needs lock | Provider handles | Needs lock |

---

## My Recommendation

**Recommend Solution B (StreamFn Wrapper)** for the following reasons:

1. **Follows existing architecture**: OpenClaw already uses streamFn decorators to handle Anthropic/OpenRouter caching. Adopting the same pattern for Kimi keeps code style consistent.

2. **Low invasiveness**: No need to modify session core code, just add a new wrapper in `extra-params.ts`.

3. **Fast delivery**: Estimated 1 day to complete, users can benefit quickly.

4. **Cache loss is acceptable**: Cache is lost after gateway restart, but:
   - Restarts are rare
   - Loss only means one extra API call on first request
   - Much better than having no caching at all

5. **Iterative improvement**: If Solution B proves valuable, can consider persistence or upstream abstraction later.

**Implementation Priority**:

```
1. Basic functionality: Create cache (system + tools) + inject cache role
2. Invalidation detection: Hash(systemPrompt + tools) change triggers rebuild
3. Concurrency protection: Inflight Promise map to avoid duplicate creation
4. TTL management: Use reset_ttl on every request (no expiry tracking needed)
5. Config toggle: agents.defaults.models.moonshot/*.params.contextCache.enabled
```

---

## Key Optimization: Cache System + Tools Together

Since Kimi supports caching both messages AND tools, the implementation should cache:
- System prompt (static per session)
- Tool definitions (static per agent config)

This means each request only sends:
```typescript
messages: [
  { role: "cache", content: "cache_id=xxx;reset_ttl=3600" },  // Cached: system + tools
  { role: "user", content: "..." },      // New messages only
  { role: "assistant", content: "..." },
  { role: "user", content: "current question" }
]
```

**Token Savings Example**:

| Component | Tokens | Without Cache | With Cache |
|-----------|--------|---------------|------------|
| System prompt | ~2000 | ✅ Sent | ❌ Cached |
| Tool definitions | ~3000 | ✅ Sent | ❌ Cached |
| Conversation history | ~1000 | ✅ Sent | ✅ Sent |
| **Total per request** | | ~6000 | ~1000 |

**Simplified Invalidation Logic**:

```typescript
type CacheEntry = {
  cacheId: string;
  contentHash: string;  // Hash of system prompt + tools JSON
  // No need for createdAt/ttl - we use reset_ttl on every request
};

function shouldInvalidate(entry: CacheEntry, current: { system: string; tools: Tool[] }): boolean {
  const currentHash = hash(JSON.stringify({ system: current.system, tools: current.tools }));
  return entry.contentHash !== currentHash;
}
```

No TTL expiry check needed — `reset_ttl=3600` auto-extends on every use.

---

## Open Questions (Partially Resolved)

### Q1: Usage Statistics — How does `usage` reflect cache hit/miss?

**Current Status**: Moonshot cookbook examples don't show usage response format. Needs actual testing.

**Two Possible Scenarios**:

| Scenario | Usage Format | OpenClaw Compatibility |
|----------|--------------|------------------------|
| A: Anthropic-compatible | `{ cache_read_input_tokens, cache_creation_input_tokens }` | ✅ Works out of box, no changes needed |
| B: Custom format | `{ cached_tokens, cache_hit: true }` or no such field | ❌ Requires mapping in `usage.ts` |

**Recommendation**: During implementation, log raw usage response first, then decide whether to extend `parseRawUsage()`.

---

### Q2: Concurrent Creation — How to avoid duplicate cache creation?

**Problem Scenario**:
```
T0: Request A arrives → no cache → starts creating cache
T1: Request B arrives → no cache yet (A still creating) → starts creating ANOTHER cache ❌
```

**Solution: Inflight Promise Map (Coalescing Pattern)**

```typescript
const inflightCreation = new Map<string, Promise<string>>();

async function getOrCreateCache(sessionKey: string, ...): Promise<string> {
  // 1. Check existing cache
  const existing = cacheStore.get(sessionKey);
  if (existing && !needsRefresh(existing)) {
    return existing.id;
  }

  // 2. Check if creation already in progress
  const inflight = inflightCreation.get(sessionKey);
  if (inflight) {
    return inflight;  // Await the same promise
  }

  // 3. Create new cache with lock
  const creationPromise = (async () => {
    try {
      const cacheId = await createKimiCache(...);
      cacheStore.set(sessionKey, { id: cacheId, ... });
      return cacheId;
    } finally {
      inflightCreation.delete(sessionKey);  // Release lock
    }
  })();

  inflightCreation.set(sessionKey, creationPromise);
  return creationPromise;
}
```

**Result**:
```
T0: Request A → creates promise, stores in inflightCreation
T1: Request B → finds inflight promise → awaits same promise
T2: Cache created → both A and B get same cacheId ✅
```

This is a standard "coalescing" pattern. No mutex needed in Node.js single-threaded environment.

---

### Q3: Cache Size Limit

Maximum token count for a single cache? **Needs confirmation from Moonshot docs.**

### Q4: Pricing

Is cache storage billed separately? **Needs confirmation from Moonshot pricing page.**

---

## References

- [Issue #7073](https://github.com/openclaw/openclaw/issues/7073)
- [MoonshotAI Cookbook - Context Caching](https://github.com/MoonshotAI/MoonshotAI-Cookbook/tree/master/examples/context_caching)
- [OpenClaw extra-params.ts](https://github.com/openclaw/openclaw/blob/main/src/agents/pi-embedded-runner/extra-params.ts)

---

*Created: 2026-02-23*
*Updated: 2026-02-24 - Added mechanism comparison, reuse barriers analysis, multi-solution comparison*
*Status: Ready for review*
