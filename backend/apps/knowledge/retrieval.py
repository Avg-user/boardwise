"""Hybrid retrieval over LawChunk: full-text + vector search, merged with reciprocal rank fusion,
then expanded one hop along cross-reference edges (the "graph" part)."""
import logging
import math
import operator
import re
from functools import reduce

from django.conf import settings
from django.contrib.postgres.search import SearchQuery, SearchRank
from django.db.models import F, Value
from pgvector.django import CosineDistance

from apps.chat import llm

from .models import LawChunk, LawReference

logger = logging.getLogger(__name__)
RRF_K = 60
CANDIDATES = 20
MAX_LINKED = 2  # cross-referenced sections added after the top hits; more is mostly noise

# Everyday words → the words the law uses. Full-text search can't bridge these on its own: the
# OHS Act says "disciplinary action", never "reprisal", and "fired" stems to "fire", which
# matches the fire-hazard sections. Each pattern's words replace the match.
_LEGAL_TERMS = [
    (re.compile(r"\b(fired|let go|sacked|canned)\b", re.I), "termination dismissal disciplinary action"),
    (re.compile(r"\b(reprisals?|retaliat\w*|punish\w*)\b", re.I), "disciplinary action"),
    (re.compile(r"\bsds\b", re.I), "safety data sheet"),
    (re.compile(r"\b(wcb|workers'? ?comp\w*)\b", re.I), "compensation claim"),
    (re.compile(r"\bmasks?\b", re.I), "respiratory protective equipment"),
    # Kept, not replaced: "threat of violence" must still find the violence sections.
    (re.compile(r"\b(threat\w*|intimidat\w*|hurt (?:her|his|my|their) career)\b", re.I),
     r"\g<0> disciplinary action"),
]


def _legal_terms(query: str) -> str:
    for pattern, words in _LEGAL_TERMS:
        query = pattern.sub(words, query)
    return query


def _fulltext(province: str, query: str) -> list[int]:
    """Rank by matched terms, each weighted by how rare it is in this province's documents (IDF).

    Plain ts_rank treats every term alike, so in a question like "Occupational Health & Safety
    rules on noise" the common words ("health", "safety") outweigh the one that matters ("noise").
    """
    chunks = LawChunk.objects.filter(province=province)
    total = chunks.count()
    weighted = [(SearchQuery(query, search_type="websearch", config=settings.RAG_SEARCH_CONFIG), 1.0)]
    for term in dict.fromkeys(t.lower() for t in query.split() if t.isalnum() and len(t) > 2):
        q = SearchQuery(term, config=settings.RAG_SEARCH_CONFIG)
        df = chunks.filter(search_vector=q).count()  # stop words match nothing and drop out here
        if df:
            weighted.append((q, math.log(1 + total / df)))
    any_term = reduce(operator.or_, (q for q, _ in weighted))
    rank = sum((SearchRank(F("search_vector"), q) * Value(w) for q, w in weighted), Value(0.0))
    return list(
        chunks.filter(search_vector=any_term).annotate(rank=rank)
        .order_by("-rank", "pk").values_list("pk", flat=True)[:CANDIDATES]
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
    for ranking in (_fulltext(province, _legal_terms(query)), _vector(province, query)):
        for rank, pk in enumerate(ranking):
            scores[pk] = scores.get(pk, 0) + 1 / (RRF_K + rank + 1)
    top = sorted(scores, key=scores.get, reverse=True)[:k]
    if not top:
        return []

    # Graph expansion: add sections the hits refer to ("subject to section 23"), up to MAX_LINKED.
    linked = [
        pk for pk in LawReference.objects.filter(from_chunk_id__in=top)
        .exclude(to_chunk_id__in=top).values_list("to_chunk_id", flat=True).distinct()
    ][:MAX_LINKED]
    chunks = {c.pk: c for c in LawChunk.objects.filter(pk__in=top + linked).select_related("source")}
    return [chunks[pk] for pk in top + linked if pk in chunks]


def format_chunks(chunks: list[LawChunk]) -> str:
    blocks = []
    for c in chunks:
        label = f"s. {c.section_ref} — {c.heading}" if c.section_ref[:1].isdigit() else c.heading
        blocks.append(f"### [{c.source.title}] {label}\n{c.text}")
    return "\n\n".join(blocks)
