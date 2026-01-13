# ComfyUI-LastImageComparison

A ComfyUI custom node package that provides advanced image comparison tools for development and workflow debugging.

## Features

### Image Push Output Node
- **WebSocket-based image push**: Send images from your ComfyUI workflow to an external viewer
- **Multi-viewer support**: Run multiple viewers with different `viewer_id` values simultaneously
- **Automatic WebP compression**: Optimized for low bandwidth with configurable quality
- **Optional downscaling**: Reduce preview size while maintaining aspect ratio
- **Reconnection handling**: Automatic reconnection with exponential backoff
- **Auto-launch viewer service**: External viewer starts automatically when ComfyUI loads

### Last Image Preview Node
- **Manual comparison**: Save and compare current images against previously saved "last" images
- **Advanced comparison modes**:
  - Split view (draggable splitter)
  - Side-by-side layout
  - A/B toggle mode
- **Zoom and pan**: Mouse wheel zoom, Space+drag pan, double-click to reset
- **Persistent storage**: Last images saved locally per node instance

## Installation

1. Clone this repository into your ComfyUI custom_nodes directory:
```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Tr1dae/ComfyUI-LastImageComparison.git
```

2. Restart ComfyUI or reload custom nodes

The viewer service will automatically start on port 8788 when ComfyUI loads.

## Usage

### Image Push Output Node

1. Add an "Image Push Output" node to your workflow
2. Connect an image output to its input
3. Set a unique `viewer_id` (e.g., "workflow1", "debug_view")
4. Configure optional settings:
   - `max_preview_resolution`: Maximum dimension (default: 1024px)
   - `webp_quality`: Compression quality 0-100 (default: 45)
   - `auto_connect`: Auto-reconnect on disconnect (default: true)
5. Click "Open Viewer for this ID" to launch the viewer in a new tab
6. Run your workflow - images will appear in the viewer

### Last Image Preview Node

1. Add a "Last Image Preview (manual save)" node
2. Connect an image output to its input
3. Run your workflow to see the current image
4. Click "Update last image" to save the current image as reference
5. Use comparison modes to compare current vs. saved images:
   - **Split**: Drag the divider to compare regions
   - **Side-by-side**: View both images simultaneously
   - **A/B toggle**: Switch between images with Space key or button

### Viewer Controls

- **Mouse wheel**: Zoom in/out centered on cursor
- **Space + drag**: Pan around zoomed images
- **Double-click**: Reset zoom and pan to default
- **Space key**: Toggle between images in A/B mode

## Architecture

### Push Model
- **Driver**: ComfyUI nodes send images via WebSocket
- **Transport**: WebSocket push with automatic reconnection
- **Viewer**: Passive receiver that filters by `viewer_id`

### Message Format
```json
{
  "viewer_id": "unique_identifier",
  "image_webp": "base64_encoded_webp_data",
  "timestamp": 1700000000000
}
```

### Auto-launch
The external viewer service starts automatically on port 8788 when ComfyUI loads the custom node package.

## Technical Details

### Image Processing
- Input: ComfyUI IMAGE tensor (BCHW format)
- Processing: Clamp to 0-1, convert to RGB PIL Image
- Optional downscaling: Maintain aspect ratio, limit longest side
- Encoding: WebP with configurable quality and method 6
- Output: Base64-encoded WebP data

### WebSocket Client
- Background thread with asyncio event loop
- Singleton pattern for connection reuse
- Exponential backoff reconnection (1s to 30s)
- Silent message dropping when disconnected
- Thread-safe message queue

### Viewer Service
- aiohttp-based HTTP/WebSocket server
- Broadcasts messages to all connected clients
- Clients filter messages locally by `viewer_id`
- No persistence, in-memory only

## Configuration

### Default Settings
- **Viewer port**: 8788
- **WebSocket URL**: `ws://127.0.0.1:8788/ws`
- **Max resolution**: 1024px (longest side)
- **WebP quality**: 45 (balanced size/quality)
- **Auto-connect**: Enabled

### Custom WebSocket URL
Override the default WebSocket URL in the node settings for:
- Remote ComfyUI instances
- Different ports
- Network configurations

## Troubleshooting

### Viewer Not Loading
- Check that port 8788 is available
- Verify no firewall blocking the port
- Check ComfyUI console for startup messages

### Images Not Appearing
- Confirm `viewer_id` matches between node and URL
- Check WebSocket connection status in viewer
- Verify the viewer tab is from the same ComfyUI instance

### Performance Issues
- Lower `max_preview_resolution` for faster encoding
- Reduce `webp_quality` for smaller file sizes
- Use `auto_connect=false` if network is unstable

## Development

### Project Structure
```
ComfyUI-DevImage/
├── __init__.py                    # Main package entry
├── last_image_preview.py         # Original preview node
├── image_push_output.py          # New push output node
├── ws_push_client.py             # WebSocket client
├── protocol.py                   # Message protocol
├── web/                          # Frontend assets
│   ├── last_image_preview.js
│   └── image_push_output.js
└── viewer_service/               # External viewer
    ├── server.py                 # aiohttp server
    ├── auto_start.py             # Auto-launch helper
    └── static/                   # Viewer UI
        ├── index.html
        ├── viewer.js
        └── viewer.css
```

### Manual Viewer Launch
If auto-launch doesn't work, start manually:
```bash
cd custom_nodes/ComfyUI-DevImage/viewer_service
python server.py
```

### Custom Port
```bash
python server.py 9090  # Custom port
```

## License

This project is released under the same license as ComfyUI.

## Contributing

Contributions welcome! Please test with various image sizes and network conditions.