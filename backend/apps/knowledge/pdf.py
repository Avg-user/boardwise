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


# A row of the OHS Code's occupational exposure limit table (Schedule 1, Table 2), e.g.
# "Acetaldehyde 75-07-0 - - - (c) 25 (c) 45 3". The name may be on the lines above instead.
_OEL_ROW = re.compile(r"^(?P<name>.*?)\s*\b(?P<cas>\d{2,7}-\d{2}-\d)\s+(?P<vals>.+?)\s*$")
_OEL_VALUE = r"(?:\(c\)\s*[\d.]+|-|[\d.]+|A\d)"
_OEL_VALUES = re.compile(rf"{_OEL_VALUE}(?:\s+{_OEL_VALUE})*")


def _amount(ppm: str, mg: str, fcc: str = "-") -> str:
    parts = [f"{ppm} ppm" if ppm != "-" else "", f"{mg} mg/m³" if mg != "-" else "",
             f"{fcc} fibres/cc" if fcc != "-" else ""]
    return ", ".join(p for p in parts if p)


def _oel_row(line: str) -> str:
    """Spell out a table row's columns, which are pages away in the PDF; small models misread
    "14464-46-1 - 0.025 - - - - A2". Columns: 8-hour ppm, mg/m³, f/cc; 15-minute or ceiling ppm,
    mg/m³; substance interaction; carcinogenicity. Rows that don't fit exactly are left alone."""
    m = _OEL_ROW.match(line.strip())
    if not m or not _OEL_VALUES.fullmatch(m.group("vals")):
        return line
    vals = re.findall(_OEL_VALUE, m.group("vals"))
    if len(vals) not in (6, 7) or any(v.startswith("A") for v in vals[:6]):
        return line
    ppm8, mg8, fcc, ppm15, mg15, interaction = vals[:6]
    carcinogen = vals[6] if len(vals) == 7 else "-"
    ceiling = "(c)" in ppm15 + mg15
    ppm15, mg15 = ppm15.replace("(c)", "").strip(), mg15.replace("(c)", "").strip()
    name = f"{m.group('name')} (CAS {m.group('cas')})" if m.group("name") else f"CAS {m.group('cas')}"
    out = [f"8-hour limit: {_amount(ppm8, mg8, fcc) or 'none'}"]
    short = _amount(ppm15, mg15)
    out.append(f"{'ceiling' if ceiling else '15-minute'} limit: {short}" if short
               else "no 15-minute or ceiling limit")
    if interaction != "-":
        out.append(f"substance interaction note {interaction}")
    if carcinogen != "-":
        out.append(f"carcinogen {carcinogen}")
    return f"{name}: {'; '.join(out)}"


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
    in_oel_table = False  # Schedule 1, Table 2: occupational exposure limits

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
            in_schedules, in_oel_table = True, False
            if text != "Schedules":
                container, after_break = f"## Schedule {m.group(1)}", True
            continue
        if in_schedules:
            if container and not candidates:
                candidates.append(text)  # the schedule's title
                flush()
            elif _TABLE.match(text):
                out.extend(["", f"#### {text}"])
                caption_next, in_oel_table = True, False
                continue
            elif caption_next:
                out[-1] += f" — {text}"
                in_oel_table = "exposure limits for chemical substances" in text.lower()
            else:
                out.append(_oel_row(line) if in_oel_table else line)
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
