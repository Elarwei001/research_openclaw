---
title: "Memory & Persistence Component"
description: "The Memory & Persistence component provides sophisticated data storage, retrieval, and context management capabilities f"
---


## Overview

The Memory & Persistence component provides sophisticated data storage, retrieval, and context management capabilities for OpenClaw. It combines traditional relational storage with advanced vector search to enable context-aware AI interactions and long-term knowledge retention.

**Locations:**
- Core: `src/agents/memory-search.ts`, `src/config/sessions.ts`
- Extensions: `extensions/memory-core/`, `extensions/memory-lancedb/`
- Storage: `src/config/paths.ts`, SQLite databases, vector stores

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                Memory & Persistence System                      │
├─────────────────┬─────────────────┬─────────────────────────────┤
│ Session Storage │   Memory Store  │   Vector Database           │
├─────────────────┼─────────────────┼─────────────────────────────┤
│ • Conversations │ • Knowledge Base│ • Embedding Storage         │
│ • User Context  │ • Learning Data │ • Similarity Search         │
│ • Tool Results  │ • File Content  │ • Hybrid Retrieval          │
│ • Metadata      │ • External Data │ • Multi-Model Support       │
├─────────────────┼─────────────────┼─────────────────────────────┤
│   Compaction    │   Indexing      │   Caching Layer             │
├─────────────────┼─────────────────┼─────────────────────────────┤
│ • Auto Cleanup  │ • Auto Sync     │ • Redis Integration         │
│ • Deduplication │ • Watch Folders │ • Memory Cache              │
│ • Compression   │ • Embeddings    │ • Query Optimization        │
└─────────────────┴─────────────────┴─────────────────────────────┘
                                │
                ┌───────────────┼───────────────┐
                │               │               │
        ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
        │  SQLite     │ │  LanceDB    │ │ File System │
        │  + Vector   │ │  Advanced   │ │  Storage    │
        │  Extensions │ │  Vectors    │ │             │
        └─────────────┘ └─────────────┘ └─────────────┘
```

## Core Components

### 1. Memory Search Engine (`src/agents/memory-search.ts`)

The central memory management system that provides context-aware retrieval.

```typescript
interface MemorySearchConfig {
  enabled: boolean;
  sources: Array<'memory' | 'sessions'>;
  extraPaths: string[];
  provider: 'openai' | 'local' | 'gemini' | 'auto';
  
  store: {
    driver: 'sqlite';
    path: string;
    vector: {
      enabled: boolean;
      extensionPath?: string;
    };
  };
  
  chunking: {
    tokens: number;
    overlap: number;
  };
  
  query: {
    maxResults: number;
    minScore: number;
    hybrid: {
      enabled: boolean;
      vectorWeight: number;
      textWeight: number;
      candidateMultiplier: number;
    };
  };
  
  cache: {
    enabled: boolean;
    maxEntries?: number;
  };
}

class MemorySearchEngine {
  async search(query: string, options?: SearchOptions): Promise<MemoryResult[]>
  async indexContent(content: string, metadata: ContentMetadata): Promise<void>
  async syncSources(force?: boolean): Promise<SyncResult>
  async generateEmbeddings(texts: string[]): Promise<number[][]>
  private performHybridSearch(query: string, options: SearchOptions): Promise<MemoryResult[]>
}
```

**Key Features:**
- Multi-provider embedding support (OpenAI, Google, local models)
- Hybrid search combining vector similarity and text search
- Automatic content indexing and synchronization
- Configurable relevance scoring and filtering
- Intelligent chunking for large documents

### 2. Session Management (`src/config/sessions.ts`)

Persistent conversation state and context management.

```typescript
interface SessionState {
  id: string;
  agentId: string;
  created: Date;
  lastActive: Date;
  messages: ConversationMessage[];
  context: SessionContext;
  metadata: SessionMetadata;
  compactionInfo: CompactionInfo;
}

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: MessageContent;
  timestamp: Date;
  metadata: MessageMetadata;
}

