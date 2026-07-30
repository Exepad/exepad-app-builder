"""Shared pytest fixtures for Exepad Agent tests."""

import json
import os
import sys
from pathlib import Path

import pytest

# Add project root to path
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

# Add packages/schemas/scripts/py to path for direct validation imports
SCHEMAS_PY = PROJECT_ROOT.parent.parent / "packages" / "schemas" / "scripts" / "py"
sys.path.insert(0, str(SCHEMAS_PY))

# Set test environment before importing app modules
os.environ["ENVIRONMENT"] = "test"
os.environ["IS_TEST"] = "true"
# AGENT_SERVICE_URL is required when ENVIRONMENT != "development" (module-level guard
# in agent_api.py).  Provide a dummy value so the module can be imported in tests.
os.environ.setdefault("AGENT_SERVICE_URL", "https://test-agent.example.com")


# =============================================================================
# RESET MODULE STATE BETWEEN TESTS
# =============================================================================


@pytest.fixture(autouse=True)
def _reset_agent_api_state():
    """Clear process-local stores so tests don't interfere with each other."""
    yield
    try:
        import agent_api

        agent_api._rate_limit_store.clear()
        agent_api._INFLIGHT_CORRELATION_IDS.clear()
        agent_api._session_locks.clear()
    except (ImportError, AttributeError, RuntimeError):
        pass


# =============================================================================
# PATH FIXTURES
# =============================================================================


@pytest.fixture(scope="session")
def project_root() -> Path:
    """Return the project root directory."""
    return PROJECT_ROOT


@pytest.fixture(scope="session")
def schemas_dir(project_root: Path) -> Path:
    """Return the monorepo schemas data directory.

    The authoritative schema assets live in ``packages/schemas/data`` at
    the monorepo root, not inside ``main_agent/``. ``project_root`` is
    ``apps/agent``; walk up twice to reach the monorepo and into the
    packages path.
    """
    return project_root.parent.parent / "packages" / "schemas" / "data"


@pytest.fixture(scope="session")
def examples_dir(schemas_dir: Path) -> Path:
    """Return the examples directory path."""
    return schemas_dir / "examples"


# =============================================================================
# JSON SCHEMA VALIDATION FIXTURES
# =============================================================================


@pytest.fixture
def validate_config():
    """Import and return the main validation function."""
    from validation import validate_app_config

    return validate_app_config


@pytest.fixture
def load_json_file(examples_dir: Path):
    """Factory fixture to load JSON files from examples directory."""

    def _load(subdir: str, filename: str) -> dict:
        filepath = examples_dir / subdir / filename
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)

    return _load


@pytest.fixture
def sample_valid_webapp(project_root: Path) -> dict:
    """Load a known valid WebAppProps configuration.

    Uses ``tests/e2e/fixtures/app_configs/minimal_webapp.json`` which is
    maintained alongside the e2e suite as a canonical minimal-but-valid
    WebAppProps document. Preferred over the legacy
    ``main_agent/schemas/examples/full`` directory which no longer exists
    after the monorepo refactor moved schemas to ``packages/schemas``.
    """
    fixture_path = (
        project_root / "tests" / "e2e" / "fixtures" / "app_configs" / "minimal_webapp.json"
    )
    if not fixture_path.exists():
        pytest.skip(f"Minimal webapp fixture not found at {fixture_path}")

    with open(fixture_path, "r", encoding="utf-8") as fp:
        return json.load(fp)


# =============================================================================
# FASTAPI TEST CLIENT FIXTURES
# =============================================================================


@pytest.fixture
def test_client():
    """Create a FastAPI TestClient for API testing.

    Note: This may fail in environments without proper database configuration.
    Tests using this fixture will be skipped if the client can't be created.
    """
    try:
        from fastapi.testclient import TestClient
        from agent_api import app

        with TestClient(app) as client:
            yield client
    except Exception as e:
        pytest.skip(f"Could not create test client: {e}")


