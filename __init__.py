"""
ComfyUI-DevImage custom node package.
Provides image preview and push functionality.
"""

# Register viewer routes on ComfyUI server (integrated approach)
from . import viewer_routes

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
