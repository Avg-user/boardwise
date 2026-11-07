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


def system_prompt(province: str, query: str = "") -> str:
    template = (PROMPTS_DIR / "system.md").read_text(encoding="utf-8")
    return template.replace("{province}", province).replace("{labour_law}", law_reference(province, query))
