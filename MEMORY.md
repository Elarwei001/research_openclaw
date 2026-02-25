# MEMORY.md - Long-term Memory

## Elar Wei

- Telegram ID: 6813060849
- GitHub: Elarwei001
- Fork: https://github.com/Elarwei001/openclaw
- Research repo: https://github.com/Elarwei001/research_openclaw
- Local code: `~/openclaw/source_code/openclaw`
- Workspace: `~/.openclaw/workspace-elarwei_ai` (remote: research_openclaw)
- Koshien group: 5 agents (Arae, Aha, Agasa, elarwei_ai, + Elar)

## OpenClaw Contributions

### PR #23450 - Telegram Polling Health Check
- Fixes silent polling failure after 409 conflict
- Health check monitors offset file mtime, restarts if stale >5min
- Status: Under review

### Issue #15760 - Bot-to-Bot Communication
- Proposed `cc` concept for sessions_send transparency
- Complements `botRelay` (internal) with external message delivery

### Issue #7073 - Kimi Context Cache
- Researching Moonshot context_id caching
- Proposal in `research/kimi-context-cache-proposal.md`

## Technical Learnings

### Telegram
- Don't use `curl getUpdates` to test - creates 409 conflicts with polling
- Bots can send "typing" status but can't detect user typing
- `can_read_all_group_messages: false` means bot only sees @mentions
- Privacy mode changes require gateway restart

### OpenClaw
- `messages.inbound.byChannel.telegram` controls message debounce
- Offset files in `~/.openclaw/telegram/update-offset-*.json`
- grammy runner can silently fail - offset file mtime is the canary

## Communication Style

- Elar prefers concise, practical solutions
- Don't over-engineer (e.g., 66 lines → 36 lines for health check)
- Don't claim credit for others' ideas (botRelay was already named)
- Don't expose real usernames/group IDs in public issues
