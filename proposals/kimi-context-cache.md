# Kimi Context Cache 实现方案

## Issue 背景

- **Issue**: [#7073 - Support Kimi K2.5 Cache](https://github.com/openclaw/openclaw/issues/7073)
- **问题**: 长上下文场景下 token 消耗过高
- **解决方案**: 利用 Kimi 的 Caching API

---

## 缓存机制对比：Kimi vs 其他模型

### 1. Anthropic Claude（及 OpenRouter/Bedrock 上的 Claude）

**机制**: 内联缓存控制（Inline Cache Control）

```typescript
// 在消息内容中标记缓存边界
messages: [
  {
    role: "system",
    content: [
      { type: "text", text: "系统提示...", cache_control: { type: "ephemeral" } }
    ]
  }
]

// 请求时指定缓存保留策略
options: { cacheRetention: "short" | "long" | "none" }
```

**特点**:
- ✅ 无状态：无需管理缓存生命周期，每次请求自包含
- ✅ 自动：provider 自动判断缓存命中
- ✅ 透明：`usage` 字段直接返回 `cache_read_input_tokens`
- ✅ 无额外 API 调用

---

### 2. OpenAI（Responses API）

**机制**: 服务端会话状态（Server-side Conversation State）

```typescript
// 首次请求
POST /v1/responses
{ messages: [...], store: true }
// 响应包含 conversation_id

// 后续请求引用会话
POST /v1/responses
{ conversation_id: "conv_xxx", messages: [newMessage] }
```

**特点**:
- ✅ 自动管理：server-side 保留会话上下文
- ✅ 增量发送：后续请求只发新消息
- ⚠️ 会话绑定：conversation_id 隐式关联历史

---

### 3. Google Gemini

**机制**: Context Caching API（独立缓存管理）

```typescript
// 创建缓存
const cache = await cacheManager.create({
  model: "gemini-1.5-pro",
  systemInstruction: "...",
  contents: [...],
  ttlSeconds: 3600
});

// 使用缓存
const model = genAI.getGenerativeModelFromCachedContent(cache);
const result = await model.generateContent("用户问题");
```

**特点**:
- ⚠️ 显式管理：需要单独创建/删除缓存
- ⚠️ 有状态：需要持久化 cache.name
- ✅ 灵活：可以预创建缓存用于多个会话

---

### 4. Moonshot Kimi

**机制**: Caching API（独立缓存管理 + 特殊 role）

```typescript
// 1. 创建缓存（独立 API）
POST /v1/caching
{ model: "...", messages: [...], ttl: 3600 }
// 返回 { id: "cache_xxx" }

// 2. 使用缓存（特殊 role）
POST /v1/chat/completions
{
  messages: [
    { role: "cache", content: "cache_id=cache_xxx" },  // 特殊 role
    { role: "user", content: "问题" }
  ]
}
```

**特点**:
- ⚠️ 显式管理：需要单独创建/删除缓存
- ⚠️ 有状态：需要持久化 cache_id
- ⚠️ 非标准 role：`role: "cache"` 不是 OpenAI 兼容格式
- ⚠️ 需要额外 HTTP 调用：创建缓存是独立请求

---

## 为什么现有机制无法简单复用到 Kimi

### 问题 1: OpenClaw 的缓存是无状态的

OpenClaw 当前的 `extra-params.ts` 设计是**无状态的装饰器模式**：

```typescript
// 每次请求独立，不保存任何会话状态
function createStreamFnWithExtraParams(...) {
  return (model, context, options) => {
    // 只是修改 payload，不存储任何 ID
    return underlying(model, context, { ...options, cacheRetention });
  };
}
```

而 Kimi 需要**有状态管理**：
- 首次请求：调用 `/v1/caching` 创建缓存，存储 `cache_id`
- 后续请求：读取 `cache_id`，注入 `role: "cache"` 消息
- 会话结束/变更：删除旧缓存

### 问题 2: Kimi 使用非标准的 `role: "cache"`

OpenClaw 的消息处理管道假设标准 OpenAI 格式：

```typescript
type Role = "system" | "user" | "assistant" | "tool";
```

Kimi 的 `role: "cache"` 会被类型检查拒绝，也可能被消息处理中间件过滤。

### 问题 3: 需要额外的 HTTP 调用

OpenClaw 的 streamFn 只处理 `/chat/completions` 请求。Kimi 的缓存创建需要先调用 `/v1/caching`，这超出了当前 streamFn 装饰器的职责范围。

### 问题 4: 缓存失效条件复杂

需要检测以下变化并重建缓存：
- System prompt 变化
- Model 变化
- TTL 过期

这需要哈希计算、时间戳追踪等 Anthropic/OpenRouter 方案不需要的逻辑。

---

## 解决方案对比

### Solution A: Session-Level Cache Manager（会话级缓存管理器）

**架构**:

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

**实现位置**: `src/agents/moonshot-cache-manager.ts`

**优点**:
- ✅ 完整的生命周期管理
- ✅ 自动处理失效重建
- ✅ 可以支持缓存预热（如长文档）

**缺点**:
- ❌ 需要修改 session 核心代码，侵入性高
- ❌ 增加会话状态复杂度
- ❌ 需要处理并发创建竞态条件
- ❌ 估算 ~200-300 行新代码

---

### Solution B: StreamFn Wrapper with Lazy Cache（懒加载缓存装饰器）

**架构**:

```typescript
// 在 extra-params.ts 中添加 Kimi 专用装饰器
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
    
    // 注入 cache role
    const modifiedContext = injectCacheRole(context, cacheId);
    return baseStreamFn(model, modifiedContext, options);
  };
}
```

**实现位置**: `src/agents/pi-embedded-runner/extra-params.ts`（扩展现有模式）

**优点**:
- ✅ 符合现有 streamFn 装饰器模式
- ✅ 侵入性低，只在 Kimi provider 时激活
- ✅ 懒加载，首次请求时创建缓存
- ✅ 估算 ~80-120 行新代码

**缺点**:
- ❌ 首次请求有额外延迟（创建缓存）
- ❌ 缓存存储在内存中，gateway 重启后丢失
- ❌ 并发请求可能创建多个缓存（需要锁）

---

### Solution C: Provider-Level Cache（Provider 层透传）

**架构**:

让 pi-ai 或 provider 配置层处理 Kimi 缓存，OpenClaw 只传递配置：

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

OpenClaw 将 `contextCache` 传递给 pi-ai，由 pi-ai 的 Moonshot provider 实现缓存逻辑。

**优点**:
- ✅ OpenClaw 侵入性最低
- ✅ 缓存逻辑可以被其他 pi-ai 用户复用
- ✅ 符合关注点分离原则

**缺点**:
- ❌ 需要修改 pi-ai（上游依赖）
- ❌ 上游 PR 合并时间不可控
- ❌ pi-ai 可能不想支持非标准 API

---

### Solution D: Hybrid（混合方案）

**阶段 1**: 先在 OpenClaw 实现 Solution B（快速可用）
**阶段 2**: 总结经验后，向 pi-ai 提交 Solution C 的 PR
**阶段 3**: pi-ai 合并后，OpenClaw 迁移到 Solution C

**优点**:
- ✅ 快速交付价值
- ✅ 长期可维护性
- ✅ 可以验证 API 行为后再做抽象

**缺点**:
- ❌ 需要两次实现（短期 + 长期）
- ❌ 短期方案可能变成永久方案

---

## 方案对比表

| 维度 | Solution A | Solution B | Solution C | Solution D |
|------|------------|------------|------------|------------|
| 代码量 | ~250 行 | ~100 行 | ~50 行(OpenClaw) | ~150 行总计 |
| 侵入性 | 高 | 低 | 最低 | 低→最低 |
| 上手时间 | 2-3 天 | 1 天 | 取决于上游 | 1 天 + 后续 |
| 可维护性 | 中 | 中 | 高 | 高 |
| 重启后缓存 | 可持久化 | 丢失 | 取决于实现 | 丢失→持久化 |
| 并发安全 | 需要锁 | 需要锁 | provider 处理 | 需要锁 |

---

## 我的建议

**推荐 Solution B（StreamFn Wrapper）**，理由：

1. **符合现有架构**：OpenClaw 已经用 streamFn 装饰器处理 Anthropic/OpenRouter 缓存，Kimi 采用相同模式，代码风格一致

2. **侵入性低**：不需要修改 session 核心代码，只在 `extra-params.ts` 添加一个新的 wrapper

3. **快速交付**：估算 1 天可完成，用户能尽快用上

4. **缓存丢失可接受**：gateway 重启后缓存丢失，但：
   - 重启本来就很少
   - 丢失后只是首次请求多一次 API 调用
   - 比完全没有缓存好很多

5. **可以迭代**：如果 Solution B 证明有价值，再考虑持久化或上游抽象

**实现优先级**:

```
1. 基础功能：创建缓存 + 注入 cache role + TTL 过期检测
2. 失效检测：system prompt hash 变化时重建
3. 并发保护：简单的 Promise 锁避免重复创建
4. 配置开关：agents.defaults.models.moonshot/*.params.contextCache.enabled
```

---

## 待确认问题

1. **Usage 统计**: 使用缓存时，`usage` 字段如何体现 cache hit/miss？
2. **并发创建**: 同一 session 并发请求时如何避免重复创建缓存？
3. **缓存大小限制**: 单个缓存的最大 token 数？
4. **费用**: 缓存存储是否单独计费？

---

## 参考资料

- [Issue #7073](https://github.com/openclaw/openclaw/issues/7073)
- [MoonshotAI Cookbook - Context Caching](https://github.com/MoonshotAI/MoonshotAI-Cookbook/tree/master/examples/context_caching)
- [OpenClaw extra-params.ts](https://github.com/openclaw/openclaw/blob/main/src/agents/pi-embedded-runner/extra-params.ts)

---

*Created: 2026-02-23*
*Updated: 2026-02-24 - 添加机制对比、复用障碍分析、多方案比较*
*Status: Ready for review*
