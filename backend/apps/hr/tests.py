import io
import tempfile
import zipfile
from datetime import date
from types import SimpleNamespace
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APITestCase

from . import dashboard
from .models import Company, HRMembership, IncidentReport, JobOffer, WorkerMembership
from .offer_review import PART_CHARS, extract_text, parse_reply, review, split_offer
from .tasks import review_job_offer

User = get_user_model()
THIS_MONTH = date.today().replace(day=1).isoformat()[:7]


def make_hr(username="hr1", company_name="Acme", verified=True):
    user = User.objects.create_user(username, password="x", role=User.Role.HR)
    company = Company.objects.create(name=company_name, is_verified=verified)
    HRMembership.objects.create(user=user, company=company)
    return user, company


def make_worker(username="w1", company=None, opt_in=True):
    user = User.objects.create_user(username, password="x", role=User.Role.VICTIM)
    if company:
        WorkerMembership.objects.create(user=user, company=company, reporting_opt_in=opt_in)
    return user


def add_reports(company, n, category="harassment", month=None, ongoing=False):
    month = month or date.today().replace(day=1)
    IncidentReport.objects.bulk_create(
        IncidentReport(company=company, category=category, occurred_month=month, ongoing=ongoing)
        for _ in range(n)
    )


class SuppressionTests(TestCase):
    def test_hides_small_counts(self):
        self.assertEqual(dashboard.suppress([0, 7, 2, 5, 3], 5), [0, 7, None, 5, None])

    def test_single_hidden_count_hides_the_next_smallest(self):
        # Otherwise total - (7 + 6) would reveal the 2.
        self.assertEqual(dashboard.suppress([7, 2, 6], 5), [7, None, None])

    def test_nothing_hidden(self):
        self.assertEqual(dashboard.suppress([0, 5, 9], 5), [0, 5, 9])


@override_settings(HR_MIN_GROUP_SIZE=5)
class DashboardTests(APITestCase):
    def setUp(self):
        self.hr, self.company = make_hr()
        self.client.force_authenticate(self.hr)

    def test_nothing_shown_below_minimum(self):
        add_reports(self.company, 4)
        r = self.client.get("/api/hr/dashboard/")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data["enough_data"])
        self.assertIsNone(r.data["total"])
        self.assertEqual(r.data["months"], [])
        self.assertEqual(r.data["categories"], [])

    def test_aggregates_with_suppression(self):
        last_month = dashboard.add_months(date.today().replace(day=1), -1)
        add_reports(self.company, 6, "harassment")
        add_reports(self.company, 2, "safety", month=last_month, ongoing=True)
        r = self.client.get("/api/hr/dashboard/")
        self.assertTrue(r.data["enough_data"])
        self.assertEqual(r.data["total"], 8)
        months = {m["month"]: m["count"] for m in r.data["months"]}
        self.assertEqual(len(months), 12)
        # Two non-zero months: 2 is hidden, so 6 is hidden too (else 8 - 6 reveals it).
        self.assertIsNone(months[last_month.isoformat()])
        self.assertIsNone(months[date.today().replace(day=1).isoformat()])
        self.assertEqual({c["category"]: c["count"] for c in r.data["categories"]},
                         {"harassment": None, "safety": None})
        self.assertEqual(r.data["ongoing"], {"ongoing": None, "resolved": None})

    def test_only_own_company(self):
        _, other = make_hr("hr2", "Other Co")
        add_reports(other, 20)
        r = self.client.get("/api/hr/dashboard/")
        self.assertFalse(r.data["enough_data"])

    def test_old_reports_outside_window(self):
        add_reports(self.company, 10, month=dashboard.add_months(date.today().replace(day=1), -12))
        self.assertFalse(self.client.get("/api/hr/dashboard/").data["enough_data"])

    def test_unverified_company_gets_nothing(self):
        self.company.is_verified = False
        self.company.save()
        add_reports(self.company, 10)
        self.assertEqual(self.client.get("/api/hr/dashboard/").status_code, 403)

    def test_workers_and_firms_cannot_see_dashboard(self):
        for role in (User.Role.VICTIM, User.Role.LAW_FIRM):
            self.client.force_authenticate(User.objects.create_user(f"u-{role}", password="x", role=role))
            self.assertEqual(self.client.get("/api/hr/dashboard/").status_code, 403)

    def test_hr_without_company(self):
        self.client.force_authenticate(User.objects.create_user("hr9", password="x", role=User.Role.HR))
        self.assertEqual(self.client.get("/api/hr/dashboard/").status_code, 404)


