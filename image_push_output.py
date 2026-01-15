"""
ComfyUI custom node that pushes preview images to an external viewer via WebSocket.
Encodes images as compressed WebP and sends them to a viewer service.
"""

import base64
import io
import logging

import torch
import torchvision.transforms as T
from PIL import Image

from server import PromptServer
from .protocol import create_image_push_message

logger = logging.getLogger(__name__)

to_pil_image = T.ToPILImage()


def normalize_image_tensor(tensor: torch.Tensor) -> torch.Tensor:
    """
    Normalize image tensor to channel-first format with 1, 3, or 4 channels.
    
    Args:
        tensor: Input tensor (2D, 3D, or 4D)
        
    Returns:
        Normalized tensor in channel-first format
    """
    tensor = tensor.detach().cpu()
    if tensor.ndim == 3:
        channels_first = tensor.shape[0]
        if channels_first in (1, 3, 4):
            return tensor
        channels_last = tensor.shape[-1]
        if channels_last in (1, 3, 4):
            return tensor.permute(2, 0, 1)
    elif tensor.ndim == 2:
        return tensor
    raise ValueError(
        "ImagePushOutput node expects an image tensor with 1, 3, or 4 channels "
        "and either channel-first or channel-last layout."
    )


def downscale_image(pil_image: Image.Image, max_resolution: int) -> Image.Image:
    """
    Downscale image if it exceeds max_resolution (longest side).
    
    Args:
        pil_image: PIL Image
        max_resolution: Maximum resolution for longest side
        
    Returns:
        Downscaled PIL Image (or original if already small enough)
    """
    width, height = pil_image.size
    longest_side = max(width, height)
    
    if longest_side <= max_resolution:
        return pil_image
    
    # Calculate new dimensions maintaining aspect ratio
    if width > height:
        new_width = max_resolution
        new_height = int(height * (max_resolution / width))
    else:
        new_height = max_resolution
        new_width = int(width * (max_resolution / height))
    
    return pil_image.resize((new_width, new_height), Image.Resampling.LANCZOS)


def encode_webp(pil_image: Image.Image, quality: int = 45) -> str:
    """
    Encode PIL Image to WebP base64 string.
    
    Args:
        pil_image: PIL Image (should be RGB)
        quality: WebP quality (0-100, lower = smaller file)
        
    Returns:
        Base64-encoded WebP data (without data URI prefix)
    """
    # Ensure RGB mode
    if pil_image.mode != "RGB":
        pil_image = pil_image.convert("RGB")
    
    with io.BytesIO() as buffered:
        pil_image.save(
            buffered,
            format="WEBP",
            quality=quality,
            method=6,  # Best compression
        )
        encoded = base64.b64encode(buffered.getvalue()).decode("utf-8")
        return encoded


class ImagePushOutput:
    """
    ComfyUI node that pushes images to an external viewer via WebSocket.
    """

    CATEGORY = "Last Image Comparision Viewer"
    OUTPUT_NODE = True
    RETURN_TYPES = ()
    FUNCTION = "push_image"
    DESCRIPTION = (
        "Push a preview image to an external viewer service via WebSocket. "
        "Images are encoded as compressed WebP and sent to a viewer tab."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "Image to push to Last Image Comparison viewer"}),
                "viewer_id": (
                    "STRING",
                    {
                        "default": "default",
                        "tooltip": "Unique identifier for the viewer instance (used in URL ?id=...)",
                    },
                ),
            },
            "optional": {
                "max_preview_resolution": (
                    "INT",
                    {
                        "default": 4096,
                        "min": 256,
                        "max": 4096,
                        "step": 64,
                        "tooltip": "Maximum resolution for longest side (downscales if larger)",
                    },
                ),
                "webp_quality": (
                    "INT",
                    {
                        "default": 80,
                        "min": 10,
                        "max": 100,
                        "step": 5,
                        "tooltip": "WebP quality (lower = smaller file, prioritize size over quality)",
                    },
                ),
            },
        }

    def push_image(
        self,
        image: torch.Tensor,
        viewer_id: str,
        max_preview_resolution: int = 1024,
        webp_quality: int = 45,
    ):
        """
        Process image and push to viewer service.

        Args:
            image: ComfyUI IMAGE tensor
            viewer_id: Unique viewer identifier
            auto_connect: Auto-reconnect setting
            max_preview_resolution: Max longest-side resolution
            webp_quality: WebP quality (0-100)
            ws_url: WebSocket server URL

        Returns:
            Empty dict (OUTPUT_NODE)
        """
        if not isinstance(image, torch.Tensor):
            raise TypeError(f"Expected torch.Tensor but got {type(image)}")

        try:
            # Extract first batch item and normalize
            tensor = image
            if tensor.ndim == 4:
                tensor = tensor[0]
            tensor = tensor.detach().cpu().clamp(0, 1)
            tensor = normalize_image_tensor(tensor)

            # Convert to PIL Image
            pil_image = to_pil_image(tensor)

            # Downscale if necessary
            if max_preview_resolution > 0:
                pil_image = downscale_image(pil_image, max_preview_resolution)

            # Encode to WebP
            image_webp_b64 = encode_webp(pil_image, quality=webp_quality)

            # Create message and deliver it over the built-in /ws channel
            message = create_image_push_message(viewer_id, image_webp_b64)
            PromptServer.instance.send_sync("last_image_comparison", message)

        except Exception as e:
            logger.error(f"[ImagePushOutput] Error processing image: {e}", exc_info=True)
            # Don't raise - just log and continue (dev tool, should be tolerant)

        return {}


NODE_CLASS_MAPPINGS = {
    "ImagePushOutput": ImagePushOutput,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ImagePushOutput": "Last Image Output",
}
