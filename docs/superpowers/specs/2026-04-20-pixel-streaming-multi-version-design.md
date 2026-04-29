# 多版本像素流服务设计文档

> **日期**: 2026-04-20
> **状态**: 设计阶段

## 概述

增强像素流接入，支持 UE 4.26 - UE 5.7 全版本。

### 核心需求

1. **UE 5.2+** 使用 `@epicgames-ps/lib-pixelstreamingfrontend-ueX.X` npm 库
2. **UE 5.1 及更早版本** 使用 `webRtcPlayer.js` 和 `app.js` 脚本
3. **自动检测 UE 版本**（通过协议握手）
4. **统一配置接口**，支持多种参数配置

## 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                     PixelStreamingService                        │
│  (统一服务层，版本检测、适配器选择、SSE 连接、MCP 命令转发)         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────┴───────────────┐
              │      IPixelStreamingAdapter   │
              │         (适配器接口)           │
              └───────────────┬───────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  LegacyAdapter  │ │  ModernAdapter  │ │  SimulateAdapter│
│  (UE 4.26-5.1)  │ │  (UE 5.2-5.7)   │ │    (测试用)     │
│                 │ │                 │ │                 │
│ - webRtcPlayer  │ │ - npm library   │ │ - mock响应      │
│ - app.js 逻辑   │ │ - ue5.2~ue5.7   │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

## 文件结构

```
qwenpaw-chat/src/pixelstreaming/
├── index.ts                    # 统一导出
├── types.ts                    # 类型定义
├── config.ts                   # 默认配置
├── version-detect.ts           # 版本检测
├── service.ts                  # 统一服务层
├── adapters/
│   ├── index.ts                # 适配器工厂
│   ├── base.ts                 # 适配器基类
│   ├── modern.ts               # UE 5.2-5.7 适配器
│   ├── legacy.ts               # UE 4.26-5.1 适配器
│   └── simulate.ts             # 模拟适配器（测试用）
└── utils/
    ├── logger.ts               # 日志工具
    └── sse-client.ts           # SSE 客户端
```

## 核心接口

### UE 版本枚举

```typescript
export type UEVersion = '4.26' | '4.27' | '5.0' | '5.1' | '5.2' | '5.3' | '5.4' | '5.5' | '5.6' | '5.7';
```

### 鼠标交互配置

```typescript
export interface MouseInteractionConfig {
  HoveringMouse?: boolean;         // 悬停鼠标模式，默认 false
  FakeMouseWithTouches?: boolean;  // 触摸模拟鼠标，默认 false
  HideBrowserCursor?: boolean;     // 隐藏浏览器光标，默认 false
}
```

### 像素流配置

```typescript
export interface PixelStreamingConfig {
  // 连接配置
  signallingUrl: string;           // 信令服务器地址
  mcpBridgeUrl: string;            // MCP Bridge HTTP 地址
  videoContainer: HTMLElement;     // 视频容器元素
  
  // UE 版本（可选，不设置则自动检测）
  ueVersion?: UEVersion;
  
  // 连接超时配置
  connectionTimeout?: number;      // 连接超时（毫秒），默认 30000
  commandTimeout?: number;         // 命令超时（毫秒），默认 30000
  
  // 视频配置
  autoPlayVideo?: boolean;         // 自动播放视频，默认 true
  initialSettings?: {
    AutoConnect?: boolean;         // 自动连接，默认 false
    AutoPlayVideo?: boolean;       // 自动播放，默认 true
    StartVideoMuted?: boolean;     // 静音开始，默认 true
    UseMic?: boolean;              // 使用麦克风，默认 false
    UseCamera?: boolean;           // 使用摄像头，默认 false
  };
  
  // 鼠标交互配置
  mouseInteraction?: MouseInteractionConfig;
  
  // 调试配置
  debugMode?: boolean;             // 调试模式，默认 false
  logLevel?: 'debug' | 'info' | 'warn' | 'error';  // 日志级别
  
  // 模拟模式（用于测试）
  simulateMode?: boolean;          // 模拟模式，默认 false
}
```

### MCP 命令/响应格式

```typescript
export interface MCPCommand {
  commandId: string;
  category: string;
  action_name: string;
  action_data: Record<string, unknown>;
}

export interface MCPResponse {
  commandId: string;
  result?: unknown;
  error?: string;
}
```

### 事件回调

```typescript
export interface PixelStreamingCallbacks {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onVideoReady?: () => void;
  onError?: (error: string) => void;
  onCommandReceived?: (command: MCPCommand) => void;
  onResponseSent?: (response: MCPResponse) => void;
  onVersionDetected?: (version: UEVersion) => void;
}
```

### 适配器接口

```typescript
export interface IPixelStreamingAdapter {
  // 生命周期
  connect(): Promise<void>;
  disconnect(): void;
  reconnect(): void;
  
  // 状态
  isConnected(): boolean;
  getConnectionStatus(): { pixelStreaming: boolean; sse: boolean };
  
  // 命令
  sendCommand(command: MCPCommand): boolean;
  
  // 事件
  onResponse(callback: (response: string) => void): void;
}
```

