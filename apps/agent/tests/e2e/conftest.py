"""E2E test fixtures for /r endpoint testing.

This module provides fixtures specific to end-to-end testing of the
agent endpoint, including payload factories and app config fixtures.

Tests require a running server (start with: python agent_api.py)
and use httpx for true async HTTP streaming.
"""

import json
import os
import uuid
from typing import Any, Callable, Dict, Optional

import httpx
import pytest
import pytest_asyncio

# Import fixtures loader

# =============================================================================
# SERVER CONFIGURATION
# =============================================================================

# Default server URL - can be overridden with E2E_SERVER_URL env var
DEFAULT_SERVER_URL = "http://localhost:8080"

# Default timeout for streaming requests (10 minutes for long-running workflows)
DEFAULT_TIMEOUT = 600.0


# =============================================================================
# TEST CLIENT FIXTURES
# =============================================================================


@pytest.fixture(scope="session")
def server_url() -> str:
    """Get the base URL for the running server.

    The URL can be configured via the E2E_SERVER_URL environment variable.
    Defaults to http://localhost:8080.

    Returns:
        str: The server base URL
    """
    return os.getenv("E2E_SERVER_URL", DEFAULT_SERVER_URL)


@pytest_asyncio.fixture(scope="session")
async def e2e_client(server_url: str):
    """Create an async httpx client for E2E testing.

    This fixture creates an async HTTP client that connects to a
    running server instance. The server must be started separately
    before running tests.

    Usage:
        # Start server in terminal 1:
        python agent_api.py

        # Run tests in terminal 2:
        pytest tests/e2e/ -v

    Yields:
        httpx.AsyncClient: A configured async HTTP client

    Note:
        Tests will be skipped if the server is not running.
    """
    # Configure timeout with explicit read timeout for SSE streaming
    # - connect: 10s for initial connection
    # - read: None (no timeout) for streaming - server controls when to close
    # - write: 30s for sending request
    # - pool: 10s for acquiring connection from pool
    timeout = httpx.Timeout(
        connect=10.0,
        read=None,  # No read timeout - SSE streams can be long-running
        write=30.0,
        pool=10.0,
    )

    async with httpx.AsyncClient(
        base_url=server_url,
        timeout=timeout,
    ) as client:
        # Verify server is running with health check
        try:
            response = await client.get("/health", timeout=10.0)
            response.raise_for_status()
        except httpx.ConnectError:
            pytest.skip(
                f"Server not running at {server_url}. " "Start the server with: python agent_api.py"
            )
        except httpx.HTTPStatusError as e:
            pytest.skip(f"Server health check failed: {e}")
        except Exception as e:
            pytest.skip(f"Could not connect to server at {server_url}: {e}")

        yield client


# =============================================================================
# SESSION FIXTURES
# =============================================================================


@pytest.fixture
def unique_session() -> Dict[str, str]:
    """Generate unique user_id and session_id for test isolation.

    Each test gets its own unique session identifiers to ensure
    complete isolation between tests.

    Returns:
        Dict with user_id and session_id keys
    """
    return {
        "user_id": f"test-user-{uuid.uuid4().hex[:12]}",
        "session_id": f"test-session-{uuid.uuid4().hex[:12]}",
    }


@pytest.fixture
def app_uuid() -> str:
    """Generate a unique app UUID for testing.

    Returns:
        A valid UUID string
    """
    return str(uuid.uuid4())


# =============================================================================
# PAYLOAD FACTORY FIXTURES
# =============================================================================