class CompanyTests(APITestCase):
    def test_hr_creates_company_unverified(self):
        hr = User.objects.create_user("hr1", password="x", role=User.Role.HR)
        self.client.force_authenticate(hr)
        self.assertEqual(self.client.get("/api/hr/company/").status_code, 404)
        r = self.client.put("/api/hr/company/", {"name": "Acme", "province": "ab", "is_verified": True},
                            format="json")
        self.assertEqual(r.status_code, 201)
        self.assertFalse(r.data["is_verified"])
        self.assertEqual(r.data["province"], "AB")
        self.assertEqual(HRMembership.objects.get(user=hr).company.name, "Acme")

    def test_rename_removes_verification(self):
        hr, company = make_hr()
        self.client.force_authenticate(hr)
        self.client.patch("/api/hr/company/", {"city": "Calgary"}, format="json")
        company.refresh_from_db()
        self.assertTrue(company.is_verified)
        self.client.patch("/api/hr/company/", {"name": "Acme Holdings"}, format="json")
        company.refresh_from_db()
        self.assertFalse(company.is_verified)

    def test_workers_cannot_manage_companies(self):
        self.client.force_authenticate(make_worker())
        self.assertEqual(self.client.put("/api/hr/company/", {"name": "X"}, format="json").status_code, 403)

    def test_list_shows_verified_only(self):
        make_hr("hr1", "Acme")
        make_hr("hr2", "Shady", verified=False)
        self.client.force_authenticate(make_worker())
        names = [c["name"] for c in self.client.get("/api/companies/").data]
        self.assertEqual(names, ["Acme"])
        self.assertEqual(self.client.get("/api/companies/?q=shady").data, [])


