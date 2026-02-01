---
title: "Communication Channels Component"
description: "The Communication Channels component provides unified messaging integration across 20+ platforms, enabling AI agents to "
---


## Overview

The Communication Channels component provides unified messaging integration across 20+ platforms, enabling AI agents to interact seamlessly with users through their preferred communication methods. This component abstracts platform-specific implementations behind a common interface.

**Locations:** 
- Core: `src/channels/`, `src/telegram/`, `src/discord/`, `src/slack/`, etc.
- Extensions: `extensions/*/` (Matrix, Teams, Zalo, etc.)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Communication Channels                       │
├─────────────────┬─────────────────┬─────────────────────────────┤
│  Channel Core   │  Built-in       │  Extension Channels         │
│                 │  Channels (7)   │  (13+)                     │
├─────────────────┼─────────────────┼─────────────────────────────┤
│ • Registry      │ • WhatsApp      │ • Matrix                    │
│ • Router        │ • Telegram      │ • MS Teams                  │
│ • Allowlists    │ • Discord       │ • Zalo/ZaloUser            │
│ • Mentions      │ • Slack         │ • Twitch                    │
│ • Typing        │ • Signal        │ • Voice Call                │
│ • Reactions     │ • iMessage      │ • Nostr                     │
│ • Location      │ • Google Chat   │ • BlueBubbles               │
│                 │                 │ • Nextcloud Talk            │
│                 │                 │ • Tlon/Urbit                │
│                 │                 │ • Mattermost                │
│                 │                 │ • LINE                      │
└─────────────────┴─────────────────┴─────────────────────────────┘
          │                         │                         │
          └─────────────────────────┼─────────────────────────┘
                                    │
┌─────────────────────────────────────────────────────────────────┐
│              Unified Message Processing                         │
├─────────────────┬─────────────────┬─────────────────────────────┤
│   Inbound       │   Processing    │   Outbound                  │
├─────────────────┼─────────────────┼─────────────────────────────┤
│ • Normalization │ • Agent Router  │ • Format Adaptation         │
│ • Validation    │ • Allowlists    │ • Platform Limits           │
│ • Media Staging │ • Group Policy  │ • Media Processing          │
│ • Rate Limiting │ • Command Parse │ • Delivery Tracking         │
└─────────────────┴─────────────────┴─────────────────────────────┘
```

## Core Channel System

### 1. Channel Registry (`src/channels/registry.ts`)

Central registration and discovery system for all communication channels.

```typescript
interface ChannelMeta {
  id: string;
  label: string;
  docsPath: string;
  blurb: string;
  systemImage: string;
}

interface ChannelPlugin {
  id: string;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities[];
  monitor: ChannelMonitor;
  sender: ChannelSender;
}

class ChannelRegistry {
  registerChannel(plugin: ChannelPlugin): void
  unregisterChannel(channelId: string): void
  getChannel(channelId: string): ChannelPlugin | null
  listChannels(): ChannelPlugin[]
  findChannelByAlias(alias: string): ChannelPlugin | null
}
```

**Supported Channels:**
```typescript
const CHAT_CHANNEL_ORDER = [
  "telegram",    // Telegram Bot API
  "whatsapp",    // WhatsApp Web (QR pairing)
  "discord",     // Discord Bot API
  "googlechat",  // Google Chat API
  "slack",       // Slack Socket Mode
  "signal",      // signal-cli REST API
  "imessage",    // iMessage (macOS only)
] as const;
```

### 2. Message Router (`src/auto-reply/dispatch.ts`)

Intelligent routing system that determines how messages should be processed and where responses should be delivered.

```typescript
interface RoutingRule {
  pattern: RegExp | string;
  channels: string[];
  allowFrom?: string[];
  denyFrom?: string[];
  requireMention?: boolean;
  priority: number;
}

interface MessageContext {
  channelId: string;
  senderId: string;
  conversationId: string;
  isGroup: boolean;
  isMention: boolean;
  isReply: boolean;
  platform: string;
}

class MessageRouter {
  route(message: InboundMessage): Promise<RoutingDecision>
  addRule(rule: RoutingRule): void
  removeRule(ruleId: string): void
  evaluateAllowlist(context: MessageContext): boolean
  shouldProcessMessage(message: InboundMessage): boolean
}
```

### 3. Channel Monitor Interface

Base interface that all channels must implement for receiving messages.

```typescript
interface ChannelMonitor {
  start(): Promise<void>
  stop(): Promise<void>
  isRunning(): boolean
  getStatus(): ChannelStatus
  onMessage(handler: MessageHandler): void
  onError(handler: ErrorHandler): void
}

