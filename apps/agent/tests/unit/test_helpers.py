"""Unit tests for helper utility functions."""

import copy
import pytest

# =============================================================================
# Sample App Config Fixtures
# =============================================================================


@pytest.fixture
def sample_app_config():
    """Create a sample app config for testing."""
    return {
        "uuid": "app-001",
        "name": "Test App",
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
                            "content": [
                                {
                                    "uuid": "heading-001",
                                    "componentType": "HeadingProps",
                                    "text": "Welcome",
                                },
                                {
                                    "uuid": "button-001",
                                    "componentType": "ButtonProps",
                                    "text": "Click me",
                                    "link": {
                                        "uuid": "link-001",
                                        "componentType": "LinkProps",
                                        "href": "/about",
                                    },
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
                {
                    "uuid": "page-003",
                    "slug": "/blog/my-post",
                    "title": "My Post",
                    "pageType": "BlogPostPageProps",
                    "content": [],
                },
            ],
            "header": [
                {
                    "uuid": "navbar-001",
                    "componentType": "NavbarProps",
                    "logo": {
                        "uuid": "logo-001",
                        "componentType": "NavbarLogoProps",
                        "text": "Logo",
                    },
                }
            ],
            "footer": [
                {
                    "uuid": "footer-001",
                    "componentType": "FooterProps",
                }
            ],
        },
    }


# =============================================================================
# Tests for find_component_by_uuid
# =============================================================================


class TestFindComponentByUuid:
    """Tests for find_component_by_uuid function."""

    @pytest.mark.unit
    def test_find_root_component(self, sample_app_config):
        """Should find the root app config by UUID."""
        from main_agent.agents.utils.helpers import find_component_by_uuid

        result = find_component_by_uuid(sample_app_config, "app-001")
        assert result is not None
        assert result["uuid"] == "app-001"

    @pytest.mark.unit
    def test_find_page_by_uuid(self, sample_app_config):
        """Should find a page by UUID."""
        from main_agent.agents.utils.helpers import find_component_by_uuid

        result = find_component_by_uuid(sample_app_config, "page-001")
        assert result is not None
        assert result["title"] == "Home"

    @pytest.mark.unit
    def test_find_nested_component(self, sample_app_config):
        """Should find deeply nested components."""
        from main_agent.agents.utils.helpers import find_component_by_uuid

        result = find_component_by_uuid(sample_app_config, "heading-001")
        assert result is not None
        assert result["text"] == "Welcome"

    @pytest.mark.unit
    def test_find_component_in_header(self, sample_app_config):
        """Should find components in header."""
        from main_agent.agents.utils.helpers import find_component_by_uuid

        result = find_component_by_uuid(sample_app_config, "navbar-001")
        assert result is not None
        assert result["componentType"] == "NavbarProps"

    @pytest.mark.unit
    def test_find_component_in_footer(self, sample_app_config):
        """Should find components in footer."""
        from main_agent.agents.utils.helpers import find_component_by_uuid

        result = find_component_by_uuid(sample_app_config, "footer-001")
        assert result is not None
        assert result["componentType"] == "FooterProps"

    @pytest.mark.unit
    def test_find_nested_in_button_link(self, sample_app_config):
        """Should find components nested in properties like link."""
        from main_agent.agents.utils.helpers import find_component_by_uuid

        result = find_component_by_uuid(sample_app_config, "link-001")
        assert result is not None
        assert result["componentType"] == "LinkProps"

    @pytest.mark.unit
    def test_find_logo_in_navbar(self, sample_app_config):
        """Should find logo nested in navbar."""
        from main_agent.agents.utils.helpers import find_component_by_uuid

        result = find_component_by_uuid(sample_app_config, "logo-001")
        assert result is not None
        assert result["text"] == "Logo"

    @pytest.mark.unit
    def test_not_found_returns_none(self, sample_app_config):
        """Should return None for non-existent UUID."""
        from main_agent.agents.utils.helpers import find_component_by_uuid

        result = find_component_by_uuid(sample_app_config, "non-existent-uuid")
        assert result is None


# =============================================================================
# Tests for find_page_type_with_uuid
# =============================================================================


