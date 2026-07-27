"""Tests for SecurityConfig validation in backend.py."""

import json

import pytest


def _j(obj: dict) -> str:
    return json.dumps(obj)


VALID_SECURITY = {
    "authProviders": [{"provider": "email"}],
    "sessionDuration": 604800,
    "roles": ["admin", "editor", "viewer"],
    "roleHierarchy": {"admin": ["editor"], "editor": ["viewer"]},
    "defaultRole": "viewer",
    "defaultAccess": "authenticated",
    "allowSignup": True,
}

MINIMAL_SECURITY = {
    "authProviders": [{"provider": "email"}],
}


# ===========================================================================
# Valid SecurityConfig
# ===========================================================================


class TestSecurityConfigValid:
    @pytest.mark.unit
    def test_valid_full_security_config(self, validate_backend):
        result = validate_backend(
            _j(
                {
                    "models": [],
                    "handlers": [],
                    "security": VALID_SECURITY,
                }
            )
        )
        assert result["valid"] is True, result["errors"]

    @pytest.mark.unit
    def test_valid_minimal_security_config(self, validate_backend):
        result = validate_backend(
            _j(
                {
                    "models": [],
                    "handlers": [],
                    "security": MINIMAL_SECURITY,
                }
            )
        )
        assert result["valid"] is True, result["errors"]

    @pytest.mark.unit
    def test_no_security_config_passes(self, validate_backend):
        """Configs without security should still pass."""
        result = validate_backend(_j({"models": [], "handlers": []}))
        assert result["valid"] is True

    @pytest.mark.unit
    def test_valid_google_provider(self, validate_backend):
        result = validate_backend(
            _j(
                {
                    "models": [],
                    "security": {
                        "authProviders": [{"provider": "google"}],
                    },
                }
            )
        )
        assert result["valid"] is True, result["errors"]

    @pytest.mark.unit
    def test_valid_multiple_providers(self, validate_backend):
        result = validate_backend(
            _j(
                {
                    "models": [],
                    "security": {
                        "authProviders": [
                            {"provider": "email"},
                            {"provider": "google"},
                        ],
                    },
                }
            )
        )
        assert result["valid"] is True, result["errors"]


# ===========================================================================
# Invalid authProviders
# ===========================================================================


class TestSecurityConfigProviders:
    @pytest.mark.unit
    def test_missing_auth_providers(self, validate_backend):
        result = validate_backend(
            _j(
                {
                    "models": [],
                    "security": {"sessionDuration": 604800},
                }
            )
        )
        assert result["valid"] is False
        assert any("authProviders" in e for e in result["errors"])

    @pytest.mark.unit
    def test_empty_auth_providers(self, validate_backend):
        result = validate_backend(
            _j(
                {
                    "models": [],
                    "security": {"authProviders": []},
                }
            )
        )
        assert result["valid"] is False
        assert any("authProviders" in e for e in result["errors"])

    @pytest.mark.unit
    def test_invalid_provider_type(self, validate_backend):
        result = validate_backend(
            _j(
                {
                    "models": [],
                    "security": {
                        "authProviders": [{"provider": "facebook"}],
                    },
                }
            )
        )
        assert result["valid"] is False
        assert any("'facebook' is not valid" in e for e in result["errors"])


# ===========================================================================
# Roles and roleHierarchy
# ===========================================================================


