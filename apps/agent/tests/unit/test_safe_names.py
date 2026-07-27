"""Unit tests for the artifact-name path-traversal guard."""

import os

import pytest

from main_agent.services.validation.safe_names import (
    UnsafeArtifactName,
    assert_inside_dir,
    is_safe_artifact_name,
)


class TestIsSafeArtifactName:
    def test_accepts_bare_identifiers(self):
        assert is_safe_artifact_name("HomeContent")
        assert is_safe_artifact_name("_display_variants")
        assert is_safe_artifact_name("Dashboard2")
        assert is_safe_artifact_name("a")

    def test_rejects_traversal_and_separators(self):
        assert not is_safe_artifact_name("../../etc/passwd")
        assert not is_safe_artifact_name("a/b")
        assert not is_safe_artifact_name("a.b")
        assert not is_safe_artifact_name("..")

    def test_rejects_empty_and_leading_digit(self):
        assert not is_safe_artifact_name("")
        assert not is_safe_artifact_name("123abc")  # must start with letter/underscore

    def test_rejects_non_str(self):
        assert not is_safe_artifact_name(None)
        assert not is_safe_artifact_name(123)


class TestAssertInsideDir:
    def test_passes_for_contained_path(self, tmp_path):
        d = str(tmp_path)
        assert_inside_dir(d, os.path.join(d, "child.tsx"))
        assert_inside_dir(d, os.path.join(d, "sub", "child.tsx"))

    def test_raises_when_escaping(self, tmp_path):
        d = str(tmp_path)
        with pytest.raises(UnsafeArtifactName):
            assert_inside_dir(d, os.path.join(d, "..", "..", "escape.tsx"))
