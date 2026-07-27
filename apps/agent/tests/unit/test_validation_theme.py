"""Tests for validation.theme — HSL contrast, chart colors, font variants, Google Fonts URLs, and theme orchestrators."""

import pytest

# ===========================================================================
# HSL lightness contrast
# ===========================================================================


class TestValidateHslLightnessContrast:
    @pytest.fixture(autouse=True)
    def _import(self):
        from validation import validate_hsl_lightness_contrast

        self.validate = validate_hsl_lightness_contrast

    @pytest.mark.unit
    def test_sufficient_contrast_returns_none(self):
        result = self.validate("0 0% 100%", "0 0% 0%")
        assert result is None

    @pytest.mark.unit
    def test_insufficient_contrast_returns_error(self):
        result = self.validate("0 0% 50%", "0 0% 60%", min_diff=40)
        assert result is not None
        assert "CRITICAL" in result

    @pytest.mark.unit
    def test_non_hsl_format_returns_none(self):
        result = self.validate("#ffffff", "#000000")
        assert result is None

    @pytest.mark.unit
    def test_custom_min_diff(self):
        # diff = 30 (80-50), min_diff = 50 → error
        result = self.validate("0 0% 50%", "0 0% 80%", min_diff=50)
        assert result is not None
        assert "CRITICAL" in result

    @pytest.mark.unit
    def test_malformed_hsl_returns_none(self):
        result = self.validate("0 0%", "0 0% 50%")
        assert result is None


# ===========================================================================
# Chart color validation
# ===========================================================================


class TestValidateChartColors:
    @pytest.fixture(autouse=True)
    def _import(self):
        from validation import validate_chart_colors

        self.validate = validate_chart_colors

    @pytest.mark.unit
    def test_distinct_colors_no_warnings(self):
        charts = {"chart-1": "#FF0000", "chart-2": "#00FF00", "chart-3": "#0000FF"}
        warnings = self.validate(charts)
        assert warnings == []

    @pytest.mark.unit
    def test_similar_colors_warning(self):
        charts = {
            "chart-1": "#FF0000",
            "chart-2": "#FF0100",
            "chart-3": "#FF0200",
            "chart-4": "#FF0300",
            "chart-5": "#FF0400",
        }
        warnings = self.validate(charts)
        assert any("too similar" in w for w in warnings)

    @pytest.mark.unit
    def test_invalid_hex_in_chart(self):
        charts = {"chart-1": "not-a-color"}
        warnings = self.validate(charts)
        assert any("Invalid hex color" in w for w in warnings)

    @pytest.mark.unit
    def test_single_chart_color_no_similarity_check(self):
        charts = {"chart-1": "#FF0000"}
        warnings = self.validate(charts)
        # Only 1 color — no similarity warning possible
        assert not any("too similar" in w for w in warnings)

    @pytest.mark.unit
    def test_non_chart_keys_ignored(self):
        charts = {"chart-1": "#FF0000", "background": "not-a-hex"}
        warnings = self.validate(charts)
        # "background" is not a chart-* key, so its invalid hex should not cause a warning
        assert not any("background" in w for w in warnings)


# ===========================================================================
# Font variant validation
# ===========================================================================


class TestValidateFontVariant:
    @pytest.fixture(autouse=True)
    def _import(self):
        from validation import validate_font_variant

        self.validate = validate_font_variant

    @pytest.mark.unit
    def test_valid_variant(self):
        # Google Fonts stores "regular" for 400 weight; use "700" which is stored literally
        result = self.validate("Roboto", "700")
        assert result is None

    @pytest.mark.unit
    def test_invalid_variant(self):
        result = self.validate("Roboto", "999")
        assert result is not None
        assert "Invalid variant" in result

    @pytest.mark.unit
    def test_normalized_regular_to_400(self):
        result = self.validate("Roboto", "regular")
        assert result is None

    @pytest.mark.unit
    def test_invalid_font_family_in_variant(self):
        result = self.validate("FakeFont123NotReal", "400")
        assert result is not None
        assert "Invalid font family" in result


# ===========================================================================
# Google Fonts URL validation
# ===========================================================================


