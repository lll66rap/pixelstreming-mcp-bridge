# UE5像素流MCP桥接系统需求规格说明书

**版本：** v1.0  
**日期：** 2026-04-18

---

## 1. 项目概述

### 1.1 项目背景

UE5像素流（Pixel Streaming）已通过 `api.json` 定义了标准化的远程命令接口（如 `transformCamera`）。本系统作为**MCP桥接层**，将这些命令暴露为标准MCP Tools，使AI助手能够通过自然语言控制已运行的像素流实例。

### 1.2 项目目标

- 读取 `api.json`，动态生成对应的MCP Tools
- 通过WebSocket连接到已运行的像素流实例
- 将MCP Tool调用转换为像素流命令格式
- 支持Claude、QwenPaw等标准MCP客户端

### 1.3 边界说明

| 范围 | 说明 |
|------|------|
| ✅ **包含** | API桥接、命令转换、MCP协议适配 |
| ❌ **不包含** | UE5进程管理（启动/停止）、信令服务器管理 |

> 像素流实例的生命周期由外部DevOps工具管理，本系统仅作为API桥接层。

---

## 2. 系统架构

### 2.1 架构简化

```
┌─────────────────────────────────────────────────────────┐
│  MCP客户端 (Claude / QwenPaw / ...)                      │
└────────────────────┬────────────────────────────────────┘
                     │ MCP协议
                     ▼
┌─────────────────────────────────────────────────────────┐
│  MCP Bridge (本系统)                                     │
│  ├─ 读取 api.json → 生成MCP Tools                       │
│  ├─ MCP请求解析                                         │
│  └─ 命令格式转换                                        │
└────────────────────┬────────────────────────────────────┘
                     │ WebSocket
                     ▼
┌─────────────────────────────────────────────────────────┐
│  已运行的像素流实例                                       │
│  (由外部工具管理生命周期)                                  │
└─────────────────────────────────────────────────────────┘
```

### 2.2 配置文件

仅需 `api.json`（像素流命令定义）：

```json
{
  "version": "1.0",
  "commands": [
    {
      "name": "transformCamera",
      "category": "camera",
      "description": "移动相机到指定位置",
      "params": {
        "position": {"type": "vec3", "required": true},
        "pitch": {"type": "float"},
        "yaw": {"type": "float"},
        "time": {"type": "float", "default": 1.0}
      }
    }
  ]
}
```

**文件位置**：`E:\Git\claude\pixelstreming-mcp-bridge\Api.json`

### 2.3 连接配置

通过环境变量或命令行参数指定像素流连接：

| 配置项 | 说明 | 示例 |
|--------|------|------|
| `PIXEL_STREAMING_URL` | 像素流WebSocket地址 | `ws://localhost:8888` |
| `API_JSON_PATH` | api.json文件路径 | `E:/Git/claude/pixelstreming-mcp-bridge/Api.json` |

---

## 3. MCP Tools 生成

### 3.1 命名规则

```
ue5_{category}_{action_name}
```

**示例**：
- `api.json` 中的 `camera.transformCamera` → MCP Tool: `ue5_camera_transformCamera`

### 3.2 参数映射

| api.json 参数 | MCP Tool 参数 | 说明 |
|---------------|---------------|------|
| `position` (vec3) | `position` (array) | 自动转换格式 |
| `pitch` (float) | `pitch` (number) | 直接透传 |
| `time` (float, default:1.0) | `time` (number) | 使用默认值 |

### 3.3 生成的Tool定义示例

```typescript
{
  name: "ue5_camera_transformCamera",
  description: "移动相机到指定位置",
  inputSchema: {
    type: "object",
    properties: {
      position: { 
        type: "array", 
        items: { type: "number" },
        description: "目标位置 [X, Y, Z]"
      },
      pitch: { type: "number", description: "俯仰角" },
      yaw: { type: "number", description: "偏航角" },
      time: { 
        type: "number", 
        description: "过渡时间(秒)",
        default: 1.0 
      }
    },
    required: ["position"]
  }
}
```

---

## 4. 命令转换示例

### 4.1 transformCamera 调用流程

**MCP Tool 调用**：
```json
{
  "position": [5000, 2000, 3000],
  "pitch": -45,
  "yaw": 95,
  "time": 2.0
}
```

**转换为像素流命令**：
```json
{
  "category": "camera",
  "action_name": "transformCamera",
  "action_data": {
    "position": [5000, 2000, 3000],
    "position_type": 0,
    "pitch": -45,
    "yaw": 95,
    "time": 2.0
  }
}
```

**发送到WebSocket**：
```
ws://localhost:8888 (像素流信令服务器)
```

---

## 5. 返回数据处理

### 5.1 像素流响应格式

像素流命令执行完成后，通过WebSocket返回响应消息：

```json
{
  "category": "camera",
  "action_name": "transformCamera",
  "action_result": "success",
  "result_data": { /* 具体返回数据，视命令而定 */ },
  "timestamp": "2026-04-18T15:30:00Z",
  "error": null
}
```

**响应字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `category` | string | 命令分类，与请求一致 |
| `action_name` | string | 命令名称，与请求一致 |
| `action_result` | string | 执行结果：`success` / `error` |
| `result_data` | object | 具体返回数据（可选） |
| `timestamp` | string | 响应时间戳 |
| `error` | object | 错误信息（失败时） |

### 5.2 请求-响应匹配

MCP Bridge需要维护请求-响应的对应关系：

