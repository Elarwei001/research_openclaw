# Transcript-Provider Decoupling: Evolution Analysis

This document analyzes how OpenClaw handles transcript management when switching providers, and the evolution of the decoupling strategy.

## 1. The Problem

When users switch between LLM providers (e.g., Anthropic → OpenAI → Google), the existing transcript may contain:

1. **Provider-specific formats** - Tool call IDs, thinking blocks, signatures
2. **Incompatible structures** - Turn ordering requirements, message formats
3. **Orphaned tool results** - Tool results without matching tool calls

Each provider has different requirements:

| Provider | Tool Call IDs | Turn Ordering | Tool Result Pairing | Thinking Blocks |
|----------|--------------|---------------|---------------------|-----------------|
| **Anthropic** | Alphanumeric | Any | Strict (must follow tool call) | N/A |
| **OpenAI** | Any format | Any | Flexible | Reasoning blocks |
| **Google/Gemini** | Alphanumeric | User must be first | Strict | Thinking with signatures |
| **Mistral** | Max 9 chars | Any | Flexible | N/A |

## 2. Solution Architecture

### 2.1 TranscriptPolicy Pattern

**File:** `src/agents/transcript-policy.ts`

The key abstraction is `TranscriptPolicy` - a configuration object that describes what sanitization is needed for each provider:

```typescript
export type TranscriptPolicy = {
  sanitizeMode: "full" | "images-only";
  sanitizeToolCallIds: boolean;
  toolCallIdMode?: "strict" | "strict9";
  repairToolUseResultPairing: boolean;
  preserveSignatures: boolean;
  sanitizeThoughtSignatures?: { allowBase64Only?: boolean };
  normalizeAntigravityThinkingBlocks: boolean;
  applyGoogleTurnOrdering: boolean;
  validateGeminiTurns: boolean;
  validateAnthropicTurns: boolean;
  allowSyntheticToolResults: boolean;
};
```

### 2.2 Sanitization Pipeline

**File:** `src/agents/pi-embedded-runner/google.ts` → `sanitizeSessionHistory()`

```
┌─────────────────────────────────────────────────────────────────────┐
│                    sanitizeSessionHistory()                          │
├─────────────────────────────────────────────────────────────────────┤
│  1. annotateInterSessionUserMessages()                               │
│     └── Mark messages from other sessions                            │
│                                                                      │
│  2. sanitizeSessionMessagesImages()                                  │
│     ├── Strip/encode images based on policy                          │
│     └── Sanitize tool call IDs if needed                             │
│                                                                      │
│  3. sanitizeAntigravityThinkingBlocks() [if Claude model]            │
│     └── Normalize thinking block format                              │
│                                                                      │
│  4. sanitizeToolCallInputs()                                         │
│     └── Drop tool calls with missing input                           │
│                                                                      │
│  5. sanitizeToolUseResultPairing() [if Anthropic/Google]             │
│     ├── Move tool results after tool calls                           │
│     ├── Insert synthetic error results for missing pairs             │
│     └── Drop orphan tool results                                     │
│                                                                      │
│  6. stripToolResultDetails()                                         │
│     └── Remove verbose tool result metadata                          │
│                                                                      │
│  7. downgradeOpenAIReasoningBlocks() [on model switch]               │
│     └── Convert reasoning blocks for non-OpenAI providers            │
│                                                                      │
│  8. applyGoogleTurnOrderingFix() [if Google]                         │
│     └── Prepend bootstrap user message if first is assistant         │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.3 Model Snapshot Tracking

To detect provider switches, the system tracks model snapshots in the transcript:

```typescript
type ModelSnapshotEntry = {
  timestamp: number;
  provider?: string;
  modelApi?: string | null;
  modelId?: string;
};

