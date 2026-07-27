"""Unit tests for CrossValidator auth scaffold auto-fix."""

import pytest

from main_agent.agents.orchestrator.app_types.shared.services.cross_validator import (
    CrossValidator,
)


def _make_config(*, has_auth_scaffold=False, security=None):
    """Build a minimal app_config for testing auth cross-validation."""
    page_content = []
    if has_auth_scaffold:
        page_content = [
            {
                "componentType": "AuthScaffoldProps",
                "uuid": "auth-1",
                "pages": ["login", "signup"],
            }
        ]

    config = {
        "frontend": {
            "pages": [
                {
                    "uuid": "page-1",
                    "slug": "/auth",
                    "title": "Auth",
                    "content": page_content,
                }
            ],
            "logic": {
                "state": {},
                "actions": {},
                "computed": {},
            },
        },
        "backend": {
            "models": [],
            "handlers": [],
        },
    }

    if security is not None:
        config["security"] = security

    return config


class TestCrossValidatorAuthScaffold:
    @pytest.mark.unit
    def test_no_auth_scaffold_no_change(self):
        """Config without AuthScaffoldProps should not be modified."""
        config = _make_config(has_auth_scaffold=False)
        cv = CrossValidator()
        warnings = cv.validate_and_fix(config)

        assert "security" not in config
        assert not any("security" in w for w in warnings)

    @pytest.mark.unit
    def test_auth_scaffold_with_existing_security_no_change(self):
        """Config with AuthScaffoldProps and existing security should not be overwritten."""
        existing_security = {
            "authProviders": [{"provider": "google"}],
            "sessionDuration": 3600,
            "roles": ["admin"],
        }
        config = _make_config(has_auth_scaffold=True, security=existing_security)
        cv = CrossValidator()
        warnings = cv.validate_and_fix(config)

        # Security should remain unchanged
        assert config["security"]["authProviders"][0]["provider"] == "google"
        assert config["security"]["sessionDuration"] == 3600
        assert not any("Auto-fix: injected minimal security" in w for w in warnings)

    @pytest.mark.unit
    def test_auth_scaffold_without_security_auto_injects(self):
        """Config with AuthScaffoldProps but no security should get auto-injected."""
        config = _make_config(has_auth_scaffold=True)
        cv = CrossValidator()
        warnings = cv.validate_and_fix(config)

        assert "security" in config
        assert config["security"]["authProviders"] == [{"provider": "email"}]
        assert config["security"]["sessionDuration"] == 604800
        assert config["security"]["allowSignup"] is True
        assert any("Auto-fix: injected minimal security" in w for w in warnings)

    @pytest.mark.unit
    def test_auth_scaffold_with_empty_security_auto_injects(self):
        """Config with AuthScaffoldProps and empty security dict should get auto-injected."""
        config = _make_config(has_auth_scaffold=True, security={})
        cv = CrossValidator()
        warnings = cv.validate_and_fix(config)

        assert config["security"]["authProviders"] == [{"provider": "email"}]
        assert any("Auto-fix: injected minimal security" in w for w in warnings)

    @pytest.mark.unit
    def test_auth_scaffold_nested_in_page_detected(self):
        """AuthScaffoldProps nested in page content should be detected."""
        config = {
            "frontend": {
                "pages": [
                    {
                        "uuid": "page-1",
                        "slug": "/",
                        "title": "Home",
                        "content": [
                            {"componentType": "HeroProps", "uuid": "h-1"},
                        ],
                    },
                    {
                        "uuid": "page-2",
                        "slug": "/auth",
                        "title": "Auth",
                        "content": [
                            {
                                "componentType": "AuthScaffoldProps",
                                "uuid": "auth-1",
                                "pages": ["login", "signup"],
                            }
                        ],
                    },
                ],
                "logic": {"state": {}, "actions": {}, "computed": {}},
            },
            "backend": {"models": [], "handlers": []},
        }

        cv = CrossValidator()
        warnings = cv.validate_and_fix(config)

        assert "security" in config
        assert any("Auto-fix: injected minimal security" in w for w in warnings)


def _make_backend_config(models, *, security=None, code_focus=True):
    """Minimal Code Focus app_config carrying backend models (no AuthScaffoldProps)."""
    config = {
        "frontend": {
            "pages": [{"uuid": "p1", "slug": "/", "title": "Home", "content": []}],
            "logic": {"state": {}, "actions": {}, "computed": {}},
        },
        "backend": {"models": models, "handlers": []},
    }
    if code_focus:
        # Mark as Code Focus so the action-based legacy checks are skipped.
        config["repo"] = {"frontend": {"components": {"Home": {}}}}
    if security is not None:
        config["security"] = security
    return config


