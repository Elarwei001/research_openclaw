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

### Problem 1: Auth Store Not Refreshed After Auth Errors

#### Current Code Issues

**Location**: `src/agents/pi-embedded-runner/run.ts:297`

```typescript
// Auth store is loaded once at run start, never refreshed
const authStore = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
```

**Problem Flow**:
```
1. Gateway starts → loads auth-profiles.json into memory
2. User revokes/updates API Key externally
3. Agent run still uses stale key from memory
4. Auth failure → enters cooldown
5. advanceAuthProfile() tries next profile, but uses same stale authStore
6. All profiles fail → user is locked out
```

**Key Code** (`run.ts:371-376`):
```typescript
const resolveApiKeyForCandidate = async (candidate?: string) => {
  return getApiKeyForModel({
    model,
    cfg: params.config,
    profileId: candidate,
    store: authStore,  // ❌ Always uses snapshot from startup
    agentDir,
  });
};
```

#### Related Issues/PRs

| Issue/PR | Status | Description |
|----------|--------|-------------|
| **#17873** | OPEN | OAuth provider enters permanent cooldown instead of using refresh token |
| **#9095** | OPEN | Anthropic OAuth fails with HTTP 401 invalid bearer token |
| **#8602** | OPEN (PR) | feat(auth): add Anthropic OAuth token refresh ← **Primary fix PR** |
| **#18624** | OPEN | billingBackoffHours default causes prolonged outages on OAuth token expiry |
| **#8405** | OPEN | Refresh token reuse errors cause extended provider outages |

#### Fix Proposal

**Option A: Reload Store After Auth Errors**

```typescript
// src/agents/pi-embedded-runner/run.ts
const advanceAuthProfile = async (): Promise<boolean> => {
  if (lockedProfileId) {
    return false;
  }
  
  // 🔧 NEW: Reload auth store on failover to pick up runtime changes
  const freshStore = ensureAuthProfileStore(agentDir, { 
    allowKeychainPrompt: false,
    forceReload: true  // Force re-read from file
  });
  
  // Update local reference
  Object.assign(authStore, freshStore);
  
  let nextIndex = profileIndex + 1;
  // ... rest of logic
};
```

**Option B: Merge PR #8602 (Anthropic OAuth token refresh)**

PR #8602 already implements:
- Automatic OAuth token refresh mechanism
- Same refresh endpoint as Claude Code CLI
- Keychain sync support

**Recommendation**: Prioritize merging PR #8602 — it's a community-validated solution.

---

### Problem 2: No Effective Model Confirmation After Switch

#### Current Code Issues

**Location**: `src/auto-reply/reply/directive-handling.model.ts`

When user runs `/model openrouter/claude-sonnet-4-5`:

```typescript
// Current logic returns simple confirmation
return { text: `Model set to ${provider}/${model}` };
```

**Problems**:
1. Does not show **actually effective** model (may be blocked by allowlist)
2. Does not show which **auth profile** will be used
3. Does not indicate **takes effect on next message** (current turn may still use old model)

#### Why Model Switch Has Delayed Effect

**Code Flow** (`src/auto-reply/reply/get-reply-run.ts`):
```
User message "/model X"
    │
    ▼
┌──────────────────────────────────────┐
│ parseDirectives() → detect /model    │
└──────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│ applyModelOverrideToSessionEntry()   │
│ → sessionEntry.modelOverride = "X"   │
│ → updateSessionStore() persists      │
└──────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────┐
│ Return confirmation "Model set to X" │
│ ⚠️ LLM client may already be created │
│    using the OLD model               │
└──────────────────────────────────────┘
    │
    ▼
Next message
    │
    ▼
┌──────────────────────────────────────┐
│ runEmbeddedPiAgent()                 │
│ → resolveModel() reads modelOverride │
│ → Uses new model ✓                   │
└──────────────────────────────────────┘
```

#### Related Issues

| Issue | Status | Description |
|-------|--------|-------------|
| **#13265** | OPEN | Switch model via telegram |
| **#5733** | OPEN (stale) | Model-level authProfileId override not respected |
| **#12754** | OPEN | Cannot switch model free from provider |

**No in-flight PR directly addresses this issue.**

#### Fix Proposal

**Option A: Enhanced Confirmation Message**

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
  
  // NEW: Resolve what will actually be used
  const effective = resolveEffectiveModel({
    sessionEntry,
    cfg,
    agentDir,
  });
  
  // NEW: Resolve auth profile that will be used
  const authStore = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
  const profileOrder = resolveAuthProfileOrder({
    cfg,
    store: authStore,
    provider: effective.provider,
  });
  const activeProfile = profileOrder[0] ?? "default";
  
  // NEW: Build detailed confirmation
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

**Option B: Support Immediate Effect (More Complex)**

```typescript
// After directive handling, abort current run and restart
if (modelSelection && params.allowImmediateSwitch) {
  throw new ModelSwitchRestartError(modelSelection);
}

// Catch at outer layer and re-invoke runEmbeddedPiAgent with new model
```

**Recommendation**: Option A is safer and should be implemented first. Option B requires more architectural changes.

---

## In-Flight PR Status Summary

| PR | Problem | Status | Recommendation |
|----|---------|--------|----------------|
| **#8602** | Auth profile refresh | OPEN, CI passing, awaiting merge | 🔥 High priority — push for merge |
| **#19211** | Clear cooldown incomplete | OPEN | Related but independent |
| **#18902** | Format error cooldown cascade | OPEN | Related but independent |
| **#14914** | 403 auth error classification | OPEN | Related, can follow #8602 |

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