interface SessionContext {
  userId: string;
  channelId: string;
  conversationId: string;
  preferences: UserPreferences;
  variables: Record<string, any>;
}

class SessionManager {
  async createSession(agentId: string, context: SessionContext): Promise<Session>
  async loadSession(sessionId: string): Promise<Session>
  async saveSession(session: Session): Promise<void>
  async updateSession(sessionId: string, updates: Partial<SessionState>): Promise<void>
  async deleteSession(sessionId: string): Promise<void>
  async listSessions(filters?: SessionFilters): Promise<SessionSummary[]>
  async compactSession(sessionId: string): Promise<CompactionResult>
}
```

### 3. Vector Database Integration

#### SQLite with Vector Extensions

```typescript
interface SQLiteVectorConfig {
  path: string;
  extensionPath?: string; // sqlite-vec extension
  pragmas: Record<string, string>;
  tables: {
    documents: string;
    embeddings: string;
    metadata: string;
  };
}

class SQLiteVectorStore {
  async initialize(config: SQLiteVectorConfig): Promise<void>
  async insertDocument(doc: Document, embedding: number[]): Promise<string>
  async searchSimilar(queryEmbedding: number[], limit: number, threshold: number): Promise<SearchResult[]>
  async updateDocument(id: string, doc: Document, embedding?: number[]): Promise<void>
  async deleteDocument(id: string): Promise<void>
  async hybridSearch(query: string, embedding: number[], options: HybridSearchOptions): Promise<SearchResult[]>
}
```

#### LanceDB Integration (`extensions/memory-lancedb/`)

```typescript
interface LanceDBConfig {
  uri: string; // Local path or S3/GCS URI
  tableName: string;
  dimensions: number;
  indexType: 'ivf_pq' | 'hnsw' | 'btree';
  metricType: 'cosine' | 'l2' | 'dot';
}

class LanceDBStore {
  private table: Table;
  
  async initialize(config: LanceDBConfig): Promise<void> {
    const db = await lancedb.connect(config.uri);
    this.table = await db.openTable(config.tableName);
  }
  
  async insert(vectors: VectorData[]): Promise<void>
  async search(query: number[], limit: number): Promise<SearchResult[]>
  async createIndex(indexConfig: IndexConfig): Promise<void>
  async vectorSearch(query: number[], options: SearchOptions): Promise<SearchResult[]>
  async hybridSearch(query: string, vector: number[], alpha: number): Promise<SearchResult[]>
}
```

### 4. Embedding Providers

#### OpenAI Embeddings

```typescript
class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private client: OpenAI;
  
  async generateEmbeddings(texts: string[], model: string = 'text-embedding-3-small'): Promise<number[][]> {
    const response = await this.client.embeddings.create({
      model,
      input: texts,
      encoding_format: 'float'
    });
    
    return response.data.map(item => item.embedding);
  }
  
  async batchEmbeddings(batches: string[][], model: string): Promise<number[][][]>
  getDimensions(model: string): number
  getMaxTokens(model: string): number
}
```

#### Local Embedding Support

```typescript
interface LocalEmbeddingConfig {
  modelPath: string;
  modelCacheDir: string;
  deviceType: 'cpu' | 'cuda' | 'mps';
  batchSize: number;
}

class LocalEmbeddingProvider implements EmbeddingProvider {
  private model: any; // ONNX or PyTorch model
  
  async initialize(config: LocalEmbeddingConfig): Promise<void>
  async generateEmbeddings(texts: string[]): Promise<number[][]>
  private tokenizeTexts(texts: string[]): number[][]
  private runInference(tokens: number[][]): Promise<number[][]>
}
```

### 5. Content Indexing System

```typescript
interface IndexingConfig {
  watchPaths: string[];
  excludePatterns: string[];
  fileTypes: string[];
  maxFileSize: number;
  debounceMs: number;
  chunkSize: number;
  chunkOverlap: number;
}

