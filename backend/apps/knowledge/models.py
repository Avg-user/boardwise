"""Public reference law, split into sections for retrieval (RAG). Contains no user data."""
from django.contrib.postgres.indexes import GinIndex
from django.contrib.postgres.search import SearchVectorField
from django.db import models
from pgvector.django import VectorField


class LawSource(models.Model):
    """One reference document for a province (an act, regulation or official guide)."""

    province = models.CharField(max_length=2, db_index=True)
    slug = models.SlugField(max_length=100)
    title = models.CharField(max_length=300)
    source_url = models.URLField(blank=True)
    content_hash = models.CharField(max_length=64)
    ingested_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["province", "slug"], name="uniq_law_source")]

    def __str__(self):
        return f"{self.province}/{self.slug}"


class LawChunk(models.Model):
    """One section (or part of a long section) of a LawSource."""

    source = models.ForeignKey(LawSource, on_delete=models.CASCADE, related_name="chunks")
    province = models.CharField(max_length=2, db_index=True)  # denormalised for filtering
    position = models.PositiveIntegerField()
    section_ref = models.CharField(max_length=50, blank=True, db_index=True)  # e.g. "56", "56(1)"; blank if none
    heading = models.CharField(max_length=500)  # breadcrumb, e.g. "Breaks > Exceptions"
    text = models.TextField()
    # No fixed dimension so the embedding model can change; fine for a corpus this size (exact scan).
    embedding = VectorField(null=True, blank=True)
    search_vector = SearchVectorField(null=True)

    class Meta:
        ordering = ["source", "position"]
        indexes = [GinIndex(fields=["search_vector"])]

    def __str__(self):
        return f"{self.source} #{self.position}"


class LawReference(models.Model):
    """Graph edge: one chunk refers to another (e.g. "subject to section 23")."""

    from_chunk = models.ForeignKey(LawChunk, on_delete=models.CASCADE, related_name="references_out")
    to_chunk = models.ForeignKey(LawChunk, on_delete=models.CASCADE, related_name="references_in")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["from_chunk", "to_chunk"], name="uniq_law_reference")]
