---
title: "Agent Runtime Component"
description: "The Agent Runtime System is the brain of OpenClaw, responsible for executing AI agent conversations, managing model inte"
---


## Overview

The Agent Runtime System is the brain of OpenClaw, responsible for executing AI agent conversations, managing model integrations, handling tool execution, and maintaining conversation context across multiple AI providers.

**Location:** `src/agents/`

## Core Responsibilities

1. **AI Model Integration**: Multi-provider AI model support with failover
2. **Session Management**: Conversation state and context management
3. **Tool Execution**: Sandboxed environment for running user tools and scripts
4. **Memory System**: Context-aware memory retrieval and storage
5. **Authentication Profiles**: Multi-provider authentication with rotation
6. **Response Generation**: Streaming and non-streaming response handling

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Agent Runtime System                       │
├─────────────────┬─────────────────┬─────────────────────────┤
│ Model Manager   │ Session Manager │ Tool Engine             │
├─────────────────┼─────────────────┼─────────────────────────┤
│ • 15+ Providers │ • Conversation  │ • Sandboxed Execution   │
│ • Failover      │   State         │ • Docker Containers     │
│ • Load Balance  │ • Context Mgmt  │ • Resource Limits       │
├─────────────────┼─────────────────┼─────────────────────────┤
│ Auth Profiles   │ Memory System   │ Response Generator      │
├─────────────────┼─────────────────┼─────────────────────────┤
│ • Multi-Auth    │ • Vector Search │ • Stream Processing     │
│ • Auto Rotation │ • Embeddings    │ • Format Adaptation     │
│ • Cooldowns     │ • Context Aware │ • Error Handling        │
└─────────────────┴─────────────────┴─────────────────────────┘
```

## Key Components

### 1. Agent Runner (`src/agents/pi-embedded-runner.ts`)

The core agent execution engine that orchestrates the entire conversation flow.

```typescript
interface AgentRunOptions {
  sessionId: string;
  agentId: string;
  message: string;
  context?: Record<string, any>;
  streaming?: boolean;
}

class PiEmbeddedRunner {
  async runAgent(options: AgentRunOptions): Promise<AgentResponse>
  async streamAgent(options: AgentRunOptions): AsyncGenerator<AgentChunk>
  private selectModel(preferences: ModelPreferences): Promise<ModelInstance>
  private buildContext(sessionId: string): Promise<ConversationContext>
  private executeTools(toolCalls: ToolCall[]): Promise<ToolResult[]>
}
```

**Features:**
- Multi-provider model selection with failover
- Streaming and non-streaming response generation
- Context window management and optimization
- Tool execution coordination
- Error handling and recovery

### 2. Model Management (`src/agents/model-catalog.ts`, `src/agents/model-selection.ts`)

Comprehensive AI model provider integration with intelligent selection.

```typescript
interface ModelProvider {
  id: string;
  name: string;
  baseUrl?: string;
  apiKey: string;
  models: ModelDefinition[];
  capabilities: ModelCapabilities[];
}

interface ModelDefinition {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  pricing: ModelPricing;
  capabilities: ModelCapabilities[];
}

class ModelCatalog {
  listProviders(): ModelProvider[]
  listModels(providerId?: string): ModelDefinition[]
  selectBestModel(requirements: ModelRequirements): ModelDefinition
  validateModel(modelId: string): Promise<boolean>
}
```

**Supported Providers:**
- **OpenAI**: GPT-4, GPT-4 Turbo, GPT-3.5
- **Anthropic**: Claude-3, Claude-3.5, Claude-2
- **Google**: Gemini Pro, Gemini Ultra, PaLM
- **Microsoft**: Azure OpenAI variants
- **Open Source**: Ollama, LocalAI, vLLM
- **Others**: Perplexity, Groq, Together, and more

### 3. Session Management (`src/agents/cli-session.ts`, `src/config/sessions.ts`)

Manages conversation state, context, and persistence across interactions.

```typescript
interface SessionState {
  id: string;
  agentId: string;
  created: Date;
  lastActive: Date;
  messages: Message[];
  context: Record<string, any>;
  metadata: SessionMetadata;
}

class SessionManager {
  async createSession(agentId: string): Promise<Session>
  async loadSession(sessionId: string): Promise<Session>
  async updateSession(sessionId: string, updates: Partial<SessionState>): Promise<void>
  async addMessage(sessionId: string, message: Message): Promise<void>
  async compactSession(sessionId: string): Promise<void>
  async deleteSession(sessionId: string): Promise<void>
}
```

**Session Features:**
- Persistent conversation history
- Context window optimization
- Automatic session compaction
- Message deduplication
- Metadata tracking

### 4. Authentication Profiles (`src/agents/auth-profiles.ts`)

Multi-provider authentication management with automatic failover and rotation.

```typescript
interface AuthProfile {
  id: string;
  providerId: string;
  label: string;
  credential: AuthProfileCredential;
  usage: ProfileUsageStats;
  health: ProfileHealth;
  lastUsed?: Date;
  cooldownUntil?: Date;
}

