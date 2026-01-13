"""
ComfyUI-DevImage custom node package.
Provides image preview and push functionality.
"""

# Auto-start the viewer service when this module loads
from .viewer_service.auto_start import ensure_running
ensure_running()  # Start on default port 8788

from .last_image_preview import (
    NODE_CLASS_MAPPINGS as LAST_PREVIEW_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS as LAST_PREVIEW_DISPLAY,
)
from .image_push_output import (
    NODE_CLASS_MAPPINGS as IMAGE_PUSH_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS as IMAGE_PUSH_DISPLAY,
)

# Define web directory for custom frontend assets
WEB_DIRECTORY = "web"

# Combine all node mappings
NODE_CLASS_MAPPINGS = {
    **LAST_PREVIEW_MAPPINGS,
    **IMAGE_PUSH_MAPPINGS,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    **LAST_PREVIEW_DISPLAY,
    **IMAGE_PUSH_DISPLAY,
}

# Export for ComfyUI
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