@pytest.fixture
def api_request_payload() -> dict:
    """Return a valid payload for the /r endpoint."""
    return {
        "operation_mode": "create",
        "user_id": "test-user-123",
        "session_id": "test-session-456",
        "payload": json.dumps(
            {
                "app_uuid": "test-app-uuid",
                "app_name": "Test App",
                "app_type": "webapp",
                "app_description": "A test application",
            }
        ),
    }


# =============================================================================
# ICON FIXTURES
# =============================================================================


@pytest.fixture(scope="session")
def valid_lucide_icons(schemas_dir: Path) -> set:
    """Load valid Lucide icon names from the catalog file."""
    icons_file = schemas_dir / "icons" / "lucide_icons.txt"
    if not icons_file.exists():
        pytest.skip("Lucide icons file not found")

    with open(icons_file, "r", encoding="utf-8") as f:
        icons = {line.strip() for line in f if line.strip()}
    return icons


@pytest.fixture
def sample_icons_set() -> set:
    """Return a minimal set of icons for testing."""
    return {
        "house",
        "user",
        "settings",
        "check",
        "x",
        "menu",
        "search",
        "mail",
        "phone",
        "star",
        "heart",
        "trash",
        "pencil",
        "eye",
        "cog",
        "arrow-right",
        "arrow-left",
        "map-pin",
        "circle-help",
        "triangle-alert",
    }


# =============================================================================
# APP CONFIG FIXTURES FOR HELPER TESTS
# =============================================================================


@pytest.fixture
def minimal_app_config() -> dict:
    """Return a minimal app config structure for testing."""
    return {
        "uuid": "app-001",
        "appType": "WebAppProps",
        "name": "Test App",
        "frontend": {
            "pages": [
                {
                    "uuid": "page-home",
                    "slug": "/",
                    "title": "Home",
                    "pageType": "WebPageProps",
                    "content": [
                        {
                            "uuid": "section-hero",
                            "componentType": "SectionProps",
                            "sectionSlug": "hero",
                            "content": [
                                {
                                    "uuid": "heading-main",
                                    "componentType": "HeadingProps",
                                    "text": "Welcome",
                                }
                            ],
                        }
                    ],
                },
                {
                    "uuid": "page-about",
                    "slug": "/about",
                    "title": "About Us",
                    "pageType": "WebPageProps",
                    "content": [],
                },
            ],
            "header": [
                {
                    "uuid": "navbar-main",
                    "componentType": "NavbarProps",
                    "logo": {
                        "uuid": "logo-main",
                        "componentType": "NavbarLogoProps",
                        "text": "MyApp",
                    },
                    "content": [
                        {
                            "uuid": "nav-link-home",
                            "componentType": "MenuLinkItemProps",
                            "label": "Home",
                            "href": {
                                "uuid": "nav-link-home-href",
                                "componentType": "LinkProps",
                                "href": "/",
                                "text": "Home",
                            },
                        }
                    ],
                }
            ],
            "footer": [
                {
                    "uuid": "footer-main",
                    "componentType": "SectionProps",
                    "content": [],
                }
            ],
        },
    }


@pytest.fixture
def app_config_with_links() -> dict:
    """Return an app config with various link types for testing."""
    return {
        "uuid": "app-links",
        "frontend": {
            "pages": [
                {
                    "uuid": "page-001",
                    "slug": "/",
                    "title": "Home",
                    "pageType": "WebPageProps",
                    "content": [
                        {
                            "uuid": "section-001",
                            "componentType": "SectionProps",
                            "sectionSlug": "features",
                            "content": [
                                {
                                    "uuid": "link-001",
                                    "componentType": "LinkProps",
                                    "href": "/about",
                                    "text": "About Us",
                                },
                                {
                                    "uuid": "link-002",
                                    "componentType": "LinkProps",
                                    "href": "https://example.com/external",
                                    "text": "External Link",
                                },
                            ],
                        }
                    ],
                },
                {
                    "uuid": "page-002",
                    "slug": "/about",
                    "title": "About",
                    "pageType": "WebPageProps",
                    "content": [],
                },
            ],
            "header": [],
            "footer": [],
        },
    }


