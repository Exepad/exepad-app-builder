"""
Agent Documentation Loader Utility.

Provides functions to load documentation files from packages/schemas/data/agent_docs/
and inject them into agent instruction providers.

Documentation files are loaded once and cached in memory using lru_cache
to avoid repeated file I/O during agent execution.

The ``InstructionBuilder`` helper enables *conditional* instruction assembly
so that large reference docs are only included when the request warrants them.
"""

from pathlib import Path
from functools import lru_cache
from typing import List
import structlog

logger = structlog.get_logger(__name__)

# Path to agent documentation directory (shared package: packages/schemas/data/agent_docs/)
AGENT_DOCS_DIR = (
    Path(__file__).resolve().parent.parent.parent.parent.parent.parent
    / "packages"
    / "schemas"
    / "data"
    / "agent_docs"
)


@lru_cache(maxsize=32)
def load_agent_doc(doc_name: str) -> str:
    """
    Load a documentation file by name. Results are cached in memory.

    Args:
        doc_name: Name of the documentation file (e.g., "00_PLATFORM_GUIDE.md")

    Returns:
        Contents of the documentation file as a string

    Raises:
        FileNotFoundError: If the documentation file does not exist
    """
    doc_path = AGENT_DOCS_DIR / doc_name
    if not doc_path.exists():
        logger.error(f"Agent doc not found: {doc_name}", path=str(doc_path))
        raise FileNotFoundError(f"Agent doc not found: {doc_name}")

    content = doc_path.read_text(encoding="utf-8")
    logger.debug(f"Loaded agent doc: {doc_name}", size=len(content))
    return content


def load_agent_docs(doc_names: List[str]) -> str:
    """
    Load multiple documentation files and concatenate with separators.

    Args:
        doc_names: List of documentation file names to load

    Returns:
        Concatenated documentation content with clear separators
    """
    sections = []
    for name in doc_names:
        content = load_agent_doc(name)
        sections.append(f"# Reference: {name}\n\n{content}")
    return "\n\n---\n\n".join(sections)


def clear_doc_cache() -> None:
    """
    Clear the documentation cache. Useful for testing or when docs are updated.
    """
    load_agent_doc.cache_clear()
    logger.info("Agent documentation cache cleared")


# ---------------------------------------------------------------------------
# InstructionBuilder — conditional instruction assembly
# ---------------------------------------------------------------------------


class InstructionBuilder:
    """Assemble agent instructions from named sections, optionally loading docs.

    Usage inside an instruction_provider callable::

        def my_instruction_provider(ctx: ReadonlyContext) -> str:
            backend_type = ctx.session.state.get("backend_type", "none")
            has_backend = backend_type == "dynamic"
            return (
                InstructionBuilder()
                .add("You are MyAgent.")
                .add_doc("planner/docs/00_PLATFORM_GUIDE.md")
                .add_doc_if(has_backend, "backend/docs/BACKEND_MODELS_CONFIG.md")
                .add_section_if(has_backend, "## Backend Rules\\n...")
                .build()
            )
    """

    def __init__(self) -> None:
        self._sections: list[str] = []

    # --- unconditional -------------------------------------------------

    def add(self, text: str) -> "InstructionBuilder":
        """Append a raw instruction block."""
        self._sections.append(text)
        return self

    def add_doc(self, doc_name: str) -> "InstructionBuilder":
        """Load and append a documentation file (cached)."""
        self._sections.append(load_agent_doc(doc_name))
        return self

    # --- conditional ---------------------------------------------------

    def add_if(self, condition: bool, text: str) -> "InstructionBuilder":
        """Append *text* only when *condition* is truthy."""
        if condition:
            self._sections.append(text)
        return self

    def add_doc_if(self, condition: bool, doc_name: str) -> "InstructionBuilder":
        """Load and append a doc file only when *condition* is truthy."""
        if condition:
            self._sections.append(load_agent_doc(doc_name))
        return self

    # keep old name as an alias
    add_section_if = add_if

    # --- build ---------------------------------------------------------

    def build(self, separator: str = "\n\n") -> str:
        """Concatenate all accumulated sections."""
        return separator.join(self._sections)


# ---------------------------------------------------------------------------
# App-type document mapping
# ---------------------------------------------------------------------------

APP_TYPE_DOC_MAP: dict[str, str] = {
    "website": "planner/docs/05_APP_TYPE_WEBSITE.md",
    "form": "planner/docs/05_APP_TYPE_FORM.md",
    "dataapp": "planner/docs/05_APP_TYPE_DATAAPP.md",
    "custom": "planner/docs/05_APP_TYPE_CUSTOM.md",
}


def get_app_type_doc(app_type: str) -> str:
    """Return the doc filename for an app type, defaulting to website.

    Args:
        app_type: The app type string (e.g., "website", "form", "dataapp", "custom")

    Returns:
        Documentation filename for the given app type
    """
    doc = APP_TYPE_DOC_MAP.get(app_type)
    if doc is None:
        logger.warning(f"Unknown app_type '{app_type}', falling back to website doc")
        return "planner/docs/05_APP_TYPE_WEBSITE.md"
    return doc
