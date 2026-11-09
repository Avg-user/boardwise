from django.conf import settings
from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.cases.permissions import CaseScopedMixin

from .tickets import make_ticket

LANGUAGES = {"en", "fr"}
PURPOSES = {"dictate", "read"}  # voice dictation, or reading a reply aloud


class DictationTicketView(CaseScopedMixin, APIView):
    """Issue a one-time ticket for the speech service in this case's chat.

    `purpose` is "dictate" (default: voice dictation, /speech/ws) or "read" (read a reply
    aloud, /speech/tts). A ticket only works for its own purpose.
    Owner only, like sending a message: strangers get 404 and grantees 403 (CaseScopedMixin).
    The browser opens `url?ticket=...` on the speech service within `expires_in` seconds.
    """

    @extend_schema(
        request=inline_serializer("DictationTicketRequest", {
            "language": serializers.ChoiceField(choices=sorted(LANGUAGES), required=False),
            "purpose": serializers.ChoiceField(choices=sorted(PURPOSES), required=False),
        }),
        responses={200: inline_serializer("DictationTicket", {
            "ticket": serializers.CharField(),
            "url": serializers.CharField(),
            "expires_in": serializers.IntegerField(),
        })},
    )
    def post(self, request, case_pk=None):
        case = self.get_case()  # access check first, so strangers can't probe whether dictation is on
        if not settings.SPEECH_TICKET_SECRET:
            return Response({"detail": "Dictation is not available."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        purpose = request.data.get("purpose") or "dictate"
        if purpose not in PURPOSES:
            return Response({"purpose": ["Must be \"dictate\" or \"read\"."]}, status=status.HTTP_400_BAD_REQUEST)
        language = request.data.get("language")
        if language not in LANGUAGES:
            language = request.user.preferred_language if request.user.preferred_language in LANGUAGES else None
        ttl = settings.SPEECH_TICKET_TTL
        ticket = make_ticket(user_id=request.user.pk, case_id=case.pk, language=language,
                             secret=settings.SPEECH_TICKET_SECRET, ttl=ttl, purpose=purpose)
        url = settings.SPEECH_TTS_URL if purpose == "read" else settings.SPEECH_WS_URL
        return Response({"ticket": ticket, "url": url, "expires_in": ttl})