class TestSecurityConfigRoles:
    @pytest.mark.unit
    def test_role_hierarchy_references_undefined_parent(self, validate_backend):
        result = validate_backend(
            _j(
                {
                    "models": [],
                    "security": {
                        "authProviders": [{"provider": "email"}],
                        "roles": ["editor", "viewer"],
                        "roleHierarchy": {"admin": ["editor"]},
                    },
                }
            )
        )
        assert result["valid"] is False
        assert any("parent role 'admin'" in e and "not defined" in e for e in result["errors"])

    @pytest.mark.unit
    def test_role_hierarchy_references_undefined_child(self, validate_backend):
        result = validate_backend(
            _j(
                {
                    "models": [],
                    "security": {
                        "authProviders": [{"provider": "email"}],
                        "roles": ["admin"],
                        "roleHierarchy": {"admin": ["editor"]},
                    },
                }
            )
        )
        assert result["valid"] is False
        assert any("child role 'editor'" in e and "not defined" in e for e in result["errors"])

    @pytest.mark.unit
    def test_default_role_not_in_roles(self, validate_backend):
        result = validate_backend(
            _j(
                {
                    "models": [],
                    "security": {
                        "authProviders": [{"provider": "email"}],
                        "roles": ["admin", "viewer"],
                        "defaultRole": "editor",
                    },
                }
            )
        )
        assert result["valid"] is False
        assert any("defaultRole 'editor'" in e and "not in roles" in e for e in result["errors"])

    @pytest.mark.unit
    def test_valid_default_role(self, validate_backend):
        result = validate_backend(
            _j(
                {
                    "models": [],
                    "security": {
                        "authProviders": [{"provider": "email"}],
                        "roles": ["admin", "viewer"],
                        "defaultRole": "viewer",
                    },
                }
            )
        )
        assert result["valid"] is True, result["errors"]


# ===========================================================================
# defaultAccess
# ===========================================================================


class TestSecurityConfigDefaultAccess:
    @pytest.mark.unit
    def test_default_access_owner_invalid(self, validate_backend):
        result = validate_backend(
            _j(
                {
                    "models": [],
                    "security": {
                        "authProviders": [{"provider": "email"}],
                        "defaultAccess": "owner",
                    },
                }
            )
        )
        assert result["valid"] is False
        assert any("cannot be 'owner'" in e for e in result["errors"])

    @pytest.mark.unit
    def test_default_access_none_invalid(self, validate_backend):
        result = validate_backend(
            _j(
                {
                    "models": [],
                    "security": {
                        "authProviders": [{"provider": "email"}],
                        "defaultAccess": "none",
                    },
                }
            )
        )
        assert result["valid"] is False
        assert any("cannot be 'none'" in e for e in result["errors"])

    @pytest.mark.unit
    def test_default_access_garbage_invalid(self, validate_backend):
        result = validate_backend(
            _j(
                {
                    "models": [],
                    "security": {
                        "authProviders": [{"provider": "email"}],
                        "defaultAccess": "foobar",
                    },
                }
            )
        )
        assert result["valid"] is False
        assert any("not a valid AccessLevel" in e for e in result["errors"])

    @pytest.mark.unit
    @pytest.mark.parametrize("access", ["public", "authenticated", "role:admin", "role:editor"])
    def test_valid_default_access_values(self, validate_backend, access):
        result = validate_backend(
            _j(
                {
                    "models": [],
                    "security": {
                        "authProviders": [{"provider": "email"}],
                        "defaultAccess": access,
                    },
                }
            )
        )
        # Should not have defaultAccess errors
        assert not any("defaultAccess" in e for e in result["errors"])


# ===========================================================================
# sessionDuration
# ===========================================================================


class TestSecurityConfigSessionDuration:
    @pytest.mark.unit
    def test_negative_session_duration(self, validate_backend):
        result = validate_backend(
            _j(
                {
                    "models": [],
                    "security": {
                        "authProviders": [{"provider": "email"}],
                        "sessionDuration": -100,
                    },
                }
            )
        )
        assert result["valid"] is False
        assert any("sessionDuration" in e and "positive" in e for e in result["errors"])

    @pytest.mark.unit
    def test_zero_session_duration(self, validate_backend):
        result = validate_backend(
            _j(
                {
                    "models": [],
                    "security": {
                        "authProviders": [{"provider": "email"}],
                        "sessionDuration": 0,
                    },
                }
            )
        )
        assert result["valid"] is False
        assert any("sessionDuration" in e for e in result["errors"])

    @pytest.mark.unit
    def test_string_session_duration(self, validate_backend):
        result = validate_backend(
            _j(
                {
                    "models": [],
                    "security": {
                        "authProviders": [{"provider": "email"}],
                        "sessionDuration": "604800",
                    },
                }
            )
        )
        assert result["valid"] is False
        assert any("sessionDuration" in e for e in result["errors"])
