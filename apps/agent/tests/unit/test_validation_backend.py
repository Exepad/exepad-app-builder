"""Tests for validation.backend — BackendProps schema validation with enriched errors."""

import json

import pytest

# ---------------------------------------------------------------------------
# Inline test data
# ---------------------------------------------------------------------------

VALID_MODEL = {
    "uuid": "model-001",
    "name": "books",
    "summary": "Library book catalog",
    "columns": [
        {"name": "title", "type": "text", "summary": "Book title"},
        {"name": "author", "type": "text", "summary": "Author name"},
        {"name": "year", "type": "integer", "summary": "Publication year"},
    ],
}

VALID_HANDLER = {
    "uuid": "handler-001",
    "name": "getBooks",
    "summary": "Fetches books",
    "authLevel": "public",
    "handlerType": "read",
    "inputs": [{"name": "category", "type": "string", "summary": "Category filter"}],
    "outputs": [{"name": "books", "type": "array", "summary": "Book list"}],
    "method": "getBooks",
}


def _j(obj: dict) -> str:
    return json.dumps(obj)


# ===========================================================================
# Basic validation
# ===========================================================================


class TestValidateBackendPropsBasic:
    @pytest.mark.unit
    def test_valid_minimal_config_passes(self, validate_backend):
        result = validate_backend(_j({"models": [VALID_MODEL], "handlers": []}))
        assert result["valid"] is True
        assert result["errors"] == []

    @pytest.mark.unit
    def test_valid_config_with_handlers(self, validate_backend):
        result = validate_backend(_j({"models": [VALID_MODEL], "handlers": [VALID_HANDLER]}))
        assert result["valid"] is True

    @pytest.mark.unit
    def test_valid_empty_models_array(self, validate_backend):
        result = validate_backend(_j({"models": []}))
        assert result["valid"] is True

    @pytest.mark.unit
    def test_valid_empty_handlers_array(self, validate_backend):
        result = validate_backend(_j({"models": [], "handlers": []}))
        assert result["valid"] is True

    @pytest.mark.unit
    def test_valid_complex_config(self, validate_backend):
        config = {
            "models": [
                VALID_MODEL,
                {
                    "uuid": "model-002",
                    "name": "authors",
                    "summary": "Author records",
                    "columns": [
                        {"name": "full_name", "type": "text", "summary": "Author full name"},
                        {
                            "name": "book_count",
                            "type": "integer",
                            "summary": "Number of books",
                            "references": {"model": "books", "column": "id"},
                        },
                    ],
                },
            ],
            "handlers": [VALID_HANDLER],
        }
        result = validate_backend(_j(config))
        assert result["valid"] is True

    @pytest.mark.unit
    def test_returns_dict_with_expected_keys(self, validate_backend):
        result = validate_backend(_j({"models": []}))
        assert "valid" in result
        assert "errors" in result
        assert isinstance(result["valid"], bool)
        assert isinstance(result["errors"], list)

    @pytest.mark.unit
    def test_valid_config_with_optional_fields(self, validate_backend):
        model = {
            **VALID_MODEL,
            "softDelete": True,
            "ownerScope": "shared",
            "migrationPolicy": "safe",
            "crudPolicy": {
                "create": "authenticated",
                "read": "public",
                "update": "authenticated",
                "delete": "admin",
            },
        }
        result = validate_backend(_j({"models": [model], "handlers": []}))
        assert result["valid"] is True


# ===========================================================================
# JSON parsing
# ===========================================================================


class TestValidateBackendPropsJsonParsing:
    @pytest.mark.unit
    def test_invalid_json_syntax(self, validate_backend):
        result = validate_backend("{invalid json")
        assert result["valid"] is False
        assert any("Invalid JSON" in e for e in result["errors"])

    @pytest.mark.unit
    def test_non_object_json_array(self, validate_backend):
        result = validate_backend("[]")
        assert result["valid"] is False
        assert any("JSON object" in e for e in result["errors"])

    @pytest.mark.unit
    def test_non_object_json_string(self, validate_backend):
        result = validate_backend('"hello"')
        assert result["valid"] is False
        assert any("JSON object" in e for e in result["errors"])

    @pytest.mark.unit
    def test_markdown_fences_stripped(self, validate_backend):
        wrapped = "```json\n" + _j({"models": []}) + "\n```"
        result = validate_backend(wrapped)
        assert result["valid"] is True

    @pytest.mark.unit
    def test_markdown_fences_with_leading_whitespace(self, validate_backend):
        wrapped = "  \n```json\n" + _j({"models": []}) + "\n```\n  "
        result = validate_backend(wrapped)
        assert result["valid"] is True


# ===========================================================================
# ForeignKeyRef validation
# ===========================================================================


