from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APITestCase

from apps.hr.models import Company, HRMembership
from apps.lawfirms.models import LawFirmProfile

User = get_user_model()


def make_firm(username, **extra):
    user = User.objects.create_user(username, password="x", role=User.Role.LAW_FIRM)
    data = dict(name=f"{username} law", description="We help workers.", law_society_number="AB-1",
                practice_areas=["harassment"], languages=["en"], provinces=["AB"])
    return LawFirmProfile.objects.create(user=user, **{**data, **extra})


class StaffAccessTests(APITestCase):
    def setUp(self):
        self.staff = User.objects.create_user("boss", password="x", is_staff=True)
        self.firm = make_firm("harbour")
        hr = User.objects.create_user("hr1", password="x", role=User.Role.HR)
        self.company = Company.objects.create(name="Acme")
        HRMembership.objects.create(user=hr, company=self.company)

    def test_only_staff(self):
        for role in (User.Role.VICTIM, User.Role.HR, User.Role.LAW_FIRM):
            self.client.force_authenticate(User.objects.create_user(f"u-{role}", password="x", role=role))
            for url in ("/api/staff/overview/", "/api/staff/firms/", "/api/staff/companies/"):
                self.assertEqual(self.client.get(url).status_code, 403, url)
            self.assertEqual(self.client.post(f"/api/staff/firms/{self.firm.pk}/verify/").status_code, 403)
        self.client.force_authenticate(None)
        self.assertIn(self.client.get("/api/staff/firms/").status_code, (401, 403))

    def test_cannot_make_yourself_staff(self):
        user = User.objects.create_user("v", password="x")
        self.client.force_authenticate(user)
        self.assertFalse(self.client.get("/api/auth/me/").data["is_staff"])
        self.client.patch("/api/auth/me/", {"is_staff": True}, format="json")
        user.refresh_from_db()
        self.assertFalse(user.is_staff)

    def test_verify_firm_lists_it_and_records_who(self):
        self.client.force_authenticate(self.staff)
        [row] = self.client.get("/api/staff/firms/").data  # pending by default
        self.assertEqual((row["law_society_number"], row["account"], row["is_listed"]), ("AB-1", "harbour", False))
        r = self.client.post(f"/api/staff/firms/{self.firm.pk}/verify/")
        self.assertEqual((r.data["is_verified"], r.data["verified_by"], r.data["is_listed"]), (True, "boss", True))
        self.assertEqual(self.client.get("/api/staff/firms/").data, [])
        self.assertEqual(len(self.client.get("/api/staff/firms/?status=verified").data), 1)
        self.assertTrue(LawFirmProfile.objects.listed().filter(pk=self.firm.pk).exists())
        r = self.client.post(f"/api/staff/firms/{self.firm.pk}/unverify/")
        self.assertEqual((r.data["is_verified"], r.data["verified_by"], r.data["verified_at"]), (False, None, None))

    def test_firm_changing_law_society_number_loses_verification(self):
        self.firm.verify(by=self.staff)
        self.client.force_authenticate(self.firm.user)
        self.client.patch("/api/lawfirms/me/", {"law_society_number": "AB-2"}, format="json")
        self.firm.refresh_from_db()
        self.assertEqual((self.firm.is_verified, self.firm.verified_by), (False, None))

    def test_verify_company(self):
        self.client.force_authenticate(self.staff)
        [row] = self.client.get("/api/staff/companies/").data
        self.assertEqual(row["hr_accounts"], ["hr1"])
        r = self.client.post(f"/api/staff/companies/{self.company.pk}/verify/")
        self.assertEqual((r.data["is_verified"], r.data["verified_by"]), (True, "boss"))
        self.assertTrue(Company.objects.listed().filter(pk=self.company.pk).exists())

    def test_overview_and_search(self):
        make_firm("bowriver", name="Bow River", is_verified=True)
        self.client.force_authenticate(self.staff)
        data = self.client.get("/api/staff/overview/").data
        self.assertEqual(data["firms"], {"pending": 1, "verified": 1})
        self.assertEqual(data["companies"], {"pending": 1, "verified": 0})
        self.assertEqual(data["accounts"], {"victim": 0, "hr": 1, "law_firm": 2})  # staff not counted
        names = [f["name"] for f in self.client.get("/api/staff/firms/?status=all&q=bow").data]
        self.assertEqual(names, ["Bow River"])


@override_settings(DEBUG=False)
class NotFoundTests(APITestCase):
    def test_api_gets_json(self):
        r = self.client.get("/api/no-such-thing/")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json(), {"detail": "Not found."})

    def test_other_paths_get_a_page(self):
        r = self.client.get("/no-such-page/")
        self.assertEqual(r.status_code, 404)
        self.assertIn(b"Page not found", r.content)