@pytest.fixture
def creation_payload_factory(unique_session) -> Callable[..., Dict[str, Any]]:
    """Factory fixture for creating creation mode payloads.

    Usage:
        payload = creation_payload_factory(
            app_name="My App",
            app_type="website",
            description="A simple website"
        )

        # With user content catalogs:
        payload = creation_payload_factory(
            app_name="My App",
            app_type="website",
            description="A website using @logo.png",
            document_catalog=[...],
            image_catalog=[...],
        )

    Returns:
        A callable that creates properly formatted payloads
    """

    def _create(
        app_name: str,
        app_type: str = "website",
        description: str = "",
        app_language_code: str = "en",
        document_catalog: Optional[list] = None,
        image_catalog: Optional[list] = None,
        **extra_payload_fields,
    ) -> Dict[str, Any]:
        """Create a creation mode payload.

        Args:
            app_name: Name of the app to create
            app_type: Type of app (website, form, dataapp, custom)
            description: Description/prompt for app creation
            app_language_code: Language code (default: en)
            document_catalog: List of document catalog entries (optional)
            image_catalog: List of image catalog entries (optional)
            **extra_payload_fields: Additional fields to include in payload

        Returns:
            Complete payload dict ready for /r endpoint
        """
        payload_data = {
            "app_name": app_name,
            "app_type": app_type,
            "app_language_code": app_language_code,
            "initial_description": description,
            "current_prompt": description,
            # Include app_uuid and correlation_id for backend notification compatibility
            "app_uuid": str(uuid.uuid4()),
            "correlation_id": str(uuid.uuid4()),
            # Test mode: emit backend_response via SSE instead of HTTP POST
            "is_test": True,
            **extra_payload_fields,
        }

        # Add content catalogs if provided
        if document_catalog is not None:
            payload_data["document_catalog"] = document_catalog
        if image_catalog is not None:
            payload_data["image_catalog"] = image_catalog

        return {
            "operation_mode": "create",
            "user_id": unique_session["user_id"],
            "session_id": unique_session["session_id"],
            "payload": json.dumps(payload_data),
        }

    return _create


@pytest.fixture
def edit_payload_factory(unique_session, app_uuid) -> Callable[..., Dict[str, Any]]:
    """Factory fixture for creating edit mode payloads.

    Usage:
        payload = edit_payload_factory(
            app_config=my_config,
            prompt="Change the heading color to blue"
        )

        # With user content catalogs:
        payload = edit_payload_factory(
            app_config=my_config,
            prompt="Use @logo.png in the header",
            image_catalog=[...],
        )

    Returns:
        A callable that creates properly formatted edit payloads
    """

    def _create(
        app_config: Dict[str, Any],
        prompt: str,
        selected_component: Optional[str] = None,
        current_page_uuid: Optional[str] = None,
        action_label: Optional[str] = None,
        action_payload: Optional[str] = None,
        app_language_code: str = "en",
        chat_history: Optional[list] = None,
        document_catalog: Optional[list] = None,
        image_catalog: Optional[list] = None,
        **extra_payload_fields,
    ) -> Dict[str, Any]:
        """Create an edit mode payload.

        Args:
            app_config: The current app configuration dict
            prompt: The user's edit request
            selected_component: UUID of selected component (optional)
            current_page_uuid: UUID of current page (optional)
            action_label: Direct action label (optional)
            action_payload: Payload for direct action (optional)
            app_language_code: Language code (default: en)
            chat_history: Previous chat messages (optional)
            document_catalog: List of document catalog entries (optional)
            image_catalog: List of image catalog entries (optional)
            **extra_payload_fields: Additional fields to include

        Returns:
            Complete payload dict ready for /r endpoint
        """
        # Get app name from config or use default
        app_name = app_config.get("name", "Test App")

        payload_data = {
            "app_config": json.dumps(app_config, separators=(",", ":"), ensure_ascii=False),
            "app_uuid": app_uuid,
            "app_name": app_name,
            "app_language_code": app_language_code,
            "current_prompt": prompt,
            "chat_history": chat_history or [],
            # Test mode: emit backend_response via SSE instead of HTTP POST
            "is_test": True,
            **extra_payload_fields,
        }

        if selected_component:
            payload_data["selected_component"] = selected_component
        if current_page_uuid:
            payload_data["current_page_uuid"] = current_page_uuid
        if action_label:
            payload_data["action_label"] = action_label
        if action_payload:
            payload_data["action_payload"] = action_payload

        # Add content catalogs if provided
        if document_catalog is not None:
            payload_data["document_catalog"] = document_catalog
        if image_catalog is not None:
            payload_data["image_catalog"] = image_catalog

        return {
            "operation_mode": "edit",
            "user_id": unique_session["user_id"],
            "session_id": unique_session["session_id"],
            "payload": json.dumps(payload_data),
        }

    return _create


