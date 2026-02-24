# Agent-to-Agent Communication Mirror

## Background

When multiple OpenClaw agents collaborate in the same Telegram group, the following problems arise:

1. **Telegram platform limitation**: Bots cannot see messages sent by other bots
2. **Opaque private communication**: `sessions_send` enables cross-agent communication, but users have no visibility
3. **Tedious dual-sending**: Currently requires manual "dual-send" (private sessions_send + public group message)

## Existing Related Work

### Issue #15760 (Highly Relevant)

> **feat: relay outbound group messages between co-located agents (Telegram bot-to-bot blindness)**
> https://github.com/openclaw/openclaw/issues/15760

This issue proposes a **Gateway-Level Outbound Relay** solution:

```
Agent A sends message to group → Gateway auto-injects system event into Agent B's session
```

Core design:
- Uses `enqueueSystemEvent()` to inject context without triggering auto-reply
- Deduplication via `contextKey`
- Supports per-group/per-account configuration

**Status**: OPEN, no assignee, detailed design complete, awaiting implementation

### Other Related Issues

| Issue | Description | Relevance |
|-------|-------------|-----------|
| #6842 | A2A Protocol Support | 🟡 General protocol layer |
| #11199 | Discord bot-to-bot filtering | 🟡 Similar problem on Discord |
| #22160 | sessions_history cross-agent access issues | 🟢 Permission related |

## Supplementary Requirement: sessions_send Mirror

Issue #15760 solves **group message visibility**, but doesn't cover **`sessions_send` transparency**.

### Scenario

```
Arae (sessions_send) → Aha: "Help check PR #123"
Aha (sessions_send) → Arae: "PR has been merged"
```

The user (Elar) has no visibility into this conversation.

### Proposed Extension

Add a `mirror` option in the `tools.agentToAgent` configuration:

```yaml
tools:
  agentToAgent:
    enabled: true
    allow: ["*"]
    mirror:
      enabled: true
      channel: telegram
      target: "-1003607814514"  # Specify group ID
      format: "🔗 [{source}→{target}] {message}"
```

### Implementation Approach

1. **Post-send hook for sessions_send**
   - After successful `callGateway` in `sessions-send-tool.ts`
   - Automatically call message tool to send to mirror target

2. **Inter-session reply hook**
   - After agent replies to a message with `provenance.kind === "inter_session"`
   - Automatically mirror the reply content

3. **Configuration inheritance**
   - Global config `tools.agentToAgent.mirror`
   - Can be overridden at agent level

### Relationship with #15760

| Feature | #15760 | This Proposal |
|---------|--------|---------------|
| Solve in-group bot invisibility | ✅ | ❌ |
| Transparent sessions_send | ❌ | ✅ |
| Auto mirror | system event | message |

The two are complementary and can be implemented together.

## Recommended Implementation Path

### Phase 1: Implement #15760 First
- Gateway-level outbound relay
- Solve bot-to-bot blindness
- Let agents see each other's group messages

### Phase 2: Extend sessions_send Mirror
- Add `tools.agentToAgent.mirror` configuration
- Let users observe cross-agent private communications

### Phase 3: Unified UI
- Control Panel displays agent collaboration graph
- Visualize sessions_send flow

## Open Questions

1. **Mirror permissions**: Who has access to see the mirror? Currently assuming group members
2. **Sensitive information**: Should certain sessions_send content be filtered?
3. **Formatting**: How to standardize the mirror message format?
4. **Performance**: Will high-frequency sessions_send cause message flooding?

## References

- [sessions-send-tool.ts](https://github.com/openclaw/openclaw/blob/main/src/agents/tools/sessions-send-tool.ts)
- [sessions-send-helpers.ts](https://github.com/openclaw/openclaw/blob/main/src/agents/tools/sessions-send-helpers.ts)
- [Issue #15760 - bot-to-bot blindness](https://github.com/openclaw/openclaw/issues/15760)

---

*Written by Arae, 2026-02-22*
*Source: Discussion with Elar, research on OpenClaw source code and GitHub Issues*
