"""
Persistent WebSocket push client for ComfyUI image push nodes.
Runs in a background thread with its own asyncio event loop.
Maintains connection and handles reconnection with exponential backoff.
"""

import asyncio
import logging
import threading
import time
from queue import Queue, Empty
from typing import Optional, Dict, Any

import aiohttp

from .protocol import serialize_message

logger = logging.getLogger(__name__)


class WSPushClient:
    """
    Thread-safe WebSocket push client.
    Maintains a persistent connection in a background thread.
    """

    def __init__(self, ws_url: str = "ws://127.0.0.1:8188/ws/simple_ui_viewer", auto_connect: bool = True):
        """
        Initialize the WebSocket push client.

        Args:
            ws_url: WebSocket server URL
            auto_connect: If True, automatically reconnect on disconnect
        """
        self.ws_url = ws_url
        self.auto_connect = auto_connect
        self.message_queue: Queue[Dict[str, Any]] = Queue()
        self.ws: Optional[aiohttp.ClientWebSocketResponse] = None
        self.session: Optional[aiohttp.ClientSession] = None
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.thread: Optional[threading.Thread] = None
        self.running = False
        self.connected = False
        self.reconnect_attempts = 0
        self.max_reconnect_attempts = 10
        self.reconnect_delay = 1.0  # Start with 1 second
        self.max_reconnect_delay = 30.0  # Cap at 30 seconds
        self._lock = threading.Lock()

    def start(self):
        """Start the background thread and event loop."""
        if self.running:
            return

        self.running = True
        self.thread = threading.Thread(target=self._run_event_loop, daemon=True)
        self.thread.start()
        logger.info(f"[WSPushClient] Started background thread for {self.ws_url}")

    def update_config(self, ws_url: str, auto_connect: bool) -> None:
        """
        Update connection settings for the running client.
        If ws_url changes, force a reconnect.
        """
        ws_url = (ws_url or "").strip()
        with self._lock:
            url_changed = ws_url and ws_url != self.ws_url
            self.auto_connect = auto_connect
            if url_changed:
                self.ws_url = ws_url
                self.connected = False
                # Close existing ws (async) to trigger reconnect
                if self.loop and self.loop.is_running():
                    asyncio.run_coroutine_threadsafe(self._close_ws_only(), self.loop)

    async def _close_ws_only(self):
        if self.ws:
            try:
                await self.ws.close()
            except Exception:
                pass
            self.ws = None

    def stop(self):
        """Stop the background thread and close connections."""
        self.running = False
        if self.loop and self.loop.is_running():
            asyncio.run_coroutine_threadsafe(self._cleanup(), self.loop)
        if self.thread:
            self.thread.join(timeout=2.0)
        logger.info("[WSPushClient] Stopped")

    async def _cleanup(self):
        """Clean up WebSocket and session."""
        if self.ws:
            try:
                await self.ws.close()
            except Exception:
                pass
            self.ws = None

        if self.session:
            try:
                await self.session.close()
            except Exception:
                pass
            self.session = None

        self.connected = False

    def _run_event_loop(self):
        """Run the asyncio event loop in the background thread."""
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        try:
            self.loop.run_until_complete(self._main_loop())
        except Exception as e:
            logger.error(f"[WSPushClient] Event loop error: {e}", exc_info=True)
        finally:
            self.loop.close()

    async def _main_loop(self):
        """Main async loop: connect, send messages, handle reconnection."""
        while self.running:
            try:
                if not self.connected:
                    if self.auto_connect:
                        await self._connect()
                    else:
                        # If not auto-connecting, just drain the queue silently
                        await asyncio.sleep(0.1)
                        continue

                if self.connected and self.ws:
                    # Process message queue
                    await self._process_queue()

                    # Check if connection is still alive
                    if self.ws.closed:
                        self.connected = False
                        logger.warning("[WSPushClient] WebSocket closed")
                        continue

                    await asyncio.sleep(0.01)  # Small delay to prevent busy loop
                else:
                    await asyncio.sleep(0.1)

            except Exception as e:
                logger.error(f"[WSPushClient] Main loop error: {e}", exc_info=True)
                self.connected = False
                await asyncio.sleep(1.0)

    async def _connect(self):
        """Establish WebSocket connection."""
        if self.connected:
            return

        try:
            if not self.session:
                timeout = aiohttp.ClientTimeout(total=10)
                self.session = aiohttp.ClientSession(timeout=timeout)

            logger.info(f"[WSPushClient] Connecting to {self.ws_url}...")
            async with self.session.ws_connect(self.ws_url) as ws:
                self.ws = ws
                self.connected = True
                self.reconnect_attempts = 0
                self.reconnect_delay = 1.0
                logger.info(f"[WSPushClient] Connected to {self.ws_url}")

                # Keep connection alive and process messages
                while self.running and not ws.closed:
                    try:
                        # Process outgoing messages
                        await self._process_queue()

                        # Check for incoming messages (we don't use them, but need to read to detect disconnects)
                        try:
                            msg = await asyncio.wait_for(ws.receive(), timeout=0.1)
                            if msg.type == aiohttp.WSMsgType.ERROR:
                                logger.warning(f"[WSPushClient] WebSocket error: {ws.exception()}")
                                break
                            elif msg.type == aiohttp.WSMsgType.CLOSE:
                                logger.info("[WSPushClient] WebSocket closed by server")
                                break
                        except asyncio.TimeoutError:
                            # No message, continue
                            pass

                        await asyncio.sleep(0.01)

                    except Exception as e:
                        logger.error(f"[WSPushClient] Connection error: {e}", exc_info=True)
                        break

        except Exception as e:
            logger.warning(f"[WSPushClient] Connection failed: {e}")
            self.connected = False
            self.ws = None

            # Exponential backoff for reconnection
            if self.auto_connect and self.reconnect_attempts < self.max_reconnect_attempts:
                self.reconnect_attempts += 1
                delay = min(self.reconnect_delay * (2 ** (self.reconnect_attempts - 1)), self.max_reconnect_delay)
                logger.info(f"[WSPushClient] Reconnecting in {delay:.1f}s (attempt {self.reconnect_attempts})")
                await asyncio.sleep(delay)
            else:
                if self.reconnect_attempts >= self.max_reconnect_attempts:
                    logger.error("[WSPushClient] Max reconnection attempts reached")
                await asyncio.sleep(1.0)

    async def _process_queue(self):
        """Process messages from the queue and send them."""
        if not self.connected or not self.ws:
            return

        sent_count = 0
        max_batch = 10  # Process up to 10 messages per iteration

        while sent_count < max_batch:
            try:
                message = self.message_queue.get_nowait()
            except Empty:
                break

            try:
                message_str = serialize_message(message)
                await self.ws.send_str(message_str)
                sent_count += 1
            except Exception as e:
                logger.warning(f"[WSPushClient] Failed to send message: {e}")
                # Drop the message silently (as per requirements)

    def push_message(self, message: Dict[str, Any]) -> bool:
        """
        Queue a message for sending (non-blocking).

        Args:
            message: Message dictionary (should match protocol schema)

        Returns:
            True if queued, False if dropped (e.g., queue full or not running)
        """
        if not self.running:
            return False

        try:
            self.message_queue.put_nowait(message)
            return True
        except Exception:
            # Queue full or other error - drop silently
            return False

    def is_connected(self) -> bool:
        """Check if currently connected."""
        with self._lock:
            return self.connected


# Module-level singleton instance
_singleton_client: Optional[WSPushClient] = None


def get_client(ws_url: str = "ws://127.0.0.1:8188/ws/simple_ui_viewer", auto_connect: bool = True) -> WSPushClient:
    """
    Get or create the singleton WebSocket push client.

    Args:
        ws_url: WebSocket server URL (only used on first call)
        auto_connect: Auto-connect setting (only used on first call)

    Returns:
        The singleton WSPushClient instance
    """
    global _singleton_client

    if _singleton_client is None:
        _singleton_client = WSPushClient(ws_url=ws_url, auto_connect=auto_connect)
        _singleton_client.start()
    else:
        _singleton_client.update_config(ws_url=ws_url, auto_connect=auto_connect)

    return _singleton_client
