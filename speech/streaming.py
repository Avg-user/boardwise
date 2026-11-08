"""Streaming speech-to-text on top of faster-whisper.

Feed 16 kHz mono float32 audio chunks with `add_audio()`, call `process()` about once a
second, and get back newly *final* segments plus the current *partial* (still changing)
text. This file does no I/O, so the same class can sit behind a microphone, a file, or a
Django Channels WebSocket consumer later.

How it works (same idea as whisper-live's rolling buffer):
- Keep the audio that hasn't been finalized yet in a buffer.
- Each step, re-transcribe that buffer. Every segment except the last is final: whisper
  won't revise a sentence once a newer one has started. Commit those and drop their audio.
- The last segment is the partial. It becomes final when it stops changing for a few
  steps (the speaker paused) or when the buffer gets too long.
"""
import time
from dataclasses import dataclass

import numpy as np
from faster_whisper import WhisperModel

SAMPLE_RATE = 16000


@dataclass(frozen=True)
class Segment:
    start: float  # seconds from the start of the stream
    end: float
    text: str


@dataclass(frozen=True)
class Update:
    final: list[Segment]  # segments that just became final (never change again)
    partial: str          # current unfinished text ("" if none)
    compute_s: float      # time spent transcribing this step
    window_s: float       # seconds of audio transcribed this step


def load_model(name: str = "base", threads: int = 0) -> WhisperModel:
    """int8 on CPU: what whisper-live uses on CPU; fast with little accuracy loss."""
    return WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=threads)


class StreamingTranscriber:
    def __init__(self, model: WhisperModel, language: str | None = None, step_s: float = 1.0,
                 max_window_s: float = 8.0, stable_repeats: int = 1, beam_size: int = 1):
        self.model = model
        self.language = language
        self.step_s = step_s
        self.max_window_s = max_window_s
        self.stable_repeats = stable_repeats
        self.beam_size = beam_size  # 1 = greedy: fastest, fine for live text

        self._audio = np.zeros(0, dtype=np.float32)  # not-yet-final audio
        self._offset = 0.0     # stream time (s) of self._audio[0]
        self._new_samples = 0  # samples added since the last process()
        self._last_partial = ""
        self._repeats = 0

    @property
    def received_s(self) -> float:
        """Total seconds of audio received so far."""
        return self._offset + len(self._audio) / SAMPLE_RATE

    def add_audio(self, samples: np.ndarray) -> None:
        self._audio = np.concatenate([self._audio, samples.astype(np.float32, copy=False)])
        self._new_samples += len(samples)

    def ready(self) -> bool:
        """True once a full step of new audio has arrived."""
        return self._new_samples >= self.step_s * SAMPLE_RATE

    def process(self, final: bool = False) -> Update:
        """Transcribe the pending buffer. `final=True` at end of stream commits everything."""
        self._new_samples = 0
        window_s = len(self._audio) / SAMPLE_RATE
        if window_s < 0.3 and not final:
            return Update([], self._last_partial, 0.0, window_s)

        t0 = time.perf_counter()
        segments = self._transcribe() if window_s >= 0.3 else []
        compute_s = time.perf_counter() - t0

        if final:
            self._cut(window_s)
            self._last_partial = ""
            return Update(segments, "", compute_s, window_s)

        # Everything but the last segment is settled.
        committed = segments[:-1]
        last = segments[-1] if segments else None
        partial = last.text if last else ""

        # The last segment is final once it stops changing, or the buffer is too long.
        self._repeats = self._repeats + 1 if partial and partial == self._last_partial else 0
        if last and (self._repeats >= self.stable_repeats or window_s >= self.max_window_s):
            committed = segments
            partial = ""

        if committed:
            self._cut(committed[-1].end - self._offset)
        elif not segments and window_s > 5:
            self._cut(window_s - 1.0)  # only silence so far: drop it, keep a 1 s tail

        if not partial or committed:
            self._repeats = 0
        self._last_partial = partial
        return Update(committed, partial, compute_s, window_s)

    def _transcribe(self) -> list[Segment]:
        segments, _ = self.model.transcribe(
            self._audio,
            language=self.language,
            beam_size=self.beam_size,
            vad_filter=True,                  # skip silence; cuts hallucinations like "Thank you."
            vad_parameters={"min_silence_duration_ms": 500},
            condition_on_previous_text=False,  # each window stands alone; avoids repeat loops
        )
        out = []
        for s in segments:  # a generator: the actual decoding happens while iterating
            text = s.text.strip()
            if text and s.no_speech_prob < 0.6:
                out.append(Segment(self._offset + s.start, self._offset + s.end, text))
        return out

    def _cut(self, seconds: float) -> None:
        n = max(0, min(len(self._audio), int(seconds * SAMPLE_RATE)))
        self._audio = self._audio[n:]
        self._offset += n / SAMPLE_RATE
