"""
Custom preview node that exposes the current image via ui metadata for frontend
extensions to render and compare against a manually saved "last image".
"""

import base64
import io

import torch
import torchvision.transforms as T

to_pil_image = T.ToPILImage()


def normalize_image_tensor(tensor: torch.Tensor) -> torch.Tensor:
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
        "LastImagePreview node expects an image tensor with 1, 3, or 4 channels "
        "and either channel-first or channel-last layout."
    )


class LastImagePreview:
    CATEGORY = "Last Image Comparision Viewer"
    OUTPUT_NODE = True
    RETURN_TYPES = ()
    FUNCTION = "preview"
    SIZE = [400, 600]  # Default size: width x height
    DESCRIPTION = (
        "Preview a single image and expose it to the custom frontend for manual "
        "comparison with a stored \"last\" image."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "Image to preview and compare manually."})
            }
        }

    def preview(self, image):
        if not isinstance(image, torch.Tensor):
            raise TypeError(f"Expected torch.Tensor but got {type(image)}")

        tensor = image
        if tensor.ndim == 4:
            tensor = tensor[0]
        tensor = tensor.detach().cpu().clamp(0, 1)
        tensor = normalize_image_tensor(tensor)
        pil_image = to_pil_image(tensor)

        with io.BytesIO() as buffered:
            pil_image.save(buffered, format="PNG")
            encoded = base64.b64encode(buffered.getvalue()).decode("utf-8")

        return {
            "ui": {
                "last_image_preview": (
                    "PNG",
                    "image/png",
                    encoded,
                    pil_image.width,
                    pil_image.height,
                )
            }
        }


NODE_CLASS_MAPPINGS = {
    "LastImagePreview": LastImagePreview,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "LastImagePreview": "Last Image Preview (manual save)",
}
