from unittest import mock

from django.test import TestCase, override_settings

from apps.chat.prompts import NO_MATCH, check_province, ProvinceNotFound, system_prompt

from .chunker import chunk_markdown, section_ref_from_heading
from .ingest import embed_missing, ingest_markdown
from .models import LawChunk, LawReference
from .references import find_section_refs
from .retrieval import search

DOC = """# Test Employment Act

## Part 1 Definitions
"Employee" means a person employed to do work.

## Section 23 Exceptions
Breaks may be skipped in an emergency.

## Section 24 Breaks
An employee working more than 5 hours gets a 30-minute break, subject to section 23.

## Section 56 Termination notice
An employer must give written notice of termination, see also s. 57(1).

## Section 57 Termination pay
Pay instead of notice is calculated on regular wages.
"""


class ChunkerTests(TestCase):
    def test_section_refs(self):
        self.assertEqual(section_ref_from_heading("Section 56 Termination"), "56")
        self.assertEqual(section_ref_from_heading("s. 57(1) Pay"), "57(1)")
        self.assertEqual(section_ref_from_heading("56.1 Leave"), "56.1")
        self.assertEqual(section_ref_from_heading("Minimum wage"), "")

    def test_splits_by_heading(self):
        chunks = chunk_markdown(DOC)
        self.assertEqual([c.section_ref for c in chunks], ["", "23", "24", "56", "57"])
        self.assertEqual(chunks[2].heading, "Section 24 Breaks")

    def test_long_section_split_keeps_heading(self):
        body = "\n\n".join(["word " * 100] * 10)
        chunks = chunk_markdown(f"# T\n\n## Section 9 Long\n{body}")
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(c.section_ref == "9" for c in chunks))

    def test_find_refs(self):
        self.assertEqual(find_section_refs("subject to section 23"), {"23"})
        self.assertEqual(find_section_refs("see ss. 56 and 57(1)"), {"56", "57(1)", "57"})


@override_settings(EMBEDDING_MODEL="")
class IngestAndSearchTests(TestCase):
    def setUp(self):
        self.source, _ = ingest_markdown("ZZ", "act", "Test Act", DOC)

    def test_ingest_builds_graph_edges(self):
        self.assertEqual(LawChunk.objects.filter(province="ZZ").count(), 5)
        edges = {(e.from_chunk.section_ref, e.to_chunk.section_ref) for e in LawReference.objects.all()}
        self.assertEqual(edges, {("24", "23"), ("56", "57")})

    def test_reingest_unchanged_is_noop(self):
        _, changed = ingest_markdown("ZZ", "act", "Test Act", DOC)
        self.assertFalse(changed)

    def test_search_expands_along_references(self):
        results = search("ZZ", "how long is my break", k=1)
        self.assertEqual([c.section_ref for c in results], ["24", "23"])

    def test_search_is_province_scoped(self):
        self.assertEqual(search("YY", "break"), [])

    def test_prompt_uses_retrieved_sections(self):
        prompt = system_prompt("ZZ", "termination notice")
        self.assertIn("s. 56", prompt)
        self.assertIn("s. 57", prompt)  # pulled in by the graph edge
        self.assertNotIn("Breaks may be skipped", prompt)

    def test_prompt_no_match(self):
        self.assertIn(NO_MATCH, system_prompt("ZZ", "xylophone"))

    def test_check_province(self):
        check_province("ZZ")
        with self.assertRaises(ProvinceNotFound):
            check_province("YY")

    def test_everyday_words_find_legal_terms(self):
        ingest_markdown("XX", "act", "Safety Act", """# Safety Act

## Section 162 Fire hazards
An employer must prevent fire at a work site.

## Section 18 Where disciplinary action prohibited
No person shall take disciplinary action against a worker acting in compliance with this Act.
""")
        refs = [c.section_ref for c in search("XX", "I was fired, is that a reprisal?")]
        self.assertEqual(refs, ["18"])  # "fired" no longer matches "fire"


class LegalTermsTests(TestCase):
    def test_maps_everyday_words(self):
        from .retrieval import _legal_terms
        self.assertNotIn("fired", _legal_terms("They fired me"))
        self.assertIn("disciplinary action", _legal_terms("Is this retaliation?"))
        self.assertIn("safety data sheet", _legal_terms("no SDS given"))
        self.assertIn("compensation claim", _legal_terms("Can I file a WCB claim?"))
        self.assertEqual(_legal_terms("termination notice"), "termination notice")

    def test_threats_add_disciplinary_action_and_keep_the_word(self):
        from .retrieval import _legal_terms
        q = _legal_terms("A supervisor texted her saying it would hurt her career")
        self.assertIn("hurt her career disciplinary action", q)
        q = _legal_terms("a threat of violence at work")
        self.assertIn("threat", q)
        self.assertIn("violence", q)


class ExposureLimitRowTests(TestCase):
    def test_rows_are_spelled_out(self):
        from .pdf import _oel_row
        self.assertEqual(_oel_row("14464-46-1 - 0.025 - - - - A2"),
                         "CAS 14464-46-1: 8-hour limit: 0.025 mg/m³; no 15-minute or ceiling limit; carcinogen A2")
        self.assertEqual(_oel_row("Acetaldehyde 75-07-0 - - - (c) 25 (c) 45 3"),
                         "Acetaldehyde (CAS 75-07-0): 8-hour limit: none; ceiling limit: 25 ppm, 45 mg/m³; "
                         "substance interaction note 3")
        self.assertEqual(_oel_row("Cumene 98-82-8 50 246 - - - -"),
                         "Cumene (CAS 98-82-8): 8-hour limit: 50 ppm, 246 mg/m³; no 15-minute or ceiling limit")

    def test_rows_that_dont_fit_are_unchanged(self):
        from .pdf import _oel_row
        for line in ["Cresol, all isomers 1319-77-3", "Chloroacetone 78-95-5   - (c) 1 (c) 3.8 1, 3",
                     "Cobalt carbonyl, as Co 10210-68-1 - 0.1  - - -", "(Silica, crystalline)"]:
            self.assertEqual(_oel_row(line), line)


