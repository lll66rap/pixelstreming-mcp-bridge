// src/index.ts
import { readFileSync, existsSync } from 'fs';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { Config, ApiCommand, ToolDefinition, ParsedToolName } from './types';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * 错误码定义（P1 优化）
 */
interface ErrorCodeDefinition {
  code: string;
  message: string;
  suggestion: string;
}

const ERROR_CODES: Record<string, ErrorCodeDefinition> = {
  BRIDGE_001: {
    code: 'CONFIG_ERROR',
    message: '配置错误',
    suggestion: '请检查环境变量配置是否正确',
  },
  BRIDGE_002: {
    code: 'NO_CLIENT',
    message: '无可用客户端',
    suggestion: '请先打开像素流网页建立 SSE 连接，或设置 SIMULATE_MODE=true 进行测试',
  },
  BRIDGE_003: {
    code: 'TIMEOUT',
    message: '命令执行超时',
    suggestion: '请检查 UE5 是否响应，可通过 COMMAND_TIMEOUT 环境变量调整超时时间',
  },
  BRIDGE_004: {
    code: 'UE5_ERROR',
    message: 'UE5 执行错误',
    suggestion: '请检查 UE5 日志确认错误原因',
  },
  BRIDGE_005: {
    code: 'DUPLICATE_COMMAND',
    message: '重复命令',
    suggestion: '命令已在执行中，请等待响应',
  },
};

/**
 * 创建错误消息
 */
function createErrorMessage(errorKey: string, details?: string): string {
  const errorDef = ERROR_CODES[errorKey];
  if (!errorDef) {
    return `[${errorKey}] 未知错误`;
  }
  return `[${errorKey}] ${errorDef.message}${details ? `: ${details}` : ''}\n💡 ${errorDef.suggestion}`;
}

/**
 * 加载环境变量配置
 */
