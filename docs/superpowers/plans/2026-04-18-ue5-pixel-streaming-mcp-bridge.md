# UE5像素流MCP桥接系统实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个MCP Server，将UE5像素流API动态暴露为MCP Tools，支持AI助手通过自然语言控制像素流实例。

**Architecture:** 单文件Server架构，从Api.json动态生成MCP Tools，通过WebSocket连接像素流实例，使用简单格式（action_name + timestamp）匹配请求响应。

**Tech Stack:** TypeScript, Node.js, @modelcontextprotocol/sdk, ws (WebSocket客户端)

---

## File Structure

```
pixelstreming-mcp-bridge/
├── src/
│   ├── index.ts          # MCP Server入口 + 核心逻辑
│   └── types.ts          # TypeScript类型定义
├── dist/                  # 编译输出
├── Api.json              # 像素流命令定义（已存在）
├── package.json          # 项目配置
├── tsconfig.json         # TypeScript配置
└── .gitignore            # Git忽略配置
```

---

### Task 1: 项目初始化

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "pixelstreaming-mcp-bridge",
  "version": "1.0.0",
  "description": "MCP Bridge for UE5 Pixel Streaming",
  "main": "dist/index.js",
  "type": "commonjs",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc --watch"
  },
  "keywords": ["mcp", "pixel-streaming", "ue5"],
  "license": "MIT",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "ws": "^8.16.0"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@types/ws": "^8.5.10",
    "typescript": "^5.3.0"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: 创建 .gitignore**

```
node_modules/
dist/
*.log
.env
.DS_Store
```

- [ ] **Step 4: 创建 src 目录**

```bash
mkdir -p src
```

- [ ] **Step 5: 安装依赖**

```bash
cd E:\Git\claude\pixelstreming-mcp-bridge && npm install
```

Expected: 依赖安装成功，生成 node_modules 目录和 package-lock.json

---

### Task 2: 定义TypeScript类型

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: 创建类型定义文件**

```typescript
// src/types.ts

/**
 * Api.json 中的命令定义结构
 */
export interface ApiCommand {
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

/**
 * 像素流请求消息格式
 */
export interface PixelStreamingRequest {
  category: string;
  action_name: string;
  action_data: Record<string, unknown>;
}

/**
 * 像素流响应消息格式
 */
export interface PixelStreamingResponse {
  category: string;
  action_name: string;
  action_result: 'success' | 'error';
  result_data?: Record<string, unknown>;
  timestamp?: string;
  error?: { code?: string; message?: string };
}

/**
 * 待处理命令（用于请求-响应匹配）
 */
export interface PendingCommand {
  actionName: string;
  timestamp: number;
  resolve: (result: PixelStreamingResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/**
 * 配置选项
 */
export interface Config {
  apiJsonPath: string;
  pixelStreamingUrl: string;
  commandTimeout: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * MCP Tool 定义
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * 从 action_name 解析出的命令标识
 */
export interface ParsedToolName {
  category: string;
  actionName: string;
}
```

- [ ] **Step 2: 验证类型编译**

```bash
cd E:\Git\claude\pixelstreming-mcp-bridge && npx tsc --noEmit
```

Expected: 无错误输出

---

### Task 3: 实现配置加载和日志工具

**Files:**
- Create: `src/index.ts` (开始编写，包含配置加载和日志)

- [ ] **Step 1: 创建配置加载函数**

在 `src/index.ts` 中添加：

