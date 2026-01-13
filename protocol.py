"""
Shared message protocol for WebSocket image push viewer.
Defines the JSON schema and validation helpers.
"""

import json
import time
from typing import Dict, Any, Optional


def create_image_push_message(viewer_id: str, image_webp_base64: str) -> Dict[str, Any]:
    """
    Create a properly formatted image push message.
    
    Args:
        viewer_id: Unique identifier for the viewer instance
        image_webp_base64: Base64-encoded WebP image data (without data URI prefix)
        
    Returns:
        Dictionary ready for JSON serialization
    """
    return {
        "viewer_id": str(viewer_id),
        "image_webp": str(image_webp_base64),
        "timestamp": int(time.time() * 1000),  # Unix timestamp in milliseconds
    }


def validate_message(data: Dict[str, Any]) -> bool:
    """
    Validate that a message dict has all required fields.
    
    Args:
        data: Dictionary to validate
        
    Returns:
        True if valid, False otherwise
    """
    required_keys = {"viewer_id", "image_webp", "timestamp"}
    return isinstance(data, dict) and required_keys.issubset(data.keys())


def serialize_message(message: Dict[str, Any]) -> str:
    """
    Serialize a message dict to JSON string.
    
    Args:
        message: Message dictionary
        
    Returns:
        JSON string
    """
    return json.dumps(message)


def deserialize_message(json_str: str) -> Optional[Dict[str, Any]]:
    """
    Deserialize a JSON string to message dict.
    
    Args:
        json_str: JSON string
        
    Returns:
        Message dictionary or None if invalid
    """
    try:
        data = json.loads(json_str)
        if validate_message(data):
            return data
        return None
    except (json.JSONDecodeError, TypeError):
        return None
