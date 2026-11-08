from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.utils.text import slugify

from apps.chat.prompts import PROMPTS_DIR
from apps.knowledge.ingest import embed_missing, ingest_markdown
from apps.knowledge.pdf import pdf_to_markdown


class Command(BaseCommand):
    help = (
        "Load province law references into the knowledge base. Reads backend/prompts/provinces/<CODE>.md "
        "(the summary) and <CODE>/*.md and <CODE>/*.pdf (King's Printer consolidations of acts and regulations)."
    )

    def add_arguments(self, parser):
        parser.add_argument("--province", help="Two-letter code, e.g. AB. Default: all.")
        parser.add_argument("--no-embed", action="store_true", help="Skip embeddings (full-text search only).")
        parser.add_argument("--async-embed", action="store_true", help="Queue embeddings on Celery instead.")

    def handle(self, *args, province=None, no_embed=False, async_embed=False, **opts):
        root = PROMPTS_DIR / "provinces"
        files: list[tuple[str, Path]] = []
        for path in sorted(root.glob("*.md")):
            files.append((path.stem.upper(), path))
        for folder in sorted(p for p in root.iterdir() if p.is_dir()):
            files += [(folder.name.upper(), p) for p in sorted(folder.iterdir()) if p.suffix.lower() in (".md", ".pdf")]
        if province:
            files = [f for f in files if f[0] == province.upper()]
        if not files:
            raise CommandError("No law documents found.")

        for code, path in files:
            if path.suffix.lower() == ".pdf":
                title, url = path.stem, ""
                try:
                    text = pdf_to_markdown(path)
                except ValueError as exc:
                    self.stderr.write(self.style.WARNING(f"{code}/{path.name}: skipped ({exc})"))
                    continue
            else:
                text = path.read_text(encoding="utf-8")
                title = next((l.lstrip("# ").strip() for l in text.splitlines() if l.startswith("# ")), path.stem)
                url = next((l.split()[-1] for l in text.splitlines() if l.startswith("http")), "")
            slug = slugify(path.stem) if path.parent != root else "summary"
            source, changed = ingest_markdown(code, slug, title, text, url)
            status = "updated" if changed else "unchanged"
            self.stdout.write(f"{code}/{slug}: {status}, {source.chunks.count()} chunks")

        if no_embed:
            return
        if async_embed:
            from apps.knowledge.tasks import embed_law_chunks
            embed_law_chunks.delay(province.upper() if province else None)
            self.stdout.write("Embedding queued.")
        else:
            try:
                n = embed_missing(province.upper() if province else None)
            except Exception as exc:
                self.stderr.write(self.style.WARNING(
                    f"Embedding failed ({type(exc).__name__}: {exc}). Chunks are saved; search falls back "
                    "to full-text. Re-run later to embed, or set EMBEDDING_MODEL= to disable."))
                return
            self.stdout.write(f"Embedded {n} chunks.")
