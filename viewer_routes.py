"""
Viewer routes integrated into ComfyUI server.
Registers HTTP and WebSocket routes on the main ComfyUI server to avoid port conflicts.
"""

import os
from pathlib import Path

from aiohttp import web
from server import PromptServer

# Get the main server instance
server_instance = PromptServer.instance

@server_instance.routes.get('/simple_ui_viewer')
async def serve_viewer_page(request):
    """Serve the viewer HTML page."""
    try:
        # Get the path to our viewer static directory
        current_dir = Path(__file__).parent
        static_dir = current_dir / "web" / "static"
        html_path = static_dir / "index.html"

        if html_path.exists():
            with open(html_path, 'r', encoding='utf-8') as f:
                content = f.read()
            return web.Response(text=content, content_type='text/html')
        else:
            return web.Response(text='Viewer not found', status=404)
    except Exception as e:
        return web.Response(text=f'Error serving viewer: {str(e)}', status=500)


@server_instance.routes.get('/simple_ui_viewer/static/{path:.*}')
async def serve_viewer_static(request):
    """Serve viewer static files (CSS, JS) from the static directory."""
    try:
        requested_path = request.match_info['path']
        current_dir = Path(__file__).parent
        static_dir = current_dir / "web" / "static"
        base_real = static_dir.resolve()
        target_real = (static_dir / requested_path).resolve()

        # Prevent directory traversal
        if not str(target_real).startswith(str(base_real)):
            return web.Response(text='Invalid path', status=400)

        if target_real.is_file():
            return web.FileResponse(path=target_real)
        else:
            return web.Response(text='File not found', status=404)
    except Exception as e:
        return web.Response(text=f'Error serving file: {str(e)}', status=500)


print("🎨 Image Viewer routes registered on ComfyUI server")