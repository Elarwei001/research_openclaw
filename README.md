# OpenClaw Research

> Deep dive into OpenClaw architecture and internals

📖 **Live Site**: https://elarwei001.github.io/research_openclaw/

This repository documents the internal workings of [OpenClaw](https://github.com/openclaw/openclaw), an AI agent framework. The goal is to understand its architecture through code analysis, issue investigation, and hands-on experimentation.

## Quick Navigation

| Module | Description | Status |
|--------|-------------|--------|
| [Session](modules/session/README.md) | Session lifecycle, caching, persistence | 📝 Active |
| [Agent](modules/agent/README.md) | Agent runtime, model switching, transcript | 📝 Active |
| [Channels](modules/channels/README.md) | Telegram, Discord, WhatsApp integration | 🔍 Basic |
| [Gateway](modules/gateway/README.md) | HTTP/WebSocket server | 🔍 Basic |
| [Memory](modules/memory/README.md) | Memory indexing and retrieval | 🔍 Basic |
| [Plugins](modules/plugins/README.md) | Plugin system and hooks | 🔍 Basic |
| [Security](modules/security/README.md) | Authentication and pairing | 🔍 Basic |
| [Browser](modules/browser/README.md) | Browser automation | 🔍 Basic |

## Issue Analysis

Real-world bug investigations with root cause analysis and fix proposals:

| Issue | Module | Severity | PR Status | Analysis |
|-------|--------|----------|-----------|----------|
| [#20910](modules/session/issues/20910-timeout-spiral.md) | Session | 🔴 Critical | ✅ [#20911](https://github.com/openclaw/openclaw/pull/20911) | Model timeout death spiral |
| [#22506](modules/session/issues/22506-gc-crash.md) | Session | 🔴 Critical | ❌ None | Session GC causes gateway crash |
| [#18194](modules/session/issues/18194-compaction-timeout.md) | Session | 🔴 Critical | ❌ None | Compaction timeout loses session |

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Gateway Server                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│  │Telegram │  │ Discord │  │WhatsApp │  │ WebChat │        │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘        │
│       └────────────┴────────────┴────────────┘              │
│                          │                                   │
│                    ┌─────▼─────┐                            │
│                    │  Router   │                            │
│                    └─────┬─────┘                            │
│                          │                                   │
│  ┌───────────────────────▼───────────────────────┐         │
│  │               Session Manager                  │         │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐       │         │
│  │  │ Store   │  │ Cache   │  │Compactor│       │         │
│  │  └─────────┘  └─────────┘  └─────────┘       │         │
│  └───────────────────────┬───────────────────────┘         │
│                          │                                   │
│                    ┌─────▼─────┐                            │
│                    │   Agent   │                            │
│                    │  Runtime  │                            │
│                    └─────┬─────┘                            │
│                          │                                   │
│  ┌───────────┬───────────┼───────────┬───────────┐         │
│  │  Memory   │  Plugins  │   Tools   │  Browser  │         │
│  └───────────┴───────────┴───────────┴───────────┘         │
└─────────────────────────────────────────────────────────────┘
```

## Contributing

This is a personal research project. Feel free to open issues for questions or suggestions.

## License

Documentation content is MIT licensed. OpenClaw itself is licensed under its own terms.
