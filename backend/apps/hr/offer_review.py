"""AI check of a job offer against the province's employment law (runs in Celery, see tasks.py)."""
import io
import json
import logging
import re
import zipfile
from xml.etree import ElementTree

from django.conf import settings
from django.utils import timezone

from apps.chat import llm
from apps.chat.prompts import PROMPTS_DIR, law_reference

from .models import JobOffer

logger = logging.getLogger(__name__)

# Long offers are checked in parts. The small model often spends its whole output budget
# reasoning over an 11-page contract and answers nothing; parts of ~4,000 characters with a
# smaller law reference each answered reliably in testing.
PART_CHARS = 4000
MAX_PARTS = 8
MAX_LAW_CHUNKS = 8
MAX_DOCX_XML_BYTES = 20 * 1024 * 1024
SEVERITIES = ("violation", "concern", "info")
# One search per topic a job offer usually covers, so the reference has the matching minimums.
TOPICS = [
    "minimum wage", "hours of work", "overtime pay and overtime agreements", "rest periods and breaks",
    "days of rest", "vacation and vacation pay", "general holiday pay", "termination notice and termination pay",
    "deductions from earnings", "pay periods and statement of earnings", "job-protected leave",
    "harassment and violence prevention",
]


class UnreadableOffer(Exception):
    pass


class NoText(UnreadableOffer):
    """The file opened but has no text, usually a scanned PDF (pages are images)."""


def _docx_text(data: bytes) -> str:
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        if z.getinfo("word/document.xml").file_size > MAX_DOCX_XML_BYTES:  # zip bomb
            raise UnreadableOffer("document too large")
        root = ElementTree.fromstring(z.read("word/document.xml"))
    return "\n".join("".join(t.text or "" for t in p.iter(f"{ns}t")) for p in root.iter(f"{ns}p"))


def extract_text(name: str, data: bytes) -> str:
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    try:
        if ext == "pdf":
            from pypdf import PdfReader
            return "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(data)).pages)
        if ext == "docx":
            return _docx_text(data)
        if ext in ("txt", "md"):
            return data.decode("utf-8", errors="replace")
    except Exception as exc:  # malformed file; never log its content
        raise UnreadableOffer(type(exc).__name__) from exc
    raise UnreadableOffer(f"unsupported type .{ext}")


def split_offer(text: str) -> list[str]:
    """Parts of at most PART_CHARS, split between paragraphs (or lines, for a long paragraph)."""
    pieces = []
    for para in re.split(r"\n\s*\n", text.strip()):
        pieces += para.splitlines() if len(para) > PART_CHARS else [para]
    parts, current = [], ""
    for piece in pieces:
        while len(piece) > PART_CHARS:  # one huge line: cut it
            if current:
                parts.append(current)
                current = ""
            parts.append(piece[:PART_CHARS])
            piece = piece[PART_CHARS:]
        if current and len(current) + len(piece) + 2 > PART_CHARS:
            parts.append(current)
            current = piece
        else:
            current = f"{current}\n\n{piece}" if current else piece
    if current.strip():
        parts.append(current)
    return parts