interface InboundMessage {
  id: string;
  channelId: string;
  senderId: string;
  conversationId: string;
  content: MessageContent;
  metadata: MessageMetadata;
  timestamp: Date;
}

interface MessageContent {
  text?: string;
  media?: MediaAttachment[];
  location?: LocationData;
  contact?: ContactData;
  reply?: ReplyContext;
}
```

### 4. Channel Sender Interface

Base interface for sending messages through channels.

```typescript
interface ChannelSender {
  sendMessage(target: MessageTarget, content: OutboundMessage): Promise<SendResult>
  sendTyping(target: MessageTarget, duration?: number): Promise<void>
  sendReaction(target: MessageTarget, reaction: Reaction): Promise<void>
  uploadMedia(media: MediaFile): Promise<MediaUploadResult>
  getCapabilities(): ChannelCapabilities
}

interface OutboundMessage {
  text?: string;
  media?: MediaAttachment[];
  formatting?: MessageFormatting;
  metadata?: Record<string, any>;
  replyTo?: string;
}

interface ChannelCapabilities {
  supportsFormatting: boolean;
  supportsMedia: boolean;
  supportsReactions: boolean;
  supportsTyping: boolean;
  supportsLocation: boolean;
  supportsGroups: boolean;
  maxMessageLength: number;
  supportedMediaTypes: string[];
}
```

## Built-in Channel Implementations

### 1. WhatsApp Web Integration (`src/channel-web.ts`)

Uses Playwright to automate WhatsApp Web interface with QR code pairing.

```typescript
interface WhatsAppConfig {
  enabled: boolean;
  profileName: string;
  qrCodeTimeout: number;
  sessionPath: string;
  messageRetention: number;
}

class WhatsAppMonitor implements ChannelMonitor {
  private browser: Browser;
  private page: Page;
  
  async start(): Promise<void> {
    await this.launchBrowser();
    await this.navigateToWhatsApp();
    await this.handleQRCode();
    await this.startMessageMonitoring();
  }
  
  private async handleQRCode(): Promise<void>
  private async scanMessages(): Promise<InboundMessage[]>
  private async sendMessage(target: string, message: string): Promise<void>
}
```

**Features:**
- QR code automatic scanning and pairing
- Multi-device support with session persistence
- Media message handling (images, documents, audio)
- Group conversation support
- Contact and location sharing

### 2. Telegram Bot (`src/telegram/`)

Official Telegram Bot API integration with webhook and polling support.

```typescript
interface TelegramConfig {
  botToken: string;
  webhook?: {
    url: string;
    secretToken: string;
    maxConnections: number;
  };
  polling?: {
    timeout: number;
    limit: number;
  };
  allowedUsers: string[];
  allowedGroups: string[];
}

class TelegramMonitor implements ChannelMonitor {
  private bot: Bot;
  private updates: UpdateHandler;
  
  async start(): Promise<void> {
    await this.initializeBot();
    await this.setupHandlers();
    await this.startPolling(); // or setupWebhook()
  }
  
  private setupHandlers(): void {
    this.bot.on('message', this.handleMessage.bind(this));
    this.bot.on('callback_query', this.handleCallback.bind(this));
    this.bot.on('inline_query', this.handleInlineQuery.bind(this));
  }
}
```

**Features:**
- Bot API with full feature support
- Inline keyboards and custom commands
- File uploads and media processing
- Group administration capabilities
- Webhook and polling modes

### 3. Discord Bot (`src/discord/`)

Discord.js integration with guild management and slash commands.

```typescript
interface DiscordConfig {
  botToken: string;
  clientId: string;
  guildId?: string;
  intents: GatewayIntentBits[];
  allowedChannels: string[];
  allowedUsers: string[];
  allowedRoles: string[];
}

class DiscordMonitor implements ChannelMonitor {
  private client: Client;
  
  async start(): Promise<void> {
    await this.initializeClient();
    await this.registerCommands();
    await this.login();
  }
  
  private async handleMessage(message: Message): Promise<void>
  private async handleInteraction(interaction: Interaction): Promise<void>
  private async registerCommands(): Promise<void>
}
```

**Features:**
- Slash commands and context menus
- Server and channel management
- Role-based access control
- Voice channel integration
- Rich embeds and attachments

### 4. Slack Integration (`src/slack/`)

Slack Socket Mode for real-time messaging without webhook setup.

```typescript
interface SlackConfig {
  botToken: string;
  appToken: string;
  signingSecret: string;
  socketMode: boolean;
  allowedChannels: string[];
  allowedUsers: string[];
}

