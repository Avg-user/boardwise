"""Speech tickets: short-lived, single-use, signed by Django with SPEECH_TICKET_SECRET.

A ticket proves that Django checked the user owns the case. It carries IDs only.

Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, first part))
Payload: {"u": user id, "c": case id, "lang": "en" | "fr" | null, "p": "dictate" | "read", "exp": unix seconds, "n": nonce}
A missing "p" means "dictate". A ticket only opens the endpoint for its purpose.

Django creates them in backend/apps/speech/tickets.py. Keep the two files in sync.
"""
import base64
import binascii
import hashlib
import hmac
import json
import time
from dataclasses import dataclass

LANGUAGES = {"en", "fr"}
PURPOSES = {"dictate", "read"}


class TicketError(Exception):
    pass


@dataclass(frozen=True)
class Claims:
    user_id: int
    case_id: int
    language: str | None
    purpose: str = "dictate"


def _b64decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class TicketVerifier:
    def __init__(self, secret: str, clock=time.time):
        self._secret = secret.encode()
        self._clock = clock
        self._used: dict[str, float] = {}  # nonce -> expiry, so a ticket works only once

    def verify(self, ticket: str) -> Claims:
        if not self._secret:
            raise TicketError("no secret configured")
        try:
            body, signature = ticket.split(".")
            expected = hmac.new(self._secret, body.encode("ascii"), hashlib.sha256).digest()
            if not hmac.compare_digest(expected, _b64decode(signature)):
                raise TicketError("bad signature")
            payload = json.loads(_b64decode(body))
            user_id, case_id = int(payload["u"]), int(payload["c"])
            expires, nonce = float(payload["exp"]), str(payload["n"])
            purpose = payload.get("p", "dictate")
            if purpose not in PURPOSES:
                raise TicketError("unknown purpose")
        except TicketError:
            raise
        except (ValueError, KeyError, TypeError, UnicodeError, binascii.Error) as exc:
            raise TicketError("malformed") from exc

        now = self._clock()
        if expires < now:
            raise TicketError("expired")
        self._used = {n: exp for n, exp in self._used.items() if exp >= now}
        if nonce in self._used:
            raise TicketError("already used")
        self._used[nonce] = expires

        language = payload.get("lang")
        return Claims(user_id, case_id, language if language in LANGUAGES else None, purpose)
