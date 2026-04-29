# UE5 像素流 MCP 桥接系统 - 项目总结

## 项目概述

本项目实现了一个完整的 UE5 像素流 MCP 桥接系统，使 AI 助手（如 QwenPaw、Claude Code）能够通过自然语言控制 UE5 像素流实例。

## 技术架构

### 整体架构

```
┌─────────────┐   MCP(stdio)   ┌─────────────┐   SSE/HTTP   ┌─────────────┐
│   AI 客户端   │ ─────────────▶ │ MCP Bridge  │ ◀──────────▶ │  像素流网页  │
│ (QwenPaw等)  │                │  :8080      │              │             │
└─────────────┘                └─────────────┘              └──────┬──────┘
                                                              │ WebRTC
                                                              ▼
                                                         ┌─────────────┐
                                                         │     UE5     │
                                                         └─────────────┘
```

### 通信流程

1. **AI → MCP Bridge**：MCP 协议（stdio 传输）
2. **MCP Bridge → 网页**：SSE 推送命令
3. **网页 → UE5**：WebRTC DataChannel
4. **UE5 → 网页**：WebRTC DataChannel 响应
5. **网页 → MCP Bridge**：HTTP POST 响应
6. **MCP Bridge → AI**：MCP 协议返回结果

## 项目组成

### 1. MCP Bridge（pixelstreming-mcp-bridge）

**技术栈**：TypeScript + Node.js + MCP SDK

**核心功能**：
- 从 `api.json` 动态生成 147 个 MCP Tools
- HTTP/SSE 服务器（端口 8080）
- MCP Server（stdio 传输）
- 命令超时管理
- 模拟模式支持

**关键文件**：
- `src/index.ts` - 主入口，MCP Server + HTTP 服务器
- `src/types.ts` - TypeScript 类型定义
- `api.json` - UE5 命令定义

### 2. 像素流服务（chat 项目）

**技术栈**：Vue 3 + TypeScript + PixelStreaming SDK

**核心功能**：
- WebRTC 像素流连接
- SSE 客户端（接收命令）
- HTTP POST（发送响应）
- 命令 ID 匹配
- 响应格式适配（兼容老项目）

**关键文件**：
- `src/pixelStreamingService.ts` - 像素流服务类
- `src/PixelStreaming.vue` - Vue 组件
- `src/QwenPawChat.vue` - 聊天组件

## 技术亮点

### 1. 命令 ID 匹配机制

区分 AI 控制命令和用户网页交互：
- AI 命令带有 `commandId`，响应需要匹配
- 用户交互无 `commandId`，本地处理

### 2. 响应格式适配

兼容两种响应格式：
- **标准格式**：`{commandId: 'xxx', result: {...}}`
- **老项目格式**：`{message: '初始化完成'}`（自动匹配最近命令）

### 3. 模拟模式

支持多层级模拟：
- 网页端模拟：像素流未连接时返回模拟响应
- Bridge 端模拟：无 SSE 客户端时返回模拟响应

### 4. 错误处理

完善的错误码体系：
- `BRIDGE_001`：配置错误
- `BRIDGE_002`：连接错误
- `BRIDGE_003`：超时错误
- `BRIDGE_004`：执行错误

## 配置说明

### MCP Bridge 环境变量

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `API_JSON_PATH` | 是 | - | Api.json 文件路径 |
| `HTTP_PORT` | 否 | `8080` | HTTP/SSE 端口 |
| `COMMAND_TIMEOUT` | 否 | `30000` | 命令超时（毫秒） |
| `LOG_LEVEL` | 否 | `info` | 日志级别 |
| `SIMULATE_MODE` | 否 | `false` | 模拟模式 |

### QwenPaw MCP 配置

```json
{
  "mcpServers": {
    "pixelstreaming": {
      "command": "node",
      "args": ["E:/Git/claude/pixelstreming-mcp-bridge/dist/index.js"],
      "env": {
        "API_JSON_PATH": "E:/Git/claude/pixelstreming-mcp-bridge/api.json",
        "HTTP_PORT": "8080"
      }
    }
  }
}
```

## 使用方式

### 完整模式

1. 启动 UE5 像素流服务器（端口 8888）
2. 启动 AI 客户端 → MCP Bridge 自动启动
3. 启动像素流网页 → 连接 SSE
4. AI 发送命令控制 UE5

### 测试模式

1. 启动 AI 客户端（设置 `SIMULATE_MODE=true`）
2. AI 发送命令 → 返回模拟响应

## 支持的命令

从 `api.json` 生成 13 个分类、147 个工具：

| 分类 | 说明 |
|------|------|
| actor | 对象操作 |
| camera | 镜头控制 |
| common | 通用设置 |
| dimenssion | 测量工具 |
| heatmap | 热力图 |
| map | 地图操作 |
| poi | 兴趣点 |
| radar | 雷达图 |
| ring | 扩散圈 |
| space | 空间绘制 |
| project | 项目控制 |
| poi3d | 3D兴趣点 |

## 遇到的问题及解决方案

### 1. WebSocket 直接连接 UE5 不可行

**问题**：UE5 像素流使用 WebRTC，不是直接 WebSocket。

**解决**：改用 SSE/HTTP 架构，像素流网页作为中间层。

### 2. MCP 客户端连接超时

**问题**：MCP Bridge 启动时间过长导致超时。

**解决**：优化初始化顺序，确保 MCP 连接优先于 HTTP 服务器。

### 3. 拖拽功能失效

**问题**：`draggable` 是 HTML 原生属性，被 Vue 错误处理。

**解决**：使用 `inheritAttrs: false` 并重命名 prop。

### 4. 老项目响应格式不兼容

**问题**：UE5 返回 `{message: 'xxx'}` 无 `commandId`。

**解决**：添加响应匹配机制，自动匹配最近发送的命令。

## 后续优化建议

1. **UE5 端标准化**：让 UE5 返回标准格式 `{commandId, result}`
2. **重连机制**：SSE 断开后自动重连
3. **命令队列**：支持批量命令执行
4. **状态同步**：UE5 状态实时同步到 AI
5. **权限控制**：限制 AI 可执行的命令范围

## 总结

本项目成功实现了 AI 控制 UE5 像素流的完整链路，采用 SSE/HTTP 架构解决了 WebRTC 通信问题，通过命令 ID 匹配实现了 AI 控制与用户交互的区分，支持模拟模式便于测试，兼容老项目响应格式。

---

**开发时间**：2026-04-19  
**技术栈**：TypeScript, Node.js, Vue 3, MCP SDK, PixelStreaming SDK  
**代码量**：~500 行核心代码