@pytest.fixture
def direct_action_payload_factory(unique_session, app_uuid) -> Callable[..., Dict[str, Any]]:
    """Factory for creating direct action payloads.

    Direct actions bypass the help desk routing and go directly
    to specific workflow branches.

    Usage:
        payload = direct_action_payload_factory(
            app_config=my_config,
            action_label="add_contact_info",
            action_payload=""
        )
    """

    def _create(
        app_config: Dict[str, Any],
        action_label: str,
        action_payload: str = "",
        prompt: str = "",
        app_language_code: str = "en",
        **extra_payload_fields,
    ) -> Dict[str, Any]:
        """Create a direct action payload.

        Args:
            app_config: The current app configuration
            action_label: The direct action to perform
            action_payload: Payload for the action
            prompt: Optional user prompt
            app_language_code: Language code

        Returns:
            Complete payload dict for /r endpoint
        """
        app_name = app_config.get("name", "Test App")

        payload_data = {
            "app_config": json.dumps(app_config, separators=(",", ":"), ensure_ascii=False),
            "app_uuid": app_uuid,
            "app_name": app_name,
            "app_language_code": app_language_code,
            "current_prompt": prompt,
            "action_label": action_label,
            "action_payload": action_payload,
            # Test mode: emit backend_response via SSE instead of HTTP POST
            "is_test": True,
            **extra_payload_fields,
        }

        return {
            "operation_mode": "edit",
            "user_id": unique_session["user_id"],
            "session_id": unique_session["session_id"],
            "payload": json.dumps(payload_data),
        }

    return _create


# =============================================================================
# APP CONFIG FIXTURES
# =============================================================================


@pytest.fixture
def minimal_webapp_config() -> Dict[str, Any]:
    """Return a minimal webapp configuration for testing.

    This is the simplest valid app config with a single empty page.
    """
    home_page_uuid = str(uuid.uuid4())
    return {
        "appType": "WebAppProps",
        "uuid": str(uuid.uuid4()),
        "version": "1.0.0",
        "appSecondaryType": "website",
        "name": "Test App",
        "alias": "test-app",
        "summary": "A test application for E2E testing",
        "shortSummary": "Test app for E2E testing",
        "lastUpdatedEpoch": 1730764800,
        "frontend": {
            "languages": [
                {
                    "code": "en",
                    "nameEnglish": "English",
                    "nameNative": "English",
                    "isDefault": True,
                }
            ],
            "layout": "boxed",
            "menuPosition": "HeaderMenuTop",
            "sidebar": [],
            "pages": [
                {
                    "uuid": home_page_uuid,
                    "slug": "/",
                    "title": "Home",
                    "pageType": "WebPageProps",
                    "content": [],
                    "summary": "Home page of the test application",
                    "shortSummary": "Home page",
                    "lastUpdatedEpoch": 1730764800,
                }
            ],
            "header": [],
            "footer": [],
            "theme": {
                "light": {
                    "background": "#ffffff",
                    "foreground": "#0f172a",
                    "primary": "#1d4ed8",
                    "primary-foreground": "#ffffff",
                    "secondary": "#475569",
                    "secondary-foreground": "#ffffff",
                    "muted": "#f1f5f9",
                    "muted-foreground": "#64748b",
                    "accent": "#f1f5f9",
                    "accent-foreground": "#0f172a",
                    "destructive": "#dc2626",
                    "destructive-foreground": "#ffffff",
                    "border": "#e2e8f0",
                    "input": "#e2e8f0",
                    "ring": "#1d4ed8",
                },
                "dark": {
                    "background": "#0f172a",
                    "foreground": "#f8fafc",
                    "primary": "#3b82f6",
                    "primary-foreground": "#0f172a",
                    "secondary": "#64748b",
                    "secondary-foreground": "#f8fafc",
                    "muted": "#1e293b",
                    "muted-foreground": "#94a3b8",
                    "accent": "#1e293b",
                    "accent-foreground": "#f8fafc",
                    "destructive": "#ef4444",
                    "destructive-foreground": "#ffffff",
                    "border": "#1e293b",
                    "input": "#1e293b",
                    "ring": "#3b82f6",
                },
            },
        },
    }