```typescript
// src/index.ts
import { readFileSync, existsSync } from 'fs';
import { Config, ApiCommand, ToolDefinition, ParsedToolName } from './types';

/**
 * 加载环境变量配置
 */
function loadConfig(): Config {
  const apiJsonPath = process.env.API_JSON_PATH;
  const pixelStreamingUrl = process.env.PIXEL_STREAMING_URL;

  if (!apiJsonPath) {
    console.error('[BRIDGE_001] Missing required environment variable: API_JSON_PATH');
    process.exit(1);
  }

  if (!pixelStreamingUrl) {
    console.error('[BRIDGE_001] Missing required environment variable: PIXEL_STREAMING_URL');
    process.exit(1);
  }

  return {
    apiJsonPath,
    pixelStreamingUrl,
    commandTimeout: parseInt(process.env.COMMAND_TIMEOUT || '10000', 10),
    logLevel: (process.env.LOG_LEVEL as Config['logLevel']) || 'info',
  };
}

/**
 * 日志级别优先级
 */
const LOG_LEVELS: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * 创建日志函数
 */
function createLogger(level: Config['logLevel']) {
  const currentLevel = LOG_LEVELS[level] || LOG_LEVELS.info;

  return {
    debug: (msg: string, ...args: unknown[]) => {
      if (currentLevel <= LOG_LEVELS.debug) console.error(`[DEBUG] ${msg}`, ...args);
    },
    info: (msg: string, ...args: unknown[]) => {
      if (currentLevel <= LOG_LEVELS.info) console.error(`[INFO] ${msg}`, ...args);
    },
    warn: (msg: string, ...args: unknown[]) => {
      if (currentLevel <= LOG_LEVELS.warn) console.error(`[WARN] ${msg}`, ...args);
    },
    error: (msg: string, ...args: unknown[]) => {
      if (currentLevel <= LOG_LEVELS.error) console.error(`[ERROR] ${msg}`, ...args);
    },
  };
}

// 初始化配置和日志（延迟到 main 函数中）
let config: Config;
let log: ReturnType<typeof createLogger>;
```

- [ ] **Step 2: 验证编译**

```bash
cd E:\Git\claude\pixelstreming-mcp-bridge && npx tsc --noEmit
```

Expected: 无错误输出

---

### Task 4: 实现Api.json解析和Tool生成

**Files:**
- Modify: `src/index.ts` (添加API解析和Tool生成逻辑)

- [ ] **Step 1: 添加加载Api.json函数**

在 `src/index.ts` 中添加：

```typescript
/**
 * 加载并解析 Api.json
 */
function loadApiCommands(apiJsonPath: string): ApiCommand[] {
  if (!existsSync(apiJsonPath)) {
    console.error(`[BRIDGE_001] API JSON file not found: ${apiJsonPath}`);
    process.exit(1);
  }

  try {
    const content = readFileSync(apiJsonPath, 'utf-8');
    const commands = JSON.parse(content) as ApiCommand[];
    return commands;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[BRIDGE_001] Failed to parse api.json: ${reason}`);
    process.exit(1);
  }
}
```

- [ ] **Step 2: 添加JSON Schema推断函数**

在 `src/index.ts` 中添加：

```typescript
/**
 * 根据值推断 JSON Schema 类型
 */
function inferSchema(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) {
    return { type: 'null' };
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { type: 'array', items: {} };
    }
    // 假设数组元素类型一致，取第一个元素推断
    const itemSchema = inferSchema(value[0]);
    return { type: 'array', items: itemSchema };
  }

  const type = typeof value;

  if (type === 'number') {
    return { type: 'number' };
  }

  if (type === 'string') {
    return { type: 'string' };
  }

  if (type === 'boolean') {
    return { type: 'boolean' };
  }

  if (type === 'object') {
    const obj = value as Record<string, unknown>;
    const properties: Record<string, unknown> = {};

    for (const key of Object.keys(obj)) {
      properties[key] = inferSchema(obj[key]);
    }

    return { type: 'object', properties };
  }

  return {};
}
```

- [ ] **Step 3: 添加Tool生成函数**

在 `src/index.ts` 中添加：

```typescript
/**
 * 从 ApiCommand 生成 MCP Tool 定义
 */