class EmbeddingTests(TestCase):
    @override_settings(EMBEDDING_MODEL="test-model")
    def test_embed_missing_and_vector_search(self):
        ingest_markdown("ZZ", "act", "Test Act", DOC)
        fake = lambda texts: [[1.0, 0.0] if "Breaks" in t else [0.0, 1.0] for t in texts]
        with mock.patch("apps.chat.llm.embed", side_effect=fake):
            self.assertEqual(embed_missing("ZZ"), 5)
            results = search("ZZ", "Breaks", k=1)
        self.assertEqual(results[0].section_ref, "24")

    @override_settings(EMBEDDING_MODEL="test-model")
    def test_embedding_failure_falls_back_to_fulltext(self):
        ingest_markdown("ZZ", "act", "Test Act", DOC)
        LawChunk.objects.update(embedding=[1.0, 0.0])
        with mock.patch("apps.chat.llm.embed", side_effect=RuntimeError("down")):
            results = search("ZZ", "termination notice", k=1)
        self.assertEqual(results[0].section_ref, "56")


# Two pages shaped like pypdf's text from a King's Printer consolidation.
PDF_PAGES = [
    """Table of Contents
Part 1
Noise
 1 Definitions
 2 Worker exposure to noise
""",
    """   
Section 1  AR 191/2021 
 
TEST SAFETY CODE 
 
3
Part 1
Noise
Definitions
1   In this Code, “noise” means sound energy.
AR 191/2021 s1
Resolving doubts about
exposure
2(1)  An employer must ensure exposure does not exceed the limits
in Schedule 3.
(2)  Subject to section 1, this applies everywhere.
AR 191/2021 s2;242/2022
""",
    """   
Section 2  AR 191/2021 
 
TEST SAFETY CODE 
 
4
Division 2
Records
Keeping records
3   Records are kept for 2 years.
Schedules
Schedule 3
Noise
Table 1
Noise exposure limits
[ See sections 2 ]
85 8 hours
""",
]


class PdfToMarkdownTests(TestCase):
    def setUp(self):
        from .pdf import statute_to_markdown
        self.md = statute_to_markdown(PDF_PAGES, "Test Safety Code")

    def test_structure(self):
        headings = [l for l in self.md.splitlines() if l.startswith("#")]
        self.assertEqual(headings, [
            "# Test Safety Code",
            "## Part 1 — Noise",
            "#### 1 Definitions",
            "#### 2 Resolving doubts about exposure",
            "### Division 2 — Records",
            "#### 3 Keeping records",
            "## Schedule 3 — Noise",
            "#### Table 1 — Noise exposure limits",
        ])

    def test_drops_contents_page_headers_and_history(self):
        self.assertNotIn("Table of Contents", self.md)
        self.assertNotIn("TEST SAFETY CODE", self.md)
        self.assertNotIn("AR 191/2021", self.md)

    def test_chunks_and_references(self):
        chunks = chunk_markdown(self.md)
        self.assertEqual([c.section_ref for c in chunks], ["1", "2", "3", "Schedule 3"])
        self.assertEqual(find_section_refs(chunks[1].text), {"1", "Schedule 3"})

    def test_rejects_other_pdfs(self):
        from .pdf import statute_to_markdown
        with self.assertRaises(ValueError):
            statute_to_markdown(["Just a letter.\nNothing numbered here."], "Letter")


@override_settings(EMBEDDING_MODEL="")
class StatuteGraphAndRankingTests(TestCase):
    def test_schedule_links_back_and_documents_stay_separate(self):
        from .pdf import statute_to_markdown
        ingest_markdown("ZZ", "code", "Test Safety Code", statute_to_markdown(PDF_PAGES, "Test Safety Code"))
        ingest_markdown("ZZ", "act", "Test Act", DOC)  # also has sections 23, 24...
        edges = {(e.from_chunk.source.slug, e.from_chunk.section_ref, e.to_chunk.source.slug, e.to_chunk.section_ref)
                 for e in LawReference.objects.select_related("from_chunk__source", "to_chunk__source")}
        self.assertIn(("code", "2", "code", "Schedule 3"), edges)
        self.assertIn(("code", "Schedule 3", "code", "2"), edges)
        self.assertIn(("code", "2", "code", "1"), edges)
        self.assertTrue(all(a == b for a, _, b, _ in edges), "edges never cross documents")
        # Finding s. 2 brings in the table; a schedule is labelled by its heading, not "s. Schedule 3".
        prompt = system_prompt("ZZ", "exposure limits")
        self.assertIn("85 8 hours", prompt)
        self.assertNotIn("s. Schedule", prompt)

    def test_rare_terms_outrank_common_ones(self):
        # "health" and "safety" are in nearly every section, as in the real OHS Code; "noise" is in one.
        common = "\n\n".join(f"## Section {n} Health and safety committees\nHealth and safety rules." for n in range(1, 31))
        ingest_markdown("ZZ", "act", "Act", f"# Act\n\n{common}\n\n## Section 99 Noise\nNoise rules apply.\n")
        results = search("ZZ", "occupational health and safety rules about noise", k=1)
        self.assertEqual(results[0].section_ref, "99")
