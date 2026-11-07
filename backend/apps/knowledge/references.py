"""Find cross-references like "subject to section 23" or "ss. 56 and 57" in law text."""
import re

_REF = re.compile(
    r"\b(?:sections?|ss?\.)\s*(\d+(?:\.\d+)?(?:\(\w+\))*(?:\s*(?:,|and|or|to)\s*\d+(?:\.\d+)?(?:\(\w+\))*)*)",
    re.IGNORECASE,
)
_NUM = re.compile(r"\d+(?:\.\d+)?(?:\(\w+\))*")


def find_section_refs(text: str) -> set[str]:
    refs = set()
    for m in _REF.finditer(text):
        for num in _NUM.findall(m.group(1)):
            refs.add(num)
            refs.add(num.split("(")[0])  # "56(1)" also matches section "56"
    return refs