// Stored as custom entry in transcript:
// {"type":"custom","customType":"model-snapshot","data":{...}}
```

When a new request comes in, the system:
1. Reads last model snapshot from transcript
2. Compares with current model
3. If different → triggers model-switch-specific sanitization

## 3. Evolution Timeline

### Phase 1: Monolithic Sanitization (Early)

- All sanitization applied regardless of provider
- Caused unnecessary transformations
- Some providers rejected over-sanitized transcripts

### Phase 2: Provider-Gated Sanitization

**Commit `db0235a26`** - "fix: gate transcript sanitization by provider"

- Introduced `TranscriptPolicy` abstraction
- Each provider gets custom policy
- OpenAI skips most sanitization (flexible format)

```typescript
// Key insight: OpenAI is the most permissive
return {
  sanitizeMode: isOpenAi ? "images-only" : "full",
  repairToolUseResultPairing: !isOpenAi && (isGoogle || isAnthropic),
  // ...
};
```

### Phase 3: Model Switch Detection

**Commit `c97bf23a4`** - "fix: gate openai reasoning downgrade on model switches"

- Added `ModelSnapshotEntry` tracking
- Only apply conversion when model actually changes
- Prevents unnecessary reasoning block transformations

### Phase 4: Repair After Truncation

**Commit `43818e158`** - "fix: re-run tool_use pairing repair after history truncation"

- History truncation (DM limits, compaction) can break tool pairs
- Must re-run repair after any truncation operation

## 4. Key Design Decisions

### 4.1 Append-Only Transcript with Markers

Instead of modifying the stored transcript, OpenClaw:
- Keeps original messages unchanged on disk
- Applies transformations in-memory before LLM call
- Uses markers (compaction, model-snapshot) for context

**Rationale:** Preserves history integrity, enables audit trail

### 4.2 Synthetic Tool Results

When tool results are missing, the system inserts:

```typescript
{
  role: "toolResult",
  toolCallId: "<missing-id>",
  content: "[openclaw] missing tool result in session history...",
  isError: true,
}
```

**Rationale:** Strict providers (Anthropic, Google) reject orphan tool calls

### 4.3 Policy-Based Not Provider-Based

The system uses policies (what to do) not provider checks (who is calling):

```typescript
// ❌ Bad: Hardcoded provider checks everywhere
if (provider === "anthropic") { doX(); }
if (provider === "google") { doY(); }

// ✅ Good: Policy abstraction
const policy = resolveTranscriptPolicy({ provider, modelApi, modelId });
if (policy.repairToolUseResultPairing) { doRepair(); }
```

**Rationale:** 
- New providers only need policy definition
- Easier testing (mock policies, not providers)
- Clearer intent (what, not who)

## 5. Current Limitations & Future Directions

### 5.1 Limitations

1. **No rollback** - Model switch is one-way; can't restore original format
2. **Information loss** - Some sanitization drops data (e.g., thinking blocks → text)
3. **Compaction interaction** - Compaction summary loses tool call structure

### 5.2 Potential Improvements

1. **Canonical intermediate format** - Store messages in provider-agnostic format
2. **Lazy conversion** - Only convert at API call time, keep original
3. **Reversible transformations** - Store both original and converted

## 6. Related Files

| File | Purpose |
|------|---------|
| `src/agents/transcript-policy.ts` | Policy definitions |
| `src/agents/pi-embedded-runner/google.ts` | `sanitizeSessionHistory()` |
| `src/agents/session-transcript-repair.ts` | Tool pairing repair |
| `src/agents/pi-embedded-helpers/images.ts` | Image sanitization |
| `src/agents/pi-embedded-helpers/openai.ts` | OpenAI reasoning handling |
| `src/agents/tool-call-id.ts` | Tool call ID sanitization |

## 7. Key Commits

| Commit | Description |
|--------|-------------|
| `db0235a26` | Initial provider-gated sanitization |
| `c97bf23a4` | Model switch detection with snapshots |
| `43818e158` | Re-run repair after truncation |
| `1d2c5783f` | Enable tool call ID sanitization for Anthropic |
| `6f7478638` | Opus 4.6 forward-compat + thinking signature bypass |

## 8. Conclusion

OpenClaw's transcript-provider decoupling follows a **policy-based sanitization** approach:

1. **Detect** current provider/model from request
2. **Resolve** appropriate transcript policy
3. **Transform** messages through sanitization pipeline
4. **Track** model changes via snapshot markers

This design allows the same transcript to be used across providers while respecting each provider's format requirements.