## 版本检测机制

### 检测流程

```
1. 连接信令服务器
2. 发送 WebSocket 握手请求
3. 解析响应中的协议版本信息
4. 映射到对应的 UE 版本
```

### 协议版本映射

| 协议版本 | UE 版本 | 适配器类型 |
|---------|--------|-----------|
| 1.x | 4.26-4.27 | Legacy |
| 2.x | 5.0-5.1 | Legacy |
| 3.x | 5.2+ | Modern |

### 检测实现

```typescript
// version-detect.ts
export async function detectUEVersion(signallingUrl: string): Promise<UEVersion> {
  // 1. 建立 WebSocket 连接
  // 2. 发送 config 请求
  // 3. 解析 protocolVersion 或类似字段
  // 4. 返回对应版本
}
```

## 适配器实现

### Modern 适配器 (UE 5.2-5.7)

```typescript
// adapters/modern.ts
import { PixelStreaming, Config } from '@epicgames-ps/lib-pixelstreamingfrontend-ueX.X';

export class ModernAdapter implements IPixelStreamingAdapter {
  private pixelStreaming: PixelStreaming | null = null;
  
  async connect(): Promise<void> {
    // 使用 npm 库连接
    const config = new Config({ initialSettings: this.config.initialSettings });
    this.pixelStreaming = new PixelStreaming(config, {
      videoElementParent: this.config.videoContainer
    });
    // ...
  }
}
```

### Legacy 适配器 (UE 4.26-5.1)

```typescript
// adapters/legacy.ts
// 基于 webRtcPlayer.js 和 app.js 的实现

export class LegacyAdapter implements IPixelStreamingAdapter {
  private webRtcPlayer: any = null;
  
  async connect(): Promise<void> {
    // 动态加载 webRtcPlayer.js
    // 使用传统方式建立 WebRTC 连接
    // ...
  }
}
```

## SSE 客户端

SSE 连接用于接收来自 MCP Bridge 的命令，与 UE 版本无关。

```typescript
// utils/sse-client.ts
export class SSEClient {
  private eventSource: EventSource | null = null;
  
  connect(url: string): Promise<void> {
    this.eventSource = new EventSource(`${url}/events`);
    // 处理心跳、命令消息
  }
  
  sendHeartbeat(clientId: string): void {
    // POST /heartbeat
  }
  
  sendResponse(response: MCPResponse): void {
    // POST /response
  }
}
```

## 数据流

```
┌─────────────┐   MCP(stdio)   ┌─────────────┐   SSE/HTTP   ┌─────────────────┐
│   AI 客户端   │ ─────────────▶ │ MCP Bridge  │ ◀──────────▶ │PixelStreaming   │
│ (QwenPaw等)  │                │  :8080      │              │    Service      │
└─────────────┘                └─────────────┘              └────────┬────────┘
                                                                │ WebRTC
                                                                ▼
                                                         ┌─────────────┐
                                                         │     UE5     │
                                                         └─────────────┘
```

## 使用示例

```typescript
import { PixelStreamingService } from './pixelstreaming';

// 创建服务实例
const service = new PixelStreamingService({
  signallingUrl: 'ws://localhost:8888',
  mcpBridgeUrl: 'http://localhost:8080',
  videoContainer: document.getElementById('video-container')!,
  mouseInteraction: {
    HoveringMouse: true,
    HideBrowserCursor: true
  },
  debugMode: true
}, {
  onConnected: () => console.log('Connected'),
  onVersionDetected: (version) => console.log(`UE ${version} detected`),
  onError: (err) => console.error(err)
});

// 启动服务
await service.start();

// 停止服务
service.stop();
```

## 依赖项

### npm 依赖

```json
{
  "dependencies": {
    "@epicgames-ps/lib-pixelstreamingfrontend-ue5.2": "^1.0.0",
    "@epicgames-ps/lib-pixelstreamingfrontend-ue5.3": "^1.0.0",
    "@epicgames-ps/lib-pixelstreamingfrontend-ue5.4": "^1.1.6",
    "@epicgames-ps/lib-pixelstreamingfrontend-ue5.5": "^1.0.0",
    "@epicgames-ps/lib-pixelstreamingfrontend-ue5.6": "^1.0.0",
    "@epicgames-ps/lib-pixelstreamingfrontend-ue5.7": "^1.0.0"
  }
}
```

### Legacy 脚本

从 ps_server 目录复制到项目中：
- `webRtcPlayer.js`
- `app.js`

## 测试计划

1. **单元测试** - 版本检测、配置解析
2. **集成测试** - 各版本适配器连接
3. **E2E 测试** - 完整 MCP 命令流程

## 风险与缓解

| 风险 | 缓解措施 |
|-----|---------|
| 版本检测失败 | 提供手动配置选项 |
| npm 库 API 变化 | 适配器封装隔离 |
| Legacy 脚本兼容性 | 动态加载，错误回退 |

## 后续工作

1. 实现适配器接口
2. 实现版本检测
3. 编写测试用例
4. 文档完善
