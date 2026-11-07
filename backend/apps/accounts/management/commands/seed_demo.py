from datetime import date, timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.cases.models import Case, CaseShare, TimelineEntry
from apps.chat.models import Conversation, Message
from apps.tasks.models import Task

PASSWORD = "demo1234"
DEMO_USERS = [("victim", "victim"), ("hr", "hr"), ("lawfirm", "law_firm")]


class Command(BaseCommand):
    help = "Create demo accounts (victim, hr, lawfirm) and a sample case. Safe to re-run."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Delete existing demo users and their data first.")

    @transaction.atomic
    def handle(self, *args, reset=False, **opts):
        if not settings.DEBUG:
            raise CommandError("seed_demo only runs with DJANGO_DEBUG=1.")
        User = get_user_model()
        if reset:
            User.objects.filter(username__in=[u for u, _ in DEMO_USERS]).delete()

        users = {}
        for username, role in DEMO_USERS:
            user, created = User.objects.get_or_create(username=username, defaults={"role": role})
            if created:
                user.set_password(PASSWORD)
                user.save()
            users[username] = user

        victim = users["victim"]
        if victim.cases.exists():
            self.stdout.write("Demo case already exists (use --reset to recreate).")
        else:
            self._create_case(victim, users["lawfirm"])

        self.stdout.write(self.style.SUCCESS(
            f"Demo users ready: {', '.join(u for u, _ in DEMO_USERS)} / password: {PASSWORD}"
        ))

    def _create_case(self, victim, lawfirm):
        today = date.today()
        case = Case.objects.create(owner=victim, title="Repeated comments from team lead")
        for days_ago, title, desc in [
            (60, "First inappropriate comment", "Comment about appearance during standup."),
            (35, "Excluded from project meeting", "Not invited after raising concern."),
            (10, "Reported to manager", "Raised the issue by email; no response."),
        ]:
            TimelineEntry.objects.create(
                case=case, occurred_at=today - timedelta(days=days_ago), title=title, description=desc
            )
        for title in ["Save copies of relevant emails", "Write down witness names", "Review company HR policy"]:
            Task.objects.create(case=case, title=title, created_by_ai=True)
        convo = Conversation.objects.create(case=case)
        Message.objects.create(conversation=convo, role=Message.Role.USER, content="I don't know where to start.")
        Message.objects.create(
            conversation=convo,
            role=Message.Role.ASSISTANT,
            content="I'm an AI assistant, not a lawyer. I can help you organise what happened. "
                    "Let's start by listing the incidents you remember.",
        )
        CaseShare.objects.create(case=case, grantee=lawfirm)
