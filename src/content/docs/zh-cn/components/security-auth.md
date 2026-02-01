---
title: "安全与认证组件"
description: "OpenClaw 的安全与认证系统提供多层防护，包括 OAuth 集成、API 密钥管理、沙箱执行和全面的访问控制机制。"
---


## 概述

OpenClaw 的安全与认证系统提供多层防护，包括 OAuth 集成、API 密钥管理、沙箱执行和全面的访问控制机制。

**代码位置：** `src/agents/auth-profiles.ts`、`src/gateway/auth.ts`、`src/agents/sandbox.ts`

## 安全架构

```mermaid
flowchart TB
    subgraph External["外部层"]
        TLS["TLS 1.3 加密"]
        Rate["速率限制"]
        DDoS["DDoS 防护"]
    end
    
    subgraph Auth["认证层"]
        Device["设备认证"]
        OAuth["OAuth 2.0"]
        APIKey["API 密钥"]
    end
    
    subgraph Access["授权层"]
        RBAC["基于角色的<br/>访问控制"]
        Allowlist["渠道<br/>允许列表"]
        Sessions["会话<br/>管理"]
    end
    
    subgraph Execution["执行层"]
        Sandbox["Docker 沙箱"]
        Limits["资源限制"]
        Policy["安全策略"]
    end
    
    External --> Auth --> Access --> Execution
    Execution --> Core["受保护核心"]
```

## 核心安全功能

### 1. 认证配置文件 (`src/agents/auth-profiles.ts`)

```mermaid
flowchart LR
    subgraph Providers["认证提供商"]
        Google["Google OAuth"]
        Microsoft["Microsoft OAuth"]
        GitHub["GitHub OAuth"]
        Custom["API 密钥"]
    end
    
    subgraph Manager["配置文件管理器"]
        Select["选择配置文件"]
        Rotate["自动轮换"]
        Cooldown["失败冷却"]
        Health["健康监控"]
    end
    
    Providers --> Manager --> Agent["代理运行时"]
```

- 多提供商 OAuth 2.0 流程（Google、Microsoft、GitHub）
- API 密钥轮换和验证
- 带冷却机制的认证失败处理
- 配置文件健康监控和指标

### 2. 沙箱执行 (`src/agents/sandbox.ts`)

```mermaid
flowchart TD
    A[工具请求] --> B{沙箱已启用?}
    
    B -->|否| C[直接执行]
    B -->|是| D[创建 Docker 容器]
    
    D --> E[应用资源限制]
    E --> F[挂载允许的路径]
    F --> G[执行工具]
    
    G --> H{超时?}
    H -->|是| I[终止 & 清理]
    H -->|否| J{成功?}
    
    J -->|是| K[返回结果]
    J -->|否| L[记录错误]
    
    I --> M[报告超时]
    K --> N[清理容器]
    L --> N
    M --> N
```

- 基于 Docker 的工具执行隔离
- 资源限制（CPU、内存、网络、磁盘）
- 安全策略执行
- 执行超时和清理

### 3. 访问控制 (`src/gateway/auth.ts`)

```mermaid
stateDiagram-v2
    [*] --> Unauthenticated: 新连接
    
    Unauthenticated --> Authenticating: 提供凭证
    Authenticating --> Authenticated: 凭证有效
    Authenticating --> Unauthenticated: 凭证无效
    
    Authenticated --> Authorized: 权限检查
    Authorized --> Active: 授权通过
    Authorized --> Denied: 授权拒绝
    
    Active --> Expired: 会话超时
    Expired --> Authenticating: 重新认证
    
    Active --> [*]: 登出
    Denied --> [*]: 连接关闭
```

- 基于角色的访问控制（RBAC）
- 渠道特定的允许列表
- 设备认证和配对
- 带过期机制的会话管理

### 4. 网络安全

```mermaid
flowchart LR
    Client["客户端"] --> TLS["TLS 1.3"]
    TLS --> Rate["速率限制器"]
    Rate --> Validate["请求验证"]
    Validate --> Gateway["网关服务器"]
    
    subgraph Protection["防护层"]
        TLS
        Rate
        Validate
    end
```

- 所有连接使用 TLS 1.3 加密
- 仅限 HTTPS 的 API 端点
- WebSocket Secure (WSS) 通信
- 速率限制和 DDoS 防护

## 实现细节

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

## 请求认证流程

```mermaid
sequenceDiagram
    participant C as 客户端
    participant G as 网关
    participant A as 认证管理器
    participant S as 会话存储
    participant P as 配置文件管理器
    
    C->>G: 带令牌的请求
    G->>A: 验证令牌
    A->>S: 检查会话
    
    alt 有效会话
        S-->>A: 会话数据
        A->>A: 检查权限
        A-->>G: 认证成功
        G->>G: 处理请求
    else 无效/已过期
        S-->>A: 会话无效
        A->>P: 尝试配置文件轮换
        P-->>A: 新配置文件
        A->>S: 创建新会话
        A-->>G: 认证成功（新会话）
    else 无有效认证
        A-->>G: 认证失败
        G-->>C: 401 未授权
    end
```

此组件确保 OpenClaw 在所有部署场景中安全运行，同时保持可用性和性能。
