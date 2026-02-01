---
title: "Security & Authentication Component"
description: "OpenClaw's Security & Authentication system provides multi-layered protection with OAuth integration, API key management"
---


## Overview

OpenClaw's Security & Authentication system provides multi-layered protection with OAuth integration, API key management, sandboxed execution, and comprehensive access control mechanisms.

**Locations:** `src/agents/auth-profiles.ts`, `src/gateway/auth.ts`, `src/agents/sandbox.ts`

## Security Architecture

```mermaid
flowchart TB
    subgraph External["External Layer"]
        TLS["TLS 1.3 Encryption"]
        Rate["Rate Limiting"]
        DDoS["DDoS Protection"]
    end
    
    subgraph Auth["Authentication Layer"]
        Device["Device Auth"]
        OAuth["OAuth 2.0"]
        APIKey["API Keys"]
    end
    
    subgraph Access["Authorization Layer"]
        RBAC["Role-Based<br/>Access Control"]
        Allowlist["Channel<br/>Allowlists"]
        Sessions["Session<br/>Management"]
    end
    
    subgraph Execution["Execution Layer"]
        Sandbox["Docker Sandbox"]
        Limits["Resource Limits"]
        Policy["Security Policies"]
    end
    
    External --> Auth --> Access --> Execution
    Execution --> Core["Protected Core"]
```

## Core Security Features

### 1. Authentication Profiles (`src/agents/auth-profiles.ts`)

```mermaid
flowchart LR
    subgraph Providers["Auth Providers"]
        Google["Google OAuth"]
        Microsoft["Microsoft OAuth"]
        GitHub["GitHub OAuth"]
        Custom["API Keys"]
    end
    
    subgraph Manager["Profile Manager"]
        Select["Select Profile"]
        Rotate["Auto Rotation"]
        Cooldown["Failure Cooldown"]
        Health["Health Monitor"]
    end
    
    Providers --> Manager --> Agent["Agent Runtime"]
```

- Multi-provider OAuth 2.0 flows (Google, Microsoft, GitHub)
- API key rotation and validation
- Authentication failure handling with cooldowns
- Profile health monitoring and metrics

### 2. Sandboxed Execution (`src/agents/sandbox.ts`)

```mermaid
flowchart TD
    A[Tool Request] --> B{Sandbox Enabled?}
    
    B -->|No| C[Direct Execution]
    B -->|Yes| D[Create Docker Container]
    
    D --> E[Apply Resource Limits]
    E --> F[Mount Allowed Paths]
    F --> G[Execute Tool]
    
    G --> H{Timeout?}
    H -->|Yes| I[Kill & Cleanup]
    H -->|No| J{Success?}
    
    J -->|Yes| K[Return Results]
    J -->|No| L[Log Error]
    
    I --> M[Report Timeout]
    K --> N[Cleanup Container]
    L --> N
    M --> N
```

- Docker-based isolation for tool execution
- Resource limits (CPU, memory, network, disk)
- Security policy enforcement
- Execution timeout and cleanup

### 3. Access Control (`src/gateway/auth.ts`)

```mermaid
stateDiagram-v2
    [*] --> Unauthenticated: New Connection
    
    Unauthenticated --> Authenticating: Provide Credentials
    Authenticating --> Authenticated: Valid Credentials
    Authenticating --> Unauthenticated: Invalid Credentials
    
    Authenticated --> Authorized: Permission Check
    Authorized --> Active: Access Granted
    Authorized --> Denied: Access Denied
    
    Active --> Expired: Session Timeout
    Expired --> Authenticating: Re-authenticate
    
    Active --> [*]: Logout
    Denied --> [*]: Connection Closed
```

- Role-based access control (RBAC)
- Channel-specific allowlisting
- Device authentication and pairing
- Session management with expiration

### 4. Network Security

```mermaid
flowchart LR
    Client --> TLS["TLS 1.3"]
    TLS --> Rate["Rate Limiter"]
    Rate --> Validate["Request Validation"]
    Validate --> Gateway["Gateway Server"]
    
    subgraph Protection["Protection Layers"]
        TLS
        Rate
        Validate
    end
```

- TLS 1.3 encryption for all connections
- HTTPS-only API endpoints
- WebSocket Secure (WSS) communication
- Rate limiting and DDoS protection

## Implementation Details

```typescript
interface SecurityConfig {
  authentication: {
    required: boolean;
    methods: ['device', 'oauth', 'apikey'];
    sessionTimeout: number;
  };
  authorization: {
    rbac: boolean;
    permissions: Permission[];
    defaultRole: string;
  };
  sandbox: {
    enabled: boolean;
    runtime: 'docker' | 'node';
    limits: ResourceLimits;
  };
}
```

## Request Authentication Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant G as Gateway
    participant A as Auth Manager
    participant S as Session Store
    participant P as Profile Manager
    
    C->>G: Request with Token
    G->>A: Validate Token
    A->>S: Check Session
    
    alt Valid Session
        S-->>A: Session Data
        A->>A: Check Permissions
        A-->>G: Auth Success
        G->>G: Process Request
    else Invalid/Expired
        S-->>A: Session Invalid
        A->>P: Try Profile Rotation
        P-->>A: New Profile
        A->>S: Create New Session
        A-->>G: Auth Success (New Session)
    else No Valid Auth
        A-->>G: Auth Failed
        G-->>C: 401 Unauthorized
    end
```

This component ensures OpenClaw operates securely across all deployment scenarios while maintaining usability and performance.