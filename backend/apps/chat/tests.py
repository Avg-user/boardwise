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
from .scope import REFUSALS

User = get_user_model()


def fake_completion(text="AI reply"):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])


class CrisisTests(TestCase):
    def test_detects(self):
        for t in ["I want to kill myself", "thinking about suicide", "My boss is going to hurt me", "I'm not safe at home",
                  "Je veux me suicider", "je veux en finir à ma vie", "Mon patron va me frapper", "je suis en danger"]:
            self.assertTrue(is_crisis(t), t)

    def test_ignores_normal(self):
        for t in ["My manager keeps yelling at me", "How many vacation days do I get?",
                  "Mon gestionnaire me crie dessus", "Combien de jours de vacances ai-je?"]:
            self.assertFalse(is_crisis(t), t)


class ScopeTests(TestCase):
    def test_contains_code(self):
        from .scope import contains_code
        self.assertTrue(contains_code("```\nx = 1\n```"))
        self.assertTrue(contains_code("def f():\n    for x in y:\n        return x"))
        self.assertFalse(contains_code("1. Write down the date.\n2. Note who was there.\n3. Keep copies of emails."))
        self.assertFalse(contains_code("Under s. 18 you are owed a 30-minute break if you work more than 5 hours."))


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
        self.assertEqual(r.data["user_message"]["role"], "user")
        self.assertEqual(r.data["reply"]["content"], "Hello, I'm an AI.")
        self.assertEqual(self.convo.messages.count(), 2)
        sent = chat.call_args.args[0]
        self.assertEqual(sent[0]["role"], "system")
        self.assertIn("Write your reply in English.", sent[0]["content"])
        self.assertEqual(sent[-1], {"role": "user", "content": "What are my rights?"})

    def test_off_topic_marker_replaced_with_refusal(self, chat):
        chat.return_value = fake_completion("`[OFF_TOPIC]`")
        self.client.force_authenticate(self.victim)
        r = self.client.post(self.url, {"content": "what is 2+2", "language": "fr"}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.data["reply"]["content"], REFUSALS["fr"])
        self.assertNotIn("[OFF_TOPIC]", self.convo.messages.last().content)

    def test_reply_with_code_is_refused(self, chat):
        chat.return_value = fake_completion("Sure! Here you go:\n```python\nprint(sorted(notes))\n```")
        self.client.force_authenticate(self.victim)
        r = self.client.post(self.url, {"content": "sort my notes with python"}, format="json")
        self.assertEqual(r.data["reply"]["content"], REFUSALS["en"])

    def test_system_prompt_has_scope_rules(self, chat):
        chat.return_value = fake_completion()
        self.client.force_authenticate(self.victim)
        self.client.post(self.url, {"content": "hi"}, format="json")
        self.assertIn("[OFF_TOPIC]", chat.call_args.args[0][0]["content"])

    def test_reply_language(self, chat):
        chat.return_value = fake_completion()
        self.client.force_authenticate(self.victim)
        self.client.post(self.url, {"content": "Quels sont mes droits?", "language": "fr-CA"}, format="json")
        self.assertIn("Write your reply in French.", chat.call_args.args[0][0]["content"])

    def test_history_is_sent_in_order(self, chat):
        Message.objects.create(conversation=self.convo, role="user", content="first")
        Message.objects.create(conversation=self.convo, role="assistant", content="answer")
        chat.return_value = fake_completion()
        self.client.force_authenticate(self.victim)
        self.client.post(self.url, {"content": "second"}, format="json")
        self.assertEqual([m["content"] for m in chat.call_args.args[0][1:]], ["first", "answer", "second"])

    def test_crisis_skips_model(self, chat):
        self.client.force_authenticate(self.victim)
        r = self.client.post(self.url, {"content": "I want to end my life"}, format="json")
        self.assertEqual(r.status_code, 201)
        chat.assert_not_called()
        self.assertTrue(r.data["user_message"]["flagged_crisis"])
        self.assertIsNone(r.data["reply"])
        self.assertIn("9-8-8", r.data["crisis_resources"])
        self.assertEqual(self.convo.messages.count(), 1)

    def test_crisis_message_never_sent_to_model_later(self, chat):
        chat.return_value = fake_completion()
        self.client.force_authenticate(self.victim)
        self.client.post(self.url, {"content": "I want to end my life"}, format="json")
        self.client.post(self.url, {"content": "ok, about my boss"}, format="json")
        sent = [m["content"] for m in chat.call_args.args[0][1:]]
        self.assertEqual(sent, ["ok, about my boss"])

    def test_llm_failure_keeps_user_message(self, chat):
        chat.side_effect = RuntimeError("boom")
        self.client.force_authenticate(self.victim)
        r = self.client.post(self.url, {"content": "hi"}, format="json")
        self.assertEqual(r.status_code, 502)
        self.assertEqual(self.convo.messages.count(), 0)  # nothing saved, so a retry won't duplicate

    def test_empty_reply_is_502(self, chat):
        chat.return_value = fake_completion("  ")
        self.client.force_authenticate(self.victim)
        self.assertEqual(self.client.post(self.url, {"content": "hi"}, format="json").status_code, 502)
        self.assertEqual(self.convo.messages.count(), 0)

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
