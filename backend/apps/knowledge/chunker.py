"""Split a Markdown law document by its own heading structure.

Each chunk is one section. Long sections are split on paragraph boundaries, keeping the heading.
"""
import re
from dataclasses import dataclass

MAX_CHARS = 2000
_HEADING = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")
# "Section 56", "s. 56(1)", "56 Termination pay", "56.1(2) ..." at the start of a heading
_SECTION = re.compile(r"^(?:section\s+|s\.\s*)?(\d+(?:\.\d+)?(?:\(\w+\))*)(?![\w(.])", re.IGNORECASE)


@dataclass
class Chunk:
    position: int
    heading: str
    section_ref: str
    text: str


def section_ref_from_heading(heading: str) -> str:
    m = _SECTION.match(heading.strip())
    return m.group(1) if m else ""


def _split_long(text: str) -> list[str]:
    if len(text) <= MAX_CHARS:
        return [text]
    parts, current = [], ""
    for para in re.split(r"\n\s*\n", text):
        if current and len(current) + len(para) + 2 > MAX_CHARS:
            parts.append(current)
            current = para
        else:
            current = f"{current}\n\n{para}" if current else para
    if current:
        parts.append(current)
    return parts


def chunk_markdown(markdown: str) -> list[Chunk]:
    stack: list[tuple[int, str]] = []  # (level, heading) breadcrumb
    sections: list[tuple[list[str], list[str]]] = []
    body: list[str] = []

    def flush():
        text = "\n".join(body).strip()
        if text:
            sections.append(([h for _, h in stack], text))
        body.clear()

    for line in markdown.splitlines():
        m = _HEADING.match(line)
        if m:
            flush()
            level = len(m.group(1))
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, m.group(2)))
        else:
            body.append(line)
    flush()

    chunks = []
    for path, text in sections:
        # Skip the top-level document title in the breadcrumb when there is something below it.
        crumbs = path[1:] if len(path) > 1 else path
        heading = " > ".join(crumbs) or "Introduction"
        ref = next((r for r in (section_ref_from_heading(h) for h in reversed(crumbs)) if r), "")
        for part in _split_long(text):
            chunks.append(Chunk(position=len(chunks), heading=heading[:500], section_ref=ref, text=part))
    return chunks
