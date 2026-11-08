"""Speech service tests. A fake model stands in for whisper, so nothing is downloaded.

Run: docker compose run --rm speech python -m unittest -v tests
"""
import asyncio
import base64
import hashlib
import hmac
import json
import time
import unittest
import urllib.error
import urllib.request
from types import SimpleNamespace

import numpy as np
from websockets.asyncio.client import connect
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

from server import MAX_FRAME_BYTES, Config, ModelPool, SpeechServer
from streaming import SAMPLE_RATE, StreamingTranscriber
from tickets import TicketError, TicketVerifier

SECRET = "test-secret"


def make_ticket(user_id=1, case_id=2, lang="en", ttl=60, nonce=None, secret=SECRET, now=None):
    """Same format as backend/apps/speech/tickets.py."""
    payload = {"u": user_id, "c": case_id, "lang": lang, "exp": int((now or time.time()) + ttl),
               "n": nonce or base64.urlsafe_b64encode(np.random.bytes(12)).decode()}
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    sig = hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()
    return body + "." + base64.urlsafe_b64encode(sig).decode().rstrip("=")


class FakeModel:
    """Says "word<n>" for each whole second of audio, one segment per second."""

    def __init__(self):
        self.calls = 0

    def transcribe(self, audio, **kwargs):
        self.calls += 1
        seconds = int(len(audio) / SAMPLE_RATE)
        segments = [SimpleNamespace(start=float(i), end=float(i + 1), text=f" word{self.calls}-{i}",
                                    no_speech_prob=0.0) for i in range(seconds)]
        return iter(segments), None


def pcm(seconds: float) -> bytes:
    return (np.zeros(int(seconds * SAMPLE_RATE), dtype="<i2")).tobytes()


class TicketTests(unittest.TestCase):
    def test_valid_ticket(self):
        claims = TicketVerifier(SECRET).verify(make_ticket(user_id=7, case_id=9, lang="fr"))
        self.assertEqual((claims.user_id, claims.case_id, claims.language), (7, 9, "fr"))

    def test_unknown_language_means_auto_detect(self):
        self.assertIsNone(TicketVerifier(SECRET).verify(make_ticket(lang="xx")).language)

    def test_rejects_bad_tickets(self):
        verifier = TicketVerifier(SECRET)
        for bad in ["", "abc", "a.b.c", make_ticket(secret="other"), make_ticket(ttl=-5),
                    make_ticket() + "x", "é." + make_ticket().split(".")[1]]:
            with self.assertRaises(TicketError, msg=bad):
                verifier.verify(bad)

    def test_single_use(self):
        verifier = TicketVerifier(SECRET)
        ticket = make_ticket()
        verifier.verify(ticket)
        with self.assertRaises(TicketError):
            verifier.verify(ticket)

    def test_no_secret_refuses_everything(self):
        with self.assertRaises(TicketError):
            TicketVerifier("").verify(make_ticket(secret=""))


class StreamingTests(unittest.TestCase):
    def test_all_but_last_segment_is_final(self):
        stt = StreamingTranscriber(FakeModel(), step_s=1.0)
        stt.add_audio(np.zeros(3 * SAMPLE_RATE, dtype=np.float32))
        update = stt.process()
        self.assertEqual([s.text for s in update.final], ["word1-0", "word1-1"])
        self.assertEqual(update.partial, "word1-2")

    def test_final_flush_commits_everything(self):
        stt = StreamingTranscriber(FakeModel())
        stt.add_audio(np.zeros(2 * SAMPLE_RATE, dtype=np.float32))
        update = stt.process(final=True)
        self.assertEqual(len(update.final), 2)
        self.assertEqual(update.partial, "")
        self.assertEqual(stt.process(final=True).final, [])  # nothing left

    def test_stable_partial_becomes_final(self):
        class Same:
            def transcribe(self, audio, **kwargs):
                return iter([SimpleNamespace(start=0.0, end=0.5, text=" hello", no_speech_prob=0.0)]), None
        stt = StreamingTranscriber(Same(), stable_repeats=2)
        finals = []
        for _ in range(3):
            stt.add_audio(np.zeros(SAMPLE_RATE, dtype=np.float32))
            finals += stt.process().final
        self.assertEqual([s.text for s in finals], ["hello"])


