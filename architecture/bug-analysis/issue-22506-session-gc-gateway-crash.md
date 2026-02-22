# Issue #22506: Session GC Causes Gateway Crash

**Issue**: [#22506 - Session GC: No automatic cleanup of session files causes gateway timeout (1008)](https://github.com/openclaw/openclaw/issues/22506)

**Severity**: 🔴🔴🔴 Critical — Gateway becomes completely unresponsive

**Status**: No PR submitted

---

## Problem Summary

OpenClaw does not automatically clean up old session files (`*.jsonl`) or orphaned temporary files. Over time, this accumulation causes file lock timeouts, resulting in complete gateway failure with WebSocket 1008 errors.

---

## Reproduction Steps

1. Run OpenClaw with multiple active agents for several weeks
2. Let sessions accumulate without manual cleanup
3. Wait until sessions directory reaches ~200+ files
4. **Expected**: Normal operation continues
5. **Actual**: Gateway operations start timing out, returning `gateway closed (1008): pairing required`

**Observed metrics before failure**:
- 200+ session files per agent
- `sessions.json` growing to 925KB
- 48MB+ total in sessions directory

---

## Root Cause Analysis

### Filesystem Accumulation

Session files are created but never automatically deleted:

```
~/.openclaw/agents/<agentId>/sessions/
├── sessions.json              # 925KB - session registry
├── abc123.jsonl               # Active session transcript
├── def456.jsonl               # Old session (3 weeks ago)
├── ghi789.jsonl               # Old session (2 months ago)
├── .tmp-xyz                   # Orphaned temp file
├── .deleted.abc               # Orphaned deletion marker
├── def456.reset.jsonl         # Orphaned reset file
└── ... (200+ files)
```

### Lock Contention Flow

```mermaid
flowchart TD
    A[Incoming Message] --> B[withSessionStoreLock]
    B --> C{Acquire Lock}
    C -->|Success| D[Load sessions.json]
    D --> E[Process Request]
    E --> F[Release Lock]
    
    C -->|Queue Full| G[Wait in Queue]
    G --> H{10s Timeout?}
    H -->|Yes| I[lockTimeoutError]
    I --> J[WebSocket 1008 Error]
    
    H -->|No| K[Retry Acquire]
    K --> C
    
    subgraph "Large Directory Impact"
        L[fs.readFileSync] --> M[925KB JSON parse]
        M --> N[Iterate entries]
        N --> O[File lock held longer]
        O --> P[Queue builds up]
    end
    
    D --> L
    
    style I fill:#ff6b6b
    style J fill:#ff6b6b
</flowchart>
```

### Code Analysis

**Lock timeout** (`src/config/sessions/store.ts`):

```typescript
async function withSessionStoreLock<T>(
  storePath: string,
  fn: () => Promise<T>,
  opts: SessionStoreLockOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 10_000;  // ← Hardcoded 10s timeout
  // ...
}
```

**Lock queue processing** (`src/config/sessions/store.ts`):

```typescript
const remainingTimeoutMs = task.timeoutMs ?? Number.POSITIVE_INFINITY;
if (task.timeoutMs != null && remainingTimeoutMs <= 0) {
  task.reject(lockTimeoutError(storePath));  // ← Throws timeout error
  continue;
}
```

### Why 10 Seconds Isn't Enough

Under I/O load with large session stores:

| Operation | Time (normal) | Time (200+ files) |
|-----------|---------------|-------------------|
| `readFileSync` (925KB) | 5-10ms | 50-200ms |
| JSON.parse | 10-20ms | 100-500ms |
| Iterate + normalize | 20-50ms | 500-2000ms |
| Write back | 10-20ms | 100-500ms |
| **Total per operation** | ~50ms | ~1-3s |

With multiple concurrent requests queuing:
- 5 requests × 3s each = 15s total
- Requests 4-5 exceed 10s timeout → **crash**

---

## Impact

| Metric | Value |
|--------|-------|
| Affected deployments | Any running > few weeks |
| Recovery | Manual cleanup + restart |
| Detection | WebSocket 1008 errors |
| Data loss | No (sessions preserved) |
| Downtime | Until manual intervention |

---

## Fix Proposals

### Option A: Automatic Session GC (Cron-based)

**Location**: New file `src/infra/session-gc.ts` + integration in `src/gateway/server.ts`

**Approach**: Run periodic garbage collection to remove old session files.

```typescript
// src/infra/session-gc.ts
export interface SessionGCConfig {
  enabled: boolean;
  retentionDays: number;      // Default: 7
  runIntervalMs: number;      // Default: 6 hours
  cleanupOrphanedFiles: boolean;
}

export async function runSessionGC(agentDir: string, config: SessionGCConfig): Promise<void> {
  const sessionsDir = path.join(agentDir, "sessions");
  const cutoffMs = Date.now() - config.retentionDays * 24 * 60 * 60 * 1000;
  
  const files = await fs.readdir(sessionsDir);
  for (const file of files) {
    // Skip sessions.json
    if (file === "sessions.json") continue;
    
    // Remove old session transcripts
    if (file.endsWith(".jsonl")) {
      const stat = await fs.stat(path.join(sessionsDir, file));
      if (stat.mtimeMs < cutoffMs) {
        await fs.unlink(path.join(sessionsDir, file));
      }
    }
    
    // Remove orphaned temp/deleted/reset files
    if (config.cleanupOrphanedFiles) {
      if (file.startsWith(".tmp") || file.startsWith(".deleted") || file.includes(".reset.")) {
        await fs.unlink(path.join(sessionsDir, file));
      }
    }
  }
}
```

**Config schema**:
```json
{
  "sessions": {
    "gc": {
      "enabled": true,
      "retentionDays": 7,
      "runIntervalHours": 6,
      "cleanupOrphanedFiles": true
    }
  }
}
```

**Pros**:
- Addresses root cause (file accumulation)
- Configurable retention policy
- Non-breaking (opt-in)

**Cons**:
- Users may lose old sessions they wanted
- Needs careful scheduling to avoid I/O spikes
- Doesn't immediately fix existing bloated deployments

---

### Option B: Increase/Configurable Lock Timeout

**Location**: `src/config/sessions/store.ts`

**Approach**: Make the 10s timeout configurable and increase the default.

```typescript
// Before
const timeoutMs = opts.timeoutMs ?? 10_000;

// After
function getSessionLockTimeoutMs(): number {
  const envValue = process.env.OPENCLAW_SESSION_LOCK_TIMEOUT_MS;
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return loadConfig().sessions?.lockTimeoutMs ?? 30_000;  // New default: 30s
}

const timeoutMs = opts.timeoutMs ?? getSessionLockTimeoutMs();
```

**Config schema**:
```json
{
  "sessions": {
    "lockTimeoutMs": 30000
  }
}
```

**Pros**:
- Simple one-line fix for immediate relief
- Configurable per deployment
- No data loss risk

**Cons**:
- Doesn't address root cause
- Just delays the inevitable for very large deployments
- May mask other performance issues

---

### Option C: Lazy Session Store Loading

**Location**: `src/config/sessions/store.ts`

**Approach**: Instead of loading entire `sessions.json` into memory, use streaming/pagination.

```typescript
// Current: Load all sessions
export function loadSessionStore(storePath: string): Record<string, SessionEntry> {
  const raw = fs.readFileSync(storePath, "utf-8");
  return JSON.parse(raw);  // ← Parses entire 925KB at once
}

// Proposed: Lazy loading with session index
export class LazySessionStore {
  private index: Map<string, number>;  // sessionKey → file offset
  private cache: LRUCache<string, SessionEntry>;
  
  constructor(storePath: string) {
    this.index = this.buildIndex(storePath);
    this.cache = new LRUCache({ max: 100 });
  }
  
  get(sessionKey: string): SessionEntry | undefined {
    if (this.cache.has(sessionKey)) return this.cache.get(sessionKey);
    
    const offset = this.index.get(sessionKey);
    if (offset === undefined) return undefined;
    
    // Read only this session from disk
    const entry = this.readSessionAtOffset(offset);
    this.cache.set(sessionKey, entry);
    return entry;
  }
}
```

**Pros**:
- Dramatically reduces memory and I/O per operation
- Scales to very large session counts
- Better overall performance

**Cons**:
- Significant refactoring required
- Changes session store format
- Migration complexity for existing deployments

---

## Comparison Matrix

| Criteria | Option A (GC) | Option B (Timeout) | Option C (Lazy) |
|----------|---------------|--------------------|-----------------| 
| Implementation complexity | 🟡 Medium | 🟢 Low | 🔴 High |
| Addresses root cause | ✅ Yes | ❌ No | ✅ Yes |
| Immediate relief | ❌ No | ✅ Yes | ❌ No |
| Risk of regression | 🟢 Low | 🟢 Low | 🟡 Medium |
| Data loss risk | 🟡 Configurable | ✅ None | ✅ None |
| Long-term scalability | 🟡 Medium | ❌ Poor | ✅ Excellent |

---

## Recommendation

**Implement Option B first, then Option A.**

**Rationale**:
1. Option B provides immediate relief with minimal risk (change default from 10s → 30s)
2. Option A addresses the root cause and should be the proper fix
3. Both are complementary — GC keeps directories small, timeout provides safety margin
4. Option C is the ideal long-term solution but requires significant investment

**Suggested Implementation Order**:
1. PR #1: Option B — Increase default timeout to 30s, make configurable
2. PR #2: Option A — Add session GC with configurable retention
3. Future: Option C — Lazy loading for very large deployments

**Workaround for affected users now**:
```bash
# Add to crontab - runs daily at 3am
0 3 * * * find ~/.openclaw/agents/*/sessions -name "*.jsonl" -mtime +7 -delete
0 3 * * * find ~/.openclaw/agents/*/sessions \( -name "*.tmp" -o -name ".deleted.*" -o -name "*.reset.*" \) -delete
```

---

## Related Issues

- #18194 — Compaction timeout causes session loss
- #20910 — Model timeout death spiral  
- #18700 — Session JSONL archival/retention policy

---

## References

- `src/config/sessions/store.ts` — Session store implementation
- `src/agents/session-write-lock.ts` — File locking mechanism
- `src/gateway/session-utils.fs.ts` — Session file utilities