function generateTools(commands: ApiCommand[]): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  for (const cmd of commands) {
    for (const action of cmd.action) {
      const toolName = `ue5_${cmd.category}_${action.action_name}`;
      const description = `[${cmd.category_zh}] ${action.action_name}`;

      let properties: Record<string, unknown> = {};

      // 从第一个示例推断参数结构
      if (action.action_example.length > 0) {
        const exampleData = action.action_example[0].example_data;
        properties = inferSchema(exampleData).properties as Record<string, unknown>;
      }

      tools.push({
        name: toolName,
        description,
        inputSchema: {
          type: 'object',
          properties,
        },
      });
    }
  }

  return tools;
}
```

- [ ] **Step 4: 验证编译**

```bash
cd E:\Git\claude\pixelstreming-mcp-bridge && npx tsc --noEmit
```

Expected: 无错误输出

---

### Task 5: 实现WebSocket连接管理

**Files:**
- Modify: `src/index.ts` (添加WebSocket客户端逻辑)

- [ ] **Step 1: 添加WebSocket导入和状态变量**

在 `src/index.ts` 顶部添加导入：

```typescript
import WebSocket from 'ws';
import { PendingCommand, PixelStreamingResponse } from './types';
```

在全局变量区域添加：

```typescript
// WebSocket 连接和待处理命令
let ws: WebSocket | null = null;
const pendingCommands = new Map<string, PendingCommand>();
```

- [ ] **Step 2: 添加WebSocket连接函数**

在 `src/index.ts` 中添加：

```typescript
/**
 * 连接到像素流 WebSocket
 */
function connectWebSocket(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    log.info(`Connecting to pixel streaming at ${url}...`);

    ws = new WebSocket(url);

    ws.on('open', () => {
      log.info('WebSocket connected successfully');
      resolve();
    });

    ws.on('message', (data: WebSocket.Data) => {
      handleWebSocketMessage(data);
    });

    ws.on('error', (err: Error) => {
      log.error('WebSocket error:', err.message);
    });

    ws.on('close', () => {
      log.warn('WebSocket connection closed');
      ws = null;
    });

    // 连接超时
    setTimeout(() => {
      if (ws?.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket connection timeout'));
      }
    }, 5000);
  });
}
```

- [ ] **Step 3: 添加消息处理函数**

在 `src/index.ts` 中添加：

```typescript
/**
 * 处理 WebSocket 消息
 */
function handleWebSocketMessage(data: WebSocket.Data): void {
  try {
    const message = JSON.parse(data.toString()) as PixelStreamingResponse;
    log.debug('Received message:', JSON.stringify(message));

    // 查找匹配的待处理命令
    const { action_name } = message;
    if (!action_name) {
      log.warn('Received message without action_name');
      return;
    }

    // 找到时间戳最近的匹配命令
    let matchedKey: string | null = null;
    let matchedCommand: PendingCommand | null = null;
    const now = Date.now();

    for (const [key, pending] of pendingCommands) {
      if (pending.actionName === action_name) {
        // 选择时间戳最近且未超时的命令
        if (!matchedCommand || pending.timestamp > matchedCommand.timestamp) {
          matchedKey = key;
          matchedCommand = pending;
        }
      }
    }

    if (matchedCommand) {
      clearTimeout(matchedCommand.timeout);
      pendingCommands.delete(matchedKey!);

      if (message.action_result === 'success') {
        matchedCommand.resolve(message);
      } else {
        const error = new Error(message.error?.message || 'Unknown error');
        matchedCommand.reject(error);
      }
    } else {
      log.debug(`No pending command found for action: ${action_name}`);
    }
  } catch (err) {
    log.error('Failed to parse WebSocket message:', err);
  }
}
```

- [ ] **Step 4: 验证编译**

```bash
cd E:\Git\claude\pixelstreming-mcp-bridge && npx tsc --noEmit
```

Expected: 无错误输出

---

### Task 6: 实现命令发送和Tool名称解析

**Files:**
- Modify: `src/index.ts` (添加命令发送逻辑)

- [ ] **Step 1: 添加Tool名称解析函数**

在 `src/index.ts` 中添加：

```typescript
/**
 * 解析 Tool 名称为 category 和 action_name
 * 格式: ue5_{category}_{action_name}
 */
function parseToolName(toolName: string): ParsedToolName | null {
  const match = toolName.match(/^ue5_(.+)_(.+)$/);
  if (!match) {
    return null;
  }
  return {
    category: match[1],
    actionName: match[2],
  };
}
```

- [ ] **Step 2: 添加命令发送函数**

在 `src/index.ts` 中添加：

```typescript
/**
 * 发送命令到像素流
 */
