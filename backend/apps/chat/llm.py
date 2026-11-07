"""Thin wrapper around OpenRouter (OpenAI-compatible API). Every LLM call goes through here."""
from django.conf import settings
from openai import OpenAI

_client = None


def get_client() -> OpenAI:
    global _client
    if _client is None:
        # The SDK retries 429 (provider busy), 408, 409 and 5xx with exponential backoff.
        _client = OpenAI(
            base_url=settings.OPENROUTER_BASE_URL,
            api_key=settings.OPENROUTER_API_KEY,
            max_retries=settings.OPENROUTER_MAX_RETRIES,
        )
    return _client


def chat(messages: list[dict], model: str | None = None, stream: bool = False, **kwargs):
    return get_client().chat.completions.create(
        model=model or settings.OPENROUTER_MODEL,
        messages=messages,
        stream=stream,
        # Sensitive data: "deny" routes only to providers that don't store/train on prompts.
        # Dev-only override via OPENROUTER_DATA_COLLECTION=allow (needed for free models).
        extra_body={"provider": {"data_collection": settings.OPENROUTER_DATA_COLLECTION}},
        **kwargs,
    )


def embed(texts: list[str], model: str | None = None) -> list[list[float]]:
    """Embedding vectors for `texts`, in order. Same data_collection policy as chat()."""
    response = get_client().embeddings.create(
        model=model or settings.EMBEDDING_MODEL,
        input=texts,
        extra_body={"provider": {"data_collection": settings.OPENROUTER_DATA_COLLECTION}},
    )
    return [item.embedding for item in sorted(response.data, key=lambda d: d.index)]