@pytest.fixture
def webapp_with_sections_config() -> Dict[str, Any]:
    """Return a webapp config with sections for testing quick actions."""
    app_uuid = str(uuid.uuid4())
    home_page_uuid = str(uuid.uuid4())
    section_uuid = str(uuid.uuid4())
    heading_uuid = str(uuid.uuid4())

    return {
        "appType": "WebAppProps",
        "uuid": app_uuid,
        "version": "1.0.0",
        "appSecondaryType": "website",
        "name": "Test App with Sections",
        "alias": "test-app-sections",
        "summary": "A test application with sections for E2E testing",
        "shortSummary": "Test app with sections",
        "lastUpdatedEpoch": 1730764800,
        "frontend": {
            "languages": [
                {
                    "code": "en",
                    "nameEnglish": "English",
                    "nameNative": "English",
                    "isDefault": True,
                }
            ],
            "layout": "boxed",
            "menuPosition": "HeaderMenuTop",
            "sidebar": [],
            "pages": [
                {
                    "uuid": home_page_uuid,
                    "slug": "/",
                    "title": "Home",
                    "pageType": "WebPageProps",
                    "content": [
                        {
                            "uuid": section_uuid,
                            "componentType": "SectionProps",
                            "sectionSlug": "hero",
                            "content": [
                                {
                                    "uuid": heading_uuid,
                                    "componentType": "HeadingProps",
                                    "text": "Welcome to Our Website",
                                    "level": "h1",
                                }
                            ],
                        }
                    ],
                    "summary": "Home page with hero section",
                    "shortSummary": "Home page",
                    "lastUpdatedEpoch": 1730764800,
                }
            ],
            "header": [
                {
                    "uuid": str(uuid.uuid4()),
                    "componentType": "NavbarProps",
                    "logo": {
                        "uuid": str(uuid.uuid4()),
                        "componentType": "NavbarLogoProps",
                        "text": "TestApp",
                    },
                    "content": [
                        {
                            "uuid": str(uuid.uuid4()),
                            "componentType": "MenuLinkItemProps",
                            "label": "Home",
                            "href": {
                                "uuid": str(uuid.uuid4()),
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
                    "uuid": str(uuid.uuid4()),
                    "componentType": "SectionProps",
                    "content": [
                        {
                            "uuid": str(uuid.uuid4()),
                            "componentType": "TextProps",
                            "text": "© 2024 Test App",
                        }
                    ],
                }
            ],
            "theme": {
                "light": {
                    "background": "#ffffff",
                    "foreground": "#0f172a",
                    "primary": "#1d4ed8",
                    "primary-foreground": "#ffffff",
                    "secondary": "#475569",
                    "secondary-foreground": "#ffffff",
                    "muted": "#f1f5f9",
                    "muted-foreground": "#64748b",
                    "accent": "#f1f5f9",
                    "accent-foreground": "#0f172a",
                    "destructive": "#dc2626",
                    "destructive-foreground": "#ffffff",
                    "border": "#e2e8f0",
                    "input": "#e2e8f0",
                    "ring": "#1d4ed8",
                },
                "dark": {
                    "background": "#0f172a",
                    "foreground": "#f8fafc",
                    "primary": "#3b82f6",
                    "primary-foreground": "#0f172a",
                    "secondary": "#64748b",
                    "secondary-foreground": "#f8fafc",
                    "muted": "#1e293b",
                    "muted-foreground": "#94a3b8",
                    "accent": "#1e293b",
                    "accent-foreground": "#f8fafc",
                    "destructive": "#ef4444",
                    "destructive-foreground": "#ffffff",
                    "border": "#1e293b",
                    "input": "#1e293b",
                    "ring": "#3b82f6",
                },
            },
        },
    }


@pytest.fixture
def webapp_with_blog_config() -> Dict[str, Any]:
    """Return a webapp config with blog enabled."""
    app_uuid = str(uuid.uuid4())
    home_page_uuid = str(uuid.uuid4())
    blog_main_uuid = str(uuid.uuid4())

    return {
        "appType": "WebAppProps",
        "uuid": app_uuid,
        "version": "1.0.0",
        "appSecondaryType": "website",
        "name": "Test Blog App",
        "alias": "test-blog-app",
        "summary": "A test blog application for E2E testing",
        "shortSummary": "Test blog app",
        "lastUpdatedEpoch": 1730764800,
        "frontend": {
            "languages": [
                {
                    "code": "en",
                    "nameEnglish": "English",
                    "nameNative": "English",
                    "isDefault": True,
                }
            ],
            "layout": "boxed",
            "menuPosition": "HeaderMenuTop",
            "sidebar": [],
            "pages": [
                {
                    "uuid": home_page_uuid,
                    "slug": "/",
                    "title": "Home",
                    "pageType": "WebPageProps",
                    "content": [],
                    "summary": "Home page of the blog application",
                    "shortSummary": "Home page",
                    "lastUpdatedEpoch": 1730764800,
                },
                {
                    "uuid": blog_main_uuid,
                    "slug": "/blog",
                    "title": "Blog",
                    "pageType": "BlogMainPageProps",
                    "content": [],
                    "summary": "Blog listing page with all posts",
                    "shortSummary": "Blog listing",
                    "lastUpdatedEpoch": 1730764800,
                },
            ],
            "header": [
                {
                    "uuid": str(uuid.uuid4()),
                    "componentType": "NavbarProps",
                    "logo": {
                        "uuid": str(uuid.uuid4()),
                        "componentType": "NavbarLogoProps",
                        "text": "Blog App",
                    },
                    "content": [
                        {
                            "uuid": str(uuid.uuid4()),
                            "componentType": "MenuLinkItemProps",
                            "label": "Home",
                            "href": {
                                "uuid": str(uuid.uuid4()),
                                "componentType": "LinkProps",
                                "href": "/",
                                "text": "Home",
                            },
                        },
                        {
                            "uuid": str(uuid.uuid4()),
                            "componentType": "MenuLinkItemProps",
                            "label": "Blog",
                            "href": {
                                "uuid": str(uuid.uuid4()),
                                "componentType": "LinkProps",
                                "href": "/blog",
                                "text": "Blog",
                            },
                        },
                    ],
                }
            ],
            "footer": [],
            "theme": {
                "light": {
                    "background": "#ffffff",
                    "foreground": "#0f172a",
                    "primary": "#1d4ed8",
                    "primary-foreground": "#ffffff",
                    "secondary": "#475569",
                    "secondary-foreground": "#ffffff",
                    "muted": "#f1f5f9",
                    "muted-foreground": "#64748b",
                    "accent": "#f1f5f9",
                    "accent-foreground": "#0f172a",
                    "destructive": "#dc2626",
                    "destructive-foreground": "#ffffff",
                    "border": "#e2e8f0",
                    "input": "#e2e8f0",
                    "ring": "#1d4ed8",
                },
                "dark": {
                    "background": "#0f172a",
                    "foreground": "#f8fafc",
                    "primary": "#3b82f6",
                    "primary-foreground": "#0f172a",
                    "secondary": "#64748b",
                    "secondary-foreground": "#f8fafc",
                    "muted": "#1e293b",
                    "muted-foreground": "#94a3b8",
                    "accent": "#1e293b",
                    "accent-foreground": "#f8fafc",
                    "destructive": "#ef4444",
                    "destructive-foreground": "#ffffff",
                    "border": "#1e293b",
                    "input": "#1e293b",
                    "ring": "#3b82f6",
                },
            },
        },
    }


@pytest.fixture
def webapp_with_blog_posts_config(webapp_with_blog_config) -> Dict[str, Any]:
    """Return a webapp config with blog and existing blog posts."""
    config = webapp_with_blog_config.copy()
    config["frontend"] = config["frontend"].copy()
    config["frontend"]["pages"] = config["frontend"]["pages"].copy()

    # Add a blog post
    blog_post_uuid = str(uuid.uuid4())
    config["frontend"]["pages"].append(
        {
            "uuid": blog_post_uuid,
            "slug": "/blog/first-post",
            "title": "First Blog Post",
            "pageType": "BlogPostPageProps",
            "summary": "This is the first blog post.",
            "shortSummary": "First blog post",
            "lastUpdatedEpoch": 1730764800,
            "publishedDate": "2024-11-05T00:00:00Z",
            "status": "published",
            "content": [
                {
                    "uuid": str(uuid.uuid4()),
                    "componentType": "SectionProps",
                    "content": [
                        {
                            "uuid": str(uuid.uuid4()),
                            "componentType": "HeadingProps",
                            "text": "First Blog Post",
                            "level": "h1",
                        },
                        {
                            "uuid": str(uuid.uuid4()),
                            "componentType": "TextProps",
                            "text": "This is the content of the first blog post.",
                        },
                    ],
                }
            ],
        }
    )

    return config


@pytest.fixture
def webapp_multi_page_config() -> Dict[str, Any]:
    """Return a webapp config with multiple pages."""
    app_uuid = str(uuid.uuid4())
    home_uuid = str(uuid.uuid4())
    about_uuid = str(uuid.uuid4())
    contact_uuid = str(uuid.uuid4())

    return {
        "appType": "WebAppProps",
        "uuid": app_uuid,
        "version": "1.0.0",
        "appSecondaryType": "website",
        "name": "Multi-Page App",
        "alias": "multi-page-app",
        "summary": "A multi-page test application for E2E testing",
        "shortSummary": "Multi-page test app",
        "lastUpdatedEpoch": 1730764800,
        "frontend": {
            "languages": [
                {
                    "code": "en",
                    "nameEnglish": "English",
                    "nameNative": "English",
                    "isDefault": True,
                }
            ],
            "layout": "boxed",
            "menuPosition": "HeaderMenuTop",
            "sidebar": [],
            "pages": [
                {
                    "uuid": home_uuid,
                    "slug": "/",
                    "title": "Home",
                    "pageType": "WebPageProps",
                    "content": [],
                    "summary": "Home page of the multi-page application",
                    "shortSummary": "Home page",
                    "lastUpdatedEpoch": 1730764800,
                },
                {
                    "uuid": about_uuid,
                    "slug": "/about",
                    "title": "About",
                    "pageType": "WebPageProps",
                    "content": [],
                    "summary": "About page with company information",
                    "shortSummary": "About page",
                    "lastUpdatedEpoch": 1730764800,
                },
                {
                    "uuid": contact_uuid,
                    "slug": "/contact",
                    "title": "Contact",
                    "pageType": "WebPageProps",
                    "content": [],
                    "summary": "Contact page with contact form",
                    "shortSummary": "Contact page",
                    "lastUpdatedEpoch": 1730764800,
                },
            ],
            "header": [
                {
                    "uuid": str(uuid.uuid4()),
                    "componentType": "NavbarProps",
                    "logo": {
                        "uuid": str(uuid.uuid4()),
                        "componentType": "NavbarLogoProps",
                        "text": "Multi-Page",
                    },
                    "content": [
                        {
                            "uuid": str(uuid.uuid4()),
                            "componentType": "MenuLinkItemProps",
                            "label": "Home",
                            "href": {
                                "uuid": str(uuid.uuid4()),
                                "componentType": "LinkProps",
                                "href": "/",
                            },
                        },
                        {
                            "uuid": str(uuid.uuid4()),
                            "componentType": "MenuLinkItemProps",
                            "label": "About",
                            "href": {
                                "uuid": str(uuid.uuid4()),
                                "componentType": "LinkProps",
                                "href": "/about",
                            },
                        },
                        {
                            "uuid": str(uuid.uuid4()),
                            "componentType": "MenuLinkItemProps",
                            "label": "Contact",
                            "href": {
                                "uuid": str(uuid.uuid4()),
                                "componentType": "LinkProps",
                                "href": "/contact",
                            },
                        },
                    ],
                }
            ],
            "footer": [],
            "theme": {
                "light": {
                    "background": "#ffffff",
                    "foreground": "#0f172a",
                    "primary": "#1d4ed8",
                    "primary-foreground": "#ffffff",
                    "secondary": "#475569",
                    "secondary-foreground": "#ffffff",
                    "muted": "#f1f5f9",
                    "muted-foreground": "#64748b",
                    "accent": "#f1f5f9",
                    "accent-foreground": "#0f172a",
                    "destructive": "#dc2626",
                    "destructive-foreground": "#ffffff",
                    "border": "#e2e8f0",
                    "input": "#e2e8f0",
                    "ring": "#1d4ed8",
                },
                "dark": {
                    "background": "#0f172a",
                    "foreground": "#f8fafc",
                    "primary": "#3b82f6",
                    "primary-foreground": "#0f172a",
                    "secondary": "#64748b",
                    "secondary-foreground": "#f8fafc",
                    "muted": "#1e293b",
                    "muted-foreground": "#94a3b8",
                    "accent": "#1e293b",
                    "accent-foreground": "#f8fafc",
                    "destructive": "#ef4444",
                    "destructive-foreground": "#ffffff",
                    "border": "#1e293b",
                    "input": "#1e293b",
                    "ring": "#3b82f6",
                },
            },
        },
    }


# =============================================================================
# OUTPUT DIRECTORY FIXTURES
# =============================================================================


@pytest.fixture(scope="session")
def run_output_dir():
    """Create a timestamped output directory for the test run.

    This fixture is session-scoped so all tests in a run share the same
    output directory.

    Yields:
        Path: The run output directory
    """
    from .utils.result_writer import ResultWriter

    writer = ResultWriter()
    run_dir = writer.create_run_directory()

    yield run_dir

    # Could add cleanup logic here if needed


@pytest.fixture
def test_output_dir(run_output_dir, request):
    """Create an output directory for a specific test.

    Args:
        run_output_dir: The session-scoped run directory
        request: Pytest request fixture for test name

    Yields:
        Path: The test-specific output directory
    """
    from .utils.result_writer import ResultWriter

    writer = ResultWriter()
    test_name = request.node.name
    test_dir = writer.create_test_directory(run_output_dir, test_name)

    yield test_dir


@pytest.fixture
def result_writer():
    """Provide a ResultWriter instance.

    Returns:
        ResultWriter: A configured result writer
    """
    from .utils.result_writer import ResultWriter

    return ResultWriter()


@pytest.fixture
def validation_runner():
    """Provide a ValidationRunner instance.

    Returns:
        ValidationRunner: A configured validation runner
    """
    from .utils.validation_runner import ValidationRunner

    return ValidationRunner()


# =============================================================================
# HELPER FIXTURES
# =============================================================================


@pytest.fixture
def get_component_uuid():
    """Helper fixture to extract component UUIDs from configs.

    Usage:
        section_uuid = get_component_uuid(config, "SectionProps")
    """

    def _get_uuid(config: Dict, component_type: str, index: int = 0) -> Optional[str]:
        """Find a component UUID by type.

        Args:
            config: App config to search
            component_type: The componentType to find
            index: Which occurrence to return (default: first)

        Returns:
            The UUID string or None if not found
        """
        found = []

        def search(obj):
            if isinstance(obj, dict):
                if obj.get("componentType") == component_type:
                    found.append(obj.get("uuid"))
                for value in obj.values():
                    search(value)
            elif isinstance(obj, list):
                for item in obj:
                    search(item)

        search(config)
        return found[index] if len(found) > index else None

    return _get_uuid


@pytest.fixture
def get_page_uuid():
    """Helper fixture to get page UUID by slug or title."""

    def _get_uuid(
        config: Dict, slug: Optional[str] = None, title: Optional[str] = None
    ) -> Optional[str]:
        """Find a page UUID by slug or title.

        Args:
            config: App config to search
            slug: Page slug to match
            title: Page title to match

        Returns:
            The UUID string or None if not found
        """
        for page in config.get("pages", []):
            if slug and page.get("slug") == slug:
                return page.get("uuid")
            if title and page.get("title") == title:
                return page.get("uuid")
        return None

    return _get_uuid


# =============================================================================
# HTTP MOCKING FIXTURES FOR CONTENT CATALOGS
# =============================================================================
# NOTE: These mock fixtures work for integration tests (same process) but NOT
# for E2E tests (separate server process). For E2E tests with document catalogs,
# start the server with SKIP_DOCUMENT_FETCH=true environment variable instead.
# =============================================================================

# Sample markdown content for mocked document fetches
MOCK_DOCUMENT_CONTENT = {
    "https://storage.example.com/docs/product-spec.md": """# Product Specification

## Overview
This document describes the key features and requirements for our product.

## Features
- **Feature 1**: Advanced analytics dashboard with real-time data visualization
- **Feature 2**: User authentication with OAuth 2.0 and SSO support
- **Feature 3**: RESTful API for third-party integrations
- **Feature 4**: Mobile-responsive design with PWA support

## Requirements
1. Must support 10,000+ concurrent users
2. Response time under 200ms for 95th percentile
3. 99.9% uptime SLA
4. GDPR and SOC 2 compliance

## Technical Stack
- Frontend: React with TypeScript
- Backend: Python with FastAPI
- Database: PostgreSQL with Redis caching
- Infrastructure: Kubernetes on GCP
""",
    "https://storage.example.com/docs/manual.md": """# User Manual

## Getting Started
Welcome to our comprehensive user manual. This guide will help you get started.

## Installation
Follow these steps to install the application...

## Configuration
Configure your settings in the admin panel...

## Troubleshooting
Common issues and their solutions...
""",
    "https://storage.example.com/docs/company-profile.md": """# Company Profile

## About Us
We are a leading technology company focused on innovation and excellence.

## Our Mission
To empower businesses with cutting-edge software solutions that drive growth.

## Our Vision
To be the global leader in enterprise software solutions by 2030.

## Core Values
- Innovation: We embrace new ideas and technologies
- Excellence: We strive for the highest quality
- Integrity: We act with honesty and transparency
- Collaboration: We work together to achieve more

## History
Founded in 2020, we have grown from a small startup to a global enterprise.
""",
}


@pytest.fixture
def mock_document_fetches():
    """Mock HTTP responses for document catalog URLs.

    This fixture mocks the aiohttp requests made by DocumentArtifactService
    when fetching document content from URLs. It provides realistic markdown
    content that can be used for testing content-aware app generation.

    IMPORTANT: This fixture only works for INTEGRATION tests where the code
    runs in the same Python process. It does NOT work for E2E tests because
    the server runs in a separate process.

    For E2E tests with document catalogs, start the server with:
        SKIP_DOCUMENT_FETCH=true python agent_api.py

    Usage (integration tests only):
        async def test_with_documents(mock_document_fetches, sample_document_catalog):
            # HTTP calls to sample_document_catalog URLs will be mocked
            ...

    Note:
        This fixture uses aioresponses to mock aiohttp.ClientSession requests.
        Install with: pip install aioresponses
    """
    try:
        from aioresponses import aioresponses
    except ImportError:
        pytest.skip("aioresponses not installed. Run: pip install aioresponses")

    with aioresponses() as m:
        # Mock all document URLs with their content
        for url, content in MOCK_DOCUMENT_CONTENT.items():
            m.get(
                url,
                body=content,
                headers={"Content-Type": "text/markdown; charset=utf-8"},
                repeat=True,  # Allow multiple fetches of the same URL
            )

        yield m


@pytest.fixture
def mock_all_external_urls():
    """Mock all external HTTP requests to prevent network calls in tests.

    This is a broader mock that catches any external URL and returns a
    generic response. Use this when you want to ensure no real network
    calls are made during testing.

    Usage:
        async def test_isolated(mock_all_external_urls):
            # All HTTP calls will be mocked
            ...
    """
    try:
        from aioresponses import aioresponses
        import re
    except ImportError:
        pytest.skip("aioresponses not installed. Run: pip install aioresponses")

    with aioresponses() as m:
        # Mock document URLs with content
        for url, content in MOCK_DOCUMENT_CONTENT.items():
            m.get(
                url,
                body=content,
                headers={"Content-Type": "text/markdown; charset=utf-8"},
                repeat=True,
            )

        # Mock any other storage.example.com URLs with generic content
        m.get(
            re.compile(r"https://storage\.example\.com/.*"),
            body="# Mocked Content\n\nThis is mocked content for testing.",
            headers={"Content-Type": "text/markdown"},
            repeat=True,
        )

        yield m