class ContentIndexer {
  private watcher: FileWatcher;
  private queue: IndexingQueue;
  
  async startWatching(config: IndexingConfig): Promise<void> {
    this.watcher = new FileWatcher(config.watchPaths, {
      exclude: config.excludePatterns,
      debounce: config.debounceMs
    });
    
    this.watcher.on('add', this.indexFile.bind(this));
    this.watcher.on('change', this.reindexFile.bind(this));
    this.watcher.on('unlink', this.removeFromIndex.bind(this));
  }
  
  async indexFile(filePath: string): Promise<IndexResult>
  async indexDirectory(dirPath: string): Promise<IndexResult[]>
  private extractContent(filePath: string): Promise<ExtractedContent>
  private chunkContent(content: string, metadata: ContentMetadata): Promise<ContentChunk[]>
  private generateEmbedding(chunk: ContentChunk): Promise<number[]>
}
```

### 6. Session Compaction (`src/agents/compaction.ts`)

Intelligent conversation history compression to manage context window limits.

```typescript
interface CompactionConfig {
  enabled: boolean;
  strategy: 'summarization' | 'importance' | 'recency' | 'hybrid';
  targetSize: number;
  preserveRecent: number;
  importanceThreshold: number;
  summaryModel: string;
}

interface CompactionResult {
  originalSize: number;
  compactedSize: number;
  messagesRemoved: number;
  summariesCreated: number;
  importantMessagesPreserved: number;
}

class SessionCompactor {
  async compactSession(sessionId: string, config: CompactionConfig): Promise<CompactionResult>
  private calculateImportance(message: ConversationMessage): number
  private generateSummary(messages: ConversationMessage[]): Promise<string>
  private preserveImportantMessages(messages: ConversationMessage[], threshold: number): ConversationMessage[]
}
```

## Storage Backends

### 1. SQLite with Extensions

**Schema Design:**

```sql
-- Documents table
CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    metadata TEXT, -- JSON metadata
    source TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Vector embeddings table (using sqlite-vec extension)
CREATE VIRTUAL TABLE embeddings USING vec0(
    id TEXT PRIMARY KEY,
    embedding FLOAT[1536], -- OpenAI embedding dimension
    FOREIGN KEY (id) REFERENCES documents(id)
);

-- Inverted index for text search
CREATE VIRTUAL TABLE documents_fts USING fts5(
    content, 
    metadata,
    content=documents,
    content_rowid=rowid
);

-- Indexes for performance
CREATE INDEX idx_documents_source ON documents(source);
CREATE INDEX idx_documents_created ON documents(created_at);
CREATE INDEX idx_documents_metadata ON documents(json_extract(metadata, '$.type'));
```

### 2. LanceDB Schema

```python
# LanceDB table schema
schema = pa.schema([
    pa.field("id", pa.string()),
    pa.field("content", pa.string()),
    pa.field("vector", pa.list_(pa.float32(), 1536)),  # Embedding vector
    pa.field("metadata", pa.struct([
        pa.field("source", pa.string()),
        pa.field("type", pa.string()),
        pa.field("timestamp", pa.timestamp('us')),
        pa.field("tags", pa.list_(pa.string())),
        pa.field("score", pa.float32())
    ])),
    pa.field("chunk_index", pa.int32()),
    pa.field("parent_id", pa.string())
])
```

### 3. File System Organization

```
~/.openclaw/
├── sessions/
│   ├── agent-{id}/
│   │   ├── session-{id}.json
│   │   ├── session-{id}.db
│   │   └── media/
│   └── global-sessions.db
├── memory/
│   ├── main.db (SQLite)
│   ├── vectors.lance (LanceDB)
│   ├── cache/
│   └── temp/
├── config/
│   ├── memory-config.yaml
│   └── embeddings-cache/
└── logs/
    ├── indexing.log
    └── search.log