class TestValidateGoogleFontsUrl:
    @pytest.fixture(autouse=True)
    def _import(self):
        from validation import validate_google_fonts_url

        self.validate = validate_google_fonts_url

    @pytest.mark.unit
    def test_valid_url(self):
        url = "https://fonts.googleapis.com/css2?family=Roboto:wght@400"
        result = self.validate(url, "Roboto")
        assert result is None

    @pytest.mark.unit
    def test_invalid_url_not_google(self):
        result = self.validate("https://example.com/fonts", "Roboto")
        assert result is not None
        assert "Invalid Google Fonts URL" in result

    @pytest.mark.unit
    def test_family_not_in_url(self):
        url = "https://fonts.googleapis.com/css2?family=Lato:wght@400"
        result = self.validate(url, "Roboto")
        assert result is not None
        assert "not found in URL" in result

    @pytest.mark.unit
    def test_family_with_spaces_encoded(self):
        url = "https://fonts.googleapis.com/css2?family=Open+Sans:wght@400"
        result = self.validate(url, "Open Sans")
        assert result is None


# ===========================================================================
# Webapp theme orchestrator
# ===========================================================================


class TestValidateWebappTheme:
    @pytest.fixture(autouse=True)
    def _import(self):
        from validation import validate_webapp_theme

        self.validate = validate_webapp_theme

    @pytest.mark.unit
    def test_valid_theme_with_light_dark(self):
        config = {
            "frontend": {
                "theme": {
                    "light": {
                        "background": "0 0% 100%",
                        "foreground": "0 0% 3.9%",
                        "primary": "0 72.2% 50.6%",
                        "primary-foreground": "0 85.7% 97.3%",
                    },
                    "dark": {
                        "background": "0 0% 3.9%",
                        "foreground": "0 0% 98%",
                        "primary": "0 72.2% 50.6%",
                        "primary-foreground": "0 85.7% 97.3%",
                    },
                }
            }
        }
        errors = []
        self.validate(config, "root", errors)
        assert errors == []

    @pytest.mark.unit
    def test_theme_low_contrast_bg_fg(self):
        config = {
            "frontend": {
                "theme": {
                    "light": {
                        "background": "0 0% 50%",
                        "foreground": "0 0% 55%",  # diff=5, well below 50
                    }
                }
            }
        }
        errors = []
        self.validate(config, "root", errors)
        assert len(errors) >= 1
        assert any("Background/Foreground" in e for e in errors)

    @pytest.mark.unit
    def test_theme_with_chart_colors(self):
        config = {
            "frontend": {
                "theme": {
                    "charts": {
                        "chart-1": "#FF0000",
                        "chart-2": "#00FF00",
                        "chart-3": "#0000FF",
                    }
                }
            }
        }
        errors = []
        self.validate(config, "root", errors)
        assert errors == []

    @pytest.mark.unit
    def test_no_theme_key_noop(self):
        config = {"frontend": {}}
        errors = []
        self.validate(config, "root", errors)
        assert errors == []


# ===========================================================================
# Webapp fonts orchestrator
# ===========================================================================


class TestValidateWebappFonts:
    @pytest.fixture(autouse=True)
    def _import(self):
        from validation import validate_webapp_fonts

        self.validate = validate_webapp_fonts

    @pytest.mark.unit
    def test_valid_font_config(self):
        config = {
            "frontend": {
                "theme": {
                    "fonts": {
                        "heading": {
                            "family": "Roboto",
                            "variant": "700",
                            "url": "https://fonts.googleapis.com/css2?family=Roboto:wght@700",
                        }
                    }
                }
            }
        }
        errors = []
        self.validate(config, "root", errors)
        assert errors == []

    @pytest.mark.unit
    def test_invalid_font_family(self):
        config = {
            "frontend": {
                "theme": {
                    "fonts": {
                        "heading": {
                            "family": "FakeFont123NotReal",
                            "variant": "400",
                            "url": "https://fonts.googleapis.com/css2?family=FakeFont123NotReal:wght@400",
                        }
                    }
                }
            }
        }
        errors = []
        self.validate(config, "root", errors)
        assert any("Invalid font family" in e for e in errors)

    @pytest.mark.unit
    def test_missing_required_font_fields(self):
        config = {"frontend": {"theme": {"fonts": {"heading": {}}}}}  # missing family, variant, url
        errors = []
        self.validate(config, "root", errors)
        assert any("Missing required 'family'" in e for e in errors)
        assert any("Missing required 'variant'" in e for e in errors)
        assert any("Missing required 'url'" in e for e in errors)

    @pytest.mark.unit
    def test_no_fonts_key_noop(self):
        config = {"frontend": {"theme": {}}}
        errors = []
        self.validate(config, "root", errors)
        assert errors == []
