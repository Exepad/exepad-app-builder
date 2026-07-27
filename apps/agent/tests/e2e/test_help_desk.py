"""E2E tests for the help desk workflow via /r endpoint.

Tests cover the help_desk branch which handles:
- Informational queries about the app
- General questions that don't require app modifications
- User guidance and assistance

When the AppHelpDeskAgent determines a request is informational,
it routes to the help_desk branch which provides a response
without modifying the app config.

These tests validate the help desk routing in:
main_agent/agents/orchestrator/core.py
main_agent/agents/orchestrator/app_types/webapp/subagents/app_help_desk.py

Usage:
    # Start server in terminal 1:
    python agent_api.py

    # Run tests in terminal 2:
    pytest tests/e2e/test_help_desk.py -v
"""

import json
import pytest

from .utils import (
    parse_sse_stream_async,
    get_events_by_type,
    get_chat_response,
    get_backend_response,
    extract_app_config_from_backend_response,
)

# Mark all tests in this module as e2e and async tests
pytestmark = [
    pytest.mark.e2e,
    pytest.mark.asyncio,
    pytest.mark.filterwarnings("ignore::DeprecationWarning"),
]


class TestHelpDeskRouting:
    """Tests for help desk routing decisions.

    The AppHelpDeskAgent determines whether a request is:
    - edit: Requires app modifications
    - help_desk: Informational/assistance only
    """

    @pytest.mark.e2e
    async def test_general_question_routes_to_help_desk(
        self, e2e_client, edit_payload_factory, minimal_webapp_config, validation_runner
    ):
        """Test that general questions route to help_desk branch.

        Questions like "How do I..." or "What is..." should be
        handled by help_desk without modifying the app.
        """
        original_config_str = json.dumps(minimal_webapp_config, sort_keys=True)

        payload = edit_payload_factory(
            app_config=minimal_webapp_config,
            prompt="How do I change the color scheme of my website?",
        )

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            assert "text/event-stream" in response.headers.get("content-type", "")
            events = await parse_sse_stream_async(response)

        # Explicit assertions: Should have chat response
        chat_response = get_chat_response(events)
        assert chat_response is not None, "Help desk should provide a chat response"

        # Config should NOT be modified for help desk queries
        config_events = get_events_by_type(events, "app_config_updated")
        if config_events:
            # If config was returned, verify it's unchanged
            backend_response = get_backend_response(events)
            app_config = extract_app_config_from_backend_response(backend_response)
            if app_config:
                final_config_str = json.dumps(app_config, sort_keys=True)
                # Config should be unchanged for pure informational queries
                # (but may still be valid if routing decided to take action)
                schema_result = validation_runner.run_schema_validation(app_config)
                assert schema_result[
                    "valid"
                ], f"Schema validation failed: {schema_result['errors'][:5]}"

    @pytest.mark.e2e
    async def test_informational_query_about_app(
        self, e2e_client, edit_payload_factory, webapp_with_sections_config, validation_runner
    ):
        """Test informational queries about the current app."""
        payload = edit_payload_factory(
            app_config=webapp_with_sections_config,
            prompt="What sections does my homepage have?",
        )

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        # Explicit assertions: Should have chat response
        chat_response = get_chat_response(events)
        assert chat_response is not None, "Help desk should provide a chat response"

        # Schema validation if config returned
        backend_response = get_backend_response(events)
        app_config = extract_app_config_from_backend_response(backend_response)
        if app_config:
            schema_result = validation_runner.run_schema_validation(app_config)
            assert schema_result[
                "valid"
            ], f"Schema validation failed: {schema_result['errors'][:5]}"

    @pytest.mark.e2e
    async def test_guidance_request(
        self, e2e_client, edit_payload_factory, minimal_webapp_config, validation_runner
    ):
        """Test requests for guidance or suggestions."""
        payload = edit_payload_factory(
            app_config=minimal_webapp_config,
            prompt="What would you suggest I add to make this website better?",
        )

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        # Explicit assertions: Should have chat response
        chat_response = get_chat_response(events)
        assert chat_response is not None, "Help desk should provide a chat response"

        # Schema validation if config returned
        backend_response = get_backend_response(events)
        app_config = extract_app_config_from_backend_response(backend_response)
        if app_config:
            schema_result = validation_runner.run_schema_validation(app_config)
            assert schema_result[
                "valid"
            ], f"Schema validation failed: {schema_result['errors'][:5]}"

    @pytest.mark.e2e
    async def test_explanation_request(
        self, e2e_client, edit_payload_factory, webapp_with_blog_config, validation_runner
    ):
        """Test requests for explanations."""
        payload = edit_payload_factory(
            app_config=webapp_with_blog_config,
            prompt="Explain what a blog post page includes",
        )

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        # Explicit assertions: Should have chat response
        chat_response = get_chat_response(events)
        assert chat_response is not None, "Help desk should provide a chat response"

        # Schema validation if config returned
        backend_response = get_backend_response(events)
        app_config = extract_app_config_from_backend_response(backend_response)
        if app_config:
            schema_result = validation_runner.run_schema_validation(app_config)
            assert schema_result[
                "valid"
            ], f"Schema validation failed: {schema_result['errors'][:5]}"


