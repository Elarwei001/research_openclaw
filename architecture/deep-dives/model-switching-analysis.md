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

## Potential Fixes

### Fix 1: Re-read Auth Store on Auth Errors

```typescript
// Proposed change in run.ts
const advanceAuthProfile = async (): Promise<boolean> => {
  // Refresh auth store on failover to pick up runtime changes
  const freshStore = ensureAuthProfileStore(agentDir, { 
    allowKeychainPrompt: false,
    forceReload: true  // New option
  });
  // ... rest of failover logic
};
```

### Fix 2: Immediate Model Switch for Current Turn

```typescript
// In directive-handling, force re-resolution of model before responding
if (modelSelection) {
  applyModelOverrideToSessionEntry(sessionEntry, modelSelection);
  // Force LLM client re-creation for current turn
  params.llmClientFactory?.invalidate();
}
```

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
