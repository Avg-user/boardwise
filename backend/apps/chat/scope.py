"""Off-topic handling, in three layers:

1. Before any model call, `is_off_topic_request` blocks obvious off-topic requests (asking for code,
   bare arithmetic). Deterministic and free. Messages that mention work are let through, so
   "my boss makes me write code after hours" still reaches the model.
2. The system prompt tells the model to reply with OFF_TOPIC_MARKER only for off-topic requests.
3. Because small models don't always comply, `is_off_topic` also checks the reply without a model:
   a reply that contains code, or offers to write code, is refused. The assistant never needs code.

In every case the backend swaps in fixed wording, so refusals are consistent and never half-answer.
"""
import re
OFF_TOPIC_MARKER = "[OFF_TOPIC]"

REFUSALS = {
    "en": (
        "I can only help with workplace issues, such as harassment, safety, your rights at work, "
        "documenting what happened and finding the right people to talk to. Is there something "
        "about your work situation I can help with?"
    ),
    "fr": (
        "Je peux seulement vous aider avec des questions liées au travail, comme le harcèlement, "
        "la sécurité, vos droits au travail, la documentation de ce qui s'est passé et les personnes "
        "à contacter. Y a-t-il quelque chose concernant votre situation au travail pour laquelle je peux vous aider?"
    ),
}


_CODE_LINE = re.compile(
    r"^\s*(def |class |import |from \S+ import |function |const |let |var |#include|public |private |"
    r"SELECT |INSERT |for \(|for \w+ in |while |if \(|print\(|console\.log|return |=>|\}\s*$)",
    re.MULTILINE,
)


def contains_code(reply: str) -> bool:
    return "```" in reply or len(_CODE_LINE.findall(reply)) >= 3


_LANGS = r"(python|javascript|typescript|java|c\+\+|c#|golang|rust|php|ruby|sql|html|css|bash|regex|excel formula)"
_CODE_NOUN = rf"({_LANGS}|code|program|programme|script|function|algorithm|app|website)"
_CODE_REQUEST = re.compile(
    rf"\b(write|create|make|build|generate|give me|show me|code|debug|fix|explain|help me with|teach me)\b"
    rf".{{0,40}}\b{_CODE_NOUN}s?\b|\b{_LANGS}\b.{{0,20}}\b(program|code|script)\b",
    re.IGNORECASE,
)
_ARITHMETIC = re.compile(
    r"^\s*(what('?s| is)|calculate|compute|solve)?\s*[\d\s+\-*/x×÷().^=%]+\??\s*$", re.IGNORECASE
)
# Words that mean the message is about the user's work, so it is never blocked before the model.
_WORKPLACE = re.compile(
    r"\b(boss|manager|supervisor|employer|cowork\w*|colleague|work(ing|ed|place)?|job|shift|overtime|"
    r"pa(y|id)|wage|salary|fired|terminat\w*|harass\w*|bull(y|ied|ying)|discriminat\w*|unsafe|injur\w*|"
    r"hr|union|complaint|case|incident|patron|travail\w*|emploi\w*|harc[eè]lement|coll[eè]gue|"
    r"law|laws|legal|regulations?|rights?|ohs|osha|wcb|safety|noise|minimum wage|break|leave|vacation|"
    r"holiday|contract|benefits?|loi|droits?|r[eè]glement\w*|s[eé]curit[eé]|salaire)\b",
    re.IGNORECASE,
)
# A reply that offers to write code, even without any code in it yet. Kept narrow on purpose:
# legal replies say "the Employment Standards Code" or "code of conduct", which must never match.
_CODE_OFFER = re.compile(
    rf"\b(write|provide|give|share|create|send)( you)? (the|a|some|this|that|your)( {_LANGS})? "
    # Lowercase only: a capitalised "Code" is the name of a law ("the Code", "Human Rights Code").
    rf"(?-i:code|program|script|snippet)\b(?! of\b)|\b{_LANGS} (?-i:program|code|script|snippet)\b",
    re.IGNORECASE,
)


def is_workplace_related(message: str) -> bool:
    """True when a message clearly mentions work or workplace law."""
    return bool(_WORKPLACE.search(message))


def is_off_topic_request(message: str) -> bool:
    """Checked BEFORE the model. Errs towards letting messages through; the reply check is the backstop."""
    if is_workplace_related(message):
        return False
    return bool(_CODE_REQUEST.search(message) or _ARITHMETIC.match(message))


def is_off_topic(reply: str) -> bool:
    """Checked AFTER the model. Small models sometimes wrap the marker in quotes or add text after it."""
    return OFF_TOPIC_MARKER in reply or contains_code(reply) or bool(_CODE_OFFER.search(reply))


def refusal(language_code: str) -> str:
    return REFUSALS.get(language_code, REFUSALS["en"])
