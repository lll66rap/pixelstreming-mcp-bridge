# UE5像素流MCP桥接系统设计文档

**版本：** v1.0
**日期：** 2026-04-18

---

## 1. 概述

本系统作为MCP桥接层，将UE5像素流的API命令暴露为标准MCP Tools，使AI助手能够通过自然语言控制已运行的像素流实例。

### 1.1 设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| WebSocket协议 | 简单格式 | 通过 `action_name + timestamp` 匹配响应 |
| MCP传输模式 | 仅stdio | 满足本地MCP客户端需求，保持简单 |
| 连接断开处理 | 直接报错 | 不自动重连，由客户端决定后续操作 |
| 技术栈 | TypeScript + Node.js | 使用官方MCP SDK，类型安全 |
| 架构 | 单文件Server | 项目规模适中，减少模块间复杂度 |

### 1.2 边界说明

| 范围 | 说明 |
|------|------|
| ✅ 包含 | API桥接、命令转换、MCP协议适配 |
| ❌ 不包含 | UE5进程管理、信令服务器管理、WebSocket自动重连 |

---

## 2. 项目结构

```
pixelstreming-mcp-bridge/
├── src/
│   ├── index.ts          # MCP Server入口 + 所有核心逻辑
│   └── types.ts          # TypeScript类型定义
├── dist/                  # 编译输出（gitignore）
├── Api.json              # 像素流命令定义（已存在）
├── package.json
├── tsconfig.json
└── ue5_mcp_bridge_prd.md # 需求文档（已存在）
```

---

## 3. 核心类型定义

```typescript
// Api.json 中的命令定义结构
interface ApiCommand {
  category: string;
  category_zh: string;
  action: Array<{
    action_name: string;
    action_example: Array<{
      example_name: string;
      example_data: Record<string, unknown>;
    }>;
  }>;
}

// 像素流请求消息格式
interface PixelStreamingRequest {
  category: string;
  action_name: string;
  action_data: Record<string, unknown>;
}

// 像素流响应消息格式
interface PixelStreamingResponse {
  category: string;
  action_name: string;
  action_result: 'success' | 'error';
  result_data?: Record<string, unknown>;
  timestamp?: string;
  error?: { code?: string; message?: string };
}

// 待处理命令（用于请求-响应匹配）
interface PendingCommand {
  actionName: string;
  timestamp: number;
  resolve: (result: PixelStreamingResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}
```

---

## 4. MCP Tool生成规则

### 4.1 命名规则

```
ue5_{category}_{action_name}
```

**示例：**
- `camera.transformCamera` → `ue5_camera_transformCamera`
- `actor.focusActor` → `ue5_actor_focusActor`

### 4.2 参数Schema生成

从 `action_example[0].action_data` 推断参数结构：

| 数据示例 | JSON Schema |
|----------|-------------|
| `[5000, 2000, 3000]` | `{type: "array", items: {type: "number"}}` |
| `100` | `{type: "number"}` |
| `"#FF0000"` | `{type: "string"}` |
| `true` | `{type: "boolean"}` |
| `{...}` | `{type: "object", properties: {...}}` |

### 4.3 描述生成

格式：`[{category_zh}] {action_name}`

**示例：**
```json
{
  "name": "ue5_camera_transformCamera",
  "description": "[镜头] transformCamera - 移动相机到指定位置",
  "inputSchema": {
    "type": "object",
    "properties": {
      "position": { "type": "array", "items": { "type": "number" } },
      "position_type": { "type": "number" },
      "pitch": { "type": "number" },
      "yaw": { "type": "number" },
      "distance": { "type": "number" },
      "time": { "type": "number" }
    }
  }
}
```

---

## 5. 命令执行流程

```
MCP客户端调用Tool
        │
        ▼
   解析Tool名称 ──────► 提取 category + action_name
        │
        ▼
   构造像素流请求 ──────► { category, action_name, action_data: params }
        │
        ▼
   记录待处理命令 ──────► 存入 pendingCommands Map
        │
        ▼
   WebSocket发送 ◄────── 检查连接状态，断开则报错
        │
        ▼
   等待响应 ──────► 超时限制 (默认10秒)
        │
        ├──► 收到匹配响应 → resolve，返回结果
        │
        └──► 超时未响应 → reject，返回超时错误
```

### 5.1 响应匹配逻辑

1. 收到WebSocket消息时，解析 `action_name`
2. 遍历 `pendingCommands`，找到 `actionName` 匹配且时间戳最接近的条目
3. 清除超时定时器，resolve Promise
4. 返回格式化结果给MCP客户端

### 5.2 返回结果格式

**成功响应：**
```json
{
  "content": [{
    "type": "text",
    "text": "Command 'transformCamera' executed successfully. Result: {...}"
  }]
}
```

**错误响应：**
```json
{
  "content": [{
    "type": "text",
    "text": "[BRIDGE_004] Pixel streaming error: {error.message}"
  }],
  "isError": true
}
```

---

## 6. 错误处理

### 6.1 错误码定义

| 错误码 | 场景 | 错误信息 |
|--------|------|----------|
| `BRIDGE_001` | api.json文件不存在或解析失败 | `Failed to load api.json: {reason}` |
| `BRIDGE_002` | WebSocket连接未建立 | `WebSocket not connected to pixel streaming instance` |
| `BRIDGE_003` | 命令执行超时 | `Command '{action_name}' timed out after {timeout}ms` |
| `BRIDGE_004` | 像素流返回错误 | `Pixel streaming error: {error.message}` |

### 6.2 错误返回格式

```json
{
  "content": [{
    "type": "text",
    "text": "[BRIDGE_002] WebSocket not connected to pixel streaming instance"
  }],
  "isError": true
}
```

---

## 7. 环境变量配置

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `API_JSON_PATH` | ✅ | - | api.json文件绝对路径 |
| `PIXEL_STREAMING_URL` | ✅ | - | 像素流WebSocket地址（如 `ws://localhost:8888`） |
| `COMMAND_TIMEOUT` | ❌ | `10000` | 命令超时时间（毫秒） |
| `LOG_LEVEL` | ❌ | `info` | 日志级别（`debug`/`info`/`warn`/`error`） |

### 7.1 启动校验

- 必填变量缺失时，打印错误信息并退出进程
- api.json文件不存在或JSON格式错误时，打印错误并退出
- WebSocket连接失败时，打印警告但继续运行（允许后续重试连接）

---

## 8. MCP客户端配置示例

### 8.1 Claude Desktop / QwenPaw

```json
{
  "mcpServers": {
    "ue5-pixel-streaming": {
      "command": "node",
      "args": ["E:/Git/claude/pixelstreming-mcp-bridge/dist/index.js"],
      "env": {
        "API_JSON_PATH": "E:/Git/claude/pixelstreming-mcp-bridge/Api.json",
        "PIXEL_STREAMING_URL": "ws://localhost:8888",
        "COMMAND_TIMEOUT": "10000",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

---

## 9. 使用示例

### 9.1 自然语言交互

```
用户: 把相机移到坐标 5000, 2000, 3000，俯视角度

AI: 正在调用 ue5_camera_transformCamera...
{
  "position": [5000, 2000, 3000],
  "pitch": -45,
  "time": 1.0
}
✅ 命令已执行成功
```

### 9.2 代码调用

```typescript
await mcp.tools.call("ue5_camera_transformCamera", {
  position: [5000, 2000, 3000],
  pitch: -45,
  yaw: 95,
  time: 2.0
});
```

---

**文档结束**