# =============================================================================
# CONTENT CATALOG FIXTURES
# =============================================================================


@pytest.fixture
def sample_document_catalog() -> list:
    """Sample document catalog for testing content handling.

    Contains:
    - A small document (5000 chars) that should become an artifact
    - A large document (100000 chars) that should use Vertex AI Search
    """
    return [
        {
            "uuid": "doc-uuid-1",
            "source_name": "product-spec.pdf",
            "summary": "Product specification document describing features and requirements",
            "content_url": "https://storage.example.com/docs/product-spec.md",
            "characters_count": 5000,
            "content_hash": "abc123def456",
        },
        {
            "uuid": "doc-uuid-2",
            "source_name": "large-manual.pdf",
            "summary": "Large user manual with detailed instructions",
            "content_url": "https://storage.example.com/docs/manual.md",
            "characters_count": 100000,  # Large document - exceeds DOCUMENT_MAX_SIZE_CHARS
            "content_hash": "xyz789ghi012",
        },
        {
            "uuid": "doc-uuid-3",
            "source_name": "uploads/company-profile.docx",
            "summary": "Company profile with mission and vision",
            "content_url": "https://storage.example.com/docs/company-profile.md",
            "characters_count": 3000,
            "content_hash": "def456abc789",
        },
    ]


@pytest.fixture
def sample_image_catalog() -> list:
    """Sample image catalog for testing content handling.

    Contains:
    - A logo image (is_logo=True)
    - A hero image (uploaded)
    - An extracted image from document
    """
    return [
        {
            "uuid": "img-uuid-1",
            "source_name": "company-logo.png",
            "description": "Company logo with blue background and modern typography",
            "url": "https://storage.example.com/images/logo.png",
            "is_logo": True,
            "source_type": "uploaded",
        },
        {
            "uuid": "img-uuid-2",
            "source_name": "hero-image.jpg",
            "description": "Hero banner showing team collaboration in modern office",
            "url": "https://storage.example.com/images/hero.jpg",
            "is_logo": False,
            "source_type": "uploaded",
        },
        {
            "uuid": "img-uuid-3",
            "source_name": "product-screenshot.png",
            "description": "Screenshot of the product dashboard with analytics",
            "url": "https://storage.example.com/images/screenshot.png",
            "is_logo": False,
            "source_type": "extracted",
        },
    ]


@pytest.fixture
def empty_document_catalog() -> list:
    """Empty document catalog for testing no-content scenarios."""
    return []


@pytest.fixture
def empty_image_catalog() -> list:
    """Empty image catalog for testing no-content scenarios."""
    return []


@pytest.fixture
def validate_backend():
    """Import and return the backend validation function."""
    from validation import validate_backend_props

    return validate_backend_props


@pytest.fixture(scope="session")
def e2e_fixture_configs_dir() -> Path:
    """Return the E2E fixture app configs directory."""
    return Path(__file__).parent / "e2e" / "fixtures" / "app_configs"


@pytest.fixture
def app_config_with_images() -> dict:
    """Return an app config with ImageProps components for testing."""
    return {
        "uuid": "app-images",
        "frontend": {
            "pages": [
                {
                    "uuid": "page-001",
                    "slug": "/",
                    "title": "Home",
                    "pageType": "WebPageProps",
                    "content": [
                        {
                            "uuid": "section-001",
                            "componentType": "SectionProps",
                            "sectionSlug": "hero",
                            "content": [
                                {
                                    "uuid": "image-001",
                                    "componentType": "ImageProps",
                                    "src": "",
                                    "alt": "Hero Image",
                                    "asset": {
                                        "keywords": "hero, team, collaboration",
                                    },
                                },
                                {
                                    "uuid": "image-002",
                                    "componentType": "ImageProps",
                                    "src": "",
                                    "alt": "Logo",
                                    "asset": {
                                        "providerImgId": "img-uuid-1",  # Explicit UUID reference
                                    },
                                },
                            ],
                        }
                    ],
                },
            ],
            "header": [],
            "footer": [],
        },
    }
