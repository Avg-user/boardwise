"""Turn an Alberta King's Printer consolidation PDF (an act or regulation) into Markdown.

The Markdown uses the structure chunk_markdown() already understands:

    # <Title>
    ## Part 16 — Noise
    ### Division 3 — Hours of Work
    #### 218 Worker exposure to noise
    ## Schedule 3 — Noise

The table of contents, page headers and amendment history lines are dropped.
"""
import re
from pathlib import Path

# "218   An employer ...", "2(1)  This Act ...", "215.6(3)  An employer ...", "139   Repealed ..."
_SECTION_START = re.compile(r"^(\d+(?:\.\d+)?)(\(\d+\))?\s{2,}([A-Z“\"(].*)$")
_PART = re.compile(r"^Part\s+(\d+(?:\.\d+)?)\s*(?:—\s*(.*?))?\s*$")
_DIVISION = re.compile(r"^Division\s+(\d+(?:\.\d+)?)\s*$")
_SCHEDULE = re.compile(r"^Schedule\s+(\d+)\s*$")
_TABLE = re.compile(r"^Table\s+\d+\s*$")
_SUBSECTION = re.compile(r"^\(\d+\)\s")
# Amendment history, e.g. "AR 191/2021 s218;242/2022", "RSA 2000 cE-9 s2;2001 c6 s6;", "2017 c9 s2;2019 c18 s6", "1996 cE-10.3 s31"
_HISTORY = re.compile(r"^(?:R?SA \d{4} c\S+|AR \d+/\d{4}|\d{4} c[\w.-]+ s\d)")


def _strip_page_header(lines: list[str]) -> list[str]:
    """Each page starts with e.g. "Section 218  AR 191/2021", "OCCUPATIONAL HEALTH AND SAFETY CODE", "169"."""
    seen_title = False
    for i, line in enumerate(lines[:8]):
        text = line.strip()
        if text.isdigit() and seen_title:
            return lines[i + 1:]
        if len(text) > 10 and text.isupper():
            seen_title = True
    return lines


def _num(ref: str) -> tuple[int, int]:
    major, _, minor = ref.partition(".")
    return int(major), int(minor or 0)


def statute_to_markdown(pages: list[str], title: str) -> str:
    lines = [l.rstrip() for page in pages for l in _strip_page_header(page.splitlines()) if l.strip()]

    # The body starts at section 1; everything before it is the cover and table of contents.
    start = next((i for i, l in enumerate(lines)
                  if (m := _SECTION_START.match(l)) and m.group(1) == "1"), None)
    if start is None:
        raise ValueError("Could not find section 1; is this a King's Printer consolidation?")
    # Step back over section 1's heading (e.g. "Definitions") and a "Part 1" + title above it.
    for _ in range(4):
        prev = lines[start - 1] if start else ""
        if not _could_be_heading(prev):
            break
        start -= 1
        if _PART.match(prev):
            break

    out = [f"# {title}"]
    candidates: list[str] = []  # unindented lines after a full stop: the next section's heading, or just text
    caption_next = False  # the line after "Table 1" is its caption
    container: str | None = None  # "## Part 16" or "### Division 3" waiting for its title
    after_break = True  # the previous line ended a sentence, a section, or was a marker
    current = (0, 0)
    in_schedules = False

    def flush():
        nonlocal container
        if container:
            out.extend(["", f"{container} — {' '.join(candidates)}".rstrip(" —"), ""])
            container = None
        else:
            out.extend(candidates)
        candidates.clear()

    for line in lines[start:]:
        text = line.strip()
        if _HISTORY.match(text):
            after_break = True
            continue
        if text == "Schedules" or (m := _SCHEDULE.match(text)):
            flush()
            in_schedules = True
            if text != "Schedules":
                container, after_break = f"## Schedule {m.group(1)}", True
            continue
        if in_schedules:
            if container and not candidates:
                candidates.append(text)  # the schedule's title
                flush()
            elif _TABLE.match(text):
                out.extend(["", f"#### {text}"])
                caption_next = True
                continue
            elif caption_next:
                out[-1] += f" — {text}"
            else:
                out.append(line)
            caption_next = False
            continue
        if m := _PART.match(text):
            flush()
            if m.group(2):  # "Part 38 — Expired"
                out.extend(["", f"## Part {m.group(1)} — {m.group(2)}", ""])
            else:
                container = f"## Part {m.group(1)}"
            after_break = True
            continue
        if m := _DIVISION.match(text):
            flush()
            container, after_break = f"### Division {m.group(1)}", True
            continue

        m = _SECTION_START.match(line)
        if m and _num(m.group(1)) > current:
            current = _num(m.group(1))
            if container:  # "Part 16", "Noise", "Duty to reduce": the last one names the section
                name = candidates.pop() if len(candidates) > 1 else ""
            else:  # "Vehicle Hoists", "Safety standards": a group heading, then the section's
                name = " — ".join(candidates)
                candidates.clear()
            flush()
            out.extend(["", f"#### {m.group(1)} {name}".rstrip(), "", line])
        elif m or _SUBSECTION.match(line):
            flush()
            out.extend(["", line])  # blank line between subsections, so long sections split cleanly
        elif (after_break or candidates) and _could_be_heading(line) and len(candidates) < 5:
            # A heading that wraps: "Resolving doubts about general" + "holiday pay entitlements"
            if candidates and (text[0].islower() or candidates[-1].endswith((",", "—", "-"))):
                candidates[-1] += f" {text}"
            else:
                candidates.append(text)
            continue
        else:
            flush()
            out.append(line)
        after_break = text.endswith((".", ";", ":"))

    flush()
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip() + "\n"


def _could_be_heading(line: str) -> bool:
    text = line.strip()
    return bool(text) and not line.startswith((" ", "(")) and not text.endswith((".", ";", ":")) \
        and not _HISTORY.match(text)


def pdf_to_markdown(path: Path) -> str:
    from pypdf import PdfReader

    pages = [page.extract_text() or "" for page in PdfReader(path).pages]
    return statute_to_markdown(pages, path.stem)
