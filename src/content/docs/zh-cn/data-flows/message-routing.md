---
title: "消息路由数据流"
description: "本文档描述消息如何在 OpenClaw 系统中从外部渠道流向 AI 代理，再返回给用户。"
---


## 概述

本文档描述消息如何在 OpenClaw 系统中从外部渠道流向 AI 代理，再返回给用户。

## 消息处理管道

```mermaid
sequenceDiagram
    participant User as 用户
    participant Channel as 渠道插件
    participant Gateway as 网关路由器
    participant Auth as 认证
    participant Agent as AI 代理
    participant Memory as 内存系统
    participant AI as AI 提供商
    participant Tools as 工具引擎
    
    User->>Channel: 发送消息
    Channel->>Gateway: 入站消息
    Gateway->>Auth: 验证用户/渠道
    Auth-->>Gateway: 认证结果
    
    alt 认证失败
        Gateway->>Channel: 错误响应
        Channel->>User: 需要认证
    else 认证成功
        Gateway->>Gateway: 应用速率限制
        Gateway->>Gateway: 检查允许列表
        Gateway->>Agent: 路由到代理
        
        Agent->>Memory: 加载会话上下文
        Memory-->>Agent: 会话数据
        
        Agent->>Memory: 搜索相关内存
        Memory-->>Agent: 上下文结果
        
        Agent->>AI: 生成响应
        AI-->>Agent: AI 响应
        
        alt 需要工具执行
            Agent->>Tools: 执行工具
            Tools->>Tools: 沙箱执行
            Tools-->>Agent: 工具结果
            Agent->>AI: 继续处理结果
            AI-->>Agent: 最终响应
        end
        
        Agent->>Memory: 更新会话
        Agent->>Gateway: 发送响应
        Gateway->>Channel: 转发响应
        Channel->>User: 投递消息
    end
```

## 入站消息流

### 1. 渠道输入处理

```mermaid
flowchart LR
    A[原始平台<br/>消息] --> B[渠道插件]
    B --> C[格式<br/>规范化]
    C --> D[验证]
    D --> E[媒体<br/>处理]
    E --> F[通用<br/>格式]
```

**步骤：**
1. **平台特定接收**：每个渠道插件以原生格式接收消息
2. **格式规范化**：转换为 OpenClaw 的通用消息格式
3. **验证**：确保消息满足基本要求
4. **媒体处理**：下载和暂存媒体附件

### 2. 网关路由

```mermaid
flowchart TD
    A[规范化消息] --> B{认证}
    B -->|有效| C{速率限制}
    B -->|无效| X[拒绝]
    
    C -->|通过| D{允许列表检查}
    C -->|超出| Y[排队/限流]
    
    D -->|允许| E[代理选择]
    D -->|拒绝| Z[丢弃]
    
    E --> F{负载均衡}
    F --> G[选定代理]
```

**路由标准：**
- 渠道特定路由规则
- 用户/群组允许列表和阻止列表
- 每用户/渠道速率限制
- 代理可用性和负载
- 消息内容模式

### 3. 代理处理

```mermaid
flowchart TD
    A[代理请求] --> B[加载会话]
    B --> C[查询内存]
    C --> D[构建上下文]
    D --> E[调用 AI 提供商]
    
    E --> F{工具调用?}
    F -->|是| G[在沙箱中执行]
    G --> H[处理结果]
    H --> E
    
    F -->|否| I[生成响应]
    I --> J[更新会话]
    J --> K[返回响应]
```

**处理步骤：**
- 加载对话会话和上下文
- 查询内存系统获取相关信息
- 准备带上下文和内存的提示词
- 调用 AI 提供商，支持故障转移
- 在沙箱中执行任何请求的工具
- 生成最终响应

## 出站消息流

### 1. 响应格式化

```mermaid
flowchart LR
    A[代理响应] --> B[平台<br/>格式化]
    B --> C[应用<br/>约束]
    C --> D[处理<br/>媒体]
    D --> E[添加<br/>元数据]
    E --> F[准备<br/>发送]
```

**格式化步骤：**
- 为目标平台适配内容（消息长度、格式）
- 应用平台特定约束
- 处理媒体附件
- 添加平台特定元数据

### 2. 投递跟踪

```mermaid
flowchart LR
    A[格式化<br/>消息] --> B[渠道<br/>投递]
    B --> C{已投递?}
    C -->|是| D[确认<br/>投递]
    C -->|否| E{重试?}
    E -->|是| B
    E -->|否| F[记录失败]
    D --> G[跟踪状态]
```

## 错误处理流程

```mermaid
flowchart TD
    subgraph AuthErr["认证错误"]
        A1[认证失败] --> A2[错误响应]
        A2 --> A3[用户通知]
        A3 --> A4[重试/恢复]
    end
    
    subgraph RateErr["速率限制"]
        R1[超出速率] --> R2[延迟/排队]
        R2 --> R3[重试逻辑]
        R3 --> R4[成功/失败]
    end
    
    subgraph AgentErr["代理故障"]
        G1[代理错误] --> G2[备用代理]
        G2 --> G3[错误恢复]
        G3 --> G4[用户通知]
    end
    
    subgraph ToolErr["工具错误"]
        T1[工具失败] --> T2[沙箱清理]
        T2 --> T3[错误报告]
        T3 --> T4[优雅降级]
    end
```

### 认证错误
认证失败 → 错误响应 → 用户通知 → 重试/恢复

### 速率限制
超出速率 → 延迟/排队 → 重试逻辑 → 成功/失败

### 代理故障
代理错误 → 备用代理 → 错误恢复 → 用户通知

### 工具执行错误
工具失败 → 沙箱清理 → 错误报告 → 优雅降级

## 消息类型和路由

### 私聊消息
- 路由到用户的默认代理
- 应用用户特定偏好
- 完整的上下文和内存访问

### 群组消息
- 检查提及模式
- 应用群组特定规则
- 有限的上下文共享

### 命令消息
- 解析命令语法
- 路由到适当的处理器
- 执行特权操作

### 媒体消息
- 安全地暂存媒体文件
- 提取元数据和内容
- 通过适当的处理器处理

## 性能优化

### 缓存
- 会话数据缓存
- 内存查询缓存
- 常见查询的 AI 响应缓存

### 批处理
- 嵌入生成批处理
- 数据库操作批处理
- AI API 请求批处理

### 流式传输
- 实时响应流式传输
- 渐进式消息投递
- 增量工具输出

此数据流确保在所有支持的通信渠道上实现高效、安全且可靠的消息处理。
