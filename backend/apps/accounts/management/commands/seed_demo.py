from datetime import date, timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.cases.models import Case, CaseShare, TimelineEntry
from apps.chat.models import Conversation, Message
from apps.hr.dashboard import add_months
from apps.hr.models import Company, HRMembership, IncidentReport, JobOffer, WorkerMembership
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
        website="https://example.com/harbour", email="intake@harbour.example.com",
        law_society_number="DEMO-1001", is_verified=True),
    "prairielaw": dict(
        name="Prairie Workers Legal Clinic", tagline="Low-cost help with wages, safety and WCB",
        description="A non-profit clinic for workers who can't afford a private lawyer.",
        practice_areas=["wages", "safety", "workers_comp"], languages=["en", "pa", "tl"],
        provinces=["AB"], city="Edmonton", years_in_practice=8, free_consultation=True,
        sliding_scale=True, legal_aid=True, fee_notes="Fees based on income. Many services are free.", email="help@prairieclinic.example.com",
        law_society_number="DEMO-1002", is_verified=True),
    "justiceco": dict(
        name="Bow River Litigation", tagline="Employment contracts and wrongful dismissal",
        description="Litigation-focused firm for complex dismissal and contract disputes.",
        practice_areas=["dismissal", "contracts"], languages=["en", "zh"], provinces=["AB", "BC"],
        city="Calgary", years_in_practice=20, consultation_fee=150, hourly_rate_min=400,
        hourly_rate_max=650, flat_fee_from=1500, email="newclients@bowriver.example.com", law_society_number="DEMO-1003", is_verified=True),
    "newfirm": dict(
        name="Unverified Demo Firm", description="Waiting for verification, so not listed.",
        practice_areas=["other"], languages=["en"], provinces=["AB"], law_society_number="DEMO-1004"),
}


DEMO_COMPANY = "Northwind Logistics"
# Anonymous reports for the demo company: (months ago, category, how many, ongoing).
DEMO_REPORTS = [
    (0, "harassment", 3, True), (0, "pay", 2, False), (1, "harassment", 4, True), (1, "safety", 3, False),
    (2, "harassment", 4, False), (2, "discrimination", 2, False), (3, "pay", 3, False), (3, "safety", 3, False),
    (4, "harassment", 5, True), (5, "sexual_harassment", 2, True), (5, "harassment", 3, False),
    (6, "safety", 4, False), (7, "pay", 2, False), (7, "safety", 4, False), (8, "retaliation", 1, False), (8, "harassment", 5, False),
    (9, "violence", 1, False), (10, "harassment", 6, False), (11, "pay", 2, False),
]

DEMO_OFFER = """Offer of Employment: Warehouse Associate
Your wage will be $13.50 per hour. You will work 10-hour shifts, Monday to Saturday.
Overtime is not paid. One 15-minute unpaid break per shift.
Either party may end employment at any time without notice or pay."""

DEMO_FINDINGS = [
    {"severity": "violation", "title": "Wage below minimum wage", "offer_quote": "$13.50 per hour",
     "explanation": "Alberta's minimum wage for employees 18 and over is $15/hour.",
     "citation": "Employment Standards Code, s. 9; AB summary"},
    {"severity": "violation", "title": "Overtime not paid", "offer_quote": "Overtime is not paid.",
     "explanation": "Hours over 8 a day or 44 a week must be paid at 1.5 times the wage or banked as time off.",
     "citation": "Employment Standards Code, ss. 21-22"},
    {"severity": "violation", "title": "Breaks too short for a 10-hour shift",
     "offer_quote": "One 15-minute unpaid break per shift.",
     "explanation": "Shifts of 10 hours or more need at least two 30-minute breaks.",
     "citation": "Employment Standards Code, s. 18"},
    {"severity": "concern", "title": "Termination without notice",
     "offer_quote": "Either party may end employment at any time without notice or pay.",
     "explanation": "After 90 days, employers must give written notice or termination pay.",
     "citation": "Employment Standards Code, ss. 56-57"},
    {"severity": "info", "title": "Vacation not mentioned", "offer_quote": "",
     "explanation": "Employees earn at least 2 weeks of vacation after a year of employment.",
     "citation": "Employment Standards Code, s. 34"},
]


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
            Company.objects.filter(name=DEMO_COMPANY).delete()  # reports and offers go with it

        users = {}
        for username, role in DEMO_USERS:
            user, created = User.objects.get_or_create(username=username, defaults={"role": role})
            if created:
                user.set_password(PASSWORD)
                user.save()
            users[username] = user

        for username, data in DEMO_FIRMS.items():
            LawFirmProfile.objects.get_or_create(user=users[username], defaults=data)

        self._create_company(users["hr"], users["victim"])

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
        # Each chat session is a timeline entry, as the send endpoint would create it.
        TimelineEntry.objects.create(case=case, conversation=convo, occurred_at=today,
                                     title=f"Chat on {today:%b} {today.day}, {today.year}")
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

    def _create_company(self, hr, victim):
        """A verified company managed by "hr", with "victim" as an opted-in worker and sample data."""
        company = HRMembership.objects.filter(user=hr).values_list("company", flat=True).first()
        if company:
            return
        company = Company.objects.create(name=DEMO_COMPANY, province="AB", city="Calgary",
                                         is_verified=True, verified_at=timezone.now())
        HRMembership.objects.create(user=hr, company=company)
        WorkerMembership.objects.update_or_create(user=victim,
                                                  defaults={"company": company, "reporting_opt_in": True})
        this_month = date.today().replace(day=1)
        IncidentReport.objects.bulk_create(
            IncidentReport(company=company, category=category, occurred_month=add_months(this_month, -ago),
                           ongoing=ongoing)
            for ago, category, n, ongoing in DEMO_REPORTS for _ in range(n)
        )
        # A reviewed sample so the job offer list isn't empty (no model call while seeding).
        JobOffer.objects.create(
            company=company, uploaded_by=hr, title="Warehouse associate (sample)", text=DEMO_OFFER,
            province="AB", status=JobOffer.Status.DONE, findings=DEMO_FINDINGS, reviewed_at=timezone.now(),
            summary="Sample review: several terms fall below Alberta's employment standards.",
        )
