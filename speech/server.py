"""Boardwise speech service: live dictation over WebSocket, transcribed locally with faster-whisper.

Idle until someone dictates: the model loads on the first session and unloads after
SPEECH_IDLE_UNLOAD_S seconds without one, so an idle container uses no CPU and little memory.

GET /warm loads the model ahead of a session (the chat calls it when it opens).

Protocol (one WebSocket per dictation):
  connect   /ws?ticket=<one-time ticket from Django's /api/cases/<id>/dictation-ticket/>
  server -> {"type": "ready"}                      start sending audio
  client -> binary frames                          16 kHz mono 16-bit little-endian PCM
  client -> {"type": "stop"}                       finish and flush the last words
  server -> {"type": "partial", "text": "..."}     unfinished text; replaces the previous partial
  server -> {"type": "final", "text": "..."}       finished text; never changes again
  server -> {"type": "done", "reason": "stopped" | "limit"}   then closes
  server -> {"type": "error", "code": "unauthorized" | "busy" | "failed"}   then closes

Privacy: audio and text are never stored, and transcript text is never logged (IDs only).
"""
import asyncio
import gc
import itertools
import json
import logging
import os
import signal
import time
from dataclasses import dataclass
from http import HTTPStatus
from urllib.parse import parse_qs, urlparse

import numpy as np
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

from streaming import SAMPLE_RATE, StreamingTranscriber, load_model
from tickets import TicketError, TicketVerifier

log = logging.getLogger("speech")
MAX_FRAME_BYTES = 64 * 1024  # ~2 s of audio; browsers send ~100 ms (3.2 KB) frames


@dataclass(frozen=True)
class Config:
    secret: str = ""
    model: str = "base"
    threads: int = 0
    max_sessions: int = 2
    max_seconds: float = 180.0
    idle_unload_s: float = 120.0
    host: str = "0.0.0.0"
    port: int = 9100

    @classmethod
    def from_env(cls) -> "Config":
        env = os.environ.get
        return cls(
            secret=env("SPEECH_TICKET_SECRET", ""),
            model=env("SPEECH_MODEL", "base"),
            threads=int(env("SPEECH_THREADS", "0")),
            max_sessions=int(env("SPEECH_MAX_SESSIONS", "2")),
            max_seconds=float(env("DICTATION_MAX_SECONDS", "180")),
            idle_unload_s=float(env("SPEECH_IDLE_UNLOAD_S", "120")),
            host=env("SPEECH_HOST", "0.0.0.0"),
            port=int(env("SPEECH_PORT", "9100")),
        )


class ModelPool:
    """Loads the model on first use and drops it after a quiet period."""

    def __init__(self, name: str, threads: int, idle_unload_s: float, loader=load_model):
        self.name, self.threads, self.idle_unload_s = name, threads, idle_unload_s
        self._loader = loader
        self._model = None
        self._lock = asyncio.Lock()
        self._last_used = time.monotonic()
        self.in_use = 0

    @property
    def loaded(self) -> bool:
        return self._model is not None

    async def get(self):
        async with self._lock:
            if self._model is None:
                started = time.perf_counter()
                self._model = await asyncio.to_thread(self._loader, self.name, self.threads)
                log.info("Loaded model %s in %.1fs", self.name, time.perf_counter() - started)
            return self._model

    def touch(self) -> None:
        self._last_used = time.monotonic()

    def unload_if_idle(self) -> bool:
        idle = time.monotonic() - self._last_used
        if self._model is not None and self.in_use == 0 and idle >= self.idle_unload_s:
            self._model = None
            gc.collect()
            log.info("Unloaded model after %.0fs idle", idle)
            return True
        return False

    async def unload_when_idle(self) -> None:
        while True:
            await asyncio.sleep(max(1.0, min(30.0, self.idle_unload_s / 2)))
            self.unload_if_idle()


