"""Unit tests for JSON Schema validation module."""

import json

import pytest


class TestValidateAppConfig:
    """Tests for the main validate_app_config function."""

    @pytest.mark.unit
    def test_valid_webapp_passes(self, validate_config, sample_valid_webapp):
        """Valid WebApp configuration should pass validation."""
        result = validate_config(json.dumps(sample_valid_webapp), "WebAppProps")

        assert result["valid"] is True, f"Errors: {result['errors']}"
        assert result["errors"] == []

    @pytest.mark.unit
    def test_invalid_json_syntax(self, validate_config):
        """Malformed JSON should return syntax error."""
        result = validate_config("{not: valid json}", None)

        assert result["valid"] is False
        assert any("Invalid JSON" in e for e in result["errors"])

    @pytest.mark.unit
    def test_empty_object_fails(self, validate_config):
        """Empty JSON object should fail type detection."""
        result = validate_config("{}", None)

        assert result["valid"] is False
        assert len(result["errors"]) > 0

    @pytest.mark.unit
    def test_non_object_json_fails(self, validate_config):
        """Non-object JSON (array, string) should fail validation."""
        # Array
        result = validate_config("[]", None)
        assert result["valid"] is False

        # String
        result = validate_config('"just a string"', None)
        assert result["valid"] is False

    @pytest.mark.unit
    def test_markdown_code_fence_stripped(self, validate_config, sample_valid_webapp):
        """Markdown code fences should be stripped before parsing."""
        wrapped = f"```json\n{json.dumps(sample_valid_webapp)}\n```"
        result = validate_config(wrapped, "WebAppProps")

        assert result["valid"] is True

    @pytest.mark.unit
    def test_type_mismatch_error(self, validate_config, sample_valid_webapp):
        """Wrong expected type should produce error."""
        # sample_valid_webapp is WebAppProps, try validating as WebPageProps
        result = validate_config(json.dumps(sample_valid_webapp), "WebPageProps")

        assert result["valid"] is False
        # Should indicate type mismatch
        assert any("does not match expected type" in e for e in result["errors"])

    @pytest.mark.unit
    def test_auto_detect_webapp(self, validate_config, sample_valid_webapp):
        """WebApp should be auto-detected without explicit type."""
        result = validate_config(json.dumps(sample_valid_webapp), None)

        # Should detect and validate as WebAppProps
        assert result["valid"] is True


class TestIconValidation:
    """Tests for Lucide icon name validation."""

    @pytest.mark.unit
    def test_valid_common_icons(self):
        """Common Lucide icons should be valid."""
        from validation import validate_single_icon_name

        # Note: Lucide uses "house" instead of "home"
        valid_icons = ["house", "user", "settings", "search", "menu", "check"]
        for icon in valid_icons:
            result = validate_single_icon_name(icon)
            assert result is None, f"Icon '{icon}' should be valid but got: {result}"

    @pytest.mark.unit
    def test_invalid_icon_name(self):
        """Non-existent icon names should return error."""
        from validation import validate_single_icon_name

        result = validate_single_icon_name("not-a-real-icon-xyz-123")

        assert result is not None
        assert "Invalid icon name" in result

    @pytest.mark.unit
    def test_icon_case_insensitive(self):
        """Icon validation should be case-insensitive."""
        from validation import validate_single_icon_name

        # Should normalize to lowercase (Lucide uses "house" not "home")
        result = validate_single_icon_name("HOUSE")
        assert result is None  # Should be valid

    @pytest.mark.unit
    def test_batch_icon_validation(self):
        """Batch icon validation should catch all invalid icons."""
        from validation import validate_icon_list

        # Note: Lucide uses "house" not "home"
        icons = ["house", "invalid-icon-xyz", "user", "another-fake"]
        errors = validate_icon_list(icons)

        assert len(errors) == 2
        assert any("invalid-icon-xyz" in e for e in errors)
        assert any("another-fake" in e for e in errors)


class TestFontValidation:
    """Tests for Google Fonts validation."""

    @pytest.mark.unit
    def test_valid_common_fonts(self):
        """Common Google Fonts should be valid."""
        from validation import validate_single_font_family

        # Common fonts that should exist in the catalog
        valid_fonts = ["Roboto", "Open Sans", "Lato", "Montserrat"]
        for font in valid_fonts:
            result = validate_single_font_family(font)
            # Will be None if valid (font exists in catalog)
            assert result is None, f"Font '{font}' should be valid but got: {result}"

    @pytest.mark.unit
    def test_invalid_font_family(self):
        """Non-existent font families should return error."""
        from validation import validate_single_font_family

        result = validate_single_font_family("NotARealFontFamily12345")

        assert result is not None
        assert "Invalid font family" in result

    @pytest.mark.unit
    def test_batch_font_validation(self):
        """Batch font validation should catch all invalid fonts."""
        from validation import validate_font_list

        fonts = ["Roboto", "FakeFont123", "Open Sans", "AnotherFake456"]
        errors = validate_font_list(fonts)

        assert len(errors) == 2
        assert any("FakeFont123" in e for e in errors)
        assert any("AnotherFake456" in e for e in errors)


class TestColorValidation:
    """Tests for color validation utilities."""

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "color",
        [
            "#FF5733",
            "#fff",
            "#000000",
            "ABC123",
            "#abc",
            "#FFFFFF",
        ],
    )
    def test_valid_hex_colors(self, color):
        """Valid hex colors should pass."""
        from validation import validate_hex_color

        result = validate_hex_color(color)
        assert result is None, f"Color '{color}' should be valid"

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "color",
        [
            "not-a-color",
            "#GGGGGG",
            "12345",
            "#12345",
            "#FFFFFFF",  # Too long
        ],
    )
    def test_invalid_hex_colors(self, color):
        """Invalid hex colors should return error."""
        from validation import validate_hex_color

        result = validate_hex_color(color)
        assert result is not None, f"Color '{color}' should be invalid"

    @pytest.mark.unit
    def test_contrast_ratio_black_white(self):
        """Black and white should have maximum contrast (~21:1)."""
        from validation import get_contrast_ratio

        ratio = get_contrast_ratio("#000000", "#FFFFFF")

        assert ratio is not None
        assert ratio > 20  # Should be ~21:1

    @pytest.mark.unit
    def test_contrast_ratio_same_color(self):
        """Same colors should have 1:1 contrast ratio."""
        from validation import get_contrast_ratio

        ratio = get_contrast_ratio("#FF0000", "#FF0000")

        assert ratio is not None
        assert abs(ratio - 1.0) < 0.01

    @pytest.mark.unit
    def test_color_contrast_validation(self):
        """Color contrast validation should detect poor contrast."""
        from validation import validate_color_contrast

        # Good contrast (black on white)
        result = validate_color_contrast("#000000", "#FFFFFF")
        assert result is None  # No error

        # Poor contrast (similar colors)
        result = validate_color_contrast("#888888", "#999999")
        assert result is not None  # Should have warning
        assert "contrast" in result.lower()

    @pytest.mark.unit
    def test_hex_to_rgb_conversion(self):
        """Hex to RGB conversion should work correctly."""
        from validation import hex_to_rgb

        # Black
        assert hex_to_rgb("#000000") == (0, 0, 0)

        # White
        assert hex_to_rgb("#FFFFFF") == (255, 255, 255)

        # Red
        assert hex_to_rgb("#FF0000") == (255, 0, 0)

        # Short form
        assert hex_to_rgb("#fff") == (255, 255, 255)
