"""Minimal cv2 shim for the audio-only WebRTC prototype.

Pipecat's SmallWebRTC transport imports ``cv2`` at module import time for video
color conversions, even when video is disabled. The voice prototype runs
audio-only, so we provide the tiny surface needed to satisfy the import without
pulling in OpenCV's native FFmpeg stack.
"""

from __future__ import annotations

import numpy as np

COLOR_YUV2RGB_I420 = 1
COLOR_YUV2RGB_NV12 = 2
COLOR_GRAY2RGB = 3


def cvtColor(frame_array: np.ndarray, code: int) -> np.ndarray:
    if code == COLOR_GRAY2RGB:
        if frame_array.ndim == 2:
            return np.repeat(frame_array[:, :, None], 3, axis=2)
        if frame_array.ndim == 3 and frame_array.shape[2] == 1:
            return np.repeat(frame_array, 3, axis=2)
    raise NotImplementedError(
        "OpenCV video conversion is not available in this audio-only prototype."
    )
