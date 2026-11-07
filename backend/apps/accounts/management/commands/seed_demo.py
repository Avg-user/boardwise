from datetime import date, timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.cases.models import Case, CaseShare, TimelineEntry
from apps.chat.models import Conversation, Message
from apps.lawfirms.models import LawFirmProfile, MatchRequest
from apps.tasks.models import Task

PASSWORD = "demo1234"
DEMO_USERS = [
    ("victim", "victim"), ("hr", "hr"), ("lawfirm", "law_firm"),
    ("prairielaw", "law_firm"), ("justiceco", "law_firm"), ("newfirm", "law_firm"),
]

# Fictional firms for the marketplace demo. "newfirm" stays unverified, so it isn't listed.
DEMO_FIRMS = {
    "lawfirm": dict(
        name="Harbour Employment Law", tagline="Harassment, discrimination and dismissal claims",
        description="A small team focused on workers. We help you understand your options, "
                    "deal with your employer and, when needed, file a complaint or claim.",
        practice_areas=["harassment", "discrimination", "dismissal"], languages=["en", "fr"],
        provinces=["AB"], city="Calgary", years_in_practice=12, free_consultation=True,
        hourly_rate_min=275, hourly_rate_max=400, contingency_percent=30,
        fee_notes="First 30-minute call is free. Contingency available for dismissal claims.",
        website="https://example.com/harbour", law_society_number="DEMO-1001", is_verified=True),
    "prairielaw": dict(
        name="Prairie Workers Legal Clinic", tagline="Low-cost help with wages, safety and WCB",
        description="A non-profit clinic for workers who can't afford a private lawyer.",
        practice_areas=["wages", "safety", "workers_comp"], languages=["en", "pa", "tl"],
        provinces=["AB"], city="Edmonton", years_in_practice=8, free_consultation=True,
        sliding_scale=True, legal_aid=True, fee_notes="Fees based on income. Many services are free.",
        law_society_number="DEMO-1002", is_verified=True),
    "justiceco": dict(
        name="Bow River Litigation", tagline="Employment contracts and wrongful dismissal",
        description="Litigation-focused firm for complex dismissal and contract disputes.",
        practice_areas=["dismissal", "contracts"], languages=["en", "zh"], provinces=["AB", "BC"],
        city="Calgary", years_in_practice=20, consultation_fee=150, hourly_rate_min=400,
        hourly_rate_max=650, flat_fee_from=1500, law_society_number="DEMO-1003", is_verified=True),
    "newfirm": dict(
        name="Unverified Demo Firm", description="Waiting for verification, so not listed.",
        practice_areas=["other"], languages=["en"], provinces=["AB"], law_society_number="DEMO-1004"),
}


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

        for username, data in DEMO_FIRMS.items():
            LawFirmProfile.objects.get_or_create(user=users[username], defaults=data)

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
        # Shared through an accepted marketplace request, as it would be for a real match.
        share = CaseShare.objects.create(case=case, grantee=lawfirm)
        req = MatchRequest(case=case, firm=lawfirm.law_firm_profile, share=share,
                           message="Comments from my team lead for months, then I was left out of meetings.")
        req.respond(MatchRequest.Status.ACCEPTED)
        req.save()
