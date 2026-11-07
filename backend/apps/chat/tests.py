from types import SimpleNamespace
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APITestCase

from apps.cases.models import Case, CaseShare

from . import llm
from .crisis import is_crisis
from .models import Conversation, Message
from .prompts import ProvinceNotFound, system_prompt

User = get_user_model()


def fake_completion(text="AI reply"):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])


class CrisisTests(TestCase):
    def test_detects(self):
        for t in ["I want to kill myself", "thinking about suicide", "My boss is going to hurt me", "I'm not safe at home"]:
            self.assertTrue(is_crisis(t), t)

    def test_ignores_normal(self):
        for t in ["My manager keeps yelling at me", "How many vacation days do I get?"]:
            self.assertFalse(is_crisis(t), t)


class PromptTests(TestCase):
    def test_builds_prompt(self):
        p = system_prompt("AB")
        self.assertNotIn("{labour_law}", p)
        self.assertNotIn("{province}", p)

    def test_unknown_or_bad_province(self):
        for code in ["ZZ", "../x"]:
            with self.assertRaises(ProvinceNotFound):
                system_prompt(code)


class LlmTests(TestCase):
    @override_settings(OPENROUTER_DATA_COLLECTION="deny")
    def test_sends_data_collection_setting(self):
        client = mock.Mock()
        with mock.patch.object(llm, "get_client", return_value=client):
            llm.chat([{"role": "user", "content": "hi"}])
        extra = client.chat.completions.create.call_args.kwargs["extra_body"]
        self.assertEqual(extra, {"provider": {"data_collection": "deny"}})

    @override_settings(OPENROUTER_DATA_COLLECTION="deny", EMBEDDING_MODEL="m")
    def test_embed_sends_data_collection_setting(self):
        client = mock.Mock()
        client.embeddings.create.return_value = SimpleNamespace(data=[SimpleNamespace(index=0, embedding=[0.1])])
        with mock.patch.object(llm, "get_client", return_value=client):
            self.assertEqual(llm.embed(["hi"]), [[0.1]])
        extra = client.embeddings.create.call_args.kwargs["extra_body"]
        self.assertEqual(extra, {"provider": {"data_collection": "deny"}})


@mock.patch("apps.chat.views.llm.chat")
class SendMessageApiTests(APITestCase):
    def setUp(self):
        self.victim = User.objects.create_user("v", role=User.Role.VICTIM)
        self.other = User.objects.create_user("v2", role=User.Role.VICTIM)
        self.lawyer = User.objects.create_user("l", role=User.Role.LAW_FIRM)
        self.case = Case.objects.create(owner=self.victim, title="t")
        self.convo = Conversation.objects.create(case=self.case)
        self.url = f"/api/cases/{self.case.pk}/conversations/{self.convo.pk}/messages/"

    def test_owner_sends_and_messages_are_saved(self, chat):
        chat.return_value = fake_completion("Hello, I'm an AI.")
        self.client.force_authenticate(self.victim)
        r = self.client.post(self.url, {"content": "What are my rights?"}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual([m["role"] for m in r.data], ["user", "assistant"])
        self.assertEqual(self.convo.messages.count(), 2)
        sent = chat.call_args.args[0]
        self.assertEqual(sent[0]["role"], "system")
        self.assertEqual(sent[-1], {"role": "user", "content": "What are my rights?"})

    def test_crisis_skips_model(self, chat):
        self.client.force_authenticate(self.victim)
        r = self.client.post(self.url, {"content": "I want to end my life"}, format="json")
        self.assertEqual(r.status_code, 201)
        chat.assert_not_called()
        self.assertTrue(all(m["flagged_crisis"] for m in r.data))
        self.assertIn("9-8-8", r.data[1]["content"])

    def test_llm_failure_keeps_user_message(self, chat):
        chat.side_effect = RuntimeError("boom")
        self.client.force_authenticate(self.victim)
        r = self.client.post(self.url, {"content": "hi"}, format="json")
        self.assertEqual(r.status_code, 502)
        self.assertEqual(list(self.convo.messages.values_list("role", flat=True)), ["user"])

    def test_stranger_gets_404(self, chat):
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.post(self.url, {"content": "hi"}, format="json").status_code, 404)
        chat.assert_not_called()

    def test_grantee_can_read_not_send(self, chat):
        CaseShare.objects.create(case=self.case, grantee=self.lawyer)
        self.client.force_authenticate(self.lawyer)
        self.assertEqual(self.client.get(self.url).status_code, 200)
        self.assertEqual(self.client.post(self.url, {"content": "hi"}, format="json").status_code, 403)
        chat.assert_not_called()

    def test_unauthenticated(self, chat):
        self.assertIn(self.client.post(self.url, {"content": "hi"}, format="json").status_code, (401, 403))

    def test_crisis_happens_before_retrieval(self, chat):
        self.client.force_authenticate(self.victim)
        with mock.patch("apps.chat.views.system_prompt") as build:
            self.client.post(self.url, {"content": "I want to kill myself"}, format="json")
        build.assert_not_called()

    def test_unknown_province_404(self, chat):
        self.client.force_authenticate(self.victim)
        r = self.client.post(self.url, {"content": "hi", "province": "ZZ"}, format="json")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(self.convo.messages.count(), 0)
