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
