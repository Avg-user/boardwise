from django.contrib import admin

from .models import LawChunk, LawSource


@admin.register(LawSource)
class LawSourceAdmin(admin.ModelAdmin):
    list_display = ["province", "slug", "title", "ingested_at"]


@admin.register(LawChunk)
class LawChunkAdmin(admin.ModelAdmin):
    list_display = ["source", "position", "section_ref", "heading"]
    list_filter = ["province"]
    exclude = ["embedding", "search_vector"]
