# ComfyUI Image Push Viewer Service

A lightweight external viewer service for ComfyUI that receives preview images via WebSocket and displays them in a browser tab with comparison tools.

## Features

- **WebSocket push model**: ComfyUI nodes push images; viewer passively receives
- **Multi-viewer support**: Multiple tabs can view different `viewer_id` streams simultaneously
- **Comparison modes**: Split (draggable), side-by-side, A/B toggle
- **Zoom/pan**: Mouse wheel zoom, Space+drag to pan, double-click to reset
- **No persistence**: In-memory only, no disk or localStorage

## Running the Service

### Standalone

```bash
cd custom_nodes/ComfyUI-DevImage/viewer_service
python server.py [port]
```

Default port is `8788`. Example:
```bash
python server.py 8788
```

### As a Module

```python
from viewer_service.server import run_server
import asyncio

asyncio.run(run_server(host="0.0.0.0", port=8788))
```

## Usage

1. Start the viewer service
2. Open a browser tab to `http://localhost:8788/?id=<viewer_id>`
3. Use ComfyUI nodes with matching `viewer_id` to push images
4. Images appear in the viewer tab automatically

## Architecture

- **HTTP server**: Serves static HTML/JS/CSS
- **WebSocket endpoint**: `/ws` accepts connections and broadcasts messages
- **Client filtering**: Each browser tab filters messages by `viewer_id` from URL query parameter

## Message Format

Messages are JSON with this structure:
```json
{
  "viewer_id": "string",
  "image_webp": "base64-encoded-webp-data",
  "timestamp": 1700000000000
}
```

## Dependencies

- `aiohttp` (already in ComfyUI requirements.txt)
