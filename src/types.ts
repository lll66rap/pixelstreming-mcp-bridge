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
/**
 * 参数元信息（从 parameters.json 读取）
 */
export interface ParamDescriptionMeta {
  description?: string;
  required?: boolean;
  enum?: string[];
  default?: unknown;
  min?: number;
  max?: number;
}

/**
 * 从 tool name 解析出的命令标识
 */
export interface ParsedToolName {
  category: string;
}
