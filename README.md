# OpenClaw Research

Research documentation and analysis of OpenClaw's architecture and implementation.

🌐 **Live Site**: [Coming soon on Vercel]

## Contents

### Memory System
- [Memory System Architecture](src/content/docs/architecture/memory/openclaw-memory-system-architecture.md) - Comprehensive analysis of OpenClaw's memory system design
- [Memory Indexing Mechanisms](src/content/docs/architecture/memory/memory-indexing-mechanisms.md) - How workspace files get indexed into SQLite

### Security
- [Pairing Mechanism](src/content/docs/architecture/security/pairing-mechanism.md) - DM policy enforcement and owner approval workflows

## Development

This site is built with [Astro](https://astro.build) + [Starlight](https://starlight.astro.build).

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Build for production
pnpm build
```

## Deployment

This site auto-deploys to Vercel on every push to `main`.

## Contributing

Contributions welcome! Add new documentation as markdown files in `src/content/docs/`.

## Related Links

- [OpenClaw Main Repository](https://github.com/openclaw/openclaw)
- [OpenClaw Documentation](https://docs.openclaw.ai)
