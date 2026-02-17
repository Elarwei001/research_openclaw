# Model Switching Flow Analysis

> **Issue Reference**: [#19196](https://github.com/openclaw/openclaw/issues/19196)  
> **Date**: 2026-02-17  
> **Contributors**: nikolasdehor, Nek-12, Elarwei001

## Executive Summary

This document analyzes the model switching mechanism in OpenClaw, focusing on runtime issues reported by users. The analysis covers the two-level model configuration system, the auth profile resolution pipeline, and identified problems with hot-reload and API key caching.

## Architecture Overview

### Two-Level Model Configuration

OpenClaw implements a **dual-layer** model configuration system:

```
┌─────────────────────────────────────────────────────────────┐
│                    Model Resolution Flow                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Session-level Override                                  │
│     └── sessionEntry.modelOverride                          │
│     └── sessionEntry.providerOverride                       │
│     └── sessionEntry.authProfileOverride                    │
│                                                             │
│  2. Config-level Default                                    │
│     └── agents.defaults.model (or models.default)           │
│     └── agents.defaults.models[provider/model].params       │
│                                                             │
│  3. Hardcoded Fallback                                      │
│     └── DEFAULT_PROVIDER = "anthropic"                      │
│     └── DEFAULT_MODEL = "claude-sonnet-4-5"                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Key Files

| File | Purpose |
|------|---------|
| `src/auto-reply/reply/model-selection.ts` | Session model override resolution |
| `src/agents/pi-embedded-runner/run.ts` | Runtime model + auth resolution |
| `src/agents/model-auth.ts` | API key and auth profile management |
| `src/config/sessions/types.ts` | Session entry schema (includes modelOverride) |
| `src/infra/restart.ts` | SIGUSR1 hot-reload mechanism |

## Model Resolution Pipeline

### Step 1: Session Model Override Check

```typescript
// src/auto-reply/reply/model-selection.ts:106
const model = entry?.modelOverride?.trim();
```

When `/model <provider/model>` is used, the selection is stored in:
- `sessionEntry.modelOverride` — the model ID
- `sessionEntry.providerOverride` — the provider ID (optional)
- `sessionEntry.authProfileOverride` — specific auth profile (optional)

### Step 2: Runtime Model Resolution

```typescript
// src/agents/pi-embedded-runner/run.ts
const { provider, modelId, model } = resolveModel({
  cfg: params.config,
  sessionEntry: params.sessionEntry,
  defaultProvider: DEFAULT_PROVIDER,
  defaultModel: DEFAULT_MODEL,
});
```

### Step 3: Auth Profile Order Resolution

```typescript
// src/agents/pi-embedded-runner/run.ts:308-330
const profileOrder = resolveAuthProfileOrder({
  cfg: params.config,
  store: authStore,
  provider,
  preferredProfile: preferredProfileId,
});
```

### Step 4: API Key Resolution (Per-Request)

```typescript
// src/agents/pi-embedded-runner/run.ts:371-376
const resolveApiKeyForCandidate = async (candidate?: string) => {
  return getApiKeyForModel({
    model,
    cfg: params.config,
    profileId: candidate,
    store: authStore,
    agentDir,
  });
};
```

## Identified Issues

### Issue 1: LLM Client Not Re-initialized After `/model`

**Symptom**: `/model` reports success, but `/status` shows old model.

**Root Cause**: The session's `modelOverride` is updated, but if the LLM client was already initialized for the current turn, it continues using the old model until the next agent turn.

**Code Path**:
```
/model command → updateSessionStore() → modelOverride saved
                                        ↓
                        BUT: Current turn already has LLM client
                        ↓
                        Next turn picks up new modelOverride ✓
```

**Workaround**: The change takes effect on the next message, not the current one.

### Issue 2: Auth Profile Store Caching

**Symptom**: Revoking API key still results in 401 errors instead of switching to OpenRouter.

**Root Cause**: The `authStore` is loaded once at the start of `runEmbeddedPiAgent()`:

```typescript
// src/agents/pi-embedded-runner/run.ts
const authStore = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
```

The store is **not reloaded** after auth errors. While `advanceAuthProfile()` iterates through `profileCandidates`, it uses the same stale `authStore` snapshot.

**Related Issues**: #9095, #17873 (OAuth refresh issues)

### Issue 3: Gateway Process Management Chaos

**Symptom**: "Gateway already running" errors even after explicit stop commands.

**Observed in Nek-12's Logs**:
```
Gateway failed to start: gateway already running (pid 66580); lock timeout after 5000ms
Port 18789 is already in use.
```

**Root Cause Analysis**:
1. **Multiple gateway instances**: launchd may respawn the service while user is trying to stop
2. **Lock file stale**: PID lock file may reference dead process
3. **Port binding race**: New instance tries to bind while old is still closing

**Sequence (from logs)**:
```
14:27:28 → Gateway service appears loaded. Stop it first.
14:27:39 → Gateway failed to start (pid 66580 still running)
... repeated every ~10 seconds ...
14:32:28 → Gateway service not loaded. (finally stopped)
```

### Issue 4: Config Changes Ignored

**Symptom**: `openclaw config set models.default "..."` doesn't affect running sessions.

**Root Cause**: The gateway needs a full restart to reload config. SIGUSR1 hot-reload only applies to certain config changes.

**What SIGUSR1 Does**:
```typescript
// src/infra/restart.ts
export function emitGatewayRestart(): boolean {
  authorizeGatewaySigusr1Restart();
  process.emit("SIGUSR1");  // Or process.kill(process.pid, "SIGUSR1")
}
```

**What Requires Full Restart**:
- Model allowlist changes (`models.allowed`)
- Provider endpoint changes
- Auth profile structural changes

## Flow Diagrams

### Model Switch via `/model` Command

```
User: /model openrouter/anthropic/claude-sonnet-4-5
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ resolveModelSelectionFromDirective()                 │
│   ├── Parse provider/model from directive            │
│   ├── Check allowedModelKeys (if allowlist exists)   │
│   └── resolveProfileOverride() if @profile specified │
└──────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ applyModelOverrideToSessionEntry()                   │
│   ├── sessionEntry.modelOverride = "claude-sonnet-4-5"│
│   ├── sessionEntry.providerOverride = "openrouter"   │
│   └── updateSessionStore()                           │
└──────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ Reply: "Model set to openrouter/claude-sonnet-4-5"   │
│ (But current turn may still use old model!)         │
└──────────────────────────────────────────────────────┘
```

### Auth Profile Failover

```
runEmbeddedPiAgent()
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ ensureAuthProfileStore(agentDir) ← LOADS ONCE       │
└──────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ resolveAuthProfileOrder()                            │
│   ├── Get all profiles for provider                  │
│   ├── Sort by lastGoodAt, cooldown status           │
│   └── Return ordered candidate list                  │
└──────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ RETRY LOOP: profileCandidates                        │
│   ├── applyApiKeyInfo(candidate)                     │
│   │   └── getApiKeyForModel() ← uses stale store!   │
│   ├── runEmbeddedAttempt()                          │
│   ├── On error: advanceAuthProfile()                │
│   └── If all fail: throwAuthProfileFailover()       │
└──────────────────────────────────────────────────────┘
```

## Detailed Problem Analysis & Fix Proposals

---

### Problem 1: Auth Store 不会在认证错误后刷新

#### 当前代码问题

**位置**: `src/agents/pi-embedded-runner/run.ts:297`

```typescript
// Auth store 在 run 开始时加载一次，之后不再刷新
const authStore = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
```

**问题流程**:
```
1. Gateway 启动 → 加载 auth-profiles.json 到内存
2. 用户在外部撤销/更新 API Key
3. Agent 运行时仍使用内存中的旧 key
4. 认证失败 → 进入 cooldown
5. advanceAuthProfile() 尝试下一个 profile，但用的还是同一个 stale authStore
6. 所有 profile 都失败 → 用户被锁定
```

**关键代码** (`run.ts:371-376`):
```typescript
const resolveApiKeyForCandidate = async (candidate?: string) => {
  return getApiKeyForModel({
    model,
    cfg: params.config,
    profileId: candidate,
    store: authStore,  // ❌ 始终使用启动时的 snapshot
    agentDir,
  });
};
```

#### 相关 Issues/PRs

| Issue/PR | Status | Description |
|----------|--------|-------------|
| **#17873** | OPEN | OAuth provider enters permanent cooldown instead of using refresh token |
| **#9095** | OPEN | Anthropic OAuth fails with HTTP 401 invalid bearer token |
| **#8602** | OPEN (PR) | feat(auth): add Anthropic OAuth token refresh ← **主要修复 PR** |
| **#18624** | OPEN | billingBackoffHours default causes prolonged outages on OAuth token expiry |
| **#8405** | OPEN | Refresh token reuse errors cause extended provider outages |

#### Fix Proposal

**方案 A: 在 Auth 错误后重新加载 Store**

```typescript
// src/agents/pi-embedded-runner/run.ts
const advanceAuthProfile = async (): Promise<boolean> => {
  if (lockedProfileId) {
    return false;
  }
  
  // 🔧 NEW: Reload auth store on failover to pick up runtime changes
  const freshStore = ensureAuthProfileStore(agentDir, { 
    allowKeychainPrompt: false,
    forceReload: true  // 强制重新读取文件
  });
  
  // Update local reference
  Object.assign(authStore, freshStore);
  
  let nextIndex = profileIndex + 1;
  // ... rest of logic
};
```

**方案 B: 合并 PR #8602 (Anthropic OAuth token refresh)**

PR #8602 已经实现了:
- OAuth token 自动刷新机制
- 与 Claude Code CLI 相同的刷新端点
- Keychain 同步支持

**建议**: 优先推动 PR #8602 合并，这是社区已验证的方案。

---

### Problem 2: Model Switch 后不显示生效确认

#### 当前代码问题

**位置**: `src/auto-reply/reply/directive-handling.model.ts`

当用户执行 `/model openrouter/claude-sonnet-4-5` 时:

```typescript
// 当前逻辑只返回简单确认
return { text: `Model set to ${provider}/${model}` };
```

**问题**:
1. 不显示**实际生效**的 model (可能被 allowlist 拦截)
2. 不显示使用的 **auth profile**
3. 不提示 **下一条消息才生效** (当前 turn 可能还用旧 model)

#### Model 生效延迟的原因

**代码流程** (`src/auto-reply/reply/get-reply-run.ts`):
```
用户消息 "/model X"
    │
    ▼
┌──────────────────────────────────────┐
│ parseDirectives() → 识别 /model      │
└──────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│ applyModelOverrideToSessionEntry()   │
│ → sessionEntry.modelOverride = "X"   │
│ → updateSessionStore() 持久化        │
└──────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│ 返回确认消息 "Model set to X"        │
│ ⚠️ 此时 LLM client 可能已创建       │
│    使用的是旧 model                  │
└──────────────────────────────────────┘
    │
    ▼
下一条消息
    │
    ▼
┌──────────────────────────────────────┐
│ runEmbeddedPiAgent()                 │
│ → resolveModel() 读取 modelOverride  │
│ → 使用新 model ✓                     │
└──────────────────────────────────────┘
```

#### 相关 Issues

| Issue | Status | Description |
|-------|--------|-------------|
| **#13265** | OPEN | Switch model via telegram |
| **#5733** | OPEN (stale) | Model-level authProfileId override not respected |
| **#12754** | OPEN | Cannot switch model free from provider |

#### Fix Proposal

**方案 A: 增强确认消息**

```typescript
// src/auto-reply/reply/directive-handling.model.ts
export async function handleModelDirectiveSwitch(params: {
  modelSelection: ModelDirectiveSelection;
  sessionEntry: SessionEntry;
  cfg: OpenClawConfig;
  agentDir: string;
}): Promise<ReplyPayload> {
  const { modelSelection, sessionEntry, cfg, agentDir } = params;
  
  // Apply the override
  applyModelOverrideToSessionEntry(sessionEntry, modelSelection);
  
  // 🔧 NEW: Resolve what will actually be used
  const effective = resolveEffectiveModel({
    sessionEntry,
    cfg,
    agentDir,
  });
  
  // 🔧 NEW: Resolve auth profile that will be used
  const authStore = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
  const profileOrder = resolveAuthProfileOrder({
    cfg,
    store: authStore,
    provider: effective.provider,
  });
  const activeProfile = profileOrder[0] ?? "default";
  
  // 🔧 NEW: Build detailed confirmation
  const lines = [
    `✅ Model switched`,
    ``,
    `Requested: ${modelSelection.provider}/${modelSelection.model}`,
    `Effective: ${effective.provider}/${effective.model}`,
    `Auth profile: ${activeProfile}`,
    ``,
    `💡 Takes effect on your next message.`,
  ];
  
  // Add warning if model was remapped
  if (effective.model !== modelSelection.model) {
    lines.push(`⚠️ Model was remapped (allowlist or alias)`);
  }
  
  return { text: lines.join("\n") };
}
```

**方案 B: 支持即时生效 (更复杂)**

```typescript
// 在 directive 处理后，abort 当前 run 并重新开始
if (modelSelection && params.allowImmediateSwitch) {
  throw new ModelSwitchRestartError(modelSelection);
}

// 在外层 catch 并重新调用 runEmbeddedPiAgent with new model
```

**建议**: 方案 A 更安全，可以先实现。方案 B 需要更多架构改动。

---

## 在途 PR 状态总结

| PR | 问题 | 状态 | 建议 |
|----|------|------|------|
| **#8602** | Auth profile refresh | OPEN, CI passing, 待合并 | 🔥 高优先级推动合并 |
| **#19211** | Clear cooldown incomplete | OPEN | 相关但独立 |
| **#18902** | Format error cooldown cascade | OPEN | 相关但独立 |
| **#14914** | 403 auth error classification | OPEN | 相关，可作为 #8602 后续 |

---

## Potential Fixes (Original)

### Fix 3: Better Gateway Process Management

1. Use exclusive file lock instead of PID-based check
2. Add process health check before assuming PID is alive
3. Implement graceful shutdown signal chain

## OpenRouter-Specific Notes

OpenRouter models require:
1. Auth profile with OpenRouter API key (`openrouter` provider)
2. Model ID format: `openrouter/<provider>/<model>` or just `<provider>/<model>` when using openrouter provider
3. Models allowlist must include the model (or be empty to allow all)

**Config Example**:
```json
{
  "agents": {
    "defaults": {
      "model": "openrouter/anthropic/claude-sonnet-4-5",
      "models": {
        "openrouter/anthropic/claude-sonnet-4-5": {
          "params": {}
        }
      }
    }
  }
}
```

## Recommendations

### For Users (Immediate Workarounds)

1. **Model changes**: Always send a new message after `/model` to trigger the new model
2. **Full restart**: Use `launchctl bootout` + `launchctl bootstrap` (macOS) instead of SIGUSR1 for config changes
3. **Kill stale processes**: `pkill -9 -f openclaw-gateway` before restart if stuck

### For Developers (Future Improvements)

1. Implement auth store refresh on auth errors
2. Add model switch confirmation that shows effective model
3. Improve gateway process lifecycle management
4. Add config change detection that lists what requires restart

## References

- Issue #19196: Model configuration not working
- Issue #9095: OAuth refresh issues
- Issue #17873: Credential resolution runtime changes
- PR #6427: Provider switching context loss (CLOSED - addressed by TranscriptPolicy)

---

*Document created as part of OpenClaw architecture research.*