class TestCrossValidatorAuthenticatedCrud:
    """Auto-inject auth when a model's crudPolicy requires it but no providers exist.

    Regression for the live TicketFlow finding: the Creator set needs_auth=false
    (so no security emitted) while the backend builder set create/update/delete to
    'authenticated' — leaving the app unusable (auth_signup/signin 404) and its
    access model accidental.
    """

    _TICKETS = {
        "name": "tickets",
        "ownerScope": "shared",
        "crudPolicy": {
            "create": "authenticated",
            "read": "public",
            "update": "authenticated",
            "delete": "authenticated",
        },
        "columns": [{"name": "title", "type": "text"}],
    }

    @pytest.mark.unit
    def test_authenticated_crud_without_security_auto_injects(self):
        config = _make_backend_config([self._TICKETS])
        warnings = CrossValidator().validate_and_fix(config)
        assert config.get("security", {}).get("authProviders") == [{"provider": "email"}]
        assert config["security"]["allowSignup"] is True
        assert any("crudPolicy requires authentication" in w for w in warnings)

    @pytest.mark.unit
    def test_owner_and_role_levels_also_trigger(self):
        for level in ("owner", "role:admin"):
            model = {
                "name": "m",
                "crudPolicy": {"create": "public", "read": "public", "update": level},
                "columns": [{"name": "x", "type": "text"}],
            }
            config = _make_backend_config([model])
            CrossValidator().validate_and_fix(config)
            assert config.get("security", {}).get("authProviders") == [{"provider": "email"}], level

    @pytest.mark.unit
    def test_fully_public_app_is_left_untouched(self):
        model = {
            "name": "posts",
            "ownerScope": "shared",
            "crudPolicy": {"create": "public", "read": "public", "update": "public", "delete": "public"},
            "columns": [{"name": "body", "type": "text"}],
        }
        config = _make_backend_config([model])
        warnings = CrossValidator().validate_and_fix(config)
        assert "security" not in config
        assert not any("crudPolicy requires authentication" in w for w in warnings)

    @pytest.mark.unit
    def test_existing_auth_providers_not_overwritten(self):
        existing = {"authProviders": [{"provider": "google"}], "allowSignup": False}
        config = _make_backend_config([self._TICKETS], security=existing)
        CrossValidator().validate_and_fix(config)
        assert config["security"]["authProviders"] == [{"provider": "google"}]
        assert config["security"]["allowSignup"] is False

    @pytest.mark.unit
    def test_no_models_no_injection(self):
        config = _make_backend_config([])
        CrossValidator().validate_and_fix(config)
        assert "security" not in config


class TestCrossValidatorPublicReadPiiInbox:
    """Lock down world-readable contact-PII submission inboxes.

    Regression for the live Paws & Hearts finding: adoption_applications /
    volunteer_signups / contact_submissions were shared + read:'public', so anon
    sys_list returned every applicant's name/email/phone.
    """

    def _inbox(self, name="contact_submissions"):
        return {
            "name": name,
            "ownerScope": "shared",
            "crudPolicy": {"create": "public", "read": "public", "update": "public", "delete": "public"},
            "columns": [
                {"name": "name", "type": "text"},
                {"name": "email", "type": "text"},
                {"name": "phone", "type": "text"},
                {"name": "message", "type": "text"},
            ],
        }

    @pytest.mark.unit
    def test_pii_inbox_read_downgraded_create_preserved(self):
        config = _make_backend_config([self._inbox()])
        warnings = CrossValidator().validate_and_fix(config)
        cp = config["backend"]["models"][0]["crudPolicy"]
        assert cp["read"] == "role:admin"
        assert cp["update"] == "role:admin"
        assert cp["delete"] == "role:admin"
        assert cp["create"] == "public"  # public can still submit
        assert any("Downgraded" in w and "contact PII" in w for w in warnings)

    @pytest.mark.unit
    def test_phone_only_inbox_also_triggers(self):
        m = self._inbox("rsvps")
        m["columns"] = [{"name": "guest", "type": "text"}, {"name": "mobile", "type": "text"}]
        config = _make_backend_config([m])
        CrossValidator().validate_and_fix(config)
        assert config["backend"]["models"][0]["crudPolicy"]["read"] == "role:admin"

    @pytest.mark.unit
    def test_public_catalog_without_pii_is_untouched(self):
        catalog = {
            "name": "pets",
            "ownerScope": "shared",
            "crudPolicy": {"create": "public", "read": "public", "update": "public", "delete": "public"},
            "columns": [
                {"name": "name", "type": "text"},
                {"name": "species", "type": "text"},
                {"name": "breed", "type": "text"},
            ],
        }
        config = _make_backend_config([catalog])
        warnings = CrossValidator().validate_and_fix(config)
        assert config["backend"]["models"][0]["crudPolicy"]["read"] == "public"
        assert not any("Downgraded" in w for w in warnings)

    @pytest.mark.unit
    def test_user_scoped_model_not_downgraded(self):
        # read:public on a user-scoped model returns nothing for anon anyway —
        # the leak only exists for shared scope, so we don't touch user-scope.
        m = self._inbox()
        m["ownerScope"] = "user"
        config = _make_backend_config([m])
        CrossValidator().validate_and_fix(config)
        assert config["backend"]["models"][0]["crudPolicy"]["read"] == "public"

    @pytest.mark.unit
    def test_downgrade_triggers_auth_injection(self):
        # role:admin is an auth-requiring level → the auth-coherence fix should then
        # inject email auth so the operator's admin role has a backing auth system.
        config = _make_backend_config([self._inbox()])
        CrossValidator().validate_and_fix(config)
        assert config.get("security", {}).get("authProviders") == [{"provider": "email"}]