```typescript
interface PendingCommand {
  id: string;                    // 唯一请求ID
  action_name: string;           // 命令名称
  resolve: (result: any) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

// 等待响应的超时管理
const pendingCommands = new Map<string, PendingCommand>();
```

**匹配逻辑**：
1. 发送命令时生成 `request_id`
2. 将 `request_id` 添加到像素流消息中（如果协议支持）
3. 或通过 `action_name + timestamp` 匹配（简单场景）
4. 收到响应后，通过 `pendingCommands` 找到对应的Promise并resolve

### 5.3 响应转换

像素流响应 → MCP Tool 结果：

| 像素流响应 | MCP Tool结果 |
|-----------|-------------|
| `action_result: "success"` | `{content: [{type: "text", text: "格式化结果"}]}` |
| `action_result: "error"` | `{content: [{type: "text", text: "错误信息"}], isError: true}` |
| 超时无响应 | `{content: [{type: "text", text: "命令超时"}], isError: true}` |

### 5.4 异步事件处理

除了命令响应，像素流还可能主动推送事件：

```json
{
  "category": "system",
  "event_name": "OnMapLoaded",
  "event_data": {
    "map_name": "Level1",
    "load_time": 3.5
  }
}
```

**处理方式**：
- 事件通过 MCP `logging/message` 通知客户端
- 或存储在内部状态，供Resources查询

---

## 6. MCP 客户端配置

### 5.1 支持的客户端

| 客户端 | 传输模式 | 状态 |
|--------|---------|------|
| Claude Desktop | stdio / sse | ✅ 支持 |
| QwenPaw | stdio / sse | ✅ 支持 |
| Cursor | stdio | ✅ 支持 |

### 5.2 QwenPaw 配置示例

```json
{
  "mcpServers": {
    "ue5-pixel-streaming": {
      "transport": "stdio",
      "command": "node",
      "args": ["E:/Git/claude/pixelstreming-mcp-bridge/dist/server.js"],
      "env": {
        "API_JSON_PATH": "E:/Git/claude/pixelstreming-mcp-bridge/Api.json",
        "PIXEL_STREAMING_URL": "ws://localhost:8888",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

---

## 7. 使用示例

### 6.1 自然语言交互

> **用户**：把相机移到 5000,2000,3000，俯视角度
>
> **QwenPaw**: 正在调用 ue5_camera_transformCamera...
```json
{
  "position": [5000, 2000, 3000],
  "pitch": -45,
  "time": 1.0
}
```
> ✅ 命令已发送至像素流实例

### 6.2 代码调用

```typescript
// 直接调用 MCP Tool
await mcp.tools.call("ue5_camera_transformCamera", {
  position: [5000, 2000, 3000],
  pitch: -45,
  yaw: 95,
  time: 2.0
});
```

---

## 8. 技术实现

### 7.1 核心模块

```
src/
├── index.ts              # MCP Server入口
├── api-parser.ts         # 解析api.json生成Tools
├── command-mapper.ts     # MCP参数→像素流命令转换
├── websocket-client.ts   # WebSocket连接管理
└── types.ts              # TypeScript类型定义
```

### 7.2 启动流程

1. 读取 `API_JSON_PATH` 指定的 `api.json`
2. 解析 `commands` 数组，生成 MCP Tool 定义
3. 建立与 `PIXEL_STREAMING_URL` 的WebSocket连接
4. 启动MCP Server，等待客户端连接

### 7.3 运行时流程

```
MCP请求 → 解析Tool名 → 查找对应命令模板 
  → 参数映射转换 → 构造像素流消息 → WebSocket发送
```

---

## 9. 环境变量

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `API_JSON_PATH` | ✅ | - | api.json文件绝对路径 |
| `PIXEL_STREAMING_URL` | ✅ | - | 像素流WebSocket地址 |
| `LOG_LEVEL` | ❌ | `info` | 日志级别 |
| `MCP_TRANSPORT` | ❌ | `stdio` | MCP传输模式 (stdio/sse) |
| `MCP_PORT` | ❌ | `3000` | SSE模式端口 |
| `COMMAND_TIMEOUT` | ❌ | `10000` | 命令超时时间(ms) |

---

## 10. 错误处理

| 错误码 | 说明 | 处理建议 |
|--------|------|---------|
| `BRIDGE_001` | api.json不存在或解析失败 | 检查 `API_JSON_PATH` |
| `BRIDGE_002` | WebSocket连接失败 | 检查像素流实例是否运行 |
| `BRIDGE_003` | 命令发送超时 | 检查网络或增加超时时间 |
| `BRIDGE_004` | 参数校验失败 | 对照 `api.json` 检查参数 |
| `BRIDGE_005` | 像素流返回错误 | 查看UE5日志 |

---

## 11. 限制与假设

### 10.1 前提条件

- ✅ 像素流实例已由外部工具启动并运行
- ✅ 信令服务器（Signalling Server）已启动
- ✅ WebSocket连接可被建立
- ✅ `api.json` 文件存在且格式正确

### 10.2 单实例模式

本系统为**单像素流实例**设计：
- 启动时连接到一个固定的像素流实例
- 不支持动态切换或管理多个实例
- 如需切换实例，需重启MCP Bridge并修改环境变量

---

## 12. 参考资料

- MCP协议规范：https://modelcontextprotocol.io
- UE5像素流文档：https://docs.unrealengine.com/pixel-streaming
- api.json 示例：`E:\Git\claude\pixelstreming-mcp-bridge\Api.json`

---

**文档结束**
