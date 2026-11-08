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


class OffTopicRequestTests(TestCase):
    def test_blocks_obvious_off_topic(self):
        from .scope import is_off_topic_request
        for t in ["can you write a python program", "write me a script that sorts a list", "what is 2+2",
                  "15*7", "Calculate 3 / 4", "debug my javascript function", "give me some SQL code"]:
            self.assertTrue(is_off_topic_request(t), t)

    def test_lets_workplace_messages_through(self):
        from .scope import is_off_topic_request
        for t in ["My boss makes me write code after hours without pay",
                  "I'm a Python developer and my manager harasses me",
                  "How many hours of overtime is 9 + 2?",
                  "My manager keeps yelling at me", "hi, what can you help me with?",
                  "Can you help me write a complaint letter?", "I worked 9 hours with no break"]:
            self.assertFalse(is_off_topic_request(t), t)

    def test_reply_offering_code_is_off_topic(self):
        from .scope import is_off_topic
        offer = ("Absolutely! I'd be happy to help you write a Python program! Describe the task "
                 "and I'll provide the code.")
        self.assertTrue(is_off_topic(offer))
        self.assertTrue(is_off_topic("Sure, I can write a program for that."))
        self.assertTrue(is_off_topic("Here's how. I'll give you the code once you describe it."))
        for legal in ["Ask HR for a copy of the code of conduct and keep your notes dated.",
                      "Ask HR to provide a copy of the code of conduct.",
                      "I can provide a summary of the Employment Standards Code, s. 18.",
                      "Under the Occupational Health and Safety Code, your employer must provide the Code to workers.",
                      "Alberta's Human Rights Code protects you. Write the details down."]:
            self.assertFalse(is_off_topic(legal), legal)
        self.assertFalse(is_off_topic("Write down what happened, who was there, and keep copies of emails."))


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

    @override_settings(OPENROUTER_DATA_COLLECTION="deny")
    def test_reasoning_keeps_data_collection(self):
        client = mock.Mock()
        with mock.patch.object(llm, "get_client", return_value=client):
            llm.chat([{"role": "user", "content": "hi"}], reasoning={"effort": "low"})
        extra = client.chat.completions.create.call_args.kwargs["extra_body"]
        self.assertEqual(extra, {"provider": {"data_collection": "deny"}, "reasoning": {"effort": "low"}})

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

    def test_off_topic_request_skips_model(self, chat):
        self.client.force_authenticate(self.victim)
        r = self.client.post(self.url, {"content": "can you write a python program"}, format="json")
        self.assertEqual(r.status_code, 201)
        chat.assert_not_called()
        self.assertEqual(r.data["reply"]["content"], REFUSALS["en"])
        self.assertEqual(self.convo.messages.count(), 2)

    def test_workplace_question_marked_off_topic_is_retried(self, chat):
        chat.side_effect = [fake_completion("[OFF_TOPIC]"), fake_completion("In BC the minimum wage is set by...")]
        self.client.force_authenticate(self.victim)
        r = self.client.post(self.url, {"content": "What is the minimum wage in BC?"}, format="json")
        self.assertEqual(chat.call_count, 2)
        self.assertEqual(r.data["reply"]["content"], "In BC the minimum wage is set by...")

    def test_non_work_question_marked_off_topic_is_not_retried(self, chat):
        chat.return_value = fake_completion("[OFF_TOPIC]")
        self.client.force_authenticate(self.victim)
        r = self.client.post(self.url, {"content": "Tell me a joke about cats"}, format="json")
        self.assertEqual(chat.call_count, 1)
        self.assertEqual(r.data["reply"]["content"], REFUSALS["en"])

    def test_reply_offering_code_is_refused(self, chat):
        chat.return_value = fake_completion("Absolutely—I'd be happy to help you write a Python program! "
                                            "Just describe the task and I'll provide the code.")
        self.client.force_authenticate(self.victim)
        r = self.client.post(self.url, {"content": "for my case, help me sort my notes with a computer"}, format="json")
        self.assertEqual(r.data["reply"]["content"], REFUSALS["en"])

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