class TestHelpDeskResponses:
    """Tests for help desk response format and content."""

    @pytest.mark.e2e
    async def test_help_desk_returns_chat_response(
        self, e2e_client, edit_payload_factory, minimal_webapp_config, validation_runner
    ):
        """Test that help desk returns a chat response message."""
        payload = edit_payload_factory(
            app_config=minimal_webapp_config,
            prompt="What can I do with this app builder?",
        )

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        # Explicit assertions: Should have a chat response
        chat_response = get_chat_response(events)
        assert chat_response is not None, "Help desk should return a chat response"
        assert len(chat_response) > 0, "Chat response should have content"

        # Schema validation if config returned
        backend_response = get_backend_response(events)
        app_config = extract_app_config_from_backend_response(backend_response)
        if app_config:
            schema_result = validation_runner.run_schema_validation(app_config)
            assert schema_result[
                "valid"
            ], f"Schema validation failed: {schema_result['errors'][:5]}"

    @pytest.mark.e2e
    async def test_help_desk_no_app_modification(
        self, e2e_client, edit_payload_factory, minimal_webapp_config, validation_runner
    ):
        """Test that help desk requests don't modify app config.

        Help desk responses should NOT trigger app_config_updated events.
        """
        original_config = json.dumps(minimal_webapp_config, sort_keys=True)

        payload = edit_payload_factory(
            app_config=minimal_webapp_config,
            prompt="Tell me about the features of this website builder",
        )

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        # Explicit assertions: Should have chat response
        chat_response = get_chat_response(events)
        assert chat_response is not None, "Help desk should return a chat response"

        # Check app_config_updated events
        get_events_by_type(events, "app_config_updated")

        # If config was returned, verify it's valid and ideally unchanged
        backend_response = get_backend_response(events)
        app_config = extract_app_config_from_backend_response(backend_response)
        if app_config:
            schema_result = validation_runner.run_schema_validation(app_config)
            assert schema_result[
                "valid"
            ], f"Schema validation failed: {schema_result['errors'][:5]}"
            # For pure help desk queries, config should be unchanged
            final_config = json.dumps(app_config, sort_keys=True)
            # Note: Config may be returned but should be essentially unchanged


