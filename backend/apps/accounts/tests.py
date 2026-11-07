from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

User = get_user_model()


class TokenAuthTests(APITestCase):
    def setUp(self):
        User.objects.create_user("alice", password="pw-123456", role=User.Role.VICTIM)

    def test_login_returns_token_and_me_works(self):
        r = self.client.post("/api/auth/login/", {"username": "alice", "password": "pw-123456"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["user"]["role"], "victim")
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {r.data['token']}")
        self.assertEqual(self.client.get("/api/auth/me/").data["username"], "alice")

    def test_bad_password(self):
        r = self.client.post("/api/auth/login/", {"username": "alice", "password": "nope"})
        self.assertEqual(r.status_code, 400)

    def test_me_requires_auth(self):
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)

    def test_logout_invalidates_token(self):
        token = self.client.post("/api/auth/login/", {"username": "alice", "password": "pw-123456"}).data["token"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token}")
        self.assertEqual(self.client.post("/api/auth/logout/").status_code, 204)
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)

    def test_cannot_change_own_role(self):
        u = User.objects.get(username="alice")
        self.client.force_authenticate(u)
        self.client.patch("/api/auth/me/", {"role": "hr"})
        u.refresh_from_db()
        self.assertEqual(u.role, "victim")