```

## Search & Retrieval

### 1. Hybrid Search Algorithm

```typescript
interface HybridSearchOptions {
  vectorWeight: number;
  textWeight: number;
  maxResults: number;
  minScore: number;
  candidateMultiplier: number;
}

class HybridSearchEngine {
  async search(query: string, options: HybridSearchOptions): Promise<SearchResult[]> {
    // 1. Generate query embedding
    const queryEmbedding = await this.generateEmbedding(query);
    
    // 2. Vector similarity search
    const vectorResults = await this.vectorStore.search(
      queryEmbedding, 
      options.maxResults * options.candidateMultiplier
    );
    
    // 3. Text search using FTS
    const textResults = await this.textSearch.search(
      query,
      options.maxResults * options.candidateMultiplier
    );
    
    // 4. Combine and re-rank results
    const combinedResults = this.combineResults(
      vectorResults, 
      textResults, 
      options.vectorWeight, 
      options.textWeight
    );
    
    // 5. Filter by minimum score and return top results
    return combinedResults
      .filter(r => r.score >= options.minScore)
      .slice(0, options.maxResults);
  }
  
  private combineResults(
    vectorResults: SearchResult[], 
    textResults: SearchResult[], 
    vectorWeight: number, 
    textWeight: number
  ): SearchResult[]
}
```

### 2. Contextual Retrieval

```typescript
interface ContextualSearchOptions extends HybridSearchOptions {
  sessionId?: string;
  timeWindow?: TimeWindow;
  sourceFilters?: string[];
  typeFilters?: string[];
  userPreferences?: UserPreferences;
}

class ContextualRetriever {
  async retrieveContext(query: string, options: ContextualSearchOptions): Promise<RetrievalResult> {
    // 1. Get session context if available
    const sessionContext = options.sessionId 
      ? await this.getSessionContext(options.sessionId)
      : null;
    
    // 2. Expand query with context
    const expandedQuery = await this.expandQuery(query, sessionContext);
    
    // 3. Perform hybrid search
    const searchResults = await this.hybridSearch(expandedQuery, options);
    
    // 4. Re-rank based on recency and relevance
    const rerankedResults = await this.rerank(searchResults, sessionContext);
    
    // 5. Generate context summary
    const contextSummary = await this.summarizeContext(rerankedResults);
    
    return {
      query: expandedQuery,
      results: rerankedResults,
      summary: contextSummary,
      metadata: {
        totalResults: searchResults.length,
        searchTime: Date.now() - startTime,
        sources: this.extractSources(rerankedResults)
      }
    };
  }
}
```

## Performance Optimization

### 1. Caching Strategy

```typescript
interface CacheConfig {
  enabled: boolean;
  maxEntries: number;
  ttlSeconds: number;
  compressionEnabled: boolean;
}

class MemoryCache {
  private cache: Map<string, CachedResult>;
  private lru: LRUCache<string, boolean>;
  
  async get(key: string): Promise<SearchResult[] | null>
  async set(key: string, results: SearchResult[], ttl?: number): Promise<void>
  async invalidate(pattern: string): Promise<void>
  private generateCacheKey(query: string, options: SearchOptions): string
  private compress(data: any): Buffer
  private decompress(data: Buffer): any
}
```

### 2. Batch Processing

```typescript
interface BatchConfig {
  enabled: boolean;
  batchSize: number;
  waitTimeMs: number;
  maxConcurrency: number;
}

class EmbeddingBatcher {
  private queue: EmbeddingRequest[] = [];
  private processing = false;
  
  async queueEmbedding(text: string): Promise<number[]> {
    return new Promise((resolve, reject) => {
      this.queue.push({ text, resolve, reject });
      this.processBatch();
    });
  }
  
