# UE5 Pixel Streaming MCP Bridge - Project Summary

## Overview

This project implements a complete UE5 Pixel Streaming MCP bridge system, enabling AI assistants (such as QwenPaw, Claude Code) to control UE5 pixel streaming instances through natural language.

## Technical Architecture

### Overall Architecture

```
┌─────────────┐   MCP(stdio)   ┌─────────────┐   SSE/HTTP   ┌─────────────┐
│  AI Client  │ ─────────────▶ │ MCP Bridge  │ ◀──────────▶ │  PS Webpage │
│ (QwenPaw等)  │                │  :8080      │              │             │
└─────────────┘                └─────────────┘              └──────┬──────┘
                                                              │ WebRTC
                                                              ▼
                                                         ┌─────────────┐
                                                         │     UE5     │
                                                         └─────────────┘
```

### Communication Flow

1. **AI → MCP Bridge**: MCP protocol (stdio transport)
2. **MCP Bridge → Webpage**: SSE push commands
3. **Webpage → UE5**: WebRTC DataChannel
4. **UE5 → Webpage**: WebRTC DataChannel response
5. **Webpage → MCP Bridge**: HTTP POST response
6. **MCP Bridge → AI**: MCP protocol returns result

## Project Components

### 1. MCP Bridge (pixelstreming-mcp-bridge)

**Tech Stack**: TypeScript + Node.js + MCP SDK

**Core Features**:
- Dynamically generates 147 MCP Tools from `api.json`
- HTTP/SSE server (port 8080)
- MCP Server (stdio transport)
- Command timeout management
- Simulation mode support

**Key Files**:
- `src/index.ts` - Main entry, MCP Server + HTTP server
- `src/types.ts` - TypeScript type definitions
- `api.json` - UE5 command definitions

### 2. Pixel Streaming Service (chat project)

**Tech Stack**: Vue 3 + TypeScript + PixelStreaming SDK

**Core Features**:
- WebRTC pixel streaming connection
- SSE client (receive commands)
- HTTP POST (send responses)
- Command ID matching
- Response format adaptation (legacy compatibility)

**Key Files**:
- `src/pixelStreamingService.ts` - Pixel streaming service class
- `src/PixelStreaming.vue` - Vue component
- `src/QwenPawChat.vue` - Chat component

## Technical Highlights

### 1. Command ID Matching Mechanism

Distinguishes AI control commands from user webpage interactions:
- AI commands have `commandId`, responses need matching
- User interactions have no `commandId`, handled locally

### 2. Response Format Adaptation

Compatible with two response formats:
- **Standard format**: `{commandId: 'xxx', result: {...}}`
- **Legacy format**: `{message: 'initialized'}` (auto-matches recent command)

### 3. Simulation Mode

Multi-level simulation support:
- Webpage simulation: Returns mock response when pixel streaming not connected
- Bridge simulation: Returns mock response when no SSE client

### 4. Error Handling

Comprehensive error code system:
- `BRIDGE_001`: Configuration error
- `BRIDGE_002`: Connection error
- `BRIDGE_003`: Timeout error
- `BRIDGE_004`: Execution error

## Configuration

### MCP Bridge Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_JSON_PATH` | Yes | - | Api.json file path |
| `HTTP_PORT` | No | `8080` | HTTP/SSE port |
| `COMMAND_TIMEOUT` | No | `30000` | Command timeout (ms) |
| `LOG_LEVEL` | No | `info` | Log level |
| `SIMULATE_MODE` | No | `false` | Simulation mode |

### QwenPaw MCP Configuration

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

## Usage

### Full Mode

1. Start UE5 Pixel Streaming Server (port 8888)
2. Start AI Client → MCP Bridge starts automatically
3. Start Pixel Streaming Webpage → Connects to SSE
4. AI sends commands to control UE5

### Test Mode

1. Start AI Client (set `SIMULATE_MODE=true`)
2. AI sends commands → Returns mock responses

## Supported Commands

Generated from `api.json`: 13 categories, 147 tools

| Category | Description |
|----------|-------------|
| actor | Object operations |
| camera | Camera control |
| common | General settings |
| dimenssion | Measurement tools |
| heatmap | Heatmap |
| map | Map operations |
| poi | Points of interest |
| radar | Radar charts |
| ring | Diffusion rings |
| space | Spatial drawing |
| project | Project control |
| poi3d | 3D POIs |

## Issues and Solutions

### 1. Direct WebSocket to UE5 Not Feasible

**Problem**: UE5 Pixel Streaming uses WebRTC, not direct WebSocket.

**Solution**: Changed to SSE/HTTP architecture, pixel streaming webpage as intermediary.

### 2. MCP Client Connection Timeout

**Problem**: MCP Bridge startup took too long causing timeout.

**Solution**: Optimized initialization order, ensured MCP connection before HTTP server.

### 3. Drag Functionality Broken

**Problem**: `draggable` is HTML native attribute, incorrectly handled by Vue.

**Solution**: Used `inheritAttrs: false` and renamed prop.

### 4. Legacy Response Format Incompatible

**Problem**: UE5 returns `{message: 'xxx'}` without `commandId`.

**Solution**: Added response matching mechanism, auto-matches recent commands.

## Future Improvements

1. **UE5 Standardization**: Make UE5 return standard format `{commandId, result}`
2. **Reconnection Mechanism**: Auto-reconnect when SSE disconnects
3. **Command Queue**: Support batch command execution
4. **State Synchronization**: Real-time UE5 state sync to AI
5. **Permission Control**: Limit AI executable command scope

## Summary

This project successfully implements a complete AI-to-UE5 pixel streaming control pipeline. Using SSE/HTTP architecture solved WebRTC communication issues. Command ID matching distinguishes AI control from user interaction. Simulation mode enables testing without UE5. Legacy response format is supported.

---

**Development Date**: 2026-04-19  
**Tech Stack**: TypeScript, Node.js, Vue 3, MCP SDK, PixelStreaming SDK  
**Code Volume**: ~500 lines of core code
