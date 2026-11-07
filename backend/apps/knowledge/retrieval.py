"""Hybrid retrieval over LawChunk: full-text + vector search, merged with reciprocal rank fusion,
then expanded one hop along cross-reference edges (the "graph" part)."""
import logging

from django.conf import settings
from django.contrib.postgres.search import SearchQuery, SearchRank
from django.db.models import F
from pgvector.django import CosineDistance

from apps.chat import llm

from .models import LawChunk, LawReference

logger = logging.getLogger(__name__)
RRF_K = 60
CANDIDATES = 20


def _fulltext(province: str, query: str) -> list[int]:
    q = SearchQuery(query, search_type="websearch", config=settings.RAG_SEARCH_CONFIG)
    # websearch requires every term (AND); for natural questions an OR of terms recalls far better.
    terms = [t for t in query.split() if t.isalnum() and len(t) > 2]
    if terms:
        q = q | SearchQuery(" ".join(terms), search_type="websearch", config=settings.RAG_SEARCH_CONFIG)
        for t in terms:
            q = q | SearchQuery(t, config=settings.RAG_SEARCH_CONFIG)
    return list(
        LawChunk.objects.filter(province=province, search_vector=q)
        .annotate(rank=SearchRank(F("search_vector"), q))
        .order_by("-rank").values_list("pk", flat=True)[:CANDIDATES]
    )


def _vector(province: str, query: str) -> list[int]:
    if not settings.EMBEDDING_MODEL:
        return []
    qs = LawChunk.objects.filter(province=province, embedding__isnull=False)
    if not qs.exists():
        return []
    try:
        [vec] = llm.embed([query])
    except Exception as exc:  # fall back to full-text only; never log the query
        logger.warning("Query embedding failed: error=%s", type(exc).__name__)
        return []
    return list(qs.order_by(CosineDistance("embedding", vec)).values_list("pk", flat=True)[:CANDIDATES])


def search(province: str, query: str, k: int | None = None) -> list[LawChunk]:
    k = k or settings.RAG_TOP_K
    scores: dict[int, float] = {}
    for ranking in (_fulltext(province, query), _vector(province, query)):
        for rank, pk in enumerate(ranking):
            scores[pk] = scores.get(pk, 0) + 1 / (RRF_K + rank + 1)
    top = sorted(scores, key=scores.get, reverse=True)[:k]
    if not top:
        return []

    # Graph expansion: add sections the hits refer to ("subject to section 23"), up to k extra.
    linked = [
        pk for pk in LawReference.objects.filter(from_chunk_id__in=top)
        .exclude(to_chunk_id__in=top).values_list("to_chunk_id", flat=True).distinct()
    ][:k]
    chunks = {c.pk: c for c in LawChunk.objects.filter(pk__in=top + linked).select_related("source")}
    return [chunks[pk] for pk in top + linked if pk in chunks]


def format_chunks(chunks: list[LawChunk]) -> str:
    blocks = []
    for c in chunks:
        label = f"s. {c.section_ref} — {c.heading}" if c.section_ref else c.heading
        blocks.append(f"### [{c.source.title}] {label}\n{c.text}")
    return "\n\n".join(blocks)
