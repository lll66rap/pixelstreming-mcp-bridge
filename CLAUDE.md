# PixelStreaming MCP Bridge

MCP Bridge for UE5 Pixel Streaming - 通过 SSE 连接 Claude 与 UE5 像素流应用。

## 项目概述

本项目实现了 Model Context Protocol (MCP) 服务器，作为 Claude 与 UE5 像素流应用之间的桥梁。支持：

- **MCP 协议**: 通过 stdio 与 Claude 通信
- **SSE (Server-Sent Events)**: 与像素流网页客户端通信
- **HTTP API**: 接收来自 UE5 的响应

## 技术栈

- **语言**: TypeScript 5.3+
- **运行时**: Node.js (CommonJS)
- **依赖**:
  - `@modelcontextprotocol/sdk` - MCP SDK
  - `ws` - WebSocket 支持
- **构建**: `tsc` 编译到 `dist/`

## 开发命令

```bash
# 安装依赖
npm install

# 构建
npm run build

# 开发模式（监听编译）
npm run dev

# 启动服务
npm start

# 环境变量配置
API_JSON_PATH=/path/to/api.json    # 必需：API 定义文件路径
PIXEL_STREAMING_URL=http://localhost:8080  # 像素流服务地址
COMMAND_TIMEOUT=30000              # 命令超时（毫秒）
HTTP_PORT=8080                     # HTTP/SSE 服务端口
LOG_LEVEL=info                     # 日志级别: debug|info|warn|error
SIMULATE_MODE=true                 # 模拟模式（无客户端时返回模拟响应）
```

---

## 代码风格

### 类型定义

- **导出函数必须有显式类型**: 所有 exported functions 必须包含参数和返回类型
- **使用 `interface` 定义对象形状**: 便于扩展和实现
- **使用 `type` 定义联合类型、工具类型**: 如 `type LogLevel = 'debug' | 'info' | 'warn' | 'error'`
- **禁止 `any`**: 使用 `unknown` + 类型守卫

```typescript
// ✅ 正确
export function loadConfig(): Config {
  // ...
}

// ❌ 错误
export function loadConfig(config) {
  // ...
}
```

### 不可变性

- **禁止原地修改对象**: 使用展开运算符创建新对象

```typescript
// ✅ 正确
function updateClient(client: SSEClient, heartbeat: number): SSEClient {
  return { ...client, lastHeartbeat: heartbeat };
}

// ❌ 错误
function updateClient(client: SSEClient, heartbeat: number): SSEClient {
  client.lastHeartbeat = heartbeat;  // 原地修改!
  return client;
}
```

### 命名约定

| 类型 | 约定 | 示例 |
|------|------|------|
| 变量/函数 | camelCase | `sendCommand`, `sseClients` |
| 常量 | UPPER_SNAKE_CASE | `HEARTBEAT_INTERVAL`, `ERROR_CODES` |
| 接口/类型 | PascalCase | `SSEClient`, `PendingCommand` |
| 私有变量 | 下划线前缀 | `_internal` |

### 文件组织

- **单文件不超过 800 行**: 超过时拆分模块
- **函数不超过 50 行**: 超过时提取子函数
- **嵌套不超过 4 层**: 使用早返回减少嵌套

### 错误处理

- **使用 try-catch 处理异步错误**
- **错误消息使用定义的错误码**: 参考 `ERROR_CODES`
- **不捕获未处理的异常后继续**: 记录日志但保持服务运行

```typescript
// ✅ 正确
async function handleRequest(req: IncomingMessage): Promise<void> {
  try {
    const data = await parseBody(req);
    // ...
  } catch (error: unknown) {
    if (error instanceof Error) {
      log.error('Request failed:', error.message);
    }
    throw error;
  }
}
```

---

## PR 要求

### 提交前检查清单

- [ ] 代码通过 `npm run build` 编译
- [ ] 无 TypeScript 类型错误
- [ ] 无 `console.log` 语句（使用 `log` 对象）
- [ ] 新功能有对应注释说明
- [ ] 导出函数有 JSDoc 注释
- [ ] 无硬编码敏感信息（API 密钥、密码等）

### Commit Message 格式

```
<type>: <description>

[optional body]
```

**类型**:
- `feat`: 新功能
- `fix`: Bug 修复
- `refactor`: 重构（不改变功能）
- `docs`: 文档更新
- `test`: 测试相关
- `chore`: 构建/工具变更
- `perf`: 性能优化

**示例**:
```
feat: 添加心跳检测机制

- 实现 SSE 客户端心跳检测
- 自动断开超时客户端
- 添加 /heartbeat 端点
```

### PR 流程

1. **Fork & Branch**: 从 `main` 创建功能分支
2. **开发**: 遵循代码风格
3. **自测**: 确保本地构建通过
4. **提交**: 使用规范的 commit message
5. **创建 PR**:
   - 描述变更内容
   - 关联相关 Issue
   - 包含测试计划

---

## 禁止事项

### 🚫 绝对禁止

| 禁止项 | 原因 | 替代方案 |
|--------|------|----------|
| 硬编码密钥/密码 | 安全风险 | 使用环境变量 |
| `any` 类型 | 类型安全丢失 | `unknown` + 类型守卫 |
| `console.log` | 影响stdio通信 | 使用 `console.error` 或 `log` 对象 |
| 原地修改对象 | 难以追踪bug | 展开运算符创建新对象 |
| 未处理的 Promise rejection | 进程不稳定 | try-catch + 错误日志 |
| 提交敏感文件 | 安全风险 | 添加到 `.gitignore` |

### ⚠️ 谨慎使用

| 项目 | 说明 |
|------|------|
| `console.error` | 仅用于日志输出（不影响 stdio MCP 通信） |
| 全局变量 | 尽量使用依赖注入或模块导出 |
| `process.exit()` | 仅在初始化失败时使用 |

---

## 架构说明

### 核心组件

```
┌─────────────────┐     stdio      ┌─────────────────┐
│   Claude/App    │ ◄────────────► │   MCP Server    │
└─────────────────┘                │   (index.ts)    │
                                   └────────┬────────┘
                                            │
                                   ┌────────▼────────┐
                                   │  HTTP/SSE Server │
                                   │   (port 8080)    │
                                   └────────┬────────┘
                                            │ SSE
                                   ┌────────▼────────┐
                                   │ Pixel Streaming │
                                   │   Web Client    │
                                   └────────┬────────┘
                                            │ WebSocket
                                   ┌────────▼────────┐
                                   │      UE5        │
                                   └─────────────────┘
```

### 关键接口

- **POST /response**: 接收 UE5 执行结果
- **GET /events**: SSE 端点，推送命令到网页
- **POST /heartbeat**: 心跳检测
- **GET /health**: 健康检查

### 命令流程

1. Claude 调用 MCP Tool
2. MCP Server 生成命令 ID 并通过 SSE 发送
3. 网页客户端接收命令，转发给 UE5
4. UE5 执行完成后，网页客户端 POST 结果到 `/response`
5. MCP Server 匹配命令 ID，返回结果给 Claude

---

## 文件结构

```
pixelstreaming-mcp-bridge/
├── src/
│   ├── index.ts          # 主入口、MCP Server、HTTP Server
│   └── types.ts          # 类型定义
├── dist/                 # 编译输出
├── package.json
├── tsconfig.json
└── CLAUDE.md             # 本文件
```

---

## 相关资源

- [MCP SDK 文档](https://github.com/modelcontextprotocol/typescript-sdk)
- [像素流文档](https://docs.unrealengine.com/5.0/en-US/pixel-streaming-in-unreal-engine/)