interface ProfileUsageStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatency: number;
  costEstimate: number;
}

class AuthProfileManager {
  async resolveProfile(providerId: string): Promise<AuthProfile>
  async rotateProfiles(): Promise<void>
  async markProfileFailure(profileId: string, reason: string): Promise<void>
  async markProfileSuccess(profileId: string, metrics: UsageMetrics): Promise<void>
  async isProfileAvailable(profileId: string): Promise<boolean>
}
```

**Authentication Features:**
- OAuth 2.0 flow management
- API key rotation and validation
- Automatic failover on auth errors
- Usage tracking and cost estimation
- Cooldown management for failed requests

### 5. Memory System (`src/agents/memory-search.ts`)

Context-aware memory retrieval using vector embeddings and hybrid search.

```typescript
interface MemorySearchConfig {
  enabled: boolean;
  sources: Array<'memory' | 'sessions'>;
  provider: 'openai' | 'local' | 'gemini' | 'auto';
  model: string;
  store: {
    driver: 'sqlite';
    path: string;
    vector: {
      enabled: boolean;
      extensionPath?: string;
    };
  };
  query: {
    maxResults: number;
    minScore: number;
    hybrid: {
      enabled: boolean;
      vectorWeight: number;
      textWeight: number;
    };
  };
}

class MemorySearch {
  async search(query: string, options: SearchOptions): Promise<MemoryResult[]>
  async indexContent(content: string, metadata: MemoryMetadata): Promise<void>
  async syncSources(): Promise<void>
  private generateEmbeddings(text: string): Promise<number[]>
  private performHybridSearch(query: string): Promise<MemoryResult[]>
}
```

**Memory Features:**
- Vector similarity search using embeddings
- Hybrid search combining vector and text search
- Multiple embedding providers (OpenAI, Google, local)
- Automatic content indexing and synchronization
- Configurable relevance scoring

### 6. Tool Execution Engine (`src/agents/pi-tools.ts`, `src/agents/sandbox.ts`)

Secure, sandboxed environment for executing user-defined tools and scripts.

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  implementation: ToolImplementation;
  security: SecurityPolicy;
}

interface SandboxConfig {
  enabled: boolean;
  runtime: 'docker' | 'node' | 'native';
  limits: {
    memory: string;
    cpu: string;
    timeout: number;
  };
  allowedPaths: string[];
  blockedCommands: string[];
}

class ToolEngine {
  async executeTool(tool: ToolCall, context: ToolContext): Promise<ToolResult>
  async validateTool(tool: ToolDefinition): Promise<ValidationResult>
  private createSandbox(config: SandboxConfig): Promise<SandboxInstance>
  private enforceSecurityPolicy(tool: ToolCall): Promise<boolean>
}
```

**Tool Execution Features:**
- Docker-based sandboxing for isolation
- Resource limits (CPU, memory, disk, network)
- Security policy enforcement
- Timeout handling and cleanup
- Result streaming for long-running operations

### 7. Response Processing (`src/agents/pi-embedded-subscribe.ts`)

Handles streaming responses, formatting, and delivery to clients.

```typescript
interface ResponseStream {
  sessionId: string;
  agentId: string;
  chunks: AsyncGenerator<ResponseChunk>;
  metadata: ResponseMetadata;
}

interface ResponseChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'error' | 'done';
  content: string;
  metadata?: Record<string, any>;
  timestamp: Date;
}

class ResponseProcessor {
  async processResponse(stream: ResponseStream): Promise<void>
  private formatChunk(chunk: ResponseChunk): FormattedChunk
  private handleToolCall(toolCall: ToolCall): Promise<ToolResult>
  private deliverChunk(chunk: FormattedChunk, targets: DeliveryTarget[]): Promise<void>
}
```

## AI Provider Integration

### OpenAI Integration

```typescript
interface OpenAIConfig {
  apiKey: string;
  baseUrl?: string;
  organization?: string;
  models: {
    default: string;
    embeddings: string;
    vision?: string;
  };
  limits: {
    requestsPerMinute: number;
    tokensPerMinute: number;
  };
}
```

### Anthropic Integration

```typescript
interface AnthropicConfig {
  apiKey: string;
  models: {
    default: string;
    reasoning?: string;
  };
  features: {
    reasoning: boolean;
    tools: boolean;
    streaming: boolean;
  };
}
```

### Google Gemini Integration

```typescript
interface GoogleConfig {
  apiKey: string;
  projectId?: string;
  region?: string;
  models: {
    default: string;
    embeddings: string;
    vision?: string;
  };
  safety: {
    threshold: 'low' | 'medium' | 'high';
    categories: SafetyCategory[];
  };
}
```