function loadConfig(): Config {
  const apiJsonPath = process.env.API_JSON_PATH;

  if (!apiJsonPath) {
    console.error('[BRIDGE_001] Missing required environment variable: API_JSON_PATH');
    process.exit(1);
  }

  return {
    apiJsonPath,
    pixelStreamingUrl: process.env.PIXEL_STREAMING_URL || 'http://localhost:8080',
    commandTimeout: parseInt(process.env.COMMAND_TIMEOUT || '30000', 10),
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
let config!: Config;
let log!: ReturnType<typeof createLogger>;

// SSE 客户端连接管理（带心跳检测，P0-1 优化：使用 clientId 标识）
interface SSEClient {
  id: string;              // 客户端唯一标识
  res: ServerResponse;
  lastHeartbeat: number;  // 最后心跳时间戳
  isAlive: boolean;       // 是否存活
}
const sseClients = new Map<string, SSEClient>();  // 改用 Map，以 clientId 为 key

// 心跳配置
const HEARTBEAT_INTERVAL = 30000;  // 心跳间隔：30秒
const HEARTBEAT_TIMEOUT = 60000;   // 心跳超时：60秒

// 待处理命令（用于请求-响应匹配）
interface PendingCommand {
  commandId: string;
  actionName: string;
  timestamp: number;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}
const pendingCommands = new Map<string, PendingCommand>();

// 命令去重缓存（P0-2 优化）
interface RecentCommand {
  commandId: string;
  promise: Promise<unknown>;
  timestamp: number;
}
const recentCommands = new Map<string, RecentCommand>();
const DEDUP_WINDOW = 3000;  // 去重时间窗口：3秒

/**
 * 生成客户端 ID
 */
function generateClientId(): string {
  return `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 生成命令去重 key
 */
function generateCommandKey(category: string, actionName: string, actionData: Record<string, unknown>): string {
  return `${category}_${actionName}_${JSON.stringify(actionData)}`;
}

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

// 参数说明缓存
let parameterDescriptions: Record<string, Record<string, Record<string, unknown>>> = {};

/**
 * 加载参数说明文件
 */
function loadParameterDescriptions(): void {
  const apiJsonPath = process.env.API_JSON_PATH || '';
  const paramPath = apiJsonPath.replace('api.json', 'parameters.json').replace('Api.json', 'parameters.json');

  try {
    if (existsSync(paramPath)) {
      const content = readFileSync(paramPath, 'utf-8');
      parameterDescriptions = JSON.parse(content);
      console.error(`[INFO] Loaded parameter descriptions from ${paramPath}`);
    }
  } catch (err) {
    console.error(`[WARN] Failed to load parameters.json, using default descriptions`);
  }
}

/**
 * 获取参数说明
 */
function getParamDescription(category: string, actionName: string, paramName: string): string | undefined {
  const categoryParams = parameterDescriptions[category];
  if (!categoryParams) return undefined;

  const actionParams = categoryParams[actionName];
  if (!actionParams) return undefined;

  const paramInfo = actionParams[paramName] as { description?: string } | undefined;
  return paramInfo?.description;
}

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

      if (action.action_example.length > 0) {
        const exampleData = action.action_example[0].example_data;
        const inferredSchema = inferSchema(exampleData);
        const inferredProps = (inferredSchema.properties || {}) as Record<string, unknown>;

        // 为每个属性添加说明
        for (const [paramName, paramSchema] of Object.entries(inferredProps)) {
          const paramDesc = getParamDescription(cmd.category, action.action_name, paramName);

          if (typeof paramSchema === 'object' && paramSchema !== null) {
            properties[paramName] = {
              ...paramSchema,
              description: paramDesc || `${paramName} 参数`,
            };
          } else {
            properties[paramName] = paramSchema;
          }
        }
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

/**
 * 解析 Tool 名称为 category 和 action_name
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

/**
 * 生成唯一命令ID
 */
function generateCommandId(): string {
  return `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 通过 SSE 发送命令到像素流网页（P0-2 优化：添加命令去重）
 */
function sendCommandViaSSE(
  category: string,
  actionName: string,
  actionData: Record<string, unknown>
): Promise<unknown> {
  // P0-2: 命令去重检查
  const commandKey = generateCommandKey(category, actionName, actionData);
  const recentCommand = recentCommands.get(commandKey);
  const now = Date.now();

  if (recentCommand && now - recentCommand.timestamp < DEDUP_WINDOW) {
    log.warn(`Duplicate command detected: ${commandKey}, returning cached response`);
    return recentCommand.promise;
  }

  // 清理过期的去重缓存
  for (const [key, cmd] of recentCommands) {
    if (now - cmd.timestamp > DEDUP_WINDOW) {
      recentCommands.delete(key);
    }
  }

  const promise = new Promise<unknown>((resolve, reject) => {
    const commandId = generateCommandId();
    const timestamp = Date.now();

    const command = {
      commandId,
      category,
      action_name: actionName,
      action_data: actionData,
    };

    // 模拟模式：如果没有 SSE 客户端连接，返回模拟响应
    if (sseClients.size === 0) {
      const simulateMode = process.env.SIMULATE_MODE === 'true';
      if (simulateMode) {
        console.error(`[INFO] Simulate mode: returning mock response for '${actionName}'`);
        setTimeout(() => {
          resolve({ simulated: true, command: actionName, data: actionData });
        }, 100);
        return;
      }
      reject(new Error(createErrorMessage('BRIDGE_002')));
      return;
    }

    // 设置超时
    const timeout = setTimeout(() => {
      pendingCommands.delete(commandId);
      reject(new Error(createErrorMessage('BRIDGE_003', `命令 '${actionName}' 超时 ${config.commandTimeout}ms`)));
    }, config.commandTimeout);

    // 记录待处理命令
    pendingCommands.set(commandId, {
      commandId,
      actionName,
      timestamp,
      resolve,
      reject,
      timeout,
    });

    // 通过 SSE 发送到最新的存活客户端（P0-1: 使用 clientId）
    const message = `data: ${JSON.stringify(command)}\n\n`;
    const aliveClients = Array.from(sseClients.values()).filter(c => c.isAlive);
    const latestClient = aliveClients[aliveClients.length - 1];
    if (latestClient) {
      latestClient.res.write(message);
      log.info(`Command sent to client ${latestClient.id}: ${commandId}`);
    } else {
      // 没有存活的客户端，清理并拒绝
      pendingCommands.delete(commandId);
      clearTimeout(timeout);
      reject(new Error(createErrorMessage('BRIDGE_002', '无存活客户端')));
      return;
    }

    log.debug(`Command sent via SSE: ${JSON.stringify(command)}`);
  });

  // P0-2: 记录命令到去重缓存
  recentCommands.set(commandKey, {
    commandId: generateCommandId(),
    promise,
    timestamp: now,
  });

  return promise;
}

/**
 * 处理来自像素流网页的响应
 * 支持两种格式：
 * 1. 标准格式：{commandId: 'xxx', result: {...}}
 * 2. 老项目格式：{message: '初始化完成'}（自动匹配最近命令）
 */
function handleResponse(response: { commandId: string; result?: unknown; error?: string; message?: string }): void {
  const { commandId, result, error, message } = response;

  let pending: PendingCommand | undefined;

  if (commandId) {
    // 标准格式：通过 commandId 匹配
    pending = pendingCommands.get(commandId);
    if (!pending) {
      log.warn(`Received response for unknown commandId: ${commandId}`);
      return;
    }
  } else {
    // 老项目格式：匹配最近的待处理命令
    const pendingArray = Array.from(pendingCommands.values());
    if (pendingArray.length > 0) {
      // 取最新的待处理命令
      pending = pendingArray[pendingArray.length - 1];
      log.info(`Legacy format response, matched to latest pending command: ${pending.commandId}`);
    } else {
      log.warn('Received legacy format response but no pending commands');
      return;
    }
  }

  clearTimeout(pending.timeout);
  pendingCommands.delete(pending.commandId);

  if (error) {
    pending.reject(new Error(createErrorMessage('BRIDGE_004', error)));
  } else {
    // 支持老项目格式：如果没有 result，使用整个响应或 message
    const responseResult = result || (message ? { message } : response);
    pending.resolve(responseResult);
  }
}

/**
 * 创建 SSE + HTTP 服务器
 */
function createHttpServer(port: number): void {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // 设置 CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Client-ID');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // SSE 端点：推送命令（P0-1: 使用 clientId）
    if (req.method === 'GET' && req.url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // 创建客户端对象，生成唯一 clientId
      const clientId = generateClientId();
      const client: SSEClient = {
        id: clientId,
        res,
        lastHeartbeat: Date.now(),
        isAlive: true,
      };
      sseClients.set(clientId, client);
      log.info(`SSE client connected: ${clientId}. Total: ${sseClients.size}, Alive: ${Array.from(sseClients.values()).filter(c => c.isAlive).length}`);

      // 发送连接成功消息，包含 clientId
      res.write(`data: ${JSON.stringify({ type: 'connected', clientId, message: 'SSE connection established' })}\n\n`);

      req.on('close', () => {
        sseClients.delete(clientId);
        log.info(`SSE client disconnected: ${clientId}. Remaining: ${sseClients.size}`);
      });

      return;
    }

    // 心跳响应端点（P0-1: 使用 clientId）
    if (req.method === 'POST' && req.url === '/heartbeat') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          const { clientId } = data;
          const now = Date.now();

          // 通过 clientId 找到对应的客户端
          const client = sseClients.get(clientId);
          if (client && client.isAlive) {
            client.lastHeartbeat = now;
            log.debug(`Heartbeat received from client ${clientId}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', timestamp: now }));
          } else {
            log.warn(`Heartbeat from unknown client: ${clientId}`);
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'error', message: 'Client not found' }));
          }
        } catch (err) {
          log.error('Failed to handle heartbeat:', err);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: 'Invalid heartbeat' }));
        }
      });
      return;
    }

    // HTTP 端点：接收响应
    if (req.method === 'POST' && req.url === '/response') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          const response = JSON.parse(body);
          log.debug(`Received response: ${JSON.stringify(response)}`);
          handleResponse(response);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        } catch (err) {
          log.error('Failed to parse response:', err);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: 'Invalid JSON' }));
        }
      });
      return;
    }

    // 健康检查端点
    if (req.method === 'GET' && req.url === '/health') {
      const aliveCount = Array.from(sseClients.values()).filter(c => c.isAlive).length;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        sseClients: sseClients.size,
        aliveClients: aliveCount,
        pendingCommands: pendingCommands.size,
      }));
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'error', message: 'Not found' }));
  });

  // 启动心跳检测定时器
  startHeartbeatChecker();

  server.listen(port, () => {
    console.error(`[INFO] SSE endpoint: http://localhost:${port}/events`);
    console.error(`[INFO] Response endpoint: http://localhost:${port}/response`);
    console.error(`[INFO] Heartbeat endpoint: http://localhost:${port}/heartbeat`);
  });
}

/**
 * 启动心跳检测定时器（P0-1: 使用 clientId）
 */
function startHeartbeatChecker(): void {
  // 定时发送心跳并检查超时
  setInterval(() => {
    const now = Date.now();

    // 检查超时的客户端
    for (const [clientId, client] of sseClients) {
      if (now - client.lastHeartbeat > HEARTBEAT_TIMEOUT) {
        // 标记为不存活
        client.isAlive = false;
        log.warn(`SSE client ${clientId} timeout, marking as dead. Last heartbeat: ${now - client.lastHeartbeat}ms ago`);

        // 尝试关闭连接
        try {
          client.res.end();
        } catch {
          // 忽略关闭错误
        }
        sseClients.delete(clientId);
        log.info(`Removed dead SSE client ${clientId}. Remaining: ${sseClients.size}`);
      }
    }

    // 发送心跳给所有存活的客户端
    for (const [clientId, client] of sseClients) {
      if (client.isAlive) {
        try {
          client.res.write(`data: ${JSON.stringify({ type: 'ping', clientId, timestamp: now })}\n\n`);
        } catch {
          // 发送失败，标记为不存活
          client.isAlive = false;
          log.warn(`Failed to send heartbeat to client ${clientId}, marking as dead`);
        }
      }
    }

    const aliveCount = Array.from(sseClients.values()).filter(c => c.isAlive).length;
    log.debug(`Heartbeat check: ${sseClients.size} total, ${aliveCount} alive`);
  }, HEARTBEAT_INTERVAL);
}

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
      const startTime = Date.now();
      const result = await sendCommandViaSSE(parsed.category, parsed.actionName, args || {});
      const elapsed = Date.now() - startTime;

      // 构造明确的响应，防止模型重复调用
      const responseText = [
        `✅ 命令执行成功`,
        `命令: ${parsed.category}.${parsed.actionName}`,
        `耗时: ${elapsed}ms`,
        `状态: 已完成，无需重复调用`,
        result ? `结果: ${JSON.stringify(result, null, 2)}` : '',
      ].filter(Boolean).join('\n');

      return {
        content: [
          {
            type: 'text',
            text: responseText,
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: 'text',
            text: `❌ 命令执行失败: ${message}\n请勿重复调用，请检查错误原因后重试。`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * 主入口函数
 */
async function main(): Promise<void> {
  // 1. 加载配置
  config = loadConfig();
  log = createLogger(config.logLevel);

  // 只输出到 stderr，不影响 stdio 通信
  console.error('[INFO] Starting UE5 Pixel Streaming MCP Bridge...');
  console.error(`[INFO] Config: API_JSON_PATH=${config.apiJsonPath}`);

  // 2. 加载参数说明
  loadParameterDescriptions();

  // 3. 加载 API 定义
  const commands = loadApiCommands(config.apiJsonPath);
  console.error(`[INFO] Loaded ${commands.length} command categories from api.json`);

  // 4. 生成 Tools
  const tools = generateTools(commands);
  console.error(`[INFO] Generated ${tools.length} MCP tools`);

  // 5. 创建 MCP Server
  const server = createMcpServer(tools);
  const transport = new StdioServerTransport();

  // 6. 先连接 MCP（确保能立即响应初始化请求）
  await server.connect(transport);
  console.error('[INFO] MCP Server connected via stdio');

  // 7. MCP 连接成功后，启动 HTTP/SSE 服务器
  const httpPort = parseInt(process.env.HTTP_PORT || '8080', 10);
  createHttpServer(httpPort);
  console.error(`[INFO] HTTP/SSE server started on port ${httpPort}`);

  // 8. 捕获 MCP 连接关闭事件，保持 HTTP 服务运行
  transport.onclose = () => {
    log.warn('MCP connection closed, HTTP/SSE server still running');
  };
}

// 启动
main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

// 捕获未处理的异常，防止进程崩溃
process.on('uncaughtException', (err) => {
  console.error('[ERROR] Uncaught exception:', err);
  // 不退出进程，保持 HTTP 服务运行
});

// 捕获未处理的 Promise 拒绝
process.on('unhandledRejection', (reason, promise) => {
  console.error('[ERROR] Unhandled rejection at:', promise, 'reason:', reason);
  // 不退出进程，保持 HTTP 服务运行
});

// 防止 stdin 关闭导致进程退出（当作为 MCP 客户端运行时）
// 这是关键修复：当 QwenPaw 的 MCP 客户端断开连接时，stdin 会关闭
// 但我们希望 HTTP/SSE 服务继续运行
process.stdin.resume();

process.stdin.on('end', () => {
  console.error('[INFO] stdin ended, HTTP/SSE server continues running');
});

// 防止 SIGTERM/SIGINT 导致进程退出（保持 HTTP 服务运行）
// 注意：在 Windows 上，SIGINT/SIGTERM 的行为可能不同
process.on('SIGTERM', () => {
  console.error('[INFO] Received SIGTERM, ignoring to keep HTTP/SSE server running');
});

process.on('SIGINT', () => {
  console.error('[INFO] Received SIGINT, ignoring to keep HTTP/SSE server running');
});
