"""Thin wrapper around OpenRouter (OpenAI-compatible API)."""
from django.conf import settings
from openai import OpenAI

_client = None


def get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(base_url=settings.OPENROUTER_BASE_URL, api_key=settings.OPENROUTER_API_KEY)
    return _client


def chat(messages: list[dict], model: str | None = None, stream: bool = False, **kwargs):
    return get_client().chat.completions.create(
        model=model or settings.OPENROUTER_MODEL,
        messages=messages,
        stream=stream,
        # Sensitive data: only route to providers that don't store/train on prompts.
        extra_body={"provider": {"data_collection": "deny"}},
        **kwargs,
    )
