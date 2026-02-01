---
title: "浏览器自动化组件"
description: "浏览器自动化组件使用 Playwright 提供 Web 自动化能力，使 AI 代理能够与网页交互、管理浏览器配置文件，并将 Web 内容与 OpenClaw 功能桥接。"
---


## 概述

浏览器自动化组件使用 Playwright 提供 Web 自动化能力，使 AI 代理能够与网页交互、管理浏览器配置文件，并将 Web 内容与 OpenClaw 功能桥接。

**代码位置：** `src/browser/`

## 架构

```mermaid
flowchart TB
    subgraph Browser["浏览器自动化"]
        subgraph Core["核心组件"]
            PW["Playwright 会话"]
            PM["配置文件管理器"]
            EB["扩展桥接"]
            CM["Chrome 管理器"]
        end
        
        subgraph Browsers["支持的浏览器"]
            Chrome["Chrome"]
            Firefox["Firefox"]
            Safari["Safari"]
        end
        
        subgraph Features["功能"]
            Screenshot["截图"]
            PDF["PDF 导出"]
            Interact["交互"]
            Inject["内容注入"]
        end
    end
    
    Agent["代理运行时"] --> Browser
    Core --> Browsers
    Core --> Features
```

## 核心功能

### 1. Playwright 集成 (`src/browser/pw-session.ts`)

```mermaid
sequenceDiagram
    participant A as 代理
    participant BS as 浏览器会话
    participant PW as Playwright
    participant P as 页面
    
    A->>BS: 启动浏览器
    BS->>PW: 创建上下文
    PW-->>BS: 浏览器上下文
    BS->>PW: 新页面
    PW-->>BS: 页面实例
    
    A->>BS: 导航到 URL
    BS->>P: goto(url)
    P-->>BS: 页面已加载
    
    A->>BS: 与元素交互
    BS->>P: click/type/etc
    P-->>BS: 操作完成
    
    A->>BS: 截图
    BS->>P: screenshot()
    P-->>BS: 图像缓冲区
    BS-->>A: 截图数据
```

- 跨浏览器支持（Chrome、Firefox、Safari）
- 无头和有头操作模式
- 页面交互和元素操作
- 截图和 PDF 生成

### 2. 配置文件管理 (`src/browser/profiles.ts`)

```mermaid
flowchart LR
    subgraph Profiles["浏览器配置文件"]
        P1["配置文件: 默认"]
        P2["配置文件: 工作"]
        P3["配置文件: 测试"]
    end
    
    subgraph Context["上下文数据"]
        Cookies["Cookies"]
        Auth["认证状态"]
        Storage["本地存储"]
        Settings["设置"]
    end
    
    PM["配置文件管理器"] --> Profiles
    Profiles --> Context
    Context --> Session["浏览器会话"]
```

- 隔离的浏览器上下文
- 跨运行的会话持久化
- Cookie 和认证管理
- 配置文件特定配置

### 3. 扩展桥接 (`src/browser/extension-relay.ts`)

```mermaid
sequenceDiagram
    participant WP as 网页
    participant Ext as 浏览器扩展
    participant EB as 扩展桥接
    participant OC as OpenClaw
    
    Note over WP,OC: 内容注入
    OC->>EB: 注入脚本
    EB->>Ext: 转发到扩展
    Ext->>WP: 注入内容
    
    Note over WP,OC: 事件转发
    WP->>Ext: DOM 事件
    Ext->>EB: 中继事件
    EB->>OC: 处理事件
    
    Note over WP,OC: 安全消息传递
    OC->>EB: 发送命令
    EB->>Ext: 安全消息
    Ext->>WP: 执行操作
    WP-->>Ext: 结果
    Ext-->>EB: 响应
    EB-->>OC: 命令结果
```

- 与浏览器扩展通信
- 网页内容注入
- 实时事件转发
- 安全消息传递

### 4. Chrome 管理 (`src/browser/chrome.ts`)

```mermaid
flowchart TD
    A[Chrome 管理器] --> B{查找 Chrome}
    B --> C[检查标准路径]
    B --> D[检查注册表/配置]
    B --> E[使用自定义路径]
    
    C --> F[找到 Chrome]
    D --> F
    E --> F
    
    F --> G[配置配置文件目录]
    G --> H[设置命令行参数]
    H --> I[启动进程]
    
    I --> J{监控健康}
    J -->|健康| K[继续]
    J -->|崩溃| L[重启]
    J -->|关闭| M[清理]
```

- Chrome 可执行文件检测
- 配置文件目录管理
- 命令行参数配置
- 进程生命周期管理

## 浏览器会话生命周期

```mermaid
stateDiagram-v2
    [*] --> Idle: 初始化
    Idle --> Launching: launch()
    Launching --> Ready: 浏览器已启动
    Launching --> Error: 启动失败
    
    Ready --> Navigating: navigate(url)
    Navigating --> Ready: 页面已加载
    
    Ready --> Interacting: click/type/etc
    Interacting --> Ready: 操作完成
    
    Ready --> Capturing: screenshot/pdf
    Capturing --> Ready: 捕获完成
    
    Ready --> Closing: close()
    Closing --> [*]: 已清理
    
    Error --> [*]: 已记录
```

## 实现

```typescript
interface BrowserConfig {
  headless: boolean;
  viewport: { width: number; height: number; };
  timeout: number;
  userAgent?: string;
  proxy?: ProxyConfig;
  extensions?: string[];
}

class BrowserSession {
  async launch(config: BrowserConfig): Promise<Browser>
  async createPage(): Promise<Page>
  async navigate(url: string): Promise<void>
  async screenshot(options?: ScreenshotOptions): Promise<Buffer>
  async close(): Promise<void>
}
```

此组件支持复杂的 Web 自动化任务，从简单的页面交互到复杂的工作流自动化。
