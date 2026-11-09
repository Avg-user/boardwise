from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.cases.models import Case, CaseShare

from .models import LawFirmProfile, MatchRequest

User = get_user_model()

PROFILE = {
    "name": "Harbour Employment Law",
    "tagline": "Workplace harassment and dismissal",
    "description": "We help workers across Alberta.",
    "practice_areas": ["harassment", "dismissal"],
    "languages": ["en", "fr"],
    "provinces": ["ab"],
    "free_consultation": True,
    "hourly_rate_min": "250.00",
    "hourly_rate_max": "400.00",
    "law_society_number": "AB-12345",
}


def make_firm(username, verified=True, **extra):
    user = User.objects.create_user(username, password="x", role=User.Role.LAW_FIRM)
    data = {**PROFILE, "provinces": ["AB"], **extra}
    data.pop("hourly_rate_min"), data.pop("hourly_rate_max")
    profile = LawFirmProfile.objects.create(user=user, is_verified=verified, **data)
    return user, profile


class RegisterTests(APITestCase):
    def test_register_signs_in(self):
        r = self.client.post("/api/auth/register/", {"username": "newfirm", "password": "a-Strong-pass-91",
                                                     "role": "law_firm"}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["user"]["role"], "law_firm")
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {r.data['token']}")
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 200)

    def test_rejects_taken_username_and_weak_password(self):
        User.objects.create_user("taken", password="x")
        r = self.client.post("/api/auth/register/", {"username": "TAKEN", "password": "a-Strong-pass-91",
                                                     "role": "victim"}, format="json")
        self.assertIn("username", r.data)
        r = self.client.post("/api/auth/register/", {"username": "fresh", "password": "123",
                                                     "role": "victim"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("password", r.data)

    def test_rejects_unknown_role(self):
        r = self.client.post("/api/auth/register/", {"username": "x1", "password": "a-Strong-pass-91",
                                                     "role": "admin"}, format="json")
        self.assertEqual(r.status_code, 400)


class ProfileTests(APITestCase):
    def setUp(self):
        self.firm = User.objects.create_user("firm", password="x", role=User.Role.LAW_FIRM)
        self.victim = User.objects.create_user("v", password="x", role=User.Role.VICTIM)

    def test_only_firms_have_profiles(self):
        self.client.force_authenticate(self.victim)
        self.assertEqual(self.client.put("/api/lawfirms/me/", PROFILE, format="json").status_code, 403)

    def test_create_then_not_listed_until_verified(self):
        self.client.force_authenticate(self.firm)
        self.assertEqual(self.client.get("/api/lawfirms/me/").status_code, 404)
        r = self.client.put("/api/lawfirms/me/", {**PROFILE, "is_verified": True}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertFalse(r.data["is_verified"])  # can't verify yourself
        self.assertFalse(r.data["is_listed"])
        self.assertEqual(r.data["provinces"], ["AB"])
        self.client.force_authenticate(self.victim)
        self.assertEqual(self.client.get("/api/lawfirms/").data, [])

    def test_new_law_society_number_resets_verification(self):
        LawFirmProfile.objects.create(user=self.firm, name="F", description="D", law_society_number="A1",
                                      is_verified=True)
        self.client.force_authenticate(self.firm)
        r = self.client.patch("/api/lawfirms/me/", {"tagline": "New"}, format="json")
        self.assertTrue(r.data["is_verified"])
        r = self.client.patch("/api/lawfirms/me/", {"law_society_number": "B2"}, format="json")
        self.assertFalse(r.data["is_verified"])

    def test_validation(self):
        self.client.force_authenticate(self.firm)
        r = self.client.put("/api/lawfirms/me/", {**PROFILE, "hourly_rate_min": "500", "hourly_rate_max": "100"},
                            format="json")
        self.assertIn("hourly_rate_max", r.data)
        r = self.client.put("/api/lawfirms/me/", {**PROFILE, "practice_areas": ["astrology"]}, format="json")
        self.assertIn("practice_areas", r.data)


class DirectoryTests(APITestCase):
    def setUp(self):
        self.victim = User.objects.create_user("v", password="x", role=User.Role.VICTIM)
        _, self.listed = make_firm("listed")
        make_firm("unverified", verified=False)
        make_firm("full", accepting_clients=False)
        _, self.french = make_firm("fr", languages=["fr"], free_consultation=False, name="Cabinet")
        self.client.force_authenticate(self.victim)

    def test_lists_only_verified_and_accepting(self):
        names = {f["name"] for f in self.client.get("/api/lawfirms/").data}
        self.assertEqual(names, {"Harbour Employment Law", "Cabinet"})

    def test_public_fields_hide_law_society_number(self):
        r = self.client.get(f"/api/lawfirms/{self.listed.pk}/")
        self.assertNotIn("law_society_number", r.data)
        self.assertNotIn("user", r.data)

    def test_unlisted_firm_detail_is_404(self):
        hidden = LawFirmProfile.objects.get(user__username="unverified")
        self.assertEqual(self.client.get(f"/api/lawfirms/{hidden.pk}/").status_code, 404)

    def test_filters(self):
        self.assertEqual(len(self.client.get("/api/lawfirms/?language=en").data), 1)
        self.assertEqual(len(self.client.get("/api/lawfirms/?free_consultation=1").data), 1)
        self.assertEqual(len(self.client.get("/api/lawfirms/?area=harassment").data), 2)
        self.assertEqual(len(self.client.get("/api/lawfirms/?q=cabinet").data), 1)


class MatchFlowTests(APITestCase):
    def setUp(self):
        self.victim = User.objects.create_user("v", password="x", role=User.Role.VICTIM)
        self.other = User.objects.create_user("v2", password="x", role=User.Role.VICTIM)
        self.firm_user, self.firm = make_firm("firm")
        self.rival_user, self.rival = make_firm("rival")
        self.case = Case.objects.create(owner=self.victim, title="Private title")
        self.matches = f"/api/cases/{self.case.pk}/matches/"

    def request_match(self, firm=None, message="Harassment by a supervisor, looking for advice."):
        self.client.force_authenticate(self.victim)
        r = self.client.post(self.matches, {"firm": (firm or self.firm).pk, "message": message}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        return r.data["id"]

    def test_firm_sees_only_the_note_until_accepting(self):
        self.request_match()
        self.client.force_authenticate(self.firm_user)
        [req] = self.client.get("/api/lawfirms/me/requests/").data
        self.assertEqual(req["message"], "Harassment by a supervisor, looking for advice.")
        self.assertIsNone(req["case_id"])
        self.assertIsNone(req["case_title"])
        self.assertEqual(self.client.get(f"/api/cases/{self.case.pk}/").status_code, 404)
        self.assertEqual(self.client.get(f"/api/cases/{self.case.pk}/timeline/").status_code, 404)

    def test_accept_shares_the_case(self):
        rid = self.request_match()
        self.client.force_authenticate(self.firm_user)
        r = self.client.post(f"/api/lawfirms/me/requests/{rid}/accept/")
        self.assertEqual(r.data["case_id"], self.case.pk)
        self.assertEqual(self.client.get(f"/api/cases/{self.case.pk}/").status_code, 200)
        self.assertEqual(self.client.patch(f"/api/cases/{self.case.pk}/", {"title": "x"}, format="json").status_code, 403)
        self.assertEqual(self.client.post(f"/api/lawfirms/me/requests/{rid}/accept/").status_code, 400)

    def test_decline_keeps_case_private(self):
        rid = self.request_match()
        self.client.force_authenticate(self.firm_user)
        self.client.post(f"/api/lawfirms/me/requests/{rid}/decline/")
        self.assertEqual(self.client.get(f"/api/cases/{self.case.pk}/").status_code, 404)

    def test_other_firm_cannot_see_or_accept(self):
        rid = self.request_match()
        self.client.force_authenticate(self.rival_user)
        self.assertEqual(self.client.get("/api/lawfirms/me/requests/").data, [])
        self.assertEqual(self.client.post(f"/api/lawfirms/me/requests/{rid}/accept/").status_code, 404)

    def test_unverified_firm_cannot_accept(self):
        rid = self.request_match()
        self.firm.is_verified = False
        self.firm.save()
        self.client.force_authenticate(self.firm_user)
        self.assertEqual(self.client.post(f"/api/lawfirms/me/requests/{rid}/accept/").status_code, 403)
        self.assertFalse(CaseShare.objects.exists())

    def test_cannot_request_unlisted_firm(self):
        _, hidden = make_firm("hidden", verified=False)
        self.client.force_authenticate(self.victim)
        r = self.client.post(self.matches, {"firm": hidden.pk}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_only_owner_can_request_or_list(self):
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.post(self.matches, {"firm": self.firm.pk}, format="json").status_code, 404)
        self.request_match()
        self.client.force_authenticate(self.firm_user)
        self.client.post(f"/api/lawfirms/me/requests/{MatchRequest.objects.get().pk}/accept/")
        # Even after accepting, the firm can't see which other firms the worker asked.
        self.assertEqual(self.client.get(self.matches).status_code, 403)

    def test_no_duplicate_open_requests(self):
        self.request_match()
        r = self.client.post(self.matches, {"firm": self.firm.pk}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_withdraw_pending_and_end_accepted(self):
        rid = self.request_match()
        self.assertEqual(self.client.delete(f"{self.matches}{rid}/").status_code, 204)
        self.assertEqual(MatchRequest.objects.get(pk=rid).status, "withdrawn")

        rid = self.request_match()
        self.client.force_authenticate(self.firm_user)
        self.client.post(f"/api/lawfirms/me/requests/{rid}/accept/")
        self.client.force_authenticate(self.victim)
        self.client.delete(f"{self.matches}{rid}/")
        self.assertEqual(MatchRequest.objects.get(pk=rid).status, "ended")
        self.client.force_authenticate(self.firm_user)
        self.assertEqual(self.client.get(f"/api/cases/{self.case.pk}/").status_code, 404)

    def test_revoking_share_ends_match(self):
        rid = self.request_match()
        self.client.force_authenticate(self.firm_user)
        self.client.post(f"/api/lawfirms/me/requests/{rid}/accept/")
        share = CaseShare.objects.get()
        self.client.force_authenticate(self.victim)
        self.client.delete(f"/api/cases/{self.case.pk}/shares/{share.pk}/")
        self.assertEqual(MatchRequest.objects.get(pk=rid).status, "ended")
        self.client.force_authenticate(self.firm_user)
        [req] = self.client.get("/api/lawfirms/me/requests/").data
        self.assertIsNone(req["case_id"])


class FirmMessageTests(APITestCase):
    """Two-way messages: workers start them, both sides reply, nobody else sees anything."""

    def setUp(self):
        self.worker = User.objects.create_user("jordan_private", password="x", role=User.Role.VICTIM)
        self.firm_user, self.firm = make_firm("firm")
        self.other_firm_user, self.other_firm = make_firm("firm2", name="Other Firm")

    def start(self, firm=None, body="Are you taking new clients?", subject="New client inquiry"):
        self.client.force_authenticate(self.worker)
        return self.client.post("/api/messages/", {"firm": (firm or self.firm).pk, "subject": subject,
                                                   "body": body}, format="json")

    def test_worker_starts_and_firm_replies(self):
        r = self.start()
        self.assertEqual(r.status_code, 201)
        thread = r.data["id"]
        self.assertEqual([(m["sender"], m["mine"]) for m in r.data["messages"]], [("worker", True)])

        self.client.force_authenticate(self.firm_user)
        self.assertEqual(self.client.get("/api/messages/unread/").data, {"unread": 1})
        [row] = self.client.get("/api/messages/").data
        self.assertTrue(row["unread"])
        self.assertEqual(row["last_message"]["preview"], "Are you taking new clients?")
        detail = self.client.get(f"/api/messages/{thread}/").data
        self.assertEqual(detail["messages"][0]["mine"], False)
        self.assertEqual(self.client.get("/api/messages/unread/").data, {"unread": 0})  # opened = read

        r = self.client.post(f"/api/messages/{thread}/reply/", {"body": "Yes, we are."}, format="json")
        self.assertEqual(r.status_code, 201)
        self.client.force_authenticate(self.worker)
        self.assertEqual(self.client.get("/api/messages/unread/").data, {"unread": 1})
        msgs = self.client.get(f"/api/messages/{thread}/").data["messages"]
        self.assertEqual([(m["sender"], m["mine"]) for m in msgs], [("worker", True), ("firm", False)])

    def test_firm_never_sees_who_the_worker_is(self):
        self.start()
        self.client.force_authenticate(self.firm_user)
        [row] = self.client.get("/api/messages/").data
        detail = self.client.get(f"/api/messages/{row['id']}/").data
        for payload in (row, detail):
            self.assertNotIn("worker", payload)
            self.assertNotIn(self.worker.username, str(payload))

    def test_second_message_to_same_firm_joins_the_thread(self):
        first = self.start().data["id"]
        r = self.start(body="Following up.", subject="Different subject")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["id"], first)
        self.assertEqual(r.data["subject"], "New client inquiry")
        self.assertEqual(len(r.data["messages"]), 2)

    def test_only_participants_can_see_or_reply(self):
        thread = self.start().data["id"]
        strangers = [self.other_firm_user, User.objects.create_user("w2", password="x", role=User.Role.VICTIM)]
        for user in strangers:
            self.client.force_authenticate(user)
            self.assertEqual(self.client.get("/api/messages/").data, [])
            self.assertEqual(self.client.get(f"/api/messages/{thread}/").status_code, 404)
            r = self.client.post(f"/api/messages/{thread}/reply/", {"body": "hi"}, format="json")
            self.assertEqual(r.status_code, 404)

    def test_firms_cannot_start_and_hr_has_no_messages(self):
        self.client.force_authenticate(self.firm_user)
        r = self.client.post("/api/messages/", {"firm": self.other_firm.pk, "subject": "x", "body": "x"},
                             format="json")
        self.assertEqual(r.status_code, 403)
        hr = User.objects.create_user("h", password="x", role=User.Role.HR)
        self.client.force_authenticate(hr)
        self.assertEqual(self.client.get("/api/messages/").status_code, 403)
        self.assertEqual(self.client.get("/api/messages/unread/").data, {"unread": 0})

    def test_only_listed_firms_can_be_written_to(self):
        _, hidden = make_firm("hidden", verified=False)
        self.assertEqual(self.start(firm=hidden).status_code, 400)

    def test_unverified_firm_cannot_reply_but_worker_still_can(self):
        thread = self.start().data["id"]
        self.firm.is_verified = False
        self.firm.save()
        self.client.force_authenticate(self.firm_user)
        self.assertFalse(self.client.get(f"/api/messages/{thread}/").data["can_reply"])
        self.assertEqual(self.client.post(f"/api/messages/{thread}/reply/", {"body": "x"}, format="json")
                         .status_code, 403)
        self.client.force_authenticate(self.worker)
        self.assertEqual(self.client.post(f"/api/messages/{thread}/reply/", {"body": "x"}, format="json")
                         .status_code, 201)

    def test_empty_and_overlong_messages_rejected(self):
        self.assertEqual(self.start(body="   ").status_code, 400)
        self.assertEqual(self.start(body="x" * 5001).status_code, 400)
