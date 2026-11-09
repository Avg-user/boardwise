import base64
import hashlib
import hmac
import json
import time

from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APITestCase

from apps.cases.models import Case, CaseShare

User = get_user_model()
SECRET = "test-secret"


def decode(ticket: str, secret: str = SECRET) -> dict:
    """Check a ticket the way speech/tickets.py does, and return its payload."""
    body, signature = ticket.split(".")
    expected = hmac.new(secret.encode(), body.encode(), hashlib.sha256).digest()
    assert hmac.compare_digest(expected, base64.urlsafe_b64decode(signature + "=" * (-len(signature) % 4)))
    return json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))


@override_settings(SPEECH_TICKET_SECRET=SECRET, SPEECH_TICKET_TTL=60, SPEECH_WS_URL="/speech/ws",
                   SPEECH_TTS_URL="/speech/tts")
class DictationTicketTests(APITestCase):
    def setUp(self):
        self.victim = User.objects.create_user("v", role=User.Role.VICTIM, preferred_language="fr")
        self.stranger = User.objects.create_user("v2", role=User.Role.VICTIM)
        self.lawyer = User.objects.create_user("l", role=User.Role.LAW_FIRM)
        self.case = Case.objects.create(owner=self.victim, title="t")
        self.url = f"/api/cases/{self.case.pk}/dictation-ticket/"

    def post(self, user, data=None):
        if user:
            self.client.force_authenticate(user)
        return self.client.post(self.url, data or {}, format="json")

    def test_owner_gets_a_signed_ticket_with_ids_only(self):
        response = self.post(self.victim, {"language": "en"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["url"], "/speech/ws")
        self.assertEqual(response.data["expires_in"], 60)
        payload = decode(response.data["ticket"])
        self.assertEqual(set(payload), {"u", "c", "lang", "p", "exp", "n"})
        self.assertEqual(payload["p"], "dictate")
        self.assertEqual((payload["u"], payload["c"], payload["lang"]), (self.victim.pk, self.case.pk, "en"))
        self.assertAlmostEqual(payload["exp"], time.time() + 60, delta=5)

    def test_read_aloud_ticket_points_at_tts(self):
        response = self.post(self.victim, {"purpose": "read", "language": "en"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["url"], "/speech/tts")
        self.assertEqual(decode(response.data["ticket"])["p"], "read")

    def test_unknown_purpose_rejected(self):
        self.assertEqual(self.post(self.victim, {"purpose": "record"}).status_code, 400)

    def test_grantee_cannot_get_read_aloud_ticket(self):
        CaseShare.objects.create(case=self.case, grantee=self.lawyer)
        self.assertEqual(self.post(self.lawyer, {"purpose": "read"}).status_code, 403)

    def test_tickets_are_unique(self):
        first, second = (decode(self.post(self.victim).data["ticket"]) for _ in range(2))
        self.assertNotEqual(first["n"], second["n"])

    def test_language_falls_back_to_preferred_language(self):
        self.assertEqual(decode(self.post(self.victim, {"language": "xx"}).data["ticket"])["lang"], "fr")

    def test_wrong_secret_does_not_verify(self):
        with self.assertRaises(AssertionError):
            decode(self.post(self.victim).data["ticket"], secret="other")

    def test_logged_out_rejected(self):
        self.assertEqual(self.post(None).status_code, 401)

    def test_stranger_gets_404(self):
        self.assertEqual(self.post(self.stranger).status_code, 404)

    def test_grantee_is_read_only(self):
        CaseShare.objects.create(case=self.case, grantee=self.lawyer)
        self.assertEqual(self.post(self.lawyer).status_code, 403)

    def test_revoked_grantee_gets_404(self):
        CaseShare.objects.create(case=self.case, grantee=self.lawyer).revoke()
        self.assertEqual(self.post(self.lawyer).status_code, 404)

    @override_settings(SPEECH_TICKET_SECRET="")
    def test_unavailable_without_secret(self):
        self.assertEqual(self.post(self.victim).status_code, 503)

    @override_settings(SPEECH_TICKET_SECRET="")
    def test_stranger_still_gets_404_when_unavailable(self):
        self.assertEqual(self.post(self.stranger).status_code, 404)