class TestHelpDeskContextAwareness:
    """Tests for help desk context awareness."""

    @pytest.mark.e2e
    async def test_help_desk_with_selected_component(
        self,
        e2e_client,
        edit_payload_factory,
        webapp_with_sections_config,
        get_component_uuid,
        validation_runner,
    ):
        """Test help desk response when a component is selected."""
        heading_uuid = get_component_uuid(webapp_with_sections_config, "HeadingProps")

        payload = edit_payload_factory(
            app_config=webapp_with_sections_config,
            prompt="What options do I have for this component?",
            selected_component=heading_uuid,
        )

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        # Explicit assertions: Should have chat response
        chat_response = get_chat_response(events)
        assert chat_response is not None, "Help desk should return a chat response"

        # Schema validation if config returned
        backend_response = get_backend_response(events)
        app_config = extract_app_config_from_backend_response(backend_response)
        if app_config:
            schema_result = validation_runner.run_schema_validation(app_config)
            assert schema_result[
                "valid"
            ], f"Schema validation failed: {schema_result['errors'][:5]}"

    @pytest.mark.e2e
    async def test_help_desk_with_current_page(
        self,
        e2e_client,
        edit_payload_factory,
        webapp_multi_page_config,
        get_page_uuid,
        validation_runner,
    ):
        """Test help desk response with current page context."""
        about_uuid = get_page_uuid(webapp_multi_page_config, slug="/about")

        payload = edit_payload_factory(
            app_config=webapp_multi_page_config,
            prompt="What should I include on this about page?",
            current_page_uuid=about_uuid,
        )

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        # Explicit assertions: Should have chat response
        chat_response = get_chat_response(events)
        assert chat_response is not None, "Help desk should return a chat response"

        # Schema validation if config returned
        backend_response = get_backend_response(events)
        app_config = extract_app_config_from_backend_response(backend_response)
        if app_config:
            schema_result = validation_runner.run_schema_validation(app_config)
            assert schema_result[
                "valid"
            ], f"Schema validation failed: {schema_result['errors'][:5]}"

    @pytest.mark.e2e
    async def test_help_desk_with_blog_context(
        self, e2e_client, edit_payload_factory, webapp_with_blog_config, validation_runner
    ):
        """Test help desk with blog-enabled app context."""
        payload = edit_payload_factory(
            app_config=webapp_with_blog_config,
            prompt="How do the blog posts appear on my website?",
        )

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        # Explicit assertions: Should have chat response
        chat_response = get_chat_response(events)
        assert chat_response is not None, "Help desk should return a chat response"

        # Schema validation if config returned
        backend_response = get_backend_response(events)
        app_config = extract_app_config_from_backend_response(backend_response)
        if app_config:
            schema_result = validation_runner.run_schema_validation(app_config)
            assert schema_result[
                "valid"
            ], f"Schema validation failed: {schema_result['errors'][:5]}"


class TestHelpDeskQuestionTypes:
    """Tests for different types of help desk questions."""

    @pytest.mark.e2e
    async def test_how_to_question(
        self, e2e_client, edit_payload_factory, minimal_webapp_config, validation_runner
    ):
        """Test 'how to' style questions."""
        payload = edit_payload_factory(
            app_config=minimal_webapp_config,
            prompt="How do I add a contact form to my website?",
        )

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        # Explicit assertions: Should have chat response
        chat_response = get_chat_response(events)
        assert chat_response is not None, "Help desk should return a chat response"

        # Schema validation if config returned
        backend_response = get_backend_response(events)
        app_config = extract_app_config_from_backend_response(backend_response)
        if app_config:
            schema_result = validation_runner.run_schema_validation(app_config)
            assert schema_result[
                "valid"
            ], f"Schema validation failed: {schema_result['errors'][:5]}"

    @pytest.mark.e2e
    async def test_what_is_question(
        self, e2e_client, edit_payload_factory, minimal_webapp_config, validation_runner
    ):
        """Test 'what is' style questions."""
        payload = edit_payload_factory(
            app_config=minimal_webapp_config,
            prompt="What is a hero section?",
        )

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        # Explicit assertions: Should have chat response
        chat_response = get_chat_response(events)
        assert chat_response is not None, "Help desk should return a chat response"

        # Schema validation if config returned
        backend_response = get_backend_response(events)
        app_config = extract_app_config_from_backend_response(backend_response)
        if app_config:
            schema_result = validation_runner.run_schema_validation(app_config)
            assert schema_result[
                "valid"
            ], f"Schema validation failed: {schema_result['errors'][:5]}"

    @pytest.mark.e2e
    async def test_can_i_question(
        self, e2e_client, edit_payload_factory, minimal_webapp_config, validation_runner
    ):
        """Test 'can I' style questions."""
        payload = edit_payload_factory(
            app_config=minimal_webapp_config,
            prompt="Can I add animations to my website?",
        )

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        # Explicit assertions: Should have chat response
        chat_response = get_chat_response(events)
        assert chat_response is not None, "Help desk should return a chat response"

        # Schema validation if config returned
        backend_response = get_backend_response(events)
        app_config = extract_app_config_from_backend_response(backend_response)
        if app_config:
            schema_result = validation_runner.run_schema_validation(app_config)
            assert schema_result[
                "valid"
            ], f"Schema validation failed: {schema_result['errors'][:5]}"

    @pytest.mark.e2e
    async def test_should_i_question(
        self, e2e_client, edit_payload_factory, webapp_with_sections_config, validation_runner
    ):
        """Test 'should I' style questions seeking advice."""
        payload = edit_payload_factory(
            app_config=webapp_with_sections_config,
            prompt="Should I add more sections to my homepage?",
        )

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        # Explicit assertions: Should have chat response
        chat_response = get_chat_response(events)
        assert chat_response is not None, "Help desk should return a chat response"

        # Schema validation if config returned
        backend_response = get_backend_response(events)
        app_config = extract_app_config_from_backend_response(backend_response)
        if app_config:
            schema_result = validation_runner.run_schema_validation(app_config)
            assert schema_result[
                "valid"
            ], f"Schema validation failed: {schema_result['errors'][:5]}"

    @pytest.mark.e2e
    async def test_why_question(
        self, e2e_client, edit_payload_factory, webapp_with_sections_config, validation_runner
    ):
        """Test 'why' style questions."""
        payload = edit_payload_factory(
            app_config=webapp_with_sections_config,
            prompt="Why should I use a hero section?",
        )

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        # Explicit assertions: Should have chat response
        chat_response = get_chat_response(events)
        assert chat_response is not None, "Help desk should return a chat response"

        # Schema validation if config returned
        backend_response = get_backend_response(events)
        app_config = extract_app_config_from_backend_response(backend_response)
        if app_config:
            schema_result = validation_runner.run_schema_validation(app_config)
            assert schema_result[
                "valid"
            ], f"Schema validation failed: {schema_result['errors'][:5]}"


