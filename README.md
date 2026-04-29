# UE5 像素流 MCP 桥接系统

基于 SSE/HTTP 架构的 UE5 像素流 MCP 桥接系统，支持 AI 助手通过自然语言控制 UE5 像素流实例。

## 架构

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

## 功能特性

- 从 `Api.json` 动态生成 MCP Tools（147 个工具）
- SSE 推送命令到像素流网页
- HTTP POST 接收响应
- 支持标准 MCP 协议（stdio 传输模式）
- 兼容 Claude Code、QwenPaw 等 MCP 客户端
- 模拟模式支持（无需 UE5 也可测试）
- 响应自动匹配（兼容老项目非标准 JSON 格式）

## 安装

```bash
npm install
npm run build
```

## 配置

### 环境变量

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `API_JSON_PATH` | 是 | - | Api.json 文件的绝对路径 |
| `HTTP_PORT` | 否 | `8080` | HTTP/SSE 服务器端口 |
| `COMMAND_TIMEOUT` | 否 | `30000` | 命令超时时间（毫秒） |
| `LOG_LEVEL` | 否 | `info` | 日志级别：`debug`、`info`、`warn`、`error` |
| `SIMULATE_MODE` | 否 | `false` | 模拟模式（无 SSE 客户端时返回模拟响应） |

### MCP 客户端配置

在 QwenPaw 或 Claude Code 的配置中添加：

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

## HTTP 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/events` | GET | SSE 端点，推送命令到像素流网页 |
| `/response` | POST | 接收像素流网页的响应 |
| `/heartbeat` | POST | 心跳响应端点 |
| `/health` | GET | 健康检查 |

## 心跳机制

为了自动清理僵尸连接，MCP Bridge 实现了心跳检测：

- **心跳间隔**：每 30 秒发送 `ping` 消息
- **心跳超时**：60 秒无响应则断开连接
- **响应方式**：前端收到 `ping` 后 POST `/heartbeat`

```
MCP Bridge                    前端 SSE 客户端
    |                              |
    |--- ping (每30秒) ------------>|
    |                              |
    |<-- POST /heartbeat ----------|
    |                              |
    |  (60秒无响应则断开连接)        |
```

## 使用流程

1. **启动 UE5 像素流服务器**（端口 8888）
2. **启动 AI 客户端**（QwenPaw/Claude Code）→ MCP Bridge 自动启动
3. **启动像素流网页**（Chat 项目）→ 连接 SSE
4. **AI 发送命令** → MCP Bridge → SSE → 网页 → WebRTC → UE5
5. **UE5 响应** → WebRTC → 网页 → HTTP POST → MCP Bridge → AI

## 支持的命令分类

系统从 Api.json 自动生成以下类别的 MCP Tools：

| 分类 | 说明 | 工具示例 |
|------|------|----------|
| actor | 对象操作 | `ue5_actor_focusActor`, `ue5_actor_setActorTransform` |
| camera | 镜头控制 | `ue5_camera_transformCamera`, `ue5_camera_rotateCamera` |
| common | 通用设置 | `ue5_common_playerSpeed`, `ue5_common_setResolutionSize` |
| dimenssion | 测量工具 | `ue5_dimenssion_dimenssion`, `ue5_dimenssion_changeUnits` |
| heatmap | 热力图 | `ue5_heatmap_drawHeatMap`, `ue5_heatmap_createHeatMap` |
| map | 地图操作 | `ue5_map_loadMap` |
| poi | 兴趣点 | `ue5_poi_updatePois`, `ue5_poi_focusPoi` |
| radar | 雷达图 | `ue5_radar_updateRadars`, `ue5_radar_getInfoRadars` |
| ring | 扩散圈 | `ue5_ring_updateRings`, `ue5_ring_deleteRings` |
| space | 空间绘制 | `ue5_space_drawSpace`, `ue5_space_deleteSpaces` |
| project | 项目控制 | `ue5_project_setEvnTime`, `ue5_project_setWeather` |
| poi3d | 3D兴趣点 | `ue5_poi3d_update3DPois` |

## 错误码

| 错误码 | 说明 |
|--------|------|
| `BRIDGE_001` | Api.json 文件不存在或解析失败 |
| `BRIDGE_002` | 无 SSE 客户端连接 |
| `BRIDGE_003` | 命令执行超时 |
| `BRIDGE_004` | 像素流返回错误 |

## 响应匹配

支持两种响应格式：

1. **标准格式**：`{commandId: 'xxx', result: {...}}`
2. **老项目格式**：`{message: '初始化完成'}`（自动匹配最近命令）

## 开发

```bash
# 构建
npm run build

# 监听模式
npm run dev
```

## 项目结构

```
pixelstreming-mcp-bridge/
├── src/
│   ├── index.ts          # MCP Server 入口 + 核心逻辑
│   └── types.ts          # TypeScript 类型定义
├── dist/                  # 编译输出
├── api.json              # 像素流命令定义
├── package.json
├── tsconfig.json
└── README.md
```

## 许可证

MIT