class SlackMonitor implements ChannelMonitor {
  private app: App;
  private socket: SocketModeReceiver;
  
  async start(): Promise<void> {
    await this.initializeApp();
    await this.setupEventHandlers();
    await this.startSocketMode();
  }
  
  private async handleMessage(event: MessageEvent): Promise<void>
  private async handleAppMention(event: AppMentionEvent): Promise<void>
}
```

**Features:**
- Socket Mode for real-time communication
- Block Kit UI components
- Workflow and automation integration
- Enterprise Grid support
- App Home and modals

## Extension Channel Examples

### 1. Matrix Integration (`extensions/matrix/`)

Decentralized communication protocol support with end-to-end encryption.

```typescript
interface MatrixConfig {
  homeserver: string;
  userId: string;
  accessToken?: string;
  deviceId?: string;
  encryption: {
    enabled: boolean;
    storePath: string;
  };
  allowedRooms: string[];
  autoJoin: boolean;
}

class MatrixChannel implements ChannelPlugin {
  private client: MatrixClient;
  private crypto: MatrixCrypto;
  
  async initialize(config: MatrixConfig): Promise<void> {
    this.client = sdk.createClient({
      baseUrl: config.homeserver,
      userId: config.userId,
      accessToken: config.accessToken,
      deviceId: config.deviceId
    });
    
    if (config.encryption.enabled) {
      await this.setupEncryption();
    }
  }
  
  private async setupEncryption(): Promise<void>
  private async handleRoomMessage(event: MatrixEvent): Promise<void>
}
```

### 2. Microsoft Teams (`extensions/msteams/`)

Microsoft Graph API integration for Teams messaging.

```typescript
interface TeamsConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  scopes: string[];
  allowedTeams: string[];
  allowedChannels: string[];
}

class TeamsChannel implements ChannelPlugin {
  private graphClient: Client;
  private subscription: Subscription;
  
  async initialize(config: TeamsConfig): Promise<void> {
    this.graphClient = Client.init({
      authProvider: new ClientCredentialProvider(config)
    });
    
    await this.setupChangeNotifications();
  }
  
  private async setupChangeNotifications(): Promise<void>
  private async handleMessage(notification: ChangeNotification): Promise<void>
}
```

### 3. Voice Call Integration (`extensions/voice-call/`)

Telephony integration with multiple VoIP providers.

```typescript
interface VoiceCallConfig {
  provider: 'twilio' | 'plivo' | 'telnyx';
  credentials: ProviderCredentials;
  phoneNumbers: string[];
  sttProvider: 'openai' | 'deepgram' | 'azure';
  ttsProvider: 'openai' | 'elevenlabs' | 'azure';
  webhook: {
    url: string;
    secret: string;
  };
}

class VoiceCallChannel implements ChannelPlugin {
  private provider: VoiceProvider;
  private stt: SpeechToText;
  private tts: TextToSpeech;
  
  async handleIncomingCall(call: IncomingCall): Promise<void> {
    const audioStream = await this.acceptCall(call);
    const textStream = await this.stt.transcribe(audioStream);
    
    for await (const text of textStream) {
      const response = await this.processMessage(text);
      const audio = await this.tts.synthesize(response);
      await this.playAudio(call, audio);
    }
  }
}
```

## Message Processing Pipeline

### 1. Inbound Message Flow

```typescript
interface MessageProcessor {
  process(message: RawMessage): Promise<ProcessedMessage>
}

class InboundProcessor implements MessageProcessor {
  async process(message: RawMessage): Promise<ProcessedMessage> {
    // 1. Normalize platform-specific format
    const normalized = await this.normalize(message);
    
    // 2. Validate message content
    const validated = await this.validate(normalized);
    
    // 3. Extract and stage media
    const withMedia = await this.processMedia(validated);
    
    // 4. Apply rate limiting
    await this.applyRateLimit(withMedia);
    
    // 5. Check allowlists and permissions
    const authorized = await this.authorize(withMedia);
    
    return authorized;
  }
  
