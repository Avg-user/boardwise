"""Crisis detection. Runs on every user message BEFORE any model call.

Deliberately simple and over-inclusive: a false positive shows resources unnecessarily,
a false negative could miss someone in danger.
"""
import re

_PATTERNS = [
    r"\bkill(ing)? (myself|me)\b", r"\bsuicid", r"\bend (my|it all|my life)\b", r"\bwant to die\b",
    r"\bdon'?t want to (live|be alive)\b", r"\bhurt(ing)? myself\b", r"\bself[- ]harm",
    r"\bno reason to live\b", r"\bbetter off dead\b",
    r"\b(he|she|they|someone|boss|manager|coworker)( is| are|'s|'re)? (going to|gonna) (kill|hurt|attack)\b",
    r"\bthreaten(ed|ing)? to (kill|hurt)\b", r"\bin danger\b", r"\bnot safe\b", r"\bafraid for my life\b",
]
_RE = re.compile("|".join(_PATTERNS), re.IGNORECASE)

CRISIS_RESOURCES = (
    "It sounds like you may be in danger or going through something very hard. You are not alone.\n\n"
    "- If you are in immediate danger, call **911**.\n"
    "- Suicide Crisis Helpline (Canada): call or text **9-8-8**, any time.\n"
    "- Kids Help Phone: **1-800-668-6868** or text **686868**.\n\n"
    "I'm an AI assistant and can't help in an emergency, but these services have trained people available now."
)


def is_crisis(text: str) -> bool:
    return bool(_RE.search(text))
