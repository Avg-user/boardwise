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
