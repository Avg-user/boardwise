"""Load a Markdown law document into LawSource / LawChunk / LawReference, then embed it."""
import hashlib
import logging

from django.conf import settings
from django.contrib.postgres.search import SearchVector
from django.db import transaction

from apps.chat import llm

from .chunker import chunk_markdown
from .models import LawChunk, LawReference, LawSource
from .references import find_section_refs

logger = logging.getLogger(__name__)
EMBED_BATCH = 64
# Bump when chunking or graph building changes, so unchanged documents are re-ingested too.
INGEST_VERSION = "2"


@transaction.atomic
def ingest_markdown(province: str, slug: str, title: str, markdown: str, source_url: str = "") -> tuple[LawSource, bool]:
    """Replace a source's chunks. Returns (source, changed). Unchanged content is a no-op."""
    digest = hashlib.sha256(f"{INGEST_VERSION}\n{markdown}".encode()).hexdigest()
    source, created = LawSource.objects.get_or_create(
        province=province, slug=slug, defaults={"title": title, "source_url": source_url, "content_hash": ""}
    )
    if not created and source.content_hash == digest:
        return source, False

    source.title, source.source_url, source.content_hash = title, source_url, digest
    source.save()
    source.chunks.all().delete()  # cascades to references

    chunks = LawChunk.objects.bulk_create([
        LawChunk(source=source, province=province, position=c.position, heading=c.heading,
                 section_ref=c.section_ref, text=c.text)
        for c in chunk_markdown(markdown)
    ])
    source.chunks.update(search_vector=SearchVector("heading", weight="A", config=settings.RAG_SEARCH_CONFIG)
                         + SearchVector("text", weight="B", config=settings.RAG_SEARCH_CONFIG))

    # Graph edges: link each chunk to the sections it mentions in the same document ("section 2"
    # in the Employment Standards Code is not section 2 of the OHS Code).
    by_ref: dict[str, list[LawChunk]] = {}
    by_section_ref = {c.pk: c.section_ref for c in chunks}
    for c in chunks:
        if not c.section_ref:
            continue
        by_ref.setdefault(c.section_ref, []).append(c)
    edges = {
        (c.pk, target.pk)
        for c in chunks
        for ref in find_section_refs(c.text)
        for target in by_ref.get(ref, [])
        if target.pk != c.pk
    }
    # A schedule's "[See sections 218, 219(1)]" names the sections that use it, so link both ways:
    # finding section 218 should bring in the Schedule 3 table of exposure limits.
    edges |= {(b, a) for a, b in edges if by_section_ref.get(a, "").startswith("Schedule")}
    LawReference.objects.bulk_create(
        [LawReference(from_chunk_id=a, to_chunk_id=b) for a, b in edges], ignore_conflicts=True
    )
    logger.info("Ingested law source=%s chunks=%d edges=%d", source.pk, len(chunks), len(edges))
    return source, True


def embed_missing(province: str | None = None) -> int:
    """Embed chunks that have no embedding yet. Safe to re-run. Returns how many were embedded."""
    if not settings.EMBEDDING_MODEL:
        return 0
    qs = LawChunk.objects.filter(embedding__isnull=True)
    if province:
        qs = qs.filter(province=province)
    done = 0
    ids = list(qs.values_list("pk", flat=True))
    for i in range(0, len(ids), EMBED_BATCH):
        batch = list(LawChunk.objects.filter(pk__in=ids[i:i + EMBED_BATCH]))
        vectors = llm.embed([f"{c.heading}\n{c.text}" for c in batch])
        for chunk, vec in zip(batch, vectors):
            chunk.embedding = vec
        LawChunk.objects.bulk_update(batch, ["embedding"])
        done += len(batch)
    return done