  private async normalize(message: RawMessage): Promise<NormalizedMessage>
  private async validate(message: NormalizedMessage): Promise<ValidatedMessage>
  private async processMedia(message: ValidatedMessage): Promise<MediaProcessedMessage>
  private async authorize(message: MediaProcessedMessage): Promise<ProcessedMessage>
}
```

### 2. Outbound Message Flow

```typescript
class OutboundProcessor {
  async send(message: OutboundMessage, target: MessageTarget): Promise<SendResult> {
    // 1. Format for target platform
    const formatted = await this.formatForPlatform(message, target.platform);
    
    // 2. Apply platform limits
    const constrained = await this.applyConstraints(formatted, target.platform);
    
    // 3. Process media attachments
    const withMedia = await this.processMediaAttachments(constrained);
    
    // 4. Send through channel
    const result = await this.deliverMessage(withMedia, target);
    
    // 5. Track delivery
    await this.trackDelivery(result);
    
    return result;
  }
  
  private async formatForPlatform(message: OutboundMessage, platform: string): Promise<FormattedMessage>
  private async applyConstraints(message: FormattedMessage, platform: string): Promise<ConstrainedMessage>
  private async deliverMessage(message: ProcessedOutboundMessage, target: MessageTarget): Promise<SendResult>
}
```

## Security & Access Control

### 1. Allowlist Management (`src/channels/allowlist-match.ts`)

```typescript
interface AllowlistConfig {
  mode: 'whitelist' | 'blacklist' | 'mixed';
  users: AllowlistEntry[];
  groups: AllowlistEntry[];
  channels: AllowlistEntry[];
  globalRules: GlobalRule[];
}

interface AllowlistEntry {
  id: string;
  pattern?: RegExp;
  channels?: string[];
  permissions: Permission[];
  expires?: Date;
}

class AllowlistManager {
  isAllowed(context: MessageContext): boolean
  addEntry(entry: AllowlistEntry): void
  removeEntry(entryId: string): void
  updatePermissions(entryId: string, permissions: Permission[]): void
}
```

### 2. Rate Limiting

```typescript
interface RateLimitConfig {
  messagesPerMinute: number;
  messagesPerHour: number;
  burstLimit: number;
  cooldownPeriod: number;
}

class RateLimiter {
  async checkLimit(senderId: string, channelId: string): Promise<RateLimitResult>
  async recordMessage(senderId: string, channelId: string): Promise<void>
  async resetLimits(senderId: string): Promise<void>
}
```

## Monitoring & Health Checks

### 1. Channel Health Monitoring

```typescript
interface ChannelHealth {
  channelId: string;
  status: 'online' | 'degraded' | 'offline';
  lastMessage: Date;
  messageCount: number;
  errorRate: number;
  latency: number;
  connectivity: ConnectivityStatus;
}

class ChannelMonitor {
  getHealth(channelId: string): Promise<ChannelHealth>
  checkConnectivity(channelId: string): Promise<boolean>
  measureLatency(channelId: string): Promise<number>
  getErrorRate(channelId: string, timeWindow: number): Promise<number>
}
```

### 2. Message Metrics

```typescript
interface MessageMetrics {
  totalReceived: number;
  totalSent: number;
  averageLatency: number;
  errorRate: number;
  topChannels: ChannelUsage[];
  peakHours: HourlyUsage[];
}
```

## Configuration Examples

### Multi-Channel Setup

```yaml
channels:
  telegram:
    enabled: true
    botToken: "${TELEGRAM_BOT_TOKEN}"
    allowedUsers: ["@username", "123456789"]
    allowedGroups: ["@groupname"]
    
  discord:
    enabled: true
    botToken: "${DISCORD_BOT_TOKEN}"
    guildId: "123456789"
    allowedChannels: ["general", "bot-commands"]
    
  whatsapp:
    enabled: true
    profileName: "OpenClaw Bot"
    sessionPath: "~/.openclaw/whatsapp-session"
    
  matrix:
    enabled: true
    homeserver: "https://matrix.org"
    userId: "@bot:matrix.org"
    allowedRooms: ["!room:matrix.org"]
    encryption:
      enabled: true
      
routing:
  allowFrom:
    channels: ["telegram", "discord"]
    users: ["trusted_user_1", "trusted_user_2"]
  
  denyFrom:
    users: ["blocked_user"]
    
  rules:
    - pattern: "!urgent"
      priority: high
      channels: ["telegram"]
    - pattern: "@bot"
      requireMention: true
```

This Communication Channels component enables OpenClaw to operate across diverse messaging ecosystems, providing users with flexible access to AI agents through their preferred platforms while maintaining security, reliability, and consistent functionality.