class TestFindPageTypeWithUuid:
    """Tests for find_page_type_with_uuid function."""

    @pytest.mark.unit
    def test_find_web_page_type(self, sample_app_config):
        """Should return pageType for web page."""
        from main_agent.agents.utils.helpers import find_page_type_with_uuid

        result = find_page_type_with_uuid(sample_app_config, "page-001")
        assert result == "WebPageProps"

    @pytest.mark.unit
    def test_find_blog_post_page_type(self, sample_app_config):
        """Should return pageType for blog post."""
        from main_agent.agents.utils.helpers import find_page_type_with_uuid

        result = find_page_type_with_uuid(sample_app_config, "page-003")
        assert result == "BlogPostPageProps"

    @pytest.mark.unit
    def test_not_found_returns_empty_string(self, sample_app_config):
        """Should return empty string for non-existent page."""
        from main_agent.agents.utils.helpers import find_page_type_with_uuid

        result = find_page_type_with_uuid(sample_app_config, "non-existent")
        assert result == ""

    @pytest.mark.unit
    def test_invalid_uuid_returns_empty(self, sample_app_config):
        """Should return empty for None/empty UUID."""
        from main_agent.agents.utils.helpers import find_page_type_with_uuid

        assert find_page_type_with_uuid(sample_app_config, None) == ""
        assert find_page_type_with_uuid(sample_app_config, "") == ""

    @pytest.mark.unit
    def test_invalid_config_returns_empty(self):
        """Should return empty for invalid config."""
        from main_agent.agents.utils.helpers import find_page_type_with_uuid

        assert find_page_type_with_uuid(None, "page-001") == ""
        assert find_page_type_with_uuid({}, "page-001") == ""


# =============================================================================
# Tests for get_page_slug_by_uuid
# =============================================================================


class TestGetPageSlugByUuid:
    """Tests for get_page_slug_by_uuid function."""

    @pytest.mark.unit
    def test_get_regular_page_slug(self, sample_app_config):
        """Should return slug for regular page."""
        from main_agent.agents.utils.helpers import get_page_slug_by_uuid

        result = get_page_slug_by_uuid(sample_app_config, "page-002")
        assert result == "/about"

    @pytest.mark.unit
    def test_get_blog_post_slug_adds_prefix(self, sample_app_config):
        """BlogPostPageProps should get /blog prefix if missing."""
        from main_agent.agents.utils.helpers import get_page_slug_by_uuid

        result = get_page_slug_by_uuid(sample_app_config, "page-003")
        # Already has /blog prefix, should keep it
        assert result == "/blog/my-post"

    @pytest.mark.unit
    def test_not_found_returns_none(self, sample_app_config):
        """Should return None for non-existent page."""
        from main_agent.agents.utils.helpers import get_page_slug_by_uuid

        result = get_page_slug_by_uuid(sample_app_config, "non-existent")
        assert result is None

    @pytest.mark.unit
    def test_empty_uuid_returns_none(self, sample_app_config):
        """Should return None for empty UUID."""
        from main_agent.agents.utils.helpers import get_page_slug_by_uuid

        result = get_page_slug_by_uuid(sample_app_config, "")
        assert result is None


# =============================================================================
# Tests for analyze_bracket_balance
# =============================================================================


class TestAnalyzeBracketBalance:
    """Tests for analyze_bracket_balance function."""

    @pytest.mark.unit
    def test_balanced_brackets(self):
        """Balanced brackets should report balanced."""
        from main_agent.agents.utils.helpers import analyze_bracket_balance

        result = analyze_bracket_balance('{"key": "value"}')
        assert "balanced" in result.lower()

    @pytest.mark.unit
    def test_missing_closing_brace(self):
        """Should detect missing closing brace."""
        from main_agent.agents.utils.helpers import analyze_bracket_balance

        result = analyze_bracket_balance('{"key": "value"')
        assert "missing" in result.lower() or "}" in result

    @pytest.mark.unit
    def test_extra_closing_brace(self):
        """Should detect extra closing brace."""
        from main_agent.agents.utils.helpers import analyze_bracket_balance

        result = analyze_bracket_balance('{"key": "value"}}')
        assert "extra" in result.lower() or "}" in result

    @pytest.mark.unit
    def test_missing_closing_bracket(self):
        """Should detect missing closing bracket."""
        from main_agent.agents.utils.helpers import analyze_bracket_balance

        result = analyze_bracket_balance("[1, 2, 3")
        assert "missing" in result.lower() or "]" in result

    @pytest.mark.unit
    def test_complex_nested_balanced(self):
        """Should handle complex nested structures."""
        from main_agent.agents.utils.helpers import analyze_bracket_balance

        result = analyze_bracket_balance('{"arr": [1, 2], "obj": {"a": 1}}')
        assert "balanced" in result.lower()