class ModelPoolTests(unittest.IsolatedAsyncioTestCase):
    async def test_loads_once_and_unloads_when_idle(self):
        loads = []
        pool = ModelPool("base", 0, idle_unload_s=0, loader=lambda name, threads: loads.append(name) or FakeModel())
        self.assertFalse(pool.loaded)
        await pool.get()
        await pool.get()
        self.assertEqual(loads, ["base"])
        pool.in_use = 1
        self.assertFalse(pool.unload_if_idle())  # never while a session is running
        pool.in_use = 0
        self.assertTrue(pool.unload_if_idle())
        self.assertFalse(pool.loaded)


class ServerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.model = FakeModel()
        self.speech = SpeechServer(Config(secret=SECRET, max_sessions=1, max_seconds=5),
                                   loader=lambda name, threads: self.model)
        self.server = await serve(self.speech.handler, "127.0.0.1", 0,
                                  process_request=self.speech.process_request, max_size=MAX_FRAME_BYTES)
        self.port = self.server.sockets[0].getsockname()[1]

    async def asyncTearDown(self):
        self.server.close()
        await self.server.wait_closed()

    def url(self, ticket):
        return f"ws://127.0.0.1:{self.port}/ws?ticket={ticket}"

    async def messages(self, ws):
        out = []
        try:
            async for raw in ws:
                out.append(json.loads(raw))
        except ConnectionClosed:
            pass
        return out

    async def test_health(self):
        body = await asyncio.to_thread(
            lambda: urllib.request.urlopen(f"http://127.0.0.1:{self.port}/health").read())
        self.assertEqual(body, b"ok\n")

    async def test_dictation_round_trip(self):
        async with connect(self.url(make_ticket())) as ws:
            self.assertEqual(json.loads(await ws.recv()), {"type": "ready"})
            for _ in range(25):  # 2.5 s in 100 ms frames, like the browser sends
                await ws.send(pcm(0.1))
            await ws.send(json.dumps({"type": "stop"}))
            received = await self.messages(ws)
        finals = [m["text"] for m in received if m["type"] == "final"]
        self.assertTrue(finals, received)
        self.assertEqual(received[-1], {"type": "done", "reason": "stopped"})
        # The handler frees its slot just after the close handshake; give it a moment.
        for _ in range(50):
            if not self.speech.models.in_use:
                break
            await asyncio.sleep(0.01)
        self.assertEqual(self.speech.models.in_use, 0)

    async def test_bad_ticket_is_refused_before_loading_the_model(self):
        async with connect(self.url("nope")) as ws:
            received = await self.messages(ws)
        self.assertEqual(received, [{"type": "error", "code": "unauthorized"}])
        self.assertFalse(self.speech.models.loaded)

    async def test_ticket_cannot_be_reused(self):
        ticket = make_ticket()
        async with connect(self.url(ticket)) as ws:
            await ws.recv()
            await ws.send(json.dumps({"type": "stop"}))
            await self.messages(ws)
        async with connect(self.url(ticket)) as ws:
            self.assertEqual(await self.messages(ws), [{"type": "error", "code": "unauthorized"}])

    async def test_busy_when_full(self):
        async with connect(self.url(make_ticket())) as first:
            await first.recv()  # ready: holds the only session
            async with connect(self.url(make_ticket())) as second:
                self.assertEqual(await self.messages(second), [{"type": "error", "code": "busy"}])
            await first.send(json.dumps({"type": "stop"}))
            await self.messages(first)

    async def test_stops_at_time_limit(self):
        async with connect(self.url(make_ticket())) as ws:
            await ws.recv()
            for _ in range(7):  # 7 s > max_seconds=5
                await ws.send(pcm(1.0))
            received = await self.messages(ws)
        self.assertEqual(received[-1], {"type": "done", "reason": "limit"})

    async def test_unknown_path_is_404(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            await asyncio.to_thread(lambda: urllib.request.urlopen(f"http://127.0.0.1:{self.port}/nope"))
        self.assertEqual(caught.exception.code, 404)


if __name__ == "__main__":
    unittest.main()
