"""Off-topic handling, in two layers:

1. The system prompt tells the model to reply with OFF_TOPIC_MARKER only for off-topic requests.
2. Because small models don't always comply, replies are also checked here without a model:
   a reply that contains code is refused. The assistant never needs to send code.

Either way the backend swaps in fixed wording, so refusals are consistent and never half-answer.
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


def is_off_topic(reply: str) -> bool:
    # Small models sometimes wrap the marker in quotes/backticks or add text after it.
    return OFF_TOPIC_MARKER in reply or contains_code(reply)


def refusal(language_code: str) -> str:
    return REFUSALS.get(language_code, REFUSALS["en"])
