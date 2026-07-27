"""Unit tests for automatic JSON type detection system."""

import pytest


class TestTypeDetectionByDiscriminator:
    """Tests for type detection using discriminator fields."""

    @pytest.mark.unit
    def test_detect_webapp_by_app_type(self):
        """WebApp should be detected by appType field."""
        from validation import detect_target_type

        obj = {"appType": "WebAppProps", "layout": {}, "name": "Test App"}
        result = detect_target_type(obj)

        assert result["type"] == "WebAppProps"
        assert result["confidence"] == "high"
        assert result["method"] == "discriminator"
        assert result["error"] is None

    @pytest.mark.unit
    def test_detect_page_by_page_type(self):
        """Page should be detected by pageType field."""
        from validation import detect_target_type

        obj = {"pageType": "WebPageProps", "title": "Test Page", "slug": "/test"}
        result = detect_target_type(obj)

        assert result["type"] == "WebPageProps"
        assert result["confidence"] == "high"
        assert result["method"] == "discriminator"

    @pytest.mark.unit
    def test_detect_blog_main_page(self):
        """BlogMainPageProps should be detected by pageType field."""
        from validation import detect_target_type

        obj = {"pageType": "BlogMainPageProps", "title": "Blog", "slug": "/blog"}
        result = detect_target_type(obj)

        assert result["type"] == "BlogMainPageProps"
        assert result["confidence"] == "high"

    @pytest.mark.unit
    def test_detect_blog_post_page(self):
        """BlogPostPageProps should be detected by pageType field."""
        from validation import detect_target_type

        obj = {
            "pageType": "BlogPostPageProps",
            "title": "My Blog Post",
            "slug": "/blog/my-post",
        }
        result = detect_target_type(obj)

        assert result["type"] == "BlogPostPageProps"
        assert result["confidence"] == "high"

    @pytest.mark.unit
    def test_detect_component_by_component_type(self):
        """Component should be detected by componentType field."""
        from validation import detect_target_type

        obj = {"componentType": "IconProps", "name": "home", "uuid": "icon-123"}
        result = detect_target_type(obj)

        assert result["type"] == "IconProps"
        assert result["confidence"] == "high"
        assert result["method"] == "discriminator"


class TestTypeDetectionBySignature:
    """Tests for type detection using field signature matching."""

    @pytest.mark.unit
    def test_detect_theme_by_light_dark(self):
        """Theme should be detected by light/dark palette fields."""
        from validation import detect_target_type

        obj = {
            "light": {"background": "0 0% 100%", "foreground": "0 0% 0%"},
            "dark": {"background": "0 0% 0%", "foreground": "0 0% 100%"},
        }
        result = detect_target_type(obj)

        assert result["type"] == "ThemeProps"
        assert result["confidence"] == "medium"
        assert result["method"] == "signature"

    @pytest.mark.unit
    def test_theme_detection_with_extra_fields(self):
        """Theme should be detected even with additional theme fields."""
        from validation import detect_target_type

        obj = {
            "light": {"background": "#fff", "primary": "#007bff"},
            "dark": {"background": "#000", "primary": "#0d6efd"},
            "charts": {"chart-1": "#ff0000"},
            "fonts": {"heading": {"family": "Roboto"}},
        }
        result = detect_target_type(obj)

        assert result["type"] == "ThemeProps"
        assert result["confidence"] == "medium"


class TestTypeDetectionFailures:
    """Tests for type detection failure cases."""

    @pytest.mark.unit
    def test_detection_fails_for_unknown_structure(self):
        """Unknown object structure should return error."""
        from validation import detect_target_type

        obj = {"randomField": "value", "anotherField": 123}
        result = detect_target_type(obj)

        assert result["type"] is None
        assert result["error"] is not None

    @pytest.mark.unit
    def test_detection_fails_for_empty_object(self):
        """Empty object should return error."""
        from validation import detect_target_type

        result = detect_target_type({})

        assert result["type"] is None
        assert result["error"] is not None

    @pytest.mark.unit
    def test_invalid_app_type_value(self):
        """Invalid appType value should return error."""
        from validation import detect_target_type

        obj = {"appType": "InvalidAppType", "name": "Test"}
        result = detect_target_type(obj)

        # Should fail because InvalidAppType is not valid
        assert result["error"] is not None

    @pytest.mark.unit
    def test_invalid_page_type_value(self):
        """Invalid pageType value should return error."""
        from validation import detect_target_type

        obj = {"pageType": "InvalidPageType", "title": "Test", "slug": "/test"}
        result = detect_target_type(obj)

        assert result["error"] is not None


class TestTypeDetectionEdgeCases:
    """Edge case tests for type detection."""

    @pytest.mark.unit
    def test_discriminator_takes_precedence(self):
        """Discriminator fields should take precedence over signatures."""
        from validation import detect_target_type

        # Object has both appType and light/dark (would match both rules)
        obj = {
            "appType": "WebAppProps",
            "light": {"background": "#fff"},
            "dark": {"background": "#000"},
        }
        result = detect_target_type(obj)

        # Should detect as WebAppProps (discriminator), not ThemeProps (signature)
        assert result["type"] == "WebAppProps"
        assert result["method"] == "discriminator"

    @pytest.mark.unit
    def test_partial_theme_not_detected(self):
        """Partial theme object (missing dark) should not match theme signature."""
        from validation import detect_target_type

        obj = {"light": {"background": "#fff"}}  # Missing "dark"
        result = detect_target_type(obj)

        # Should not detect as ThemeProps
        assert result["type"] != "ThemeProps" or result["type"] is None

    @pytest.mark.unit
    def test_detection_result_structure(self):
        """Detection result should have all expected keys."""
        from validation import detect_target_type

        obj = {"appType": "WebAppProps"}
        result = detect_target_type(obj)

        assert "type" in result
        assert "confidence" in result
        assert "method" in result
        assert "warnings" in result
        assert "error" in result

    @pytest.mark.unit
    def test_warnings_list_is_always_list(self):
        """Warnings should always be a list, even if empty."""
        from validation import detect_target_type

        obj = {"appType": "WebAppProps"}
        result = detect_target_type(obj)

        assert isinstance(result["warnings"], list)

    @pytest.mark.unit
    def test_non_string_discriminator_value(self):
        """Non-string discriminator value should be handled gracefully."""
        from validation import detect_target_type

        obj = {"appType": 123, "name": "Test"}  # appType should be string
        result = detect_target_type(obj)

        # Should fail with appropriate error
        assert result["error"] is not None