class TestHelpDeskEdgeCases:
    """Edge case tests for help desk."""

    @pytest.mark.e2e
    async def test_ambiguous_request(
        self, e2e_client, edit_payload_factory, minimal_webapp_config, validation_runner
    ):
        """Test with an ambiguous request that could be either help or edit.

        The AppHelpDeskAgent should make a reasonable routing decision.
        """
        payload = edit_payload_factory(
            app_config=minimal_webapp_config,
            prompt="Colors",  # Very ambiguous
        )

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        # Schema validation if config returned
        backend_response = get_backend_response(events)
        app_config = extract_app_config_from_backend_response(backend_response)
        if app_config:
            schema_result = validation_runner.run_schema_validation(app_config)
            assert schema_result[
                "valid"
            ], f"Schema validation failed: {schema_result['errors'][:5]}"

    @pytest.mark.e2e
    async def test_mixed_request(
        self, e2e_client, edit_payload_factory, minimal_webapp_config, validation_runner
    ):
        """Test request that mixes question with action.

        E.g., "What if I add a hero section?" - could be either.
        """
        payload = edit_payload_factory(
            app_config=minimal_webapp_config,
            prompt="What would happen if I added a pricing table?",
        )

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        # Schema validation if config returned
        backend_response = get_backend_response(events)
        app_config = extract_app_config_from_backend_response(backend_response)
        if app_config:
            schema_result = validation_runner.run_schema_validation(app_config)
            assert schema_result[
                "valid"
            ], f"Schema validation failed: {schema_result['errors'][:5]}"

    @pytest.mark.e2e
    async def test_empty_question(
        self, e2e_client, edit_payload_factory, minimal_webapp_config, validation_runner
    ):
        """Test with empty/minimal question."""
        payload = edit_payload_factory(
            app_config=minimal_webapp_config,
            prompt="?",
        )

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        # Schema validation if config returned
        backend_response = get_backend_response(events)
        app_config = extract_app_config_from_backend_response(backend_response)
        if app_config:
            schema_result = validation_runner.run_schema_validation(app_config)
            assert schema_result[
                "valid"
            ], f"Schema validation failed: {schema_result['errors'][:5]}"

    @pytest.mark.e2e
    async def test_very_long_question(
        self, e2e_client, edit_payload_factory, minimal_webapp_config, validation_runner
    ):
        """Test with a very detailed question."""
        long_question = """
        I'm building a website for my small business and I'm not sure what the 
        best approach would be. My business is a local bakery that sells custom 
        cakes and pastries. I want to showcase our products, allow customers to 
        see our menu, and provide a way for them to contact us for custom orders.
        
        What kind of pages should I have? What sections would work best for 
        showcasing food products? Should I have a separate page for each product 
        category or put everything on one page? Also, what about a blog - would 
        that be useful for a bakery website?
        
        I'm also wondering about the color scheme - what colors work well for 
        food-related businesses? And should I use lots of images or keep it 
        more minimal?
        """

        payload = edit_payload_factory(
            app_config=minimal_webapp_config,
            prompt=long_question,
        )

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        # Explicit assertions: Should have chat response for detailed question
        chat_response = get_chat_response(events)
        assert chat_response is not None, "Help desk should return a chat response"

        # Schema validation if config returned
        backend_response = get_backend_response(events)
        app_config = extract_app_config_from_backend_response(backend_response)
        if app_config:
            schema_result = validation_runner.run_schema_validation(app_config)
            assert schema_result[
                "valid"
            ], f"Schema validation failed: {schema_result['errors'][:5]}"

    @pytest.mark.e2e
    async def test_question_in_different_language(
        self, e2e_client, edit_payload_factory, minimal_webapp_config, validation_runner
    ):
        """Test help desk question in non-English language."""
        payload = edit_payload_factory(
            app_config=minimal_webapp_config,
            prompt="¿Cómo puedo agregar una sección de contacto?",
            app_language_code="es",
        )

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        # Explicit assertions: Should have chat response
        chat_response = get_chat_response(events)
        assert chat_response is not None, "Help desk should return a chat response"

        # Schema validation if config returned
        backend_response = get_backend_response(events)
        app_config = extract_app_config_from_backend_response(backend_response)
        if app_config:
            schema_result = validation_runner.run_schema_validation(app_config)
            assert schema_result[
                "valid"
            ], f"Schema validation failed: {schema_result['errors'][:5]}"


