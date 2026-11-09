"""One-time tickets for the speech service: dictation (/ws) and read-aloud (/tts).

Django checks that the user owns the case, then signs a short-lived ticket. The speech
service (speech/tickets.py at the repo root) checks the signature with the same
SPEECH_TICKET_SECRET, so it never needs the database. Tickets carry IDs only.

Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, first part))
Payload: {"u": user id, "c": case id, "lang": "en" | "fr" | null, "p": "dictate" | "read", "exp": unix seconds, "n": nonce}
A missing "p" means "dictate".
Keep this in sync with speech/tickets.py.
"""
import base64
import hashlib
import hmac
import json
import secrets
import time


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def make_ticket(*, user_id: int, case_id: int, language: str | None, secret: str, ttl: int,
                purpose: str = "dictate") -> str:
    payload = {"u": user_id, "c": case_id, "lang": language, "p": purpose, "exp": int(time.time()) + ttl,
               "n": secrets.token_urlsafe(12)}
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    signature = hmac.new(secret.encode(), body.encode("ascii"), hashlib.sha256).digest()
    return f"{body}.{_b64(signature)}"
