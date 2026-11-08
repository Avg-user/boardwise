"""Move what the browser used to remember onto the server.

Until now, which timeline entry belonged to which chat (and which chats were closed) was kept
in each browser's localStorage. A second browser didn't know the link and created its own
entry, so chats showed twice. This migration:

1. Links each chat to the entry the app created for it. An entry belongs to the chat whose
   message was saved most recently before the entry (within 10 minutes), since the app
   created the entry right after a message went through.
2. Deletes the extra copies other browsers created. Only entries the app generated itself
   are touched: the "Chat on …" / "Discussion du …" title, no description, source manual.
3. Keeps one open chat per case (the newest), as the app always intended.
"""
import re
from datetime import timedelta

from django.db import migrations
from django.utils import timezone

WINDOW = timedelta(minutes=10)
GENERATED_TITLE = re.compile(r"^(Chat on |Discussion du ).+")


def forwards(apps, schema_editor):
    Conversation = apps.get_model("chat", "Conversation")
    Message = apps.get_model("chat", "Message")
    TimelineEntry = apps.get_model("cases", "TimelineEntry")

    case_ids = Conversation.objects.values_list("case_id", flat=True).distinct()
    for case_id in case_ids:
        messages = list(
            Message.objects.filter(conversation__case_id=case_id)
            .order_by("created_at").values_list("created_at", "conversation_id")
        )
        if not messages:
            continue
        candidates = [
            entry for entry in TimelineEntry.objects.filter(
                case_id=case_id, conversation__isnull=True, source="manual", description=""
            ).order_by("created_at")
            if GENERATED_TITLE.match(entry.title)
        ]
        by_conversation: dict[int, list] = {}
        for entry in candidates:
            before = [(at, convo) for at, convo in messages if at <= entry.created_at]
            if before and entry.created_at - before[-1][0] <= WINDOW:
                by_conversation.setdefault(before[-1][1], []).append(entry)
        for convo_id, entries in by_conversation.items():
            keep, *copies = entries
            keep.conversation_id = convo_id
            keep.save(update_fields=["conversation"])
            for copy in copies:
                copy.delete()

        open_chats = list(
            Conversation.objects.filter(case_id=case_id, closed_at__isnull=True).order_by("-created_at")
        )
        for convo in open_chats[1:]:
            convo.closed_at = timezone.now()
            convo.save(update_fields=["closed_at"])


class Migration(migrations.Migration):

    dependencies = [
        ("cases", "0003_timeline_entry_conversation"),
        ("chat", "0002_conversation_closed_at"),
    ]

    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