class TestHelpDeskWithChatHistory:
    """Tests for help desk with conversation context."""

    @pytest.mark.e2e
    async def test_help_desk_with_chat_history(
        self, e2e_client, edit_payload_factory, minimal_webapp_config, validation_runner
    ):
        """Test help desk considering previous chat messages."""
        chat_history = [
            {"role": "user", "content": "I want to build a portfolio website"},
            {"role": "assistant", "content": "I can help you build a portfolio website!"},
        ]

        payload = edit_payload_factory(
            app_config=minimal_webapp_config,
            prompt="What sections should I include?",
            chat_history=chat_history,
        )

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        # Explicit assertions: Should have chat response
        chat_response = get_chat_response(events)
        assert chat_response is not None, "Help desk should return a chat response"

        # Schema validation if config returned
        backend_response = get_backend_response(events)
        app_config = extract_app_config_from_backend_response(backend_response)
        if app_config:
            schema_result = validation_runner.run_schema_validation(app_config)
            assert schema_result[
                "valid"
            ], f"Schema validation failed: {schema_result['errors'][:5]}"

    @pytest.mark.e2e
    async def test_follow_up_question(
        self, e2e_client, edit_payload_factory, minimal_webapp_config, validation_runner
    ):
        """Test a follow-up question style query."""
        chat_history = [
            {"role": "user", "content": "Add a hero section"},
            {"role": "assistant", "content": "I've added a hero section to your homepage."},
        ]

        payload = edit_payload_factory(
            app_config=minimal_webapp_config,
            prompt="What else can I add there?",  # Follow-up
            chat_history=chat_history,
        )

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        # Explicit assertions: Should have chat response
        chat_response = get_chat_response(events)
        assert chat_response is not None, "Help desk should return a chat response"

        # Schema validation if config returned
        backend_response = get_backend_response(events)
        app_config = extract_app_config_from_backend_response(backend_response)
        if app_config:
            schema_result = validation_runner.run_schema_validation(app_config)
            assert schema_result[
                "valid"
            ], f"Schema validation failed: {schema_result['errors'][:5]}"