## Performance Optimization

### Context Window Management

```typescript
class ContextWindowManager {
  optimizeContext(messages: Message[], windowSize: number): Message[]
  compactHistory(messages: Message[]): Message[]
  prioritizeMessages(messages: Message[]): Message[]
  estimateTokens(text: string): number
}
```

### Model Selection Strategy

```typescript
interface ModelSelectionCriteria {
  requiredCapabilities: ModelCapabilities[];
  preferredLatency: number;
  maxCost: number;
  contextRequirement: number;
  qualityPreference: 'speed' | 'balanced' | 'quality';
}

class ModelSelector {
  selectOptimalModel(criteria: ModelSelectionCriteria): ModelDefinition
  rankModels(models: ModelDefinition[], criteria: ModelSelectionCriteria): RankedModel[]
  estimateCost(model: ModelDefinition, tokens: number): number
  estimateLatency(model: ModelDefinition): number
}
```

### Caching Strategy

```typescript
interface CacheConfig {
  enabled: boolean;
  ttl: number;
  maxSize: number;
  evictionPolicy: 'lru' | 'lfu' | 'ttl';
}

class ResponseCache {
  async get(key: string): Promise<CachedResponse | null>
  async set(key: string, response: AgentResponse, ttl?: number): Promise<void>
  async invalidate(pattern: string): Promise<void>
  private generateCacheKey(request: AgentRequest): string
}
```

## Error Handling & Recovery

### Failover Strategy

```typescript
interface FailoverConfig {
  maxRetries: number;
  backoffStrategy: 'linear' | 'exponential';
  retryDelay: number;
  fallbackProviders: string[];
  circuitBreaker: {
    enabled: boolean;
    threshold: number;
    timeout: number;
  };
}

class FailoverManager {
  async executeWithFailover<T>(
    operation: () => Promise<T>,
    config: FailoverConfig
  ): Promise<T>
  private selectFallbackProvider(): ModelProvider
  private shouldRetry(error: Error, attempt: number): boolean
}
```

### Error Classification

```typescript
enum ErrorType {
  AUTH_ERROR = 'auth_error',
  RATE_LIMIT = 'rate_limit',
  CONTEXT_OVERFLOW = 'context_overflow',
  MODEL_UNAVAILABLE = 'model_unavailable',
  TOOL_EXECUTION_FAILED = 'tool_execution_failed',
  NETWORK_ERROR = 'network_error',
  UNKNOWN_ERROR = 'unknown_error'
}

interface ErrorHandler {
  classify(error: Error): ErrorType
  recover(error: Error, context: ErrorContext): Promise<RecoveryAction>
  shouldRetry(error: Error): boolean
  getRetryDelay(attempt: number): number
}
```

## Monitoring & Observability

### Metrics Collection

```typescript
interface AgentMetrics {
  requests: {
    total: number;
    successful: number;
    failed: number;
    averageLatency: number;
  };
  providers: {
    [providerId: string]: ProviderMetrics;
  };
  tools: {
    executions: number;
    failures: number;
    averageExecutionTime: number;
  };
  memory: {
    queries: number;
    hits: number;
    averageRetrievalTime: number;
  };
}
```

### Health Monitoring

```typescript
interface AgentHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  providers: ProviderHealth[];
  memory: MemoryHealth;
  sandbox: SandboxHealth;
  lastCheck: Date;
}

class HealthMonitor {
  checkAgentHealth(agentId: string): Promise<AgentHealth>
  checkProviderHealth(providerId: string): Promise<ProviderHealth>
  checkMemoryHealth(): Promise<MemoryHealth>
  checkSandboxHealth(): Promise<SandboxHealth>
}
```

## Configuration Examples

### Agent Configuration

```yaml
agents:
  defaults:
    model:
      provider: "openai"
      name: "gpt-4"
      fallback: "anthropic/claude-3-sonnet"
    
    memory:
      enabled: true
      provider: "openai"
      model: "text-embedding-3-small"
      maxResults: 6
      minScore: 0.35
    
    tools:
      enabled: true
      sandbox:
        runtime: "docker"
        limits:
          memory: "512M"
          cpu: "1"
          timeout: 300
    
    auth:
      profiles:
        - id: "primary-openai"
          provider: "openai"
          apiKey: "${OPENAI_API_KEY}"
        - id: "fallback-anthropic"
          provider: "anthropic"
          apiKey: "${ANTHROPIC_API_KEY}"

  custom:
    coding-agent:
      model:
        name: "gpt-4-turbo"
        temperature: 0.1
      tools:
        allowList: ["bash", "edit", "read", "write"]
        sandbox:
          limits:
            memory: "2G"
            timeout: 600
```

This Agent Runtime Component serves as the intelligent core of OpenClaw, enabling sophisticated AI interactions while maintaining security, reliability, and performance across diverse use cases and deployment scenarios.