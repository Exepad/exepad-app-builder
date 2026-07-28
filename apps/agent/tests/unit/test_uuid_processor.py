"""Unit tests for UUID processor - UUID validation and fixing."""

import uuid as uuid_lib

import pytest


class TestUUIDValidation:
    """Tests for UUID validation logic."""

    @pytest.mark.unit
    def test_is_valid_uuid_standard_format(self):
        """Standard UUID format should be valid."""
        valid_uuid = str(uuid_lib.uuid4())
        try:
            uuid_lib.UUID(valid_uuid)
            is_valid = True
        except (ValueError, AttributeError):
            is_valid = False

        assert is_valid is True

    @pytest.mark.unit
    def test_is_valid_uuid_invalid_string(self):
        """Non-UUID string should be invalid."""
        invalid = "not-a-uuid"
        try:
            uuid_lib.UUID(invalid)
            is_valid = True
        except (ValueError, AttributeError):
            is_valid = False

        assert is_valid is False

    @pytest.mark.unit
    def test_is_valid_uuid_empty_string(self):
        """Empty string should be invalid."""
        try:
            uuid_lib.UUID("")
            is_valid = True
        except (ValueError, AttributeError):
            is_valid = False

        assert is_valid is False

    @pytest.mark.unit
    def test_is_valid_uuid_custom_id(self):
        """Custom ID like 'page-001' should be invalid UUID."""
        try:
            uuid_lib.UUID("page-001")
            is_valid = True
        except (ValueError, AttributeError):
            is_valid = False

        assert is_valid is False

    @pytest.mark.unit
    def test_is_valid_uuid_partial(self):
        """Partial UUID should be invalid."""
        try:
            uuid_lib.UUID("12345678-1234")
            is_valid = True
        except (ValueError, AttributeError):
            is_valid = False

        assert is_valid is False


class TestUUIDProcessorLogic:
    """Tests for UUID processor logic (without async context)."""

    def _process_uuids_sync(self, config, existing_uuids=None):  # noqa: C901
        """
        Synchronous version of UUID processing logic for testing.
        Mimics the recursive UUID fixing without async context.
        """
        seen_uuids = set(existing_uuids) if existing_uuids else set()
        preserved_uuids = set(existing_uuids) if existing_uuids else set()

        stats = {"valid_uuids": 0, "fixed_invalid": 0, "fixed_duplicates": 0}

        def is_valid_uuid(value):
            if not isinstance(value, str):
                return False
            try:
                uuid_lib.UUID(value)
                return True
            except (ValueError, AttributeError):
                return False

        def check_and_fix_recursively(obj):
            if isinstance(obj, dict):
                for key, value in obj.items():
                    if "uuid" in key.lower():
                        needs_new_uuid = False

                        if not is_valid_uuid(value):
                            if value not in preserved_uuids:
                                needs_new_uuid = True
                                stats["fixed_invalid"] += 1
                        elif value in seen_uuids:
                            if value not in preserved_uuids:
                                needs_new_uuid = True
                                stats["fixed_duplicates"] += 1
                        else:
                            seen_uuids.add(value)
                            stats["valid_uuids"] += 1

                        if needs_new_uuid:
                            new_uuid = str(uuid_lib.uuid4())
                            while new_uuid in seen_uuids:
                                new_uuid = str(uuid_lib.uuid4())
                            seen_uuids.add(new_uuid)
                            obj[key] = new_uuid
                    else:
                        check_and_fix_recursively(value)
            elif isinstance(obj, list):
                for item in obj:
                    check_and_fix_recursively(item)

        check_and_fix_recursively(config)
        return config, stats

    @pytest.mark.unit
    def test_valid_uuids_unchanged(self):
        """Valid UUIDs should not be changed."""
        valid_uuid = str(uuid_lib.uuid4())
        config = {"uuid": valid_uuid, "name": "Test"}

        result, stats = self._process_uuids_sync(config)

        assert result["uuid"] == valid_uuid
        assert stats["valid_uuids"] == 1
        assert stats["fixed_invalid"] == 0

    @pytest.mark.unit
    def test_invalid_uuid_gets_fixed(self):
        """Invalid UUIDs should be replaced with valid ones."""
        config = {"uuid": "invalid-uuid-format", "name": "Test"}

        result, stats = self._process_uuids_sync(config)

        # Should have a new valid UUID
        assert result["uuid"] != "invalid-uuid-format"
        try:
            uuid_lib.UUID(result["uuid"])
            is_valid = True
        except (ValueError, AttributeError):
            is_valid = False
        assert is_valid is True
        assert stats["fixed_invalid"] == 1

    @pytest.mark.unit
    def test_duplicate_uuid_gets_fixed(self):
        """Duplicate UUIDs should be replaced with unique ones."""
        shared_uuid = str(uuid_lib.uuid4())
        config = {
            "uuid": shared_uuid,
            "content": [
                {"uuid": shared_uuid},  # Duplicate
            ],
        }

        result, stats = self._process_uuids_sync(config)

        # Root UUID should stay
        assert result["uuid"] == shared_uuid
        # Content item should get a new UUID
        assert result["content"][0]["uuid"] != shared_uuid
        assert stats["fixed_duplicates"] == 1

    @pytest.mark.unit
    def test_preserved_uuids_not_changed(self):
        """Existing UUIDs that should be preserved should not change."""
        existing_uuid = str(uuid_lib.uuid4())
        config = {
            "uuid": existing_uuid,
            "content": [
                {"uuid": existing_uuid},  # Would be duplicate, but preserved
            ],
        }

        result, stats = self._process_uuids_sync(config, existing_uuids=[existing_uuid])

        # Both should keep the preserved UUID
        assert result["uuid"] == existing_uuid
        # The second occurrence is preserved even though it's a "duplicate"
        assert result["content"][0]["uuid"] == existing_uuid

    @pytest.mark.unit
    def test_nested_structure_processed(self):
        """Nested structures should be fully processed."""
        config = {
            "uuid": "invalid-1",
            "pages": [
                {
                    "uuid": "invalid-2",
                    "content": [{"uuid": "invalid-3", "componentType": "TextProps"}],
                }
            ],
        }

        result, stats = self._process_uuids_sync(config)

        # All should be fixed
        assert stats["fixed_invalid"] == 3

        # All should now be valid UUIDs
        for uuid_field in [
            result["uuid"],
            result["pages"][0]["uuid"],
            result["pages"][0]["content"][0]["uuid"],
        ]:
            try:
                uuid_lib.UUID(uuid_field)
                is_valid = True
            except (ValueError, AttributeError):
                is_valid = False
            assert is_valid is True

    @pytest.mark.unit
    def test_uuid_field_case_insensitive(self):
        """UUID field detection should be case-insensitive."""
        config = {
            "UUID": "invalid-1",  # Uppercase
            "pageUuid": "invalid-2",  # Mixed case
        }

        result, stats = self._process_uuids_sync(config)

        assert stats["fixed_invalid"] == 2

    @pytest.mark.unit
    def test_non_uuid_fields_ignored(self):
        """Fields not containing 'uuid' should be ignored."""
        valid_id = "page-001"
        config = {
            "id": valid_id,  # Not a UUID field
            "uuid": "invalid-uuid",  # UUID field
        }

        result, stats = self._process_uuids_sync(config)

        # id field should be unchanged
        assert result["id"] == valid_id
        # uuid field should be fixed
        assert result["uuid"] != "invalid-uuid"
        assert stats["fixed_invalid"] == 1


