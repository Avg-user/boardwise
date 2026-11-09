"""Read-aloud: turns reply text into speech locally with Piper (a small neural voice on CPU).

The voice file is downloaded into TTS_VOICE_DIR when the image is built (see the Dockerfile),
so nothing is fetched at runtime and no text leaves the machine. Text is never stored or logged.
"""
import os

VOICE_DIR = os.environ.get("TTS_VOICE_DIR", "/voices")


class Speaker:
    """One loaded Piper voice. `speak` returns (sample rate, 16-bit mono PCM bytes)."""

    def __init__(self, voice, length_scale: float):
        self._voice = voice
        self._length_scale = length_scale

    def speak(self, text: str) -> tuple[int, bytes]:
        from piper import SynthesisConfig

        config = SynthesisConfig(length_scale=self._length_scale)
        rate, parts = 22050, []
        for chunk in self._voice.synthesize(text, syn_config=config):
            rate = chunk.sample_rate
            parts.append(chunk.audio_int16_bytes)
        return rate, b"".join(parts)


def load_speaker(name: str, length_scale: float = 1.0) -> Speaker:
    from piper import PiperVoice  # imported on first use: dictation-only runs and tests don't need it

    return Speaker(PiperVoice.load(os.path.join(VOICE_DIR, f"{name}.onnx")), length_scale)