def law_for_offer(province: str, offer_text: str) -> str:
    """The law sections closest to this text first, then the usual topics, up to MAX_LAW_CHUNKS."""
    from apps.knowledge.models import LawChunk
    from apps.knowledge.retrieval import format_chunks, search

    if not LawChunk.objects.filter(province=province).exists():
        return law_reference(province, "")  # the whole summary file
    seen: dict[int, object] = {}
    for query, k in [(offer_text[:2000], MAX_LAW_CHUNKS // 2), *((topic, 2) for topic in TOPICS)]:
        for chunk in search(province, query, k=k):
            seen.setdefault(chunk.pk, chunk)
            if len(seen) >= MAX_LAW_CHUNKS:
                return format_chunks(list(seen.values()))
    return format_chunks(list(seen.values()))


def _ask(template: str, province: str, part: str, index: int, total: int) -> str:
    """One part through the model, retried when it comes back empty. Returns "" if it never answers."""
    prompt = template.replace("{province}", province).replace("{law}", law_for_offer(province, part))
    note = ""
    if total > 1:
        note = (f"This is part {index} of {total} of a longer offer. Only flag terms written in this part. "
                "Don't report anything as missing: it may be in another part.\n")
    messages = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": f"{note}<job_offer>\n{part}\n</job_offer>"},
    ]
    # Small reasoning models sometimes spend the whole output budget thinking and return
    # nothing; that's not deterministic, so try again before giving up.
    for _ in range(max(1, settings.JOB_OFFER_REVIEW_ATTEMPTS)):
        reply = llm.chat(messages, model=settings.JOB_OFFER_MODEL or None, reasoning={"effort": "low"})
        content = (reply.choices[0].message.content or "").strip()
        if content:
            return content
    return ""


def parse_reply(text: str) -> tuple[str, list[dict]]:
    """The model's JSON, made safe to store. Falls back to the raw reply as the summary."""
    match = re.search(r"\{.*\}", text, re.DOTALL)
    try:
        data = json.loads(match.group(0)) if match else None
    except json.JSONDecodeError:
        data = None
    if not isinstance(data, dict):
        return text.strip(), []
    findings = []
    for item in data.get("findings") or []:
        if not isinstance(item, dict) or not str(item.get("title", "")).strip():
            continue
        severity = str(item.get("severity", "")).lower()
        findings.append({
            "severity": severity if severity in SEVERITIES else "concern",
            **{key: str(item.get(key) or "").strip()[:2000]
               for key in ("title", "offer_quote", "explanation", "citation")},
        })
    order = {s: i for i, s in enumerate(SEVERITIES)}
    findings.sort(key=lambda f: order[f["severity"]])
    return str(data.get("summary") or "").strip(), findings


def _dedupe(findings: list[dict]) -> list[dict]:
    seen, out = set(), []
    for f in findings:
        key = (f["severity"], f["title"].lower(), f["offer_quote"].lower())
        if key not in seen:
            seen.add(key)
            out.append(f)
    return out


def review(offer: JobOffer) -> None:
    """Fill in offer.summary and offer.findings. Sets status to done or failed."""
    offer.status = JobOffer.Status.PROCESSING
    offer.save(update_fields=["status"])
    try:
        if offer.file and not offer.text.strip():
            with offer.file.open("rb") as f:
                offer.text = extract_text(offer.file.name, f.read()).strip()
        text = offer.text.strip()
        if not text:
            raise NoText()
        template = (PROMPTS_DIR / "job_offer_review.md").read_text(encoding="utf-8")
        parts = split_offer(text)
        skipped = parts[MAX_PARTS:]
        parts = parts[:MAX_PARTS]
        summaries, findings, unanswered = [], [], []
        for index, part in enumerate(parts, start=1):
            content = _ask(template, offer.province, part, index, len(parts))
            if not content:
                unanswered.append(index)
                continue
            summary, part_findings = parse_reply(content)
            if len(parts) > 1:  # "missing" only makes sense when the model saw the whole offer
                part_findings = [f for f in part_findings if f["severity"] != "info"]
            summaries.append(summary)
            findings += part_findings
        if len(unanswered) == len(parts):
            raise ValueError("empty reply")
        order = {s: i for i, s in enumerate(SEVERITIES)}
        offer.findings = sorted(_dedupe(findings), key=lambda f: order[f["severity"]])
        offer.summary = "\n\n".join(s for s in summaries if s)
        offer.parts_total = len(parts) + len(skipped)
        # Parts past MAX_PARTS aren't sent at all; list them as unchecked too.
        offer.parts_unchecked = unanswered + list(range(len(parts) + 1, offer.parts_total + 1))
        offer.status = JobOffer.Status.DONE
        offer.failure = JobOffer.Failure.PARTIAL if offer.parts_unchecked else ""
    except Exception as exc:  # IDs and error type only, never the offer text
        logger.error("Job offer review failed: offer=%s error=%s", offer.pk, type(exc).__name__)
        offer.status = JobOffer.Status.FAILED
        offer.failure = (JobOffer.Failure.NO_TEXT if isinstance(exc, NoText)
                         else JobOffer.Failure.UNREADABLE if isinstance(exc, UnreadableOffer)
                         else JobOffer.Failure.MODEL)
    offer.reviewed_at = timezone.now()
    offer.save(update_fields=["text", "summary", "findings", "status", "failure", "parts_total",
                              "parts_unchecked", "reviewed_at"])
