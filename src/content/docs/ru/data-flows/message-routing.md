---
title: "Message Routing Data Flow"
description: "This document describes how messages flow through the OpenClaw system from external channels to AI agents and back to us"
---


## Overview

This document describes how messages flow through the OpenClaw system from external channels to AI agents and back to users.

## Message Processing Pipeline

```mermaid
sequenceDiagram
    participant User
    participant Channel as Channel Plugin
    participant Gateway as Gateway Router
    participant Auth as Authentication
    participant Agent as AI Agent
    participant Memory as Memory System
    participant AI as AI Provider
    participant Tools as Tool Engine
    
    User->>Channel: Send Message
    Channel->>Gateway: Inbound Message
    Gateway->>Auth: Validate User/Channel
    Auth-->>Gateway: Auth Result
    
    alt Authentication Failed
        Gateway->>Channel: Error Response
        Channel->>User: Authentication Required
    else Authentication Success
        Gateway->>Gateway: Apply Rate Limiting
        Gateway->>Gateway: Check Allowlists
        Gateway->>Agent: Route to Agent
        
        Agent->>Memory: Load Session Context
        Memory-->>Agent: Session Data
        
        Agent->>Memory: Search Relevant Memory
        Memory-->>Agent: Context Results
        
        Agent->>AI: Generate Response
        AI-->>Agent: AI Response
        
        alt Tool Execution Required
            Agent->>Tools: Execute Tools
            Tools->>Tools: Sandbox Execution
            Tools-->>Agent: Tool Results
            Agent->>AI: Continue with Results
            AI-->>Agent: Final Response
        end
        
        Agent->>Memory: Update Session
        Agent->>Gateway: Send Response
        Gateway->>Channel: Forward Response
        Channel->>User: Deliver Message
    end
```

## Inbound Message Flow

### 1. Channel Input Processing

```mermaid
flowchart LR
    A[Raw Platform<br/>Message] --> B[Channel Plugin]
    B --> C[Format<br/>Normalization]
    C --> D[Validation]
    D --> E[Media<br/>Processing]
    E --> F[Common<br/>Format]
```

**Steps:**
1. **Platform-Specific Reception**: Each channel plugin receives messages in native format
2. **Format Normalization**: Convert to OpenClaw's common message format
3. **Validation**: Ensure message meets basic requirements
4. **Media Processing**: Download and stage media attachments

### 2. Gateway Routing

```mermaid
flowchart TD
    A[Normalized Message] --> B{Authentication}
    B -->|Valid| C{Rate Limit}
    B -->|Invalid| X[Reject]
    
    C -->|OK| D{Allowlist Check}
    C -->|Exceeded| Y[Queue/Throttle]
    
    D -->|Allowed| E[Agent Selection]
    D -->|Denied| Z[Drop]
    
    E --> F{Load Balance}
    F --> G[Selected Agent]
```

**Routing Criteria:**
- Channel-specific routing rules
- User/group allowlists and blocklists
- Rate limiting per user/channel
- Agent availability and load
- Message content patterns

### 3. Agent Processing

```mermaid
flowchart TD
    A[Agent Request] --> B[Load Session]
    B --> C[Query Memory]
    C --> D[Build Context]
    D --> E[Call AI Provider]
    
    E --> F{Tool Calls?}
    F -->|Yes| G[Execute in Sandbox]
    G --> H[Process Results]
    H --> E
    
    F -->|No| I[Generate Response]
    I --> J[Update Session]
    J --> K[Return Response]
```

**Processing Steps:**
- Load conversation session and context
- Query memory system for relevant information
- Prepare prompt with context and memory
- Call AI provider with failover support
- Execute any requested tools in sandbox
- Generate final response

## Outbound Message Flow

### 1. Response Formatting

```mermaid
flowchart LR
    A[Agent Response] --> B[Platform<br/>Formatting]
    B --> C[Apply<br/>Constraints]
    C --> D[Process<br/>Media]
    D --> E[Add<br/>Metadata]
    E --> F[Ready to<br/>Send]
```

**Formatting Steps:**
- Adapt content for target platform (message length, formatting)
- Apply platform-specific constraints
- Process media attachments
- Add platform-specific metadata

### 2. Delivery Tracking

```mermaid
flowchart LR
    A[Formatted<br/>Message] --> B[Channel<br/>Delivery]
    B --> C{Delivered?}
    C -->|Yes| D[Confirm<br/>Delivery]
    C -->|No| E{Retry?}
    E -->|Yes| B
    E -->|No| F[Log Failure]
    D --> G[Track Status]
```

## Error Handling Flow

```mermaid
flowchart TD
    subgraph AuthErr["Authentication Errors"]
        A1[Auth Failure] --> A2[Error Response]
        A2 --> A3[User Notification]
        A3 --> A4[Retry/Recovery]
    end
    
    subgraph RateErr["Rate Limiting"]
        R1[Rate Exceeded] --> R2[Delay/Queue]
        R2 --> R3[Retry Logic]
        R3 --> R4[Success/Failure]
    end
    
    subgraph AgentErr["Agent Failures"]
        G1[Agent Error] --> G2[Fallback Agent]
        G2 --> G3[Error Recovery]
        G3 --> G4[User Notification]
    end
    
    subgraph ToolErr["Tool Errors"]
        T1[Tool Failure] --> T2[Sandbox Cleanup]
        T2 --> T3[Error Report]
        T3 --> T4[Graceful Degradation]
    end
```

### Authentication Errors
Auth Failure → Error Response → User Notification → Retry/Recovery

### Rate Limiting
Rate Exceeded → Delay/Queue → Retry Logic → Success/Failure

### Agent Failures
Agent Error → Fallback Agent → Error Recovery → User Notification

### Tool Execution Errors
Tool Failure → Sandbox Cleanup → Error Report → Graceful Degradation

## Message Types and Routing

### Direct Messages
- Route to user's default agent
- Apply user-specific preferences
- Full context and memory access

### Group Messages
- Check mention patterns
- Apply group-specific rules
- Limited context sharing

### Command Messages
- Parse command syntax
- Route to appropriate handlers
- Execute privileged operations

### Media Messages
- Stage media files securely
- Extract metadata and content
- Process through appropriate handlers

## Performance Optimizations

### Caching
- Session data caching
- Memory query caching
- AI response caching for common queries

### Batching
- Embedding generation batching
- Database operation batching
- AI API request batching

### Streaming
- Real-time response streaming
- Progressive message delivery
- Incremental tool output

This data flow ensures efficient, secure, and reliable message processing across all supported communication channels.