# =============================================================================
# Tests for replace_component_by_uuid
# =============================================================================


class TestReplaceComponentByUuid:
    """Tests for replace_component_by_uuid function."""

    @pytest.mark.unit
    def test_replace_in_page_content(self, sample_app_config):
        """Should replace component in page content."""
        from main_agent.agents.utils.helpers import replace_component_by_uuid

        config = copy.deepcopy(sample_app_config)
        new_component = {
            "uuid": "heading-001",
            "componentType": "HeadingProps",
            "text": "New Welcome Text",
        }

        result = replace_component_by_uuid(config, "heading-001", new_component)

        assert result is True
        # Find the replaced component
        page_content = config["frontend"]["pages"][0]["content"][0]["content"]
        heading = next(c for c in page_content if c["uuid"] == "heading-001")
        assert heading["text"] == "New Welcome Text"

    @pytest.mark.unit
    def test_replace_in_header(self, sample_app_config):
        """Should replace component in header."""
        from main_agent.agents.utils.helpers import replace_component_by_uuid

        config = copy.deepcopy(sample_app_config)
        new_component = {
            "uuid": "navbar-001",
            "componentType": "NavbarProps",
            "variant": "new-variant",
        }

        result = replace_component_by_uuid(config, "navbar-001", new_component)

        assert result is True
        assert config["frontend"]["header"][0]["variant"] == "new-variant"

    @pytest.mark.unit
    def test_replace_not_found_returns_false(self, sample_app_config):
        """Should return False if component not found."""
        from main_agent.agents.utils.helpers import replace_component_by_uuid

        config = copy.deepcopy(sample_app_config)
        result = replace_component_by_uuid(config, "non-existent", {"uuid": "non-existent"})

        assert result is False


# =============================================================================
# Tests for remove_component_by_uuid
# =============================================================================


class TestRemoveComponentByUuid:
    """Tests for remove_component_by_uuid function."""

    @pytest.mark.unit
    def test_remove_from_list(self, sample_app_config):
        """Should remove component from list."""
        from main_agent.agents.utils.helpers import remove_component_by_uuid

        config = copy.deepcopy(sample_app_config)
        # Remove the button from section content
        result = remove_component_by_uuid(config, "button-001")

        assert result is True
        section_content = config["frontend"]["pages"][0]["content"][0]["content"]
        uuids = [c["uuid"] for c in section_content]
        assert "button-001" not in uuids

    @pytest.mark.unit
    def test_remove_not_found_returns_false(self, sample_app_config):
        """Should return False if component not found."""
        from main_agent.agents.utils.helpers import remove_component_by_uuid

        config = copy.deepcopy(sample_app_config)
        result = remove_component_by_uuid(config, "non-existent")

        assert result is False


# =============================================================================
# Tests for modify_component_field_by_uuid
# =============================================================================


class TestModifyComponentFieldByUuid:
    """Tests for modify_component_field_by_uuid function."""

    @pytest.mark.unit
    def test_modify_simple_field(self, sample_app_config):
        """Should modify a simple field value."""
        from main_agent.agents.utils.helpers import modify_component_field_by_uuid

        config = copy.deepcopy(sample_app_config)
        result = modify_component_field_by_uuid(config, "heading-001", "text", "Modified Heading")

        assert result is True
        # Find and check the component
        from main_agent.agents.utils.helpers import find_component_by_uuid

        heading = find_component_by_uuid(config, "heading-001")
        assert heading["text"] == "Modified Heading"

    @pytest.mark.unit
    def test_modify_nested_field_with_dot_notation(self, sample_app_config):
        """Should modify nested fields using dot notation."""
        from main_agent.agents.utils.helpers import modify_component_field_by_uuid

        config = copy.deepcopy(sample_app_config)
        # Add a style field to test nested modification
        result = modify_component_field_by_uuid(config, "heading-001", "style.color", "red")

        assert result is True
        from main_agent.agents.utils.helpers import find_component_by_uuid

        heading = find_component_by_uuid(config, "heading-001")
        assert heading["style"]["color"] == "red"

    @pytest.mark.unit
    def test_modify_not_found_returns_false(self, sample_app_config):
        """Should return False if component not found."""
        from main_agent.agents.utils.helpers import modify_component_field_by_uuid

        config = copy.deepcopy(sample_app_config)
        result = modify_component_field_by_uuid(config, "non-existent", "field", "value")

        assert result is False