class SpeechServer:
    def __init__(self, config: Config, loader=load_model, clock=time.time):
        self.config = config
        self.tickets = TicketVerifier(config.secret, clock=clock)
        self.models = ModelPool(config.model, config.threads, config.idle_unload_s, loader)
        self._ids = itertools.count(1)
        self._warming = None  # keeps the warm-up task from being garbage-collected

    def process_request(self, connection, request):
        path = urlparse(request.path).path
        if path == "/health":
            return connection.respond(HTTPStatus.OK, "ok\n")
        if path == "/warm":
            self.models.touch()  # restart the idle timer
            self._warming = asyncio.get_running_loop().create_task(self.models.get())
            return connection.respond(HTTPStatus.OK, "ok\n")
        if path != "/ws":
            return connection.respond(HTTPStatus.NOT_FOUND, "Not found\n")
        return None  # continue with the WebSocket handshake

    async def handler(self, ws) -> None:
        session = next(self._ids)
        ticket = parse_qs(urlparse(ws.request.path).query).get("ticket", [""])[0]
        try:
            claims = self.tickets.verify(ticket)
        except TicketError as exc:
            log.info("Session %s refused: ticket %s", session, exc)
            await self._fail(ws, "unauthorized", 1008)
            return
        if self.models.in_use >= self.config.max_sessions:
            log.info("Session %s refused: busy", session)
            await self._fail(ws, "busy", 1013)
            return

        self.models.in_use += 1
        started = time.monotonic()
        audio_s = 0.0
        try:
            # Ready before loading: the client starts sending, and frames queue while the model loads.
            await ws.send(json.dumps({"type": "ready"}))
            model = await self.models.get()
            stt = StreamingTranscriber(model, language=claims.language)
            audio_s = await self._run(ws, stt, session)
        except ConnectionClosed:
            pass
        except Exception as exc:
            # Exception text could echo input; log the type only.
            log.error("Session %s failed: %s", session, type(exc).__name__)
            await self._fail(ws, "failed", 1011)
        finally:
            self.models.in_use -= 1
            self.models.touch()
            log.info("Session %s (user %s, case %s) ended: %.0fs audio in %.0fs",
                     session, claims.user_id, claims.case_id, audio_s, time.monotonic() - started)

    async def _run(self, ws, stt: StreamingTranscriber, session: int) -> float:
        """Feed audio to the transcriber and send text back until stop, limit or disconnect."""
        pending: list[np.ndarray] = []  # audio received while the transcriber was busy
        wake = asyncio.Event()
        state = {"stop": False, "reason": "stopped", "closed": False, "received": 0.0}

        async def receive() -> None:
            try:
                async for message in ws:
                    if isinstance(message, bytes):
                        if len(message) % 2:
                            continue  # not whole 16-bit samples
                        pending.append(np.frombuffer(message, dtype="<i2"))
                        state["received"] += len(message) / 2 / SAMPLE_RATE
                        if state["received"] >= self.config.max_seconds:
                            state["stop"], state["reason"] = True, "limit"
                            return
                    else:
                        try:
                            data = json.loads(message)
                        except ValueError:
                            continue
                        if isinstance(data, dict) and data.get("type") == "stop":
                            state["stop"], state["stop_at"] = True, time.monotonic()
                            return
                    wake.set()
                state["closed"] = True  # client went away without "stop"
            except ConnectionClosed:
                state["closed"] = True
            finally:
                state["stop"] = True
                wake.set()

        receiver = asyncio.create_task(receive())
        slowest = 0.0
        try:
            while True:
                await wake.wait()
                wake.clear()
                if pending:
                    chunk = np.concatenate(pending).astype(np.float32) / 32768.0
                    pending.clear()
                    stt.add_audio(chunk)
                if state["stop"]:
                    break
                if stt.ready():
                    # Off the event loop, so other sessions and new audio keep flowing.
                    update = await asyncio.to_thread(stt.process)
                    slowest = max(slowest, update.compute_s)
                    await self._send(ws, update)
            if state["closed"]:
                return state["received"]
            await self._send(ws, await asyncio.to_thread(stt.process, True))
            await ws.send(json.dumps({"type": "done", "reason": state["reason"]}))
            log.info("Session %s timing: slowest update %.2fs, stop to done %.2fs", session,
                     slowest, time.monotonic() - state.get("stop_at", time.monotonic()))
            await ws.close()
            return state["received"]
        finally:
            receiver.cancel()

    @staticmethod
    async def _send(ws, update) -> None:
        for segment in update.final:
            await ws.send(json.dumps({"type": "final", "text": segment.text}))
        await ws.send(json.dumps({"type": "partial", "text": update.partial}))

    @staticmethod
    async def _fail(ws, code: str, close_code: int) -> None:
        try:
            await ws.send(json.dumps({"type": "error", "code": code}))
            await ws.close(close_code)
        except ConnectionClosed:
            pass


async def main() -> None:
    config = Config.from_env()
    if not config.secret:
        log.warning("SPEECH_TICKET_SECRET is not set, so every dictation will be refused.")
    server = SpeechServer(config)
    stop = asyncio.get_running_loop().create_future()
    try:
        asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, stop.set_result, None)
    except NotImplementedError:
        pass  # Windows; Ctrl+C still works
    unloader = asyncio.create_task(server.models.unload_when_idle())
    async with serve(server.handler, config.host, config.port, process_request=server.process_request,
                     max_size=MAX_FRAME_BYTES):
        log.info("Listening on %s:%s (model %s loads on first use, max %s sessions)",
                 config.host, config.port, config.model, config.max_sessions)
        await stop
    unloader.cancel()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("websockets").setLevel(logging.WARNING)  # its request logs include the ticket URL
    logging.getLogger("faster_whisper").setLevel(logging.WARNING)  # logs every step otherwise
    asyncio.run(main())
