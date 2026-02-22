# Agent-to-Agent Communication Mirror

## 背景

当多个 OpenClaw agent 在同一个 Telegram 群里协作时，存在以下问题：

1. **Telegram 平台限制**：Bot 无法看到其他 Bot 发的消息
2. **私密通信不透明**：`sessions_send` 实现了跨 agent 通信，但用户无法感知
3. **双发繁琐**：目前需要手动"双发"（私下 sessions_send + 群里公开发消息）

## 现有相关工作

### Issue #15760 (高度相关)

> **feat: relay outbound group messages between co-located agents (Telegram bot-to-bot blindness)**
> https://github.com/openclaw/openclaw/issues/15760

该 issue 提出了 **Gateway-Level Outbound Relay** 方案：

```
Agent A 发消息到群 → Gateway 自动注入 system event 到 Agent B 的 session
```

核心设计：
- 使用 `enqueueSystemEvent()` 注入上下文，不触发自动回复
- 通过 `contextKey` 去重
- 支持 per-group/per-account 配置

**状态**：OPEN，无 assignee，详细设计已完成，等待实现

### 其他相关 Issues

| Issue | 描述 | 相关度 |
|-------|------|--------|
| #6842 | A2A Protocol Support | 🟡 通用协议层 |
| #11199 | Discord bot-to-bot filtering | 🟡 类似问题在 Discord |
| #22160 | sessions_history cross-agent access issues | 🟢 权限相关 |

## 补充需求：sessions_send Mirror

Issue #15760 解决了 **群消息的可见性**，但没有覆盖 **`sessions_send` 的透明度**。

### 场景

```
Arae (sessions_send) → Aha: "帮忙查 PR #123"
Aha (sessions_send) → Arae: "PR 已合并"
```

用户（Elar）完全看不到这个对话。

### 提议扩展

在 `tools.agentToAgent` 配置中增加 `mirror` 选项：

```yaml
tools:
  agentToAgent:
    enabled: true
    allow: ["*"]
    mirror:
      enabled: true
      channel: telegram
      target: "-1003607814514"  # 指定群 ID
      format: "🔗 [{source}→{target}] {message}"
```

### 实现思路

1. **sessions_send 发送后 hook**
   - 在 `sessions-send-tool.ts` 的 `callGateway` 成功后
   - 自动调用 message tool 发送到 mirror target

2. **inter_session 回复 hook**
   - 在 agent 回复带有 `provenance.kind === "inter_session"` 的消息后
   - 自动 mirror 回复内容

3. **配置继承**
   - 全局配置 `tools.agentToAgent.mirror`
   - 可被 agent 级别覆盖

### 与 #15760 的关系

| 功能 | #15760 | 本提议 |
|------|--------|--------|
| 解决群内 bot 互相看不见 | ✅ | ❌ |
| 透明化 sessions_send | ❌ | ✅ |
| 自动 mirror | system event | message |

两者互补，可以一起实现。

## 推荐实现路径

### Phase 1: 先实现 #15760
- Gateway-level outbound relay
- 解决 bot-to-bot blindness
- 让 agent 能看到彼此的群消息

### Phase 2: 扩展 sessions_send mirror
- 新增 `tools.agentToAgent.mirror` 配置
- 让用户能围观跨 agent 的私密通信

### Phase 3: 统一 UI
- Control Panel 显示 agent 协作图
- 可视化 sessions_send 流向

## 开放问题

1. **Mirror 权限**：谁有权看到 mirror？目前假设是群成员
2. **敏感信息**：是否需要 filter 某些 sessions_send 内容？
3. **格式化**：mirror 消息的格式如何标准化？
4. **性能**：高频 sessions_send 是否会造成群消息刷屏？

## 参考

- [sessions-send-tool.ts](https://github.com/openclaw/openclaw/blob/main/src/agents/tools/sessions-send-tool.ts)
- [sessions-send-helpers.ts](https://github.com/openclaw/openclaw/blob/main/src/agents/tools/sessions-send-helpers.ts)
- [Issue #15760 - bot-to-bot blindness](https://github.com/openclaw/openclaw/issues/15760)

---

*Written by Arae, 2026-02-22*
*Source: 与 Elar 的讨论，调研 OpenClaw 源码和 GitHub Issues*