class TestValidateBackendPropsForeignKeyRef:
    def _model_with_ref(self, references: dict) -> str:
        model = {
            **VALID_MODEL,
            "columns": [
                {"name": "title", "type": "text", "summary": "Title"},
                {"name": "author_id", "type": "integer", "summary": "FK", "references": references},
            ],
        }
        return _j({"models": [model], "handlers": []})

    @pytest.mark.unit
    def test_fk_table_instead_of_model(self, validate_backend):
        result = validate_backend(self._model_with_ref({"table": "authors", "column": "id"}))
        assert result["valid"] is False
        assert any("'table' is not valid" in e and "use 'model'" in e for e in result["errors"])

    @pytest.mark.unit
    def test_fk_missing_model(self, validate_backend):
        result = validate_backend(self._model_with_ref({"column": "id"}))
        assert result["valid"] is False
        assert any("missing required field 'model'" in e for e in result["errors"])

    @pytest.mark.unit
    def test_fk_missing_column(self, validate_backend):
        result = validate_backend(self._model_with_ref({"model": "authors"}))
        assert result["valid"] is False
        assert any("missing required field 'column'" in e for e in result["errors"])

    @pytest.mark.unit
    @pytest.mark.parametrize("wrong_casing", ["ondelete", "on_delete"])
    def test_fk_ondelete_wrong_casing(self, validate_backend, wrong_casing):
        ref = {"model": "authors", "column": "id", wrong_casing: "cascade"}
        result = validate_backend(self._model_with_ref(ref))
        assert result["valid"] is False
        assert any("'onDelete'" in e for e in result["errors"])

    @pytest.mark.unit
    def test_fk_valid_reference(self, validate_backend):
        ref = {"model": "authors", "column": "id", "onDelete": "cascade"}
        result = validate_backend(self._model_with_ref(ref))
        assert result["valid"] is True


# ===========================================================================
# Schema errors — description→summary, missing fields
# ===========================================================================


class TestValidateBackendPropsSchemaErrors:
    @pytest.mark.unit
    def test_description_instead_of_summary_on_model(self, validate_backend):
        model = {**VALID_MODEL, "description": "A catalog"}
        del model["summary"]
        # re-add columns without summary to avoid noise
        result = validate_backend(_j({"models": [model], "handlers": []}))
        assert result["valid"] is False
        assert any("'description' is not valid" in e and "'summary'" in e for e in result["errors"])

    @pytest.mark.unit
    def test_description_instead_of_summary_on_handler(self, validate_backend):
        handler = {**VALID_HANDLER, "description": "Fetches books"}
        del handler["summary"]
        result = validate_backend(_j({"models": [], "handlers": [handler]}))
        assert result["valid"] is False
        assert any("'description' is not valid" in e and "'summary'" in e for e in result["errors"])

    @pytest.mark.unit
    def test_description_instead_of_summary_on_column(self, validate_backend):
        model = {
            **VALID_MODEL,
            "columns": [{"name": "title", "type": "text", "description": "The title"}],
        }
        result = validate_backend(_j({"models": [model], "handlers": []}))
        assert result["valid"] is False
        assert any("'description' is not valid" in e and "'summary'" in e for e in result["errors"])

    @pytest.mark.unit
    def test_description_instead_of_summary_on_input(self, validate_backend):
        handler = {
            **VALID_HANDLER,
            "inputs": [{"name": "q", "type": "string", "description": "Query"}],
        }
        result = validate_backend(_j({"models": [], "handlers": [handler]}))
        assert result["valid"] is False
        assert any("'description' is not valid" in e for e in result["errors"])

    @pytest.mark.unit
    def test_description_instead_of_summary_on_output(self, validate_backend):
        handler = {
            **VALID_HANDLER,
            "outputs": [{"name": "data", "type": "json", "description": "Results"}],
        }
        result = validate_backend(_j({"models": [], "handlers": [handler]}))
        assert result["valid"] is False
        assert any("'description' is not valid" in e for e in result["errors"])

    @pytest.mark.unit
    def test_unknown_top_level_property(self, validate_backend):
        result = validate_backend(_j({"models": [], "foo": "bar"}))
        assert result["valid"] is False
        assert any("'foo'" in e for e in result["errors"])


# ===========================================================================
# Column field name mistakes
# ===========================================================================


class TestValidateBackendPropsColumnMistakes:
    def _model_with_col(self, extra_fields: dict) -> str:
        col = {"name": "title", "type": "text", "summary": "Title", **extra_fields}
        model = {**VALID_MODEL, "columns": [col]}
        return _j({"models": [model], "handlers": []})

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "wrong_field,correct_field",
        [
            ("unique", "isUnique"),
            ("nullable", "isNullable"),
            ("primary", "isPrimary"),
            ("primaryKey", "isPrimary"),
            ("default", "defaultValue"),
            ("ref", "references"),
            ("foreignKey", "references"),
        ],
    )
    def test_column_field_renames(self, validate_backend, wrong_field, correct_field):
        result = validate_backend(self._model_with_col({wrong_field: True}))
        assert result["valid"] is False
        assert any(
            f"'{wrong_field}' is not valid" in e and correct_field in e for e in result["errors"]
        )

    @pytest.mark.unit
    def test_column_required_field_error(self, validate_backend):
        result = validate_backend(self._model_with_col({"required": True}))
        assert result["valid"] is False
        assert any("'required'" in e and "isNullable" in e for e in result["errors"])

    @pytest.mark.unit
    def test_unknown_column_field(self, validate_backend):
        result = validate_backend(self._model_with_col({"foobar": True}))
        assert result["valid"] is False
        assert any("'foobar'" in e and "ColumnConfig" in e for e in result["errors"])

    @pytest.mark.unit
    def test_unknown_references_field(self, validate_backend):
        col = {
            "name": "author_id",
            "type": "integer",
            "summary": "FK",
            "references": {"model": "authors", "column": "id", "foo": "bar"},
        }
        model = {**VALID_MODEL, "columns": [col]}
        result = validate_backend(_j({"models": [model], "handlers": []}))
        assert result["valid"] is False
        assert any("ForeignKeyRef" in e for e in result["errors"])


# ===========================================================================
# Handler IO type mistakes
# ===========================================================================


class TestValidateBackendPropsHandlerIO:
    @pytest.mark.unit
    @pytest.mark.parametrize(
        "wrong_type,correct_type",
        [("text", "string"), ("integer", "number"), ("real", "number"), ("blob", "json")],
    )
    def test_handler_input_wrong_type(self, validate_backend, wrong_type, correct_type):
        handler = {
            **VALID_HANDLER,
            "inputs": [{"name": "q", "type": wrong_type, "summary": "Query"}],
        }
        result = validate_backend(_j({"models": [], "handlers": [handler]}))
        assert result["valid"] is False
        assert any(
            f"'{wrong_type}' is a column type" in e and correct_type in e for e in result["errors"]
        )

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "wrong_type,correct_type",
        [("text", "string"), ("integer", "number")],
    )
    def test_handler_output_wrong_type(self, validate_backend, wrong_type, correct_type):
        handler = {
            **VALID_HANDLER,
            "outputs": [{"name": "data", "type": wrong_type, "summary": "Result"}],
        }
        result = validate_backend(_j({"models": [], "handlers": [handler]}))
        assert result["valid"] is False
        assert any(
            f"'{wrong_type}' is a column type" in e and correct_type in e for e in result["errors"]
        )


# ===========================================================================
# Semantic checks
# ===========================================================================


class TestValidateBackendPropsSemanticChecks:
    @pytest.mark.unit
    @pytest.mark.parametrize("sys_col", ["id", "owner_id", "created_at", "updated_at"])
    def test_system_column_declared(self, validate_backend, sys_col):
        model = {
            **VALID_MODEL,
            "columns": [{"name": sys_col, "type": "text", "summary": "System col"}],
        }
        result = validate_backend(_j({"models": [model], "handlers": []}))
        assert result["valid"] is False
        assert any(f"'{sys_col}' is a system column" in e for e in result["errors"])

    @pytest.mark.unit
    @pytest.mark.parametrize("bad_name", ["123abc", "my-table", "has space"])
    def test_invalid_model_name(self, validate_backend, bad_name):
        model = {**VALID_MODEL, "name": bad_name}
        result = validate_backend(_j({"models": [model], "handlers": []}))
        assert result["valid"] is False
        assert any("not a valid SQL identifier" in e for e in result["errors"])

    @pytest.mark.unit
    @pytest.mark.parametrize("good_name", ["books", "loan_records", "_private"])
    def test_valid_model_names(self, validate_backend, good_name):
        model = {**VALID_MODEL, "name": good_name}
        result = validate_backend(_j({"models": [model], "handlers": []}))
        # Should NOT have model name errors (may have other errors but not name-related)
        assert not any("not a valid SQL identifier" in e for e in result["errors"])

    @pytest.mark.unit
    def test_explicit_mode_dynamic_passes(self, validate_backend):
        result = validate_backend(_j({"mode": "dynamic", "models": [VALID_MODEL], "handlers": []}))
        assert result["valid"] is True

    @pytest.mark.unit
    def test_mode_auto_injected_when_missing(self, validate_backend):
        """Validator auto-injects mode: dynamic for backward compat with LLM output."""
        result = validate_backend(_j({"models": [VALID_MODEL]}))
        assert result["valid"] is True

    @pytest.mark.unit
    def test_multiple_system_columns_multiple_errors(self, validate_backend):
        model = {
            **VALID_MODEL,
            "columns": [
                {"name": "id", "type": "text", "summary": "PK"},
                {"name": "owner_id", "type": "text", "summary": "Owner"},
            ],
        }
        result = validate_backend(_j({"models": [model], "handlers": []}))
        assert result["valid"] is False
        sys_errors = [e for e in result["errors"] if "system column" in e]
        assert len(sys_errors) >= 2