  private async processBatch(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    const batch = this.queue.splice(0, this.config.batchSize);
    
    try {
      const texts = batch.map(req => req.text);
      const embeddings = await this.provider.generateEmbeddings(texts);
      
      batch.forEach((req, idx) => {
        req.resolve(embeddings[idx]);
      });
    } catch (error) {
      batch.forEach(req => req.reject(error));
    } finally {
      this.processing = false;
      if (this.queue.length > 0) {
        setTimeout(() => this.processBatch(), this.config.waitTimeMs);
      }
    }
  }
}
```

## Monitoring & Analytics

### 1. Memory System Metrics

```typescript
interface MemoryMetrics {
  storage: {
    totalDocuments: number;
    totalSize: number;
    indexSize: number;
    lastUpdated: Date;
  };
  performance: {
    averageSearchTime: number;
    cacheHitRate: number;
    embeddingGenerationTime: number;
    indexingRate: number;
  };
  usage: {
    searchesPerHour: number;
    topQueries: string[];
    errorRate: number;
  };
}

class MemoryMonitor {
  async getMetrics(): Promise<MemoryMetrics>
  async getHealthStatus(): Promise<HealthStatus>
  async trackSearch(query: string, results: number, time: number): Promise<void>
  async trackIndexing(docs: number, time: number, size: number): Promise<void>
}
```

### 2. Search Quality Analytics

```typescript
interface SearchQualityMetrics {
  relevanceScores: number[];
  userFeedback: FeedbackScore[];
  clickThroughRates: number[];
  abandonmentRate: number;
  averageResultPosition: number;
}

class SearchQualityAnalyzer {
  async analyzeSearchQuality(sessionId: string): Promise<SearchQualityMetrics>
  async recordUserFeedback(searchId: string, feedback: FeedbackScore): Promise<void>
  async identifyLowQualityQueries(): Promise<string[]>
  async suggestQueryImprovements(query: string): Promise<string[]>
}
```

## Configuration Examples

### Complete Memory Configuration

```yaml
memory:
  enabled: true
  
  # Embedding provider configuration
  provider: "auto" # auto, openai, google, local
  fallback: "openai"
  model: "text-embedding-3-small"
  
  # Data sources
  sources: ["memory", "sessions"]
  extraPaths:
    - "~/Documents/knowledge-base"
    - "~/Projects/docs"
  
  # Storage configuration
  store:
    driver: "sqlite"
    path: "~/.openclaw/memory/{agentId}.db"
    vector:
      enabled: true
      extensionPath: "/usr/local/lib/sqlite-vec.so"
  
  # Content processing
  chunking:
    tokens: 400
    overlap: 80
  
  # Synchronization settings
  sync:
    onSessionStart: true
    onSearch: true
    watch: true
    watchDebounceMs: 1500
    intervalMinutes: 60
    sessions:
      deltaBytes: 100000
      deltaMessages: 50
  
  # Search configuration
  query:
    maxResults: 6
    minScore: 0.35
    hybrid:
      enabled: true
      vectorWeight: 0.7
      textWeight: 0.3
      candidateMultiplier: 4
  
  # Performance settings
  cache:
    enabled: true
    maxEntries: 1000
  
  # Remote embedding service (optional)
  remote:
    baseUrl: "https://api.openai.com/v1"
    apiKey: "${OPENAI_API_KEY}"
    batch:
      enabled: true
      wait: true
      concurrency: 2
      pollIntervalMs: 2000
      timeoutMinutes: 60

# Session management
sessions:
  compaction:
    enabled: true
    strategy: "hybrid"
    targetSize: 8000
    preserveRecent: 10
    importanceThreshold: 0.6
    summaryModel: "gpt-3.5-turbo"
  
  retention:
    maxAge: "30d"
    maxSessions: 1000
    archiveOld: true
```

This Memory & Persistence component provides the foundation for intelligent, context-aware AI interactions by maintaining long-term knowledge and enabling sophisticated information retrieval across conversations and knowledge sources.