from celery import shared_task

from .ingest import embed_missing


@shared_task(autoretry_for=(Exception,), retry_backoff=True, max_retries=5)
def embed_law_chunks(province: str | None = None) -> int:
    return embed_missing(province)