function sendCommand(
  category: string,
  actionName: string,
  actionData: Record<string, unknown>
): Promise<PixelStreamingResponse> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('[BRIDGE_002] WebSocket not connected to pixel streaming instance'));
      return;
    }

    const request = {
      category,
      action_name: actionName,
      action_data: actionData,
    };

    const timestamp = Date.now();
    const key = `${category}.${actionName}.${timestamp}`;

    // 设置超时
    const timeout = setTimeout(() => {
      pendingCommands.delete(key);
      reject(new Error(`[BRIDGE_003] Command '${actionName}' timed out after ${config.commandTimeout}ms`));
    }, config.commandTimeout);

    // 记录待处理命令
    pendingCommands.set(key, {
      actionName,
      timestamp,
      resolve,
      reject,
      timeout,
    });

    // 发送请求
    const message = JSON.stringify(request);
    log.debug(`Sending: ${message}`);
    ws.send(message);
  });
}
```

- [ ] **Step 3: 验证编译**

```bash
cd E:\Git\claude\pixelstreming-mcp-bridge && npx tsc --noEmit
```

Expected: 无错误输出

---

### Task 7: 实现MCP Server

**Files:**
- Modify: `src/index.ts` (添加MCP Server主逻辑)

- [ ] **Step 1: 添加MCP SDK导入**

在 `src/index.ts` 顶部添加：

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
```

- [ ] **Step 2: 添加创建MCP Server函数**

在 `src/index.ts` 中添加：

```typescript
/**
 * 创建 MCP Server
 */
function createMcpServer(tools: ToolDefinition[]): Server {
  const server = new Server(
    {
      name: 'ue5-pixel-streaming-bridge',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // 处理 tools/list 请求
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  // 处理 tools/call 请求
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    log.info(`Tool called: ${name}`);

    const parsed = parseToolName(name);
    if (!parsed) {
      return {
        content: [
          {
            type: 'text',
            text: `Invalid tool name format: ${name}. Expected format: ue5_{category}_{action_name}`,
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await sendCommand(parsed.category, parsed.actionName, args || {});

      if (result.action_result === 'success') {
        return {
          content: [
            {
              type: 'text',
              text: `Command '${parsed.actionName}' executed successfully. Result: ${JSON.stringify(result.result_data || {})}`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text',
              text: `[BRIDGE_004] Pixel streaming error: ${result.error?.message || 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: 'text',
            text: message,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}
```

- [ ] **Step 3: 验证编译**

```bash
cd E:\Git\claude\pixelstreming-mcp-bridge && npx tsc --noEmit
```

Expected: 无错误输出

---

### Task 8: 实现主入口函数

**Files:**
- Modify: `src/index.ts` (添加main函数和启动逻辑)

- [ ] **Step 1: 添加main函数**

在 `src/index.ts` 中添加：

```typescript
/**
 * 主入口函数
 */
async function main(): Promise<void> {
  // 1. 加载配置
  config = loadConfig();
  log = createLogger(config.logLevel);

  log.info('Starting UE5 Pixel Streaming MCP Bridge...');
  log.info(`Config: API_JSON_PATH=${config.apiJsonPath}, PIXEL_STREAMING_URL=${config.pixelStreamingUrl}`);

  // 2. 加载 API 定义
  const commands = loadApiCommands(config.apiJsonPath);
  log.info(`Loaded ${commands.length} command categories from api.json`);

  // 3. 生成 Tools
  const tools = generateTools(commands);
  log.info(`Generated ${tools.length} MCP tools`);

  // 4. 尝试连接 WebSocket
  try {
    await connectWebSocket(config.pixelStreamingUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`Failed to connect to pixel streaming: ${message}`);
    log.warn('MCP Server will start anyway. WebSocket commands will fail until connected.');
  }

  // 5. 创建并启动 MCP Server
  const server = createMcpServer(tools);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  log.info('MCP Server started and connected via stdio');
}

// 启动
main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 2: 验证完整编译**

```bash
cd E:\Git\claude\pixelstreming-mcp-bridge && npx tsc
```

Expected: 编译成功，生成 dist/index.js 和 dist/types.js

---

### Task 9: 测试MCP Server启动

**Files:**
- Test: `dist/index.js`

- [ ] **Step 1: 测试基本启动（缺少环境变量应报错）**

```bash
cd E:\Git\claude\pixelstreming-mcp-bridge && node dist/index.js
```

