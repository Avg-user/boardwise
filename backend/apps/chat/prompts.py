"""Builds the system prompt: system.md + the law reference for a province.

If the province has been ingested into apps.knowledge, only the sections relevant to the
question are included (RAG). Otherwise the whole prompts/provinces/<CODE>.md is used.
"""
from pathlib import Path

PROMPTS_DIR = Path(__file__).resolve().parents[2] / "prompts"
NO_MATCH = "(No sections of the reference matched this question. Say the reference does not cover it.)"


class ProvinceNotFound(Exception):
    pass


def _province_file(code: str) -> Path | None:
    path = PROMPTS_DIR / "provinces" / f"{code}.md"
    return path if code.isalpha() and path.is_file() else None


def _has_knowledge(code: str) -> bool:
    from apps.knowledge.models import LawChunk
    return LawChunk.objects.filter(province=code).exists()


def check_province(code: str) -> None:
    """Cheap check, no model calls. Raises ProvinceNotFound."""
    if not (_province_file(code) or _has_knowledge(code)):
        raise ProvinceNotFound(code)


def law_reference(code: str, query: str) -> str:
    if _has_knowledge(code):
        from apps.knowledge.retrieval import format_chunks, search
        chunks = search(code, query)
        if not chunks:
            return NO_MATCH
        return ("Only the sections most relevant to the question are included below.\n\n"
                + format_chunks(chunks))
    path = _province_file(code)
    if not path:
        raise ProvinceNotFound(code)
    return path.read_text(encoding="utf-8")


NO_CONTACTS = "(No verified contacts for this province. Suggest its employment standards or OHS office in general terms.)"


def contacts(code: str) -> str:
    """Verified offices and phone numbers (prompts/contacts/<CODE>.md), always in the prompt so the
    model never has to invent them. Kept out of provinces/ so ingest_laws doesn't load it."""
    path = PROMPTS_DIR / "contacts" / f"{code}.md"
    return path.read_text(encoding="utf-8").strip() if code.isalpha() and path.is_file() else NO_CONTACTS


def documents(code: str) -> str:
    """Titles of the province's law documents, so the model cites them by their real names."""
    from apps.knowledge.models import LawSource
    titles = list(LawSource.objects.filter(province=code).order_by("title").values_list("title", flat=True))
    return ", ".join(titles) or "the reference below"


def system_prompt(province: str, query: str = "") -> str:
    template = (PROMPTS_DIR / "system.md").read_text(encoding="utf-8")
    return (template.replace("{province}", province)
            .replace("{documents}", documents(province))
            .replace("{contacts}", contacts(province))
            .replace("{labour_law}", law_reference(province, query)))