class TestUUIDProcessorEdgeCases:
    """Edge case tests for UUID processing."""

    def _process_uuids_sync(self, config, existing_uuids=None):  # noqa: C901
        """Synchronous UUID processing for testing."""
        seen_uuids = set(existing_uuids) if existing_uuids else set()
        preserved_uuids = set(existing_uuids) if existing_uuids else set()

        def is_valid_uuid(value):
            if not isinstance(value, str):
                return False
            try:
                uuid_lib.UUID(value)
                return True
            except (ValueError, AttributeError):
                return False

        def check_and_fix_recursively(obj):
            if isinstance(obj, dict):
                for key, value in obj.items():
                    if "uuid" in key.lower():
                        if not is_valid_uuid(value):
                            if value not in preserved_uuids:
                                new_uuid = str(uuid_lib.uuid4())
                                while new_uuid in seen_uuids:
                                    new_uuid = str(uuid_lib.uuid4())
                                seen_uuids.add(new_uuid)
                                obj[key] = new_uuid
                        elif value in seen_uuids and value not in preserved_uuids:
                            new_uuid = str(uuid_lib.uuid4())
                            while new_uuid in seen_uuids:
                                new_uuid = str(uuid_lib.uuid4())
                            seen_uuids.add(new_uuid)
                            obj[key] = new_uuid
                        else:
                            seen_uuids.add(value)
                    else:
                        check_and_fix_recursively(value)
            elif isinstance(obj, list):
                for item in obj:
                    check_and_fix_recursively(item)

        check_and_fix_recursively(config)
        return config

    @pytest.mark.unit
    def test_empty_config(self):
        """Empty config should be handled."""
        config = {}
        result = self._process_uuids_sync(config)
        assert result == {}

    @pytest.mark.unit
    def test_config_with_no_uuids(self):
        """Config without UUID fields should be unchanged."""
        config = {"name": "Test", "value": 123}
        result = self._process_uuids_sync(config)
        assert result == {"name": "Test", "value": 123}

    @pytest.mark.unit
    def test_list_of_components(self):
        """List of components should all be processed."""
        config = {
            "content": [
                {"uuid": "invalid-1"},
                {"uuid": "invalid-2"},
                {"uuid": "invalid-3"},
            ]
        }

        result = self._process_uuids_sync(config)

        # All should be valid and unique
        uuids = [item["uuid"] for item in result["content"]]
        for u in uuids:
            try:
                uuid_lib.UUID(u)
                is_valid = True
            except (ValueError, AttributeError):
                is_valid = False
            assert is_valid is True

        # All should be unique
        assert len(uuids) == len(set(uuids))

    @pytest.mark.unit
    def test_deeply_nested_structure(self):
        """Deeply nested structures should be processed."""
        config = {
            "uuid": "level-0",
            "child": {
                "uuid": "level-1",
                "child": {
                    "uuid": "level-2",
                    "child": {
                        "uuid": "level-3",
                    },
                },
            },
        }

        result = self._process_uuids_sync(config)

        # All UUIDs should be valid
        def collect_uuids(obj, uuids=None):
            if uuids is None:
                uuids = []
            if isinstance(obj, dict):
                for key, value in obj.items():
                    if "uuid" in key.lower():
                        uuids.append(value)
                    else:
                        collect_uuids(value, uuids)
            return uuids

        uuids = collect_uuids(result)
        assert len(uuids) == 4
        for u in uuids:
            try:
                uuid_lib.UUID(u)
                is_valid = True
            except (ValueError, AttributeError):
                is_valid = False
            assert is_valid is True


class TestGeneratedUUIDQuality:
    """Tests for quality of generated UUIDs."""

    @pytest.mark.unit
    def test_generated_uuid_is_valid_format(self):
        """Generated UUIDs should be valid UUID4 format."""
        new_uuid = str(uuid_lib.uuid4())

        # Should be valid
        parsed = uuid_lib.UUID(new_uuid)
        assert parsed.version == 4

    @pytest.mark.unit
    def test_generated_uuids_are_unique(self):
        """Multiple generated UUIDs should be unique."""
        uuids = [str(uuid_lib.uuid4()) for _ in range(100)]

        # All should be unique
        assert len(uuids) == len(set(uuids))

    @pytest.mark.unit
    def test_uuid_string_format(self):
        """UUID string should have correct format."""
        new_uuid = str(uuid_lib.uuid4())

        # Should be 36 characters with 4 hyphens
        assert len(new_uuid) == 36
        assert new_uuid.count("-") == 4

        # Should match pattern: 8-4-4-4-12
        parts = new_uuid.split("-")
        assert len(parts) == 5
        assert len(parts[0]) == 8
        assert len(parts[1]) == 4
        assert len(parts[2]) == 4
        assert len(parts[3]) == 4
        assert len(parts[4]) == 12