Expected: 输出 `[BRIDGE_001] Missing required environment variable: API_JSON_PATH`

- [ ] **Step 2: 测试完整配置启动**

```bash
cd E:\Git\claude\pixelstreming-mcp-bridge && API_JSON_PATH="E:/Git/claude/pixelstreming-mcp-bridge/Api.json" PIXEL_STREAMING_URL="ws://localhost:8888" node dist/index.js
```

Expected:
- 输出 `[INFO] Starting UE5 Pixel Streaming MCP Bridge...`
- 输出 `[INFO] Loaded X command categories from api.json`
- 输出 `[INFO] Generated X MCP tools`
- 输出 `[WARN] Failed to connect to pixel streaming...`（因为像素流实例未运行）
- Server 继续运行等待 stdio 输入

- [ ] **Step 3: 测试 MCP tools/list 请求**

使用 MCP Inspector 或手动发送 JSON-RPC 请求：

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | API_JSON_PATH="E:/Git/claude/pixelstreming-mcp-bridge/Api.json" PIXEL_STREAMING_URL="ws://localhost:8888" node dist/index.js
```

Expected: 返回包含所有生成的 tools 的 JSON 响应

---

### Task 10: 创建README文档

**Files:**
- Create: `README.md`

- [ ] **Step 1: 创建README文件**

```markdown
# UE5 Pixel Streaming MCP Bridge

MCP Bridge for UE5 Pixel Streaming, enabling AI assistants to control pixel streaming instances through natural language.

## Features

- Dynamically generates MCP Tools from `Api.json`
- WebSocket communication with pixel streaming instances
- Standard MCP protocol support (stdio transport)
- Compatible with Claude Desktop, QwenPaw, and other MCP clients

## Installation

```bash
npm install
npm run build
```

## Configuration

Set the following environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_JSON_PATH` | Yes | - | Absolute path to Api.json |
| `PIXEL_STREAMING_URL` | Yes | - | WebSocket URL of pixel streaming (e.g., `ws://localhost:8888`) |
| `COMMAND_TIMEOUT` | No | `10000` | Command timeout in milliseconds |
| `LOG_LEVEL` | No | `info` | Log level: `debug`, `info`, `warn`, `error` |

## Usage

### With Claude Desktop / QwenPaw

Add to your MCP client configuration:

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

### Example Usage

```
User: Move the camera to coordinates 5000, 2000, 3000 with a top-down view

AI: Calling ue5_camera_transformCamera...
{
  "position": [5000, 2000, 3000],
  "pitch": -45,
  "time": 1.0
}
✅ Command executed successfully
```

## Error Codes

| Code | Description |
|------|-------------|
| `BRIDGE_001` | Api.json file not found or parse error |
| `BRIDGE_002` | WebSocket not connected |
| `BRIDGE_003` | Command execution timeout |
| `BRIDGE_004` | Pixel streaming returned an error |

## Development

```bash
# Build
npm run build

# Watch mode
npm run dev
```

## License

MIT
```

- [ ] **Step 2: 验证文档完整性**

检查 README.md 文件内容是否包含：
- 安装说明
- 配置说明
- 使用示例
- 错误码说明
- 开发说明

---

## Self-Review

**1. Spec coverage:**
- ✅ 项目结构: Task 1
- ✅ 类型定义: Task 2
- ✅ 配置加载: Task 3
- ✅ API解析和Tool生成: Task 4
- ✅ WebSocket管理: Task 5
- ✅ 命令发送: Task 6
- ✅ MCP Server: Task 7
- ✅ 主入口: Task 8
- ✅ 测试: Task 9
- ✅ 文档: Task 10

**2. Placeholder scan:**
- ✅ 无 TBD/TODO
- ✅ 所有代码步骤包含完整实现
- ✅ 所有命令包含预期输出

**3. Type consistency:**
- ✅ `ApiCommand`, `Config`, `ToolDefinition`, `PendingCommand`, `PixelStreamingResponse` 等类型在 types.ts 中定义
- ✅ 函数参数和返回值类型一致
- ✅ 变量命名一致 (`actionName` vs `action_name` 区分使用)

---

**Plan complete.** Ready for execution.
