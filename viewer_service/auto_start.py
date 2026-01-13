"""
Auto-start helper for the viewer service.
Launches the viewer service in a background thread when imported.
Safe to call multiple times (singleton pattern).
"""

import asyncio
import logging
import threading
from typing import Optional

logger = logging.getLogger(__name__)

# Global state
_server_thread: Optional[threading.Thread] = None
_server_loop: Optional[asyncio.AbstractEventLoop] = None
_server_started = False
_lock = threading.Lock()


def _run_server_in_thread(host: str = "0.0.0.0", port: int = 8788):
    """
    Run the viewer server in this thread's event loop.
    This function runs in the background thread.
    """
    global _server_loop

    try:
        # Import here to avoid circular imports
        from .server import run_server

        # Create new event loop for this thread
        _server_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_server_loop)

        # Run the server
        _server_loop.run_until_complete(run_server(host=host, port=port))
    except Exception as e:
        logger.error(f"[ViewerService] Error in server thread: {e}", exc_info=True)
    finally:
        if _server_loop:
            _server_loop.close()
            _server_loop = None


def ensure_running(host: str = "0.0.0.0", port: int = 8788):
    """
    Ensure the viewer service is running in a background thread.
    Safe to call multiple times - will only start once.
    
    Args:
        host: Host to bind to (default: 0.0.0.0)
        port: Port to listen on (default: 8788)
    """
    global _server_thread, _server_started

    with _lock:
        if _server_started:
            if _server_thread and _server_thread.is_alive():
                # Already running
                return
            else:
                # Thread died, reset and restart
                _server_started = False
                _server_thread = None

        if not _server_started:
            try:
                logger.info(f"[ViewerService] Starting viewer service on {host}:{port}")
                _server_thread = threading.Thread(
                    target=_run_server_in_thread,
                    args=(host, port),
                    daemon=True,  # Daemon thread so it doesn't prevent shutdown
                    name="ViewerServiceThread",
                )
                _server_thread.start()
                _server_started = True
                logger.info("[ViewerService] Viewer service started in background thread")
            except Exception as e:
                logger.error(f"[ViewerService] Failed to start viewer service: {e}", exc_info=True)
                _server_started = False
                _server_thread = None


def is_running() -> bool:
    """Check if the viewer service thread is running."""
    with _lock:
        return _server_started and _server_thread is not None and _server_thread.is_alive()
