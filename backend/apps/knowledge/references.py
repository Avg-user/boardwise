"""Find cross-references like "subject to section 23", "ss. 56 and 57" or "Schedule 3" in law text."""
import re

_REF = re.compile(
    r"\b(?:sections?|ss?\.)\s*(\d+(?:\.\d+)?(?:\(\w+\))*(?:\s*(?:,|and|or|to)\s*\d+(?:\.\d+)?(?:\(\w+\))*)*)",
    re.IGNORECASE,
)
_NUM = re.compile(r"\d+(?:\.\d+)?(?:\(\w+\))*")
_SCHEDULE = re.compile(r"\bSchedule\s+(\d+)\b")


def find_section_refs(text: str) -> set[str]:
    refs = set()
    for m in _REF.finditer(text):
        for num in _NUM.findall(m.group(1)):
            refs.add(num)
            refs.add(num.split("(")[0])  # "56(1)" also matches section "56"
    refs.update(f"Schedule {n}" for n in _SCHEDULE.findall(text))
    return refs