# =============================================================================
# Tests for find_component_with_location
# =============================================================================


class TestFindComponentWithLocation:
    """Tests for find_component_with_location function."""

    @pytest.mark.unit
    def test_find_in_header(self, sample_app_config):
        """Should find component and report header location."""
        from main_agent.agents.utils.helpers import find_component_with_location

        result = find_component_with_location(sample_app_config, "navbar-001")

        assert result is not None
        assert result["location_type"] == "header"
        assert result["config"]["uuid"] == "navbar-001"

    @pytest.mark.unit
    def test_find_in_footer(self, sample_app_config):
        """Should find component and report footer location."""
        from main_agent.agents.utils.helpers import find_component_with_location

        result = find_component_with_location(sample_app_config, "footer-001")

        assert result is not None
        assert result["location_type"] == "footer"

    @pytest.mark.unit
    def test_find_page_itself(self, sample_app_config):
        """Should find page and report 'page' location."""
        from main_agent.agents.utils.helpers import find_component_with_location

        result = find_component_with_location(sample_app_config, "page-001")

        assert result is not None
        assert result["location_type"] == "page"
        assert result["page_uuid"] == "page-001"

    @pytest.mark.unit
    def test_find_in_page_content(self, sample_app_config):
        """Should find component in page and report 'page_content' location."""
        from main_agent.agents.utils.helpers import find_component_with_location

        result = find_component_with_location(sample_app_config, "heading-001")

        assert result is not None
        assert result["location_type"] == "page_content"
        assert result["page_uuid"] == "page-001"

    @pytest.mark.unit
    def test_not_found_returns_none(self, sample_app_config):
        """Should return None for non-existent component."""
        from main_agent.agents.utils.helpers import find_component_with_location

        result = find_component_with_location(sample_app_config, "non-existent")
        assert result is None


# =============================================================================
# Tests for find_unique_slot_for_component_name (TC-002 hot-reload metadata)
# =============================================================================


class TestFindUniqueSlotForComponentName:
    """Tests for find_unique_slot_for_component_name — used by TC-002 fix D
    to populate hot-reload metadata only when the answer is unambiguous."""

    @pytest.mark.unit
    def test_single_match_returns_slot_and_page_uuid(self):
        from main_agent.agents.utils.component_tree import (
            find_unique_slot_for_component_name,
        )

        config = {
            "frontend": {
                "pages": [
                    {
                        "uuid": "p-home",
                        "content": [
                            {"uuid": "slot-1", "component": "HeroSection"},
                            {"uuid": "slot-2", "component": "Footer"},
                        ],
                    }
                ]
            }
        }
        assert find_unique_slot_for_component_name(config, "HeroSection") == (
            "slot-1",
            "p-home",
        )

    @pytest.mark.unit
    def test_app_level_header_returns_empty_page_uuid(self):
        from main_agent.agents.utils.component_tree import (
            find_unique_slot_for_component_name,
        )

        config = {
            "frontend": {
                "pages": [],
                "header": [{"uuid": "hdr-1", "component": "WebsiteHeader"}],
            }
        }
        assert find_unique_slot_for_component_name(config, "WebsiteHeader") == (
            "hdr-1",
            "",
        )

    @pytest.mark.unit
    def test_ambiguous_match_returns_none(self):
        """Same component name on two pages → caller falls back to full reload."""
        from main_agent.agents.utils.component_tree import (
            find_unique_slot_for_component_name,
        )

        config = {
            "frontend": {
                "pages": [
                    {"uuid": "p1", "content": [{"uuid": "s1", "component": "Hero"}]},
                    {"uuid": "p2", "content": [{"uuid": "s2", "component": "Hero"}]},
                ]
            }
        }
        assert find_unique_slot_for_component_name(config, "Hero") is None

    @pytest.mark.unit
    def test_not_found_returns_none(self):
        from main_agent.agents.utils.component_tree import (
            find_unique_slot_for_component_name,
        )

        assert find_unique_slot_for_component_name({"frontend": {"pages": []}}, "X") is None

    @pytest.mark.unit
    def test_empty_inputs_return_none(self):
        from main_agent.agents.utils.component_tree import (
            find_unique_slot_for_component_name,
        )

        assert find_unique_slot_for_component_name({}, "Hero") is None
        assert find_unique_slot_for_component_name({"frontend": {}}, "") is None
