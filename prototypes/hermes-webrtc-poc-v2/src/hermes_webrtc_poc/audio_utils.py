from __future__ import annotations

import io
import wave

from pipecat.frames.frames import OutputAudioRawFrame


def pcm_to_wav_bytes(audio: bytes, sample_rate: int, num_channels: int) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as wav_file:
        wav_file.setnchannels(num_channels)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(audio)
    return buffer.getvalue()


def _read_wav_pcm(wav_bytes: bytes) -> tuple[bytes, int, int]:
    with wave.open(io.BytesIO(wav_bytes), 'rb') as wav_file:
        channels = wav_file.getnchannels()
        sample_rate = wav_file.getframerate()
        sample_width = wav_file.getsampwidth()
        if sample_width != 2:
            raise ValueError(f'Unsupported WAV sample width: {sample_width}')
        audio = wav_file.readframes(wav_file.getnframes())
    return audio, sample_rate, channels


def wav_duration_seconds(wav_bytes: bytes) -> float:
    audio, sample_rate, channels = _read_wav_pcm(wav_bytes)
    bytes_per_second = sample_rate * channels * 2
    if bytes_per_second <= 0:
        raise ValueError('Invalid WAV timing information')
    return len(audio) / bytes_per_second


def wav_to_transport_frames(wav_bytes: bytes, frame_ms: int = 20) -> list[OutputAudioRawFrame]:
    audio, sample_rate, channels = _read_wav_pcm(wav_bytes)
    bytes_per_frame = int(sample_rate * channels * 2 * frame_ms / 1000)
    if bytes_per_frame <= 0:
        raise ValueError('Invalid WAV timing information')

    remainder = len(audio) % bytes_per_frame
    if remainder:
        audio += b'\x00' * (bytes_per_frame - remainder)

    frames: list[OutputAudioRawFrame] = []
    for start in range(0, len(audio), bytes_per_frame):
        frames.append(
            OutputAudioRawFrame(
                audio=audio[start : start + bytes_per_frame],
                sample_rate=sample_rate,
                num_channels=channels,
            )
        )
    return frames
