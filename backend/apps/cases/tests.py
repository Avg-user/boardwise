from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from django.test import TestCase

from .models import Case, CaseShare

User = get_user_model()


class CaseAccessTests(TestCase):
    def setUp(self):
        self.victim = User.objects.create_user("victim", role=User.Role.VICTIM)
        self.lawyer = User.objects.create_user("lawyer", role=User.Role.LAW_FIRM)
        self.hr = User.objects.create_user("hr", role=User.Role.HR)
        self.case = Case.objects.create(owner=self.victim, title="c")

    def test_owner_has_access(self):
        self.assertTrue(self.case.can_access(self.victim))
        self.assertIn(self.case, Case.objects.accessible_by(self.victim))

    def test_unshared_user_denied(self):
        self.assertFalse(self.case.can_access(self.lawyer))
        self.assertNotIn(self.case, Case.objects.accessible_by(self.lawyer))

    def test_anonymous_denied(self):
        self.assertFalse(self.case.can_access(AnonymousUser()))
        self.assertFalse(Case.objects.accessible_by(AnonymousUser()).exists())

    def test_share_grants_access_only_to_grantee(self):
        CaseShare.objects.create(case=self.case, grantee=self.lawyer)
        self.assertTrue(self.case.can_access(self.lawyer))
        self.assertIn(self.case, Case.objects.accessible_by(self.lawyer))
        self.assertFalse(self.case.can_access(self.hr))

    def test_revoked_share_removes_access(self):
        share = CaseShare.objects.create(case=self.case, grantee=self.lawyer)
        share.revoke()
        self.assertFalse(self.case.can_access(self.lawyer))
        self.assertNotIn(self.case, Case.objects.accessible_by(self.lawyer))

    def test_regrant_after_revoke(self):
        CaseShare.objects.create(case=self.case, grantee=self.lawyer).revoke()
        CaseShare.objects.create(case=self.case, grantee=self.lawyer)
        self.assertTrue(self.case.can_access(self.lawyer))


class LinkChatEntriesMigrationTests(TestCase):
    """The 0004 data migration: link each chat to its generated entry, drop extra copies."""

    def test_links_and_dedupes(self):
        import importlib
        from datetime import date, timedelta

        from django.apps import apps
        from django.contrib.auth import get_user_model
        from django.utils import timezone

        from apps.chat.models import Conversation, Message

        from .models import Case, TimelineEntry

        migration = importlib.import_module("apps.cases.migrations.0004_link_chat_entries")
        owner = get_user_model().objects.create_user("v", role="victim")
        case = Case.objects.create(owner=owner, title="t")
        t0 = timezone.now() - timedelta(days=1)

        def at(model, minutes, **fields):
            obj = model.objects.create(**fields)
            model.objects.filter(pk=obj.pk).update(created_at=t0 + timedelta(minutes=minutes))
            return model.objects.get(pk=obj.pk)

        old = at(Conversation, 0, case=case)
        at(Message, 1, conversation=old, role="user", content="a")
        first = at(TimelineEntry, 2, case=case, occurred_at=date.today(), title="Chat on Nov 7, 2026")
        at(Message, 30, conversation=old, role="user", content="b")
        copy = at(TimelineEntry, 31, case=case, occurred_at=date.today(), title="Chat on Nov 7, 2026")
        new = at(Conversation, 40, case=case)
        at(Message, 41, conversation=new, role="user", content="c")
        second = at(TimelineEntry, 42, case=case, occurred_at=date.today(), title="Discussion du 7 nov. 2026")
        written = at(TimelineEntry, 43, case=case, occurred_at=date.today(), title="Chat on Nov 7, 2026",
                     description="My own note")  # has the person's words: never touched
        manual = at(TimelineEntry, 44, case=case, occurred_at=date.today(), title="Reported to manager")

        migration.forwards(apps, None)

        self.assertEqual(TimelineEntry.objects.get(pk=first.pk).conversation_id, old.pk)
        self.assertEqual(TimelineEntry.objects.get(pk=second.pk).conversation_id, new.pk)
        self.assertFalse(TimelineEntry.objects.filter(pk=copy.pk).exists())
        self.assertIsNone(TimelineEntry.objects.get(pk=written.pk).conversation_id)
        self.assertIsNone(TimelineEntry.objects.get(pk=manual.pk).conversation_id)
        # One open chat per case: the newest.
        self.assertIsNotNone(Conversation.objects.get(pk=old.pk).closed_at)
        self.assertIsNone(Conversation.objects.get(pk=new.pk).closed_at)
