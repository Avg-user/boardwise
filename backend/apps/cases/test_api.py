import shutil
import tempfile

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APITestCase

from apps.documents.models import Document, private_storage

from .models import Case, CaseShare

User = get_user_model()


class CaseApiPermissionTests(APITestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._media = tempfile.mkdtemp()
        cls._old_location = private_storage._location
        private_storage._location = cls._media
        private_storage.__dict__.pop("base_location", None)
        private_storage.__dict__.pop("location", None)

    @classmethod
    def tearDownClass(cls):
        private_storage._location = cls._old_location
        private_storage.__dict__.pop("base_location", None)
        private_storage.__dict__.pop("location", None)
        shutil.rmtree(cls._media, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.victim = User.objects.create_user("v", role=User.Role.VICTIM)
        self.other_victim = User.objects.create_user("v2", role=User.Role.VICTIM)
        self.lawyer = User.objects.create_user("l", role=User.Role.LAW_FIRM)
        self.hr = User.objects.create_user("h", role=User.Role.HR)
        self.case = Case.objects.create(owner=self.victim, title="t")
        self.base = f"/api/cases/{self.case.pk}"

    def as_(self, user):
        self.client.force_authenticate(user)

    # --- cases ---
    def test_unauthenticated_rejected(self):
        self.assertEqual(self.client.get("/api/cases/").status_code, 401)

    def test_owner_lists_and_creates(self):
        self.as_(self.victim)
        self.assertEqual(len(self.client.get("/api/cases/").data), 1)
        self.assertEqual(self.client.post("/api/cases/", {"title": "new"}).status_code, 201)

    def test_list_includes_progress_counts(self):
        from datetime import date

        from apps.tasks.models import Task
        from .models import TimelineEntry
        for title in ("a", "b"):
            TimelineEntry.objects.create(case=self.case, occurred_at=date.today(), title=title)
        Task.objects.create(case=self.case, title="x", done=True)
        Task.objects.create(case=self.case, title="y")
        CaseShare.objects.create(case=self.case, grantee=self.lawyer)
        CaseShare.objects.create(case=self.case, grantee=self.hr)
        CaseShare.objects.filter(grantee=self.hr).update(revoked_at="2026-01-01T00:00Z")

        self.client.force_authenticate(self.victim)
        [row] = self.client.get("/api/cases/").data
        self.assertEqual((row["timeline_count"], row["tasks_total"], row["tasks_done"], row["shared_count"]),
                         (2, 2, 1, 1))
        # A grantee gets the same progress, but never learns who else the case is shared with.
        self.client.force_authenticate(self.lawyer)
        [row] = self.client.get("/api/cases/").data
        self.assertEqual((row["timeline_count"], row["tasks_total"], row["shared_count"]), (2, 2, None))

    def test_non_victim_cannot_create_case(self):
        self.as_(self.lawyer)
        self.assertEqual(self.client.post("/api/cases/", {"title": "x"}).status_code, 403)

    def test_stranger_gets_404_everywhere(self):
        self.as_(self.other_victim)
        self.assertEqual(self.client.get("/api/cases/").data, [])
        for path in ["/", "/timeline/", "/tasks/", "/documents/", "/conversations/", "/shares/"]:
            self.assertEqual(self.client.get(self.base + path).status_code, 404, path)

    def test_grantee_reads_but_cannot_write(self):
        CaseShare.objects.create(case=self.case, grantee=self.lawyer)
        self.as_(self.lawyer)
        self.assertEqual(self.client.get(self.base + "/").status_code, 200)
        self.assertFalse(self.client.get(self.base + "/").data["is_owner"])
        self.assertEqual(self.client.get(self.base + "/timeline/").status_code, 200)
        self.assertEqual(self.client.patch(self.base + "/", {"title": "x"}).status_code, 403)
        self.assertEqual(self.client.delete(self.base + "/").status_code, 403)
        self.assertEqual(
            self.client.post(self.base + "/timeline/", {"occurred_at": "2026-01-01", "title": "x"}).status_code, 403
        )
        self.assertEqual(self.client.post(self.base + "/tasks/", {"title": "x"}).status_code, 403)

    def test_grantee_cannot_manage_shares(self):
        CaseShare.objects.create(case=self.case, grantee=self.lawyer)
        self.as_(self.lawyer)
        self.assertEqual(self.client.get(self.base + "/shares/").status_code, 403)
        self.assertEqual(self.client.post(self.base + "/shares/", {"grantee": "h"}).status_code, 403)

    # --- shares ---
    def test_owner_shares_and_revokes(self):
        self.as_(self.victim)
        r = self.client.post(self.base + "/shares/", {"grantee": "l"})
        self.assertEqual(r.status_code, 201)
        self.assertTrue(self.case.can_access(self.lawyer))
        self.assertEqual(self.client.post(self.base + "/shares/", {"grantee": "l"}).status_code, 400)
        self.assertEqual(self.client.delete(f"{self.base}/shares/{r.data['id']}/").status_code, 204)
        self.assertFalse(self.case.can_access(self.lawyer))
        self.assertTrue(CaseShare.objects.filter(pk=r.data["id"]).exists())  # kept as audit record

    def test_cannot_share_with_victim(self):
        self.as_(self.victim)
        self.assertEqual(self.client.post(self.base + "/shares/", {"grantee": "v2"}).status_code, 400)

    # --- children ---
    def test_owner_crud_timeline_and_tasks(self):
        self.as_(self.victim)
        r = self.client.post(self.base + "/timeline/", {"occurred_at": "2026-01-01", "title": "e"})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["source"], "manual")
        r = self.client.post(self.base + "/tasks/", {"title": "t"})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(self.client.patch(f"{self.base}/tasks/{r.data['id']}/", {"done": True}).data["done"], True)

    def test_child_of_other_case_not_reachable(self):
        other = Case.objects.create(owner=self.other_victim, title="o")
        task = other.tasks.create(title="secret")
        self.as_(self.victim)
        self.assertEqual(self.client.get(f"{self.base}/tasks/{task.pk}/").status_code, 404)

    def test_timeline_cannot_link_foreign_document(self):
        other = Case.objects.create(owner=self.other_victim, title="o")
        doc = Document.objects.create(case=other, original_name="x")
        self.as_(self.victim)
        r = self.client.post(self.base + "/timeline/", {"occurred_at": "2026-01-01", "title": "e", "document": doc.pk})
        self.assertEqual(r.status_code, 400)

    # --- documents ---
    def test_upload_and_download(self):
        self.as_(self.victim)
        f = SimpleUploadedFile("note.txt", b"hello", content_type="text/plain")
        r = self.client.post(self.base + "/documents/", {"file": f}, format="multipart")
        self.assertEqual(r.status_code, 201)
        self.assertNotIn("file", r.data)  # no file URL exposed
        dl = self.client.get(f"{self.base}/documents/{r.data['id']}/download/")
        self.assertEqual(dl.status_code, 200)
        self.assertEqual(b"".join(dl.streaming_content), b"hello")
        self.as_(self.other_victim)
        self.assertEqual(self.client.get(f"{self.base}/documents/{r.data['id']}/download/").status_code, 404)

    # --- chat ---
    def test_conversation_messages(self):
        convo = self.case.conversations.create()
        convo.messages.create(role="user", content="hi")
        CaseShare.objects.create(case=self.case, grantee=self.lawyer)
        self.as_(self.lawyer)
        r = self.client.get(f"{self.base}/conversations/{convo.pk}/messages/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data[0]["content"], "hi")


class SchemaTests(APITestCase):
    def test_swagger_and_schema_served(self):
        self.assertEqual(self.client.get("/api/schema/").status_code, 200)
        self.assertEqual(self.client.get("/api/docs/").status_code, 200)
