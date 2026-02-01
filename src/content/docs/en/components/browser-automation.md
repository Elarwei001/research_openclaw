---
title: "Browser Automation Component"
description: "The Browser Automation component provides web automation capabilities using Playwright, enabling AI agents to interact w"
---


## Overview

The Browser Automation component provides web automation capabilities using Playwright, enabling AI agents to interact with web pages, manage browser profiles, and bridge web content with OpenClaw functionality.

**Location:** `src/browser/`

## Architecture

```mermaid
flowchart TB
    subgraph Browser["Browser Automation"]
        subgraph Core["Core Components"]
            PW["Playwright Session"]
            PM["Profile Manager"]
            EB["Extension Bridge"]
            CM["Chrome Manager"]
        end
        
        subgraph Browsers["Supported Browsers"]
            Chrome["Chrome"]
            Firefox["Firefox"]
            Safari["Safari"]
        end
        
        subgraph Features["Features"]
            Screenshot["Screenshots"]
            PDF["PDF Export"]
            Interact["Interactions"]
            Inject["Content Injection"]
        end
    end
    
    Agent["Agent Runtime"] --> Browser
    Core --> Browsers
    Core --> Features
```

## Core Features

### 1. Playwright Integration (`src/browser/pw-session.ts`)

```mermaid
sequenceDiagram
    participant A as Agent
    participant BS as Browser Session
    participant PW as Playwright
    participant P as Page
    
    A->>BS: Launch Browser
    BS->>PW: Create Context
    PW-->>BS: Browser Context
    BS->>PW: New Page
    PW-->>BS: Page Instance
    
    A->>BS: Navigate to URL
    BS->>P: goto(url)
    P-->>BS: Page Loaded
    
    A->>BS: Interact with Element
    BS->>P: click/type/etc
    P-->>BS: Action Complete
    
    A->>BS: Screenshot
    BS->>P: screenshot()
    P-->>BS: Image Buffer
    BS-->>A: Screenshot Data
```

- Cross-browser support (Chrome, Firefox, Safari)
- Headless and headed operation modes
- Page interaction and element manipulation
- Screenshot and PDF generation

### 2. Profile Management (`src/browser/profiles.ts`)

```mermaid
flowchart LR
    subgraph Profiles["Browser Profiles"]
        P1["Profile: Default"]
        P2["Profile: Work"]
        P3["Profile: Testing"]
    end
    
    subgraph Context["Context Data"]
        Cookies["Cookies"]
        Auth["Auth State"]
        Storage["Local Storage"]
        Settings["Settings"]
    end
    
    PM["Profile Manager"] --> Profiles
    Profiles --> Context
    Context --> Session["Browser Session"]
```

- Isolated browser contexts
- Session persistence across runs
- Cookie and authentication management
- Profile-specific configurations

### 3. Extension Bridge (`src/browser/extension-relay.ts`)

```mermaid
sequenceDiagram
    participant WP as Web Page
    participant Ext as Browser Extension
    participant EB as Extension Bridge
    participant OC as OpenClaw
    
    Note over WP,OC: Content Injection
    OC->>EB: Inject Script
    EB->>Ext: Forward to Extension
    Ext->>WP: Inject Content
    
    Note over WP,OC: Event Forwarding
    WP->>Ext: DOM Event
    Ext->>EB: Relay Event
    EB->>OC: Process Event
    
    Note over WP,OC: Secure Messaging
    OC->>EB: Send Command
    EB->>Ext: Secure Message
    Ext->>WP: Execute Action
    WP-->>Ext: Result
    Ext-->>EB: Response
    EB-->>OC: Command Result
```

- Communication with browser extensions
- Web page content injection
- Real-time event forwarding
- Secure message passing

### 4. Chrome Management (`src/browser/chrome.ts`)

```mermaid
flowchart TD
    A[Chrome Manager] --> B{Find Chrome}
    B --> C[Check Standard Paths]
    B --> D[Check Registry/Config]
    B --> E[Use Custom Path]
    
    C --> F[Chrome Found]
    D --> F
    E --> F
    
    F --> G[Configure Profile Dir]
    G --> H[Set Command Args]
    H --> I[Launch Process]
    
    I --> J{Monitor Health}
    J -->|Healthy| K[Continue]
    J -->|Crashed| L[Restart]
    J -->|Shutdown| M[Cleanup]
```

- Chrome executable detection
- Profile directory management
- Command-line argument configuration
- Process lifecycle management

## Browser Session Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Idle: Initialize
    Idle --> Launching: launch()
    Launching --> Ready: Browser Started
    Launching --> Error: Launch Failed
    
    Ready --> Navigating: navigate(url)
    Navigating --> Ready: Page Loaded
    
    Ready --> Interacting: click/type/etc
    Interacting --> Ready: Action Complete
    
    Ready --> Capturing: screenshot/pdf
    Capturing --> Ready: Capture Complete
    
    Ready --> Closing: close()
    Closing --> [*]: Cleaned Up
    
    Error --> [*]: Logged
```

## Implementation

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

This component enables sophisticated web automation tasks, from simple page interactions to complex workflow automation.