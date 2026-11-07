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
