# UE5 Pixel Streaming MCP Bridge

A SSE/HTTP-based MCP bridge for UE5 Pixel Streaming, enabling AI assistants to control UE5 pixel streaming instances through natural language.

## Architecture

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

## Features

- Dynamically generates MCP Tools from `Api.json` (147 tools)
- SSE for pushing commands to pixel streaming webpage
- HTTP POST for receiving responses
- Standard MCP protocol support (stdio transport)
- Compatible with Claude Code, QwenPaw, and other MCP clients
- Simulation mode support (test without UE5)
- Automatic response matching (compatible with legacy non-standard JSON format)

## Installation

```bash
npm install
npm run build
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_JSON_PATH` | Yes | - | Absolute path to Api.json file |
| `HTTP_PORT` | No | `8080` | HTTP/SSE server port |
| `COMMAND_TIMEOUT` | No | `30000` | Command timeout (ms) |
| `LOG_LEVEL` | No | `info` | Log level: `debug`, `info`, `warn`, `error` |
| `SIMULATE_MODE` | No | `false` | Simulation mode (returns mock response when no SSE client) |

### MCP Client Configuration

Add to QwenPaw or Claude Code configuration:

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

## HTTP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/events` | GET | SSE endpoint, pushes commands to pixel streaming webpage |
| `/response` | POST | Receives responses from pixel streaming webpage |
| `/health` | GET | Health check |

## Usage Flow

1. **Start UE5 Pixel Streaming Server** (port 8888)
2. **Start AI Client** (QwenPaw/Claude Code) → MCP Bridge starts automatically
3. **Start Pixel Streaming Webpage** (Chat project) → Connects to SSE
4. **AI sends command** → MCP Bridge → SSE → Webpage → WebRTC → UE5
5. **UE5 responds** → WebRTC → Webpage → HTTP POST → MCP Bridge → AI

## Supported Command Categories

The system automatically generates MCP Tools from Api.json:

| Category | Description | Tool Examples |
|----------|-------------|---------------|
| actor | Object operations | `ue5_actor_focusActor`, `ue5_actor_setActorTransform` |
| camera | Camera control | `ue5_camera_transformCamera`, `ue5_camera_rotateCamera` |
| common | General settings | `ue5_common_playerSpeed`, `ue5_common_setResolutionSize` |
| dimenssion | Measurement tools | `ue5_dimenssion_dimenssion`, `ue5_dimenssion_changeUnits` |
| heatmap | Heatmap | `ue5_heatmap_drawHeatMap`, `ue5_heatmap_createHeatMap` |
| map | Map operations | `ue5_map_loadMap` |
| poi | Points of interest | `ue5_poi_updatePois`, `ue5_poi_focusPoi` |
| radar | Radar charts | `ue5_radar_updateRadars`, `ue5_radar_getInfoRadars` |
| ring | Diffusion rings | `ue5_ring_updateRings`, `ue5_ring_deleteRings` |
| space | Spatial drawing | `ue5_space_drawSpace`, `ue5_space_deleteSpaces` |
| project | Project control | `ue5_project_setEvnTime`, `ue5_project_setWeather` |
| poi3d | 3D POIs | `ue5_poi3d_update3DPois` |

## Error Codes

| Code | Description |
|------|-------------|
| `BRIDGE_001` | Api.json file not found or parse failed |
| `BRIDGE_002` | No SSE client connected |
| `BRIDGE_003` | Command execution timeout |
| `BRIDGE_004` | Pixel streaming returned error |

## Response Matching

Supports two response formats:

1. **Standard format**: `{commandId: 'xxx', result: {...}}`
2. **Legacy format**: `{message: 'initialized'}` (auto-matches to recent command)

## Development

```bash
# Build
npm run build

# Watch mode
npm run dev
```

## Project Structure

```
pixelstreming-mcp-bridge/
├── src/
│   ├── index.ts          # MCP Server entry + core logic
│   └── types.ts          # TypeScript type definitions
├── dist/                  # Compiled output
├── api.json              # Pixel streaming command definitions
├── package.json
├── tsconfig.json
└── README.md
```

## License

MIT