@mock.patch("apps.chat.views.llm.chat", return_value=fake_completion())
class ChatSessionTests(APITestCase):
    """Timeline entries and closed chats live on the server, so every device agrees."""

    def setUp(self):
        self.victim = User.objects.create_user("v", role=User.Role.VICTIM)
        self.lawyer = User.objects.create_user("l", role=User.Role.LAW_FIRM)
        self.case = Case.objects.create(owner=self.victim, title="t")
        self.base = f"/api/cases/{self.case.pk}/conversations/"
        self.client.force_authenticate(self.victim)

    def new_chat(self):
        return self.client.post(self.base).data["id"]

    def send(self, convo_id, content="What are my rights?", **extra):
        return self.client.post(f"{self.base}{convo_id}/messages/", {"content": content, **extra}, format="json")

    def test_first_message_creates_one_linked_entry(self, chat):
        from datetime import date

        from apps.cases.models import TimelineEntry
        convo = self.new_chat()
        self.assertIsNone(self.client.get(f"{self.base}{convo}/").data["timeline_entry"])
        today = date.today().isoformat()
        self.send(convo, entry_title="Chat on Nov 8, 2026", entry_date=today)
        self.send(convo, entry_title="Chat on Nov 8, 2026", entry_date=today)  # e.g. from a second browser
        entry = TimelineEntry.objects.get(case=self.case)
        self.assertEqual((entry.conversation_id, entry.title, entry.occurred_at.isoformat()),
                         (convo, "Chat on Nov 8, 2026", today))
        self.assertEqual(self.client.get(f"{self.base}{convo}/").data["timeline_entry"], entry.pk)
        timeline = self.client.get(f"/api/cases/{self.case.pk}/timeline/").data
        self.assertEqual([row["conversation"] for row in timeline], [convo])

    def test_no_entry_when_the_model_fails(self, chat):
        from apps.cases.models import TimelineEntry
        chat.side_effect = RuntimeError("down")
        convo = self.new_chat()
        self.assertEqual(self.send(convo).status_code, 502)
        self.assertFalse(TimelineEntry.objects.exists())

    def test_crisis_message_still_gets_an_entry(self, chat):
        from apps.cases.models import TimelineEntry
        convo = self.new_chat()
        self.send(convo, "I want to kill myself")
        chat.assert_not_called()
        self.assertEqual(TimelineEntry.objects.get().conversation_id, convo)

    def test_deleted_entry_comes_back_with_the_next_message(self, chat):
        from apps.cases.models import TimelineEntry
        convo = self.new_chat()
        self.send(convo)
        entry = TimelineEntry.objects.get()
        self.assertEqual(self.client.delete(f"/api/cases/{self.case.pk}/timeline/{entry.pk}/").status_code, 204)
        self.assertTrue(Conversation.objects.filter(pk=convo).exists())  # the chat itself stays
        self.send(convo)
        self.assertEqual(TimelineEntry.objects.get().conversation_id, convo)

    def test_entry_link_cannot_be_set_by_clients(self, chat):
        convo = self.new_chat()
        r = self.client.post(f"/api/cases/{self.case.pk}/timeline/",
                             {"occurred_at": "2026-11-01", "title": "x", "conversation": convo}, format="json")
        self.assertEqual(r.status_code, 201)
        self.assertIsNone(r.data["conversation"])

    def test_entry_date_must_be_about_today(self, chat):
        convo = self.new_chat()
        self.assertEqual(self.send(convo, entry_date="2020-01-01").status_code, 400)

    def test_closed_chat_refuses_messages(self, chat):
        convo = self.new_chat()
        r = self.client.post(f"{self.base}{convo}/close/")
        self.assertEqual(r.status_code, 200)
        self.assertIsNotNone(r.data["closed_at"])
        again = self.client.post(f"{self.base}{convo}/close/")  # idempotent
        self.assertEqual(again.data["closed_at"], r.data["closed_at"])
        refused = self.send(convo)
        self.assertEqual(refused.status_code, 409)
        self.assertNotIn("crisis_resources", refused.data)
        self.assertEqual(Message.objects.count(), 0)
        chat.assert_not_called()
        # Someone in danger still gets resources, even from a closed chat.
        self.assertIn("crisis_resources", self.send(convo, "I want to kill myself").data)
        self.assertEqual(Message.objects.count(), 0)

    def test_new_chat_closes_the_open_one(self, chat):
        first = self.new_chat()
        second = self.new_chat()
        chats = {row["id"]: row["closed_at"] for row in self.client.get(self.base).data}
        self.assertIsNotNone(chats[first])
        self.assertIsNone(chats[second])

    def test_only_owner_can_close(self, chat):
        convo = self.new_chat()
        CaseShare.objects.create(case=self.case, grantee=self.lawyer)
        self.client.force_authenticate(self.lawyer)
        self.assertEqual(self.client.post(f"{self.base}{convo}/close/").status_code, 403)
        stranger = User.objects.create_user("s", role=User.Role.VICTIM)
        self.client.force_authenticate(stranger)
        self.assertEqual(self.client.post(f"{self.base}{convo}/close/").status_code, 404)
