"""
Lightweight external viewer service for ComfyUI image push.
Serves static HTML/JS/CSS and broadcasts WebSocket messages to connected clients.
"""

import asyncio
import json
import logging
from pathlib import Path
from typing import Set

import aiohttp
from aiohttp import web

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global set of connected WebSocket clients
connected_clients: Set[web.WebSocketResponse] = set()

# Path to static files
STATIC_DIR = Path(__file__).parent / "static"


async def websocket_handler(request: web.Request) -> web.WebSocketResponse:
    """
    Handle WebSocket connections.
    Clients connect and receive broadcast messages.
    """
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    
    client_addr = request.remote
    logger.info(f"WebSocket client connected from {client_addr}")
    connected_clients.add(ws)
    
    try:
        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.TEXT:
                # Messages from ComfyUI nodes: parse and broadcast to all clients
                try:
                    data = json.loads(msg.data)
                    # Validate message structure
                    if not isinstance(data, dict) or not all(
                        k in data for k in ("viewer_id", "image_webp", "timestamp")
                    ):
                        logger.warning(f"Invalid message format from {client_addr}")
                        continue
                    
                    # Broadcast to all connected clients
                    # Each client will filter by viewer_id on their side
                    message_str = json.dumps(data)
                    disconnected = set()
                    for client in connected_clients:
                        try:
                            await client.send_str(message_str)
                        except Exception as e:
                            logger.debug(f"Failed to send to client: {e}")
                            disconnected.add(client)
                    
                    # Clean up disconnected clients
                    for client in disconnected:
                        connected_clients.discard(client)
                        try:
                            await client.close()
                        except Exception:
                            pass
                    
                    logger.debug(f"Broadcast message with viewer_id={data.get('viewer_id')} to {len(connected_clients)} clients")
                    
                except json.JSONDecodeError:
                    logger.warning(f"Invalid JSON from {client_addr}")
                except Exception as e:
                    logger.error(f"Error processing message from {client_addr}: {e}", exc_info=True)
                    
            elif msg.type == aiohttp.WSMsgType.ERROR:
                logger.warning(f"WebSocket error from {client_addr}: {ws.exception()}")
                break
                
    except Exception as e:
        logger.error(f"WebSocket handler error for {client_addr}: {e}", exc_info=True)
    finally:
        connected_clients.discard(ws)
        logger.info(f"WebSocket client disconnected from {client_addr}")
        try:
            await ws.close()
        except Exception:
            pass
    
    return ws


async def index_handler(request: web.Request) -> web.Response:
    """Serve the main HTML page."""
    index_path = STATIC_DIR / "index.html"
    if not index_path.exists():
        return web.Response(
            text="<h1>Viewer service error</h1><p>index.html not found</p>",
            status=500,
            content_type="text/html"
        )
    
    with open(index_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    return web.Response(text=content, content_type="text/html")


async def static_handler(request: web.Request) -> web.Response:
    """Serve static files (JS, CSS, etc.)."""
    filename = request.match_info.get("filename", "")
    if not filename or ".." in filename or "/" in filename:
        return web.Response(text="Invalid filename", status=400)
    
    file_path = STATIC_DIR / filename
    if not file_path.exists() or not file_path.is_file():
        return web.Response(text="File not found", status=404)
    
    # Determine content type
    content_type = "application/octet-stream"
    if filename.endswith(".js"):
        content_type = "application/javascript"
    elif filename.endswith(".css"):
        content_type = "text/css"
    elif filename.endswith(".html"):
        content_type = "text/html"
    
    with open(file_path, "rb") as f:
        content = f.read()
    
    return web.Response(body=content, content_type=content_type)


def create_app() -> web.Application:
    """Create and configure the aiohttp application."""
    app = web.Application()
    
    # Routes
    app.router.add_get("/", index_handler)
    app.router.add_get("/ws", websocket_handler)
    app.router.add_get("/static/{filename}", static_handler)
    
    return app


async def run_server(host: str = "0.0.0.0", port: int = 8788):
    """
    Run the viewer service server.
    
    Args:
        host: Host to bind to (default: 0.0.0.0 for all interfaces)
        port: Port to listen on (default: 8788)
    """
    app = create_app()
    runner = web.AppRunner(app)
    await runner.setup()
    
    site = web.TCPSite(runner, host, port)
    await site.start()
    
    logger.info(f"Viewer service started on http://{host}:{port}")
    logger.info(f"Static files directory: {STATIC_DIR}")
    
    # Keep running
    try:
        await asyncio.Event().wait()
    except KeyboardInterrupt:
        logger.info("Shutting down viewer service...")
    finally:
        await runner.cleanup()


if __name__ == "__main__":
    # Allow running as standalone script
    import sys
    
    port = 8788
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            logger.error(f"Invalid port: {sys.argv[1]}")
            sys.exit(1)
    
    asyncio.run(run_server(port=port))
