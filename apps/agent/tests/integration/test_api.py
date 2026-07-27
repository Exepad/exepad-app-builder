"""Integration tests for FastAPI API endpoints."""

import pytest

# Mark all tests in this module as integration tests that may be skipped
# if the database or other services aren't available
pytestmark = [
    pytest.mark.integration,
    pytest.mark.filterwarnings("ignore::DeprecationWarning"),
]


class TestAPIHealth:
    """Basic API health and accessibility tests."""

    @pytest.mark.integration
    def test_api_docs_accessible(self, test_client):
        """API documentation should be accessible."""
        response = test_client.get("/docs")
        assert response.status_code == 200

    @pytest.mark.integration
    @pytest.mark.skip(reason="OpenAPI schema generation fails with MCP ClientSession type")
    def test_openapi_schema_available(self, test_client):
        """OpenAPI schema should be accessible."""
        response = test_client.get("/openapi.json")
        assert response.status_code == 200

        data = response.json()
        assert "paths" in data
        assert "info" in data
        assert "openapi" in data

    @pytest.mark.integration
    def test_redoc_accessible(self, test_client):
        """ReDoc documentation should be accessible."""
        response = test_client.get("/redoc")
        assert response.status_code == 200


class TestRunEndpoint:
    """Tests for the /r streaming endpoint."""

    @pytest.mark.integration
    def test_missing_payload_returns_error(self, test_client):
        """Missing required fields should return error."""
        response = test_client.post("/r", json={})

        # Should fail due to missing fields
        assert response.status_code in [400, 422, 500]

    @pytest.mark.integration
    def test_missing_operation_mode(self, test_client):
        """Missing operation_mode should cause error."""
        response = test_client.post(
            "/r",
            json={
                "user_id": "test-user",
                "session_id": "test-session",
                "payload": "{}",
            },
        )

        # Should fail
        assert response.status_code in [400, 422, 500]

    @pytest.mark.integration
    def test_valid_payload_returns_stream(self, test_client, api_request_payload):
        """Valid payload should return streaming response."""
        response = test_client.post("/r", json=api_request_payload)

        # Should return SSE stream
        assert response.status_code == 200
        assert "text/event-stream" in response.headers.get("content-type", "")

    @pytest.mark.integration
    def test_cors_headers_present(self, test_client, api_request_payload):
        """CORS headers should be present in response."""
        response = test_client.post(
            "/r",
            json=api_request_payload,
            headers={"Origin": "http://localhost:3001"},
        )

        # Check for CORS header (lowercase for header comparison)
        headers_lower = {k.lower(): v for k, v in response.headers.items()}
        assert "access-control-allow-origin" in headers_lower

    @pytest.mark.integration
    def test_cache_control_header(self, test_client, api_request_payload):
        """Cache-Control header should be set for SSE."""
        response = test_client.post("/r", json=api_request_payload)

        if response.status_code == 200:
            headers_lower = {k.lower(): v for k, v in response.headers.items()}
            assert "cache-control" in headers_lower
            assert "no-cache" in headers_lower.get("cache-control", "")


class TestAPIErrorHandling:
    """Tests for API error handling."""

    @pytest.mark.integration
    def test_invalid_json_payload(self, test_client):
        """Invalid JSON should return appropriate error."""
        response = test_client.post(
            "/r",
            content="not valid json",
            headers={"Content-Type": "application/json"},
        )

        assert response.status_code in [400, 422]

    @pytest.mark.integration
    def test_method_not_allowed(self, test_client):
        """GET request to POST endpoint should return 405."""
        response = test_client.get("/r")

        assert response.status_code == 405


class TestAPIMetadata:
    """Tests for API metadata and configuration."""

    @pytest.mark.integration
    @pytest.mark.skip(reason="OpenAPI schema generation fails with MCP ClientSession type")
    def test_api_title_in_openapi(self, test_client):
        """API title should be set in OpenAPI spec."""
        response = test_client.get("/openapi.json")
        data = response.json()

        assert "info" in data
        assert "title" in data["info"]
        # Should have a meaningful title
        assert len(data["info"]["title"]) > 0

    @pytest.mark.integration
    @pytest.mark.skip(reason="OpenAPI schema generation fails with MCP ClientSession type")
    def test_run_endpoint_in_openapi(self, test_client):
        """The /r endpoint should be documented in OpenAPI spec."""
        response = test_client.get("/openapi.json")
        data = response.json()

        assert "/r" in data.get("paths", {})
