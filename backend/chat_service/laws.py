from pathlib import Path

PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"


class ProvinceNotFound(Exception):
    pass


def get_province_laws(code: str) -> str:
    """Return the labour law text for a province. Swap this for a DB lookup later."""
    path = PROMPTS_DIR / "provinces" / f"{code}.md"
    if not path.is_file():
        raise ProvinceNotFound(code)
    return path.read_text(encoding="utf-8")