@override_settings(HR_REPORTS_PER_MONTH=2)
class WorkplaceAndReportTests(APITestCase):
    def setUp(self):
        _, self.company = make_hr()
        self.worker = make_worker()
        self.client.force_authenticate(self.worker)

    def report(self, **data):
        body = {"category": "harassment", "occurred_month": THIS_MONTH, "ongoing": True, **data}
        return self.client.post("/api/workplace/reports/", body, format="json")

    def test_join_opt_in_and_report(self):
        self.assertEqual(self.client.get("/api/workplace/").data["company"], None)
        self.assertEqual(self.report().status_code, 403)  # no company yet
        r = self.client.put("/api/workplace/", {"company": self.company.pk, "reporting_opt_in": False},
                            format="json")
        self.assertEqual(r.data["company_name"], "Acme")
        self.assertEqual(self.report().status_code, 403)  # not opted in
        self.client.patch("/api/workplace/", {"reporting_opt_in": True}, format="json")
        r = self.report()
        self.assertEqual(r.status_code, 204)  # no ID to look up later
        self.assertEqual(IncidentReport.objects.count(), 1)

    def test_report_is_unlinkable(self):
        self.client.put("/api/workplace/", {"company": self.company.pk, "reporting_opt_in": True}, format="json")
        self.report()
        field_names = {f.name for f in IncidentReport._meta.get_fields()}
        self.assertEqual(field_names, {"id", "company", "category", "occurred_month", "ongoing"})
        report = IncidentReport.objects.get()
        self.assertEqual(report.occurred_month, date.today().replace(day=1))

    def test_cannot_pick_unverified_company(self):
        _, shady = make_hr("hr2", "Shady", verified=False)
        r = self.client.put("/api/workplace/", {"company": shady.pk, "reporting_opt_in": True}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_opt_in_needs_company(self):
        r = self.client.put("/api/workplace/", {"company": None, "reporting_opt_in": True}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_leave_opts_out_and_keeps_reports(self):
        self.client.put("/api/workplace/", {"company": self.company.pk, "reporting_opt_in": True}, format="json")
        self.report()
        self.assertEqual(self.client.delete("/api/workplace/").status_code, 204)
        m = WorkerMembership.objects.get(user=self.worker)
        self.assertIsNone(m.company)
        self.assertFalse(m.reporting_opt_in)
        self.assertEqual(IncidentReport.objects.count(), 1)
        self.assertEqual(self.report().status_code, 403)

    def test_monthly_limit_survives_leaving_and_rejoining(self):
        self.client.put("/api/workplace/", {"company": self.company.pk, "reporting_opt_in": True}, format="json")
        self.assertEqual(self.report().status_code, 204)
        self.assertEqual(self.report().status_code, 204)
        self.client.delete("/api/workplace/")
        self.client.put("/api/workplace/", {"company": self.company.pk, "reporting_opt_in": True}, format="json")
        self.assertEqual(self.report().status_code, 429)
        self.assertEqual(IncidentReport.objects.count(), 2)

    def test_month_validation(self):
        self.client.put("/api/workplace/", {"company": self.company.pk, "reporting_opt_in": True}, format="json")
        future = dashboard.add_months(date.today().replace(day=1), 1).isoformat()[:7]
        self.assertEqual(self.report(occurred_month=future).status_code, 400)
        self.assertEqual(self.report(occurred_month="2001-01").status_code, 400)
        self.assertEqual(self.report(occurred_month="nope").status_code, 400)
        self.assertEqual(self.report(category="gossip").status_code, 400)
        self.assertEqual(IncidentReport.objects.count(), 0)

    def test_hr_cannot_report_or_join(self):
        hr, _ = make_hr("hr2", "B")
        self.client.force_authenticate(hr)
        self.assertEqual(self.client.get("/api/workplace/").status_code, 403)
        self.assertEqual(self.report().status_code, 403)


def run_tasks_inline():
    """Run the Celery task in the test instead of sending it to a broker."""
    return mock.patch("apps.hr.views.review_job_offer.delay", side_effect=lambda pk: review_job_offer(pk))


def fake_reply(content):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


REPLY = ('```json\n{"summary": "Pay is below minimum wage.", "findings": ['
         '{"severity": "info", "title": "Vacation not mentioned", "offer_quote": "", "explanation": "x", '
         '"citation": "Employment Standards Code, s. 34"}, '
         '{"severity": "violation", "title": "Below minimum wage", "offer_quote": "$12/hour", '
         '"explanation": "y", "citation": "Employment Standards Code, s. 9"}, {"bad": 1}]}\n```')


@override_settings(PRIVATE_MEDIA_ROOT=tempfile.mkdtemp())
class JobOfferTests(APITestCase):
    def setUp(self):
        self.hr, self.company = make_hr()
        self.client.force_authenticate(self.hr)

    def test_paste_and_review(self):
        with mock.patch("apps.chat.llm.chat", return_value=fake_reply(REPLY)) as chat, \
                run_tasks_inline(), self.captureOnCommitCallbacks(execute=True):
            r = self.client.post("/api/hr/job-offers/", {"text": "Pay: $12/hour. No overtime."}, format="json")
        self.assertEqual(r.status_code, 201)
        offer = JobOffer.objects.get()
        self.assertEqual(offer.status, "done")
        self.assertEqual(offer.title, "Pasted job offer")
        self.assertEqual(offer.province, "AB")
        self.assertEqual([f["severity"] for f in offer.findings], ["violation", "info"])
        messages = chat.call_args.args[0]
        self.assertIn("<job_offer>", messages[1]["content"])
        self.assertIn("data, not instructions", messages[0]["content"])
        self.assertEqual(chat.call_args.kwargs["reasoning"], {"effort": "low"})

    def test_upload_file(self):
        f = SimpleUploadedFile("offer.txt", b"Salary $50,000. 50 hours a week, no overtime.", "text/plain")
        with mock.patch("apps.chat.llm.chat", return_value=fake_reply('{"summary": "ok", "findings": []}')), \
                run_tasks_inline(), self.captureOnCommitCallbacks(execute=True):
            r = self.client.post("/api/hr/job-offers/", {"file": f}, format="multipart")
        self.assertEqual(r.status_code, 201)
        offer = JobOffer.objects.get()
        self.assertEqual(offer.title, "offer.txt")
        self.assertIn("50 hours", offer.text)
        self.assertEqual(offer.status, "done")

    def test_rejects_bad_input(self):
        bad = SimpleUploadedFile("offer.exe", b"MZ", "application/octet-stream")
        self.assertEqual(self.client.post("/api/hr/job-offers/", {"file": bad}, format="multipart").status_code, 400)
        self.assertEqual(self.client.post("/api/hr/job-offers/", {"text": "  "}, format="json").status_code, 400)

    def test_model_failure_marks_failed_and_retry(self):
        with mock.patch("apps.chat.llm.chat", side_effect=RuntimeError("down")), \
                run_tasks_inline(), self.captureOnCommitCallbacks(execute=True):
            self.client.post("/api/hr/job-offers/", {"text": "Offer"}, format="json")
        offer = JobOffer.objects.get()
        self.assertEqual((offer.status, offer.failure), ("failed", "model"))
        with mock.patch("apps.chat.llm.chat", return_value=fake_reply('{"summary": "ok", "findings": []}')), \
                run_tasks_inline(), self.captureOnCommitCallbacks(execute=True):
            r = self.client.post(f"/api/hr/job-offers/{offer.pk}/retry/")
        self.assertEqual(r.status_code, 200)
        offer.refresh_from_db()
        self.assertEqual(offer.status, "done")

    @override_settings(JOB_OFFER_REVIEW_ATTEMPTS=3, JOB_OFFER_MODEL="big/model")
    def test_empty_reply_is_retried(self):
        replies = [fake_reply(""), fake_reply(None), fake_reply('{"summary": "ok", "findings": []}')]
        with mock.patch("apps.chat.llm.chat", side_effect=replies) as chat, \
                run_tasks_inline(), self.captureOnCommitCallbacks(execute=True):
            self.client.post("/api/hr/job-offers/", {"text": "Offer"}, format="json")
        self.assertEqual(chat.call_count, 3)
        self.assertEqual(chat.call_args.kwargs["model"], "big/model")
        self.assertEqual(JobOffer.objects.get().status, "done")

    @override_settings(JOB_OFFER_REVIEW_ATTEMPTS=2)
    def test_long_offer_checked_in_parts(self):
        text = "\n\n".join(f"Clause {i}. " + "word " * 700 for i in range(3))  # ~3 x 3,500 chars
        part = lambda title, severity="violation": fake_reply(
            '{"summary": "s", "findings": [{"severity": "%s", "title": "%s"}]}' % (severity, title))
        replies = [part("Low pay"), fake_reply(""), fake_reply(""), part("Vacation missing", "info")]
        with mock.patch("apps.chat.llm.chat", side_effect=replies) as chat, \
                run_tasks_inline(), self.captureOnCommitCallbacks(execute=True):
            self.client.post("/api/hr/job-offers/", {"text": text}, format="json")
        offer = JobOffer.objects.get()
        self.assertEqual(chat.call_count, 4)
        self.assertIn("part 1 of 3", chat.call_args_list[0].args[0][1]["content"])
        self.assertEqual((offer.status, offer.failure), ("done", "partial"))
        self.assertEqual((offer.parts_total, offer.parts_unchecked), (3, [2]))
        # "Missing" findings are dropped when the model only saw part of the offer.
        self.assertEqual([f["title"] for f in offer.findings], ["Low pay"])
        with mock.patch("apps.chat.llm.chat", return_value=part("Low pay")), \
                run_tasks_inline(), self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.client.post(f"/api/hr/job-offers/{offer.pk}/retry/").status_code, 200)
        offer.refresh_from_db()
        self.assertEqual((offer.failure, offer.parts_unchecked), ("", []))

    @override_settings(JOB_OFFER_REVIEW_ATTEMPTS=2)
    def test_gives_up_after_attempts(self):
        with mock.patch("apps.chat.llm.chat", return_value=fake_reply("")) as chat, \
                run_tasks_inline(), self.captureOnCommitCallbacks(execute=True):
            self.client.post("/api/hr/job-offers/", {"text": "Offer"}, format="json")
        self.assertEqual(chat.call_count, 2)
        self.assertEqual(JobOffer.objects.get().status, "failed")

    def test_queue_down_marks_failed(self):
        with mock.patch("apps.hr.views.review_job_offer.delay", side_effect=ConnectionError), \
                self.captureOnCommitCallbacks(execute=True):
            self.client.post("/api/hr/job-offers/", {"text": "Offer"}, format="json")
        self.assertEqual((JobOffer.objects.get().status, JobOffer.objects.get().failure), ("failed", "queue"))

    def test_other_companies_offers_are_hidden(self):
        _, other = make_hr("hr2", "Other")
        offer = JobOffer.objects.create(company=other, title="t", text="secret", province="AB")
        self.assertEqual(self.client.get("/api/hr/job-offers/").data, [])
        self.assertEqual(self.client.get(f"/api/hr/job-offers/{offer.pk}/").status_code, 404)
        self.assertEqual(self.client.delete(f"/api/hr/job-offers/{offer.pk}/").status_code, 404)

    def test_needs_verified_hr(self):
        self.company.is_verified = False
        self.company.save()
        self.assertEqual(self.client.post("/api/hr/job-offers/", {"text": "x"}, format="json").status_code, 403)
        self.client.force_authenticate(make_worker())
        self.assertEqual(self.client.get("/api/hr/job-offers/").status_code, 403)


class OfferReviewUnitTests(TestCase):
    def test_parse_falls_back_to_raw_text(self):
        self.assertEqual(parse_reply("Looks fine to me."), ("Looks fine to me.", []))

    def test_parse_cleans_findings(self):
        summary, findings = parse_reply(REPLY)
        self.assertEqual(summary, "Pay is below minimum wage.")
        self.assertEqual(len(findings), 2)
        self.assertEqual(findings[0]["title"], "Below minimum wage")

    def test_split_offer(self):
        self.assertEqual(split_offer("Short offer."), ["Short offer."])
        paras = ["a" * 3000, "b" * 3000, "c" * 500]
        parts = split_offer("\n\n".join(paras))
        self.assertEqual(parts, ["a" * 3000, "b" * 3000 + "\n\n" + "c" * 500])
        self.assertTrue(all(len(p) <= PART_CHARS for p in split_offer("x" * 10000)))

    def test_extract_docx(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("word/document.xml", (
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
                '<w:p><w:r><w:t>Salary: </w:t></w:r><w:r><w:t>$40,000</w:t></w:r></w:p>'
                '<w:p><w:r><w:t>Hours: 44</w:t></w:r></w:p></w:body></w:document>'))
        self.assertEqual(extract_text("offer.docx", buf.getvalue()), "Salary: $40,000\nHours: 44")

    def test_review_does_not_crash_on_unreadable_file(self):
        _, company = make_hr()
        offer = JobOffer.objects.create(company=company, title="t", province="AB")
        with mock.patch("apps.chat.llm.chat") as chat:
            review(offer)
        chat.assert_not_called()
        self.assertEqual(offer.status, "failed")
        self.assertEqual(offer.failure, "no_text")

    @override_settings(PRIVATE_MEDIA_ROOT=tempfile.mkdtemp())
    def test_scanned_pdf_reports_no_text(self):
        from pypdf import PdfWriter
        buf = io.BytesIO()
        writer = PdfWriter()
        writer.add_blank_page(width=612, height=792)  # like a scan: a page with no text layer
        writer.write(buf)
        _, company = make_hr()
        offer = JobOffer.objects.create(company=company, title="scan.pdf", province="AB",
                                        file=SimpleUploadedFile("scan.pdf", buf.getvalue()))
        with mock.patch("apps.chat.llm.chat") as chat:
            review(offer)
        chat.assert_not_called()
        self.assertEqual((offer.status, offer.failure, offer.text), ("failed", "no_text", ""))

    def test_broken_file_is_unreadable(self):
        _, company = make_hr()
        with tempfile.TemporaryDirectory() as root, self.settings(PRIVATE_MEDIA_ROOT=root):
            offer = JobOffer.objects.create(company=company, title="x.pdf", province="AB",
                                            file=SimpleUploadedFile("x.pdf", b"not a pdf"))
            review(offer)
        self.assertEqual(offer.failure, "unreadable")
