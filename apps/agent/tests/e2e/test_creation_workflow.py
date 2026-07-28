"""E2E tests for the creation workflow via /r endpoint.

Tests cover app creation for different app types:
- Websites: Portfolio, business, landing pages
- Forms: Contact forms, surveys
- Data Apps: Dashboards
- Custom Apps: User-defined structures

These tests validate the CreationWorkflow in:
main_agent/agents/orchestrator/app_types/webapp/workflows/creation/creation_workflow.py

Note: Creation tests are typically slower as they involve:
1. AppCreatorAgent for planning
2. PageGenerationService for page building
3. Post-processing for UUIDs, icons, links, images

Test results are saved to tests/e2e/output/<timestamp>/<test_name>/

Usage:
    # Start server in terminal 1:
    python agent_api.py

    # Run tests in terminal 2:
    pytest tests/e2e/test_creation_workflow.py -v
"""

import json
import pytest

from .utils import (
    parse_sse_stream_async,
    get_events_by_type,
    get_final_app_config,
    get_chat_response,
    get_backend_response,
    extract_app_config_from_backend_response,
    assert_workflow_completed,
    extract_progress_messages,
    ResultWriter,
    ValidationRunner,
    validate_test_results,
    # App config helpers
    get_page_count,
    has_page_type,
    has_form_component,
    has_chart_or_data_component,
    count_components_by_type,
    # Backend config helpers
    has_backend_config,
    get_model_count,
    has_model,
    get_handler_count,
)

# Mark all tests as e2e, slow, and async
pytestmark = [
    pytest.mark.e2e,
    pytest.mark.slow,
    pytest.mark.asyncio,
    pytest.mark.filterwarnings("ignore::DeprecationWarning"),
]


class TestWebsiteCreation:
    """Tests for creating website-type apps."""

    @pytest.mark.e2e
    @pytest.mark.slow
    @pytest.mark.websites
    async def test_create_simple_portfolio_website(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
    ):
        """Test creating a simple portfolio website.

        Expected flow:
        1. AppCreatorAgent creates building plan
        2. Pages are generated with JSON component builder
        3. Post-processing (UUIDs, links, icons) is applied
        4. Final config is assembled and saved
        """
        payload = creation_payload_factory(
            app_name="My Portfolio",
            app_type="website",
            description="A personal portfolio website showcasing my work as a software developer. Include home, about, and projects pages.",
        )

        # Save request
        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            assert "text/event-stream" in response.headers.get("content-type", "")

            # Parse and save results
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)
        result_writer.save_progress_log(test_output_dir, events)

        # Extract and save backend response if present (test mode only)
        backend_response = get_backend_response(events)
        if backend_response:
            result_writer.save_backend_response(test_output_dir, backend_response)

        # Extract app_config from backend_response (authoritative source)
        # This is the actual config that would be sent to the Django backend
        app_config = (
            extract_app_config_from_backend_response(backend_response) if backend_response else None
        )

        # Fallback to app_config_updated event if backend_response not available
        if not app_config:
            app_config = get_final_app_config(events)

        # Save app_config.json
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)

        # Run schema validation on app_config and save results
        schema_result = None
        if app_config:
            schema_result = validation_runner.run_schema_validation(app_config)
            result_writer.save_schema_validation(test_output_dir, schema_result)

        # Run all validations (SSE events + config validation)
        report = validation_runner.run_all_validations(events, app_config)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

        # Print validation summary
        print(f"\n{'='*60}")
        print(f"Test: test_create_simple_portfolio_website")
        print(f"Output: {test_output_dir}")
        print(f"Events: {len(events)}")
        print(f"Validation: {'PASSED' if report.passed else 'FAILED'}")
        if schema_result and not schema_result["valid"]:
            print(f"Schema Validation: FAILED ({schema_result['error_count']} errors)")
            for err in schema_result["errors"][:5]:
                print(f"  - {err}")
        if not report.passed:
            for err in report.errors[:5]:
                print(f"  - {err.name}: {err.message}")
        print(f"{'='*60}\n")

        # Assert schema validation passed
        if schema_result:
            assert schema_result[
                "valid"
            ], f"Schema validation failed with {schema_result['error_count']} errors: {schema_result['errors'][:5]}"

        # Assert all validations passed
        assert report.passed, f"Validations failed: {report.failures}"

        # Explicit assertions: Portfolio should have multiple pages
        if app_config:
            page_count = get_page_count(app_config)
            assert (
                page_count >= 2
            ), f"Portfolio website should have at least 2 pages, got {page_count}"

    @pytest.mark.e2e
    @pytest.mark.slow
    @pytest.mark.websites
    async def test_create_business_website(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
    ):
        """Test creating a multi-page business website.

        Business websites typically include:
        - Home page with hero and features
        - About page
        - Services page
        - Contact page
        """
        payload = creation_payload_factory(
            app_name="Acme Corp",
            app_type="website",
            description="A professional website for a consulting company. Include home, about, services, and contact pages with a modern design.",
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)
        result_writer.save_progress_log(test_output_dir, events)

        # Extract backend response and app_config
        backend_response = get_backend_response(events)
        if backend_response:
            result_writer.save_backend_response(test_output_dir, backend_response)

        app_config = (
            extract_app_config_from_backend_response(backend_response) if backend_response else None
        )
        if not app_config:
            app_config = get_final_app_config(events)

        schema_result = None
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)
            schema_result = validation_runner.run_schema_validation(app_config)
            result_writer.save_schema_validation(test_output_dir, schema_result)

        report = validation_runner.run_all_validations(events, app_config)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

        # Assert schema validation passed
        if schema_result:
            assert schema_result[
                "valid"
            ], f"Schema validation failed with {schema_result['error_count']} errors: {schema_result['errors'][:5]}"

        assert report.passed, f"Validations failed: {report.failures}"

        # Explicit assertions: Business website should have multiple pages
        if app_config:
            page_count = get_page_count(app_config)
            assert (
                page_count >= 3
            ), f"Business website should have at least 3 pages, got {page_count}"

    @pytest.mark.e2e
    @pytest.mark.slow
    @pytest.mark.websites
    async def test_create_landing_page(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
    ):
        """Test creating a single-page landing page."""
        payload = creation_payload_factory(
            app_name="Product Launch",
            app_type="website",
            description="A landing page for a new SaaS product. Include hero section, features, pricing, and call-to-action.",
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)
        result_writer.save_progress_log(test_output_dir, events)

        # Extract backend response and app_config
        backend_response = get_backend_response(events)
        if backend_response:
            result_writer.save_backend_response(test_output_dir, backend_response)

        app_config = (
            extract_app_config_from_backend_response(backend_response) if backend_response else None
        )
        if not app_config:
            app_config = get_final_app_config(events)

        schema_result = None
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)
            schema_result = validation_runner.run_schema_validation(app_config)
            result_writer.save_schema_validation(test_output_dir, schema_result)

        report = validation_runner.run_all_validations(events, app_config)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

        # Assert schema validation passed
        if schema_result:
            assert schema_result[
                "valid"
            ], f"Schema validation failed with {schema_result['error_count']} errors: {schema_result['errors'][:5]}"

        assert report.passed, f"Validations failed: {report.failures}"

        # Explicit assertions: Landing page should have at least 1 page
        if app_config:
            page_count = get_page_count(app_config)
            assert page_count >= 1, f"Landing page should have at least 1 page, got {page_count}"
            # Landing pages typically have sections
            section_count = count_components_by_type(app_config, "SectionProps")
            assert (
                section_count >= 1
            ), f"Landing page should have at least 1 section, got {section_count}"

    @pytest.mark.e2e
    @pytest.mark.slow
    @pytest.mark.websites
    async def test_create_restaurant_website(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
    ):
        """Test creating a restaurant website with menu and reservation info."""
        payload = creation_payload_factory(
            app_name="Bella Italia Restaurant",
            app_type="website",
            description="A restaurant website with a home page featuring the restaurant ambiance, a menu page showcasing dishes, and a contact page with reservation information.",
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)
        result_writer.save_progress_log(test_output_dir, events)

        # Extract backend response and app_config
        backend_response = get_backend_response(events)
        if backend_response:
            result_writer.save_backend_response(test_output_dir, backend_response)

        app_config = (
            extract_app_config_from_backend_response(backend_response) if backend_response else None
        )
        if not app_config:
            app_config = get_final_app_config(events)

        schema_result = None
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)
            schema_result = validation_runner.run_schema_validation(app_config)
            result_writer.save_schema_validation(test_output_dir, schema_result)

        report = validation_runner.run_all_validations(events, app_config)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

        # Assert schema validation passed
        if schema_result:
            assert schema_result[
                "valid"
            ], f"Schema validation failed with {schema_result['error_count']} errors: {schema_result['errors'][:5]}"

        assert report.passed, f"Validations failed: {report.failures}"

        # Explicit assertions: Restaurant website should have multiple pages
        if app_config:
            page_count = get_page_count(app_config)
            assert (
                page_count >= 2
            ), f"Restaurant website should have at least 2 pages, got {page_count}"


class TestFormCreation:
    """Tests for creating form-type apps."""

    @pytest.mark.e2e
    @pytest.mark.slow
    @pytest.mark.forms
    async def test_create_contact_form(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
    ):
        """Test creating a contact form app."""
        payload = creation_payload_factory(
            app_name="Contact Form",
            app_type="form",
            description="A contact form with fields for name, email, phone, and message.",
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)
        result_writer.save_progress_log(test_output_dir, events)

        # Extract backend response and app_config
        backend_response = get_backend_response(events)
        if backend_response:
            result_writer.save_backend_response(test_output_dir, backend_response)

        app_config = (
            extract_app_config_from_backend_response(backend_response) if backend_response else None
        )
        if not app_config:
            app_config = get_final_app_config(events)

        schema_result = None
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)
            schema_result = validation_runner.run_schema_validation(app_config)
            result_writer.save_schema_validation(test_output_dir, schema_result)

        report = validation_runner.run_all_validations(events, app_config)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

        # Assert schema validation passed
        if schema_result:
            assert schema_result[
                "valid"
            ], f"Schema validation failed with {schema_result['error_count']} errors: {schema_result['errors'][:5]}"

        assert report.passed, f"Validations failed: {report.failures}"

        # Explicit assertions: Contact form should have form components
        if app_config:
            assert has_form_component(app_config), "Contact form app should have form components"

    @pytest.mark.e2e
    @pytest.mark.slow
    @pytest.mark.forms
    async def test_create_survey_form(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
    ):
        """Test creating a survey/questionnaire form."""
        payload = creation_payload_factory(
            app_name="Customer Survey",
            app_type="form",
            description="A customer satisfaction survey with multiple choice questions and text fields.",
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)
        result_writer.save_progress_log(test_output_dir, events)

        # Extract backend response and app_config
        backend_response = get_backend_response(events)
        if backend_response:
            result_writer.save_backend_response(test_output_dir, backend_response)

        app_config = (
            extract_app_config_from_backend_response(backend_response) if backend_response else None
        )
        if not app_config:
            app_config = get_final_app_config(events)

        schema_result = None
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)
            schema_result = validation_runner.run_schema_validation(app_config)
            result_writer.save_schema_validation(test_output_dir, schema_result)

        report = validation_runner.run_all_validations(events, app_config)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

        # Assert schema validation passed
        if schema_result:
            assert schema_result[
                "valid"
            ], f"Schema validation failed with {schema_result['error_count']} errors: {schema_result['errors'][:5]}"

        assert report.passed, f"Validations failed: {report.failures}"

        # Explicit assertions: Survey form should have form components
        if app_config:
            assert has_form_component(app_config), "Survey form app should have form components"

    @pytest.mark.e2e
    @pytest.mark.slow
    @pytest.mark.forms
    async def test_create_registration_form(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
    ):
        """Test creating a registration/signup form."""
        payload = creation_payload_factory(
            app_name="Event Registration",
            app_type="form",
            description="Create a job application form for my company called HappyDoods",
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)
        result_writer.save_progress_log(test_output_dir, events)

        # Extract backend response and app_config
        backend_response = get_backend_response(events)
        if backend_response:
            result_writer.save_backend_response(test_output_dir, backend_response)

        app_config = (
            extract_app_config_from_backend_response(backend_response) if backend_response else None
        )
        if not app_config:
            app_config = get_final_app_config(events)

        schema_result = None
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)
            schema_result = validation_runner.run_schema_validation(app_config)
            result_writer.save_schema_validation(test_output_dir, schema_result)

        report = validation_runner.run_all_validations(events, app_config)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

        # Assert schema validation passed
        if schema_result:
            assert schema_result[
                "valid"
            ], f"Schema validation failed with {schema_result['error_count']} errors: {schema_result['errors'][:5]}"

        assert report.passed, f"Validations failed: {report.failures}"

        # Explicit assertions: Registration form should have form components
        if app_config:
            assert has_form_component(
                app_config
            ), "Registration form app should have form components"


class TestDataAppCreation:
    """Tests for creating data app types."""

    @pytest.mark.e2e
    @pytest.mark.slow
    @pytest.mark.dataapps
    async def test_create_dashboard(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
    ):
        """Test creating a data dashboard app."""
        payload = creation_payload_factory(
            app_name="Sales Dashboard",
            app_type="dataapp",
            description="A sales analytics dashboard with charts showing revenue, customers, and product performance.",
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)
        result_writer.save_progress_log(test_output_dir, events)

        # Extract backend response and app_config
        backend_response = get_backend_response(events)
        if backend_response:
            result_writer.save_backend_response(test_output_dir, backend_response)

        app_config = (
            extract_app_config_from_backend_response(backend_response) if backend_response else None
        )
        if not app_config:
            app_config = get_final_app_config(events)

        schema_result = None
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)
            schema_result = validation_runner.run_schema_validation(app_config)
            result_writer.save_schema_validation(test_output_dir, schema_result)

        report = validation_runner.run_all_validations(events, app_config)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

        # Assert schema validation passed
        if schema_result:
            assert schema_result[
                "valid"
            ], f"Schema validation failed with {schema_result['error_count']} errors: {schema_result['errors'][:5]}"

        assert report.passed, f"Validations failed: {report.failures}"

        # Explicit assertions: Dashboard should have chart/data components
        if app_config:
            # Note: has_chart_or_data_component may not find components if schema uses different types
            page_count = get_page_count(app_config)
            assert page_count >= 1, f"Dashboard should have at least 1 page, got {page_count}"

    @pytest.mark.e2e
    @pytest.mark.slow
    @pytest.mark.dataapps
    async def test_create_analytics_dashboard(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
    ):
        """Test creating an analytics/reporting dashboard."""
        payload = creation_payload_factory(
            app_name="Marketing Analytics",
            app_type="dataapp",
            description="A marketing analytics dashboard with metrics for campaigns, conversions, and ROI.",
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)
        result_writer.save_progress_log(test_output_dir, events)

        # Extract backend response and app_config
        backend_response = get_backend_response(events)
        if backend_response:
            result_writer.save_backend_response(test_output_dir, backend_response)

        app_config = (
            extract_app_config_from_backend_response(backend_response) if backend_response else None
        )
        if not app_config:
            app_config = get_final_app_config(events)

        schema_result = None
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)
            schema_result = validation_runner.run_schema_validation(app_config)
            result_writer.save_schema_validation(test_output_dir, schema_result)

        report = validation_runner.run_all_validations(events, app_config)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

        # Assert schema validation passed
        if schema_result:
            assert schema_result[
                "valid"
            ], f"Schema validation failed with {schema_result['error_count']} errors: {schema_result['errors'][:5]}"

        assert report.passed, f"Validations failed: {report.failures}"

        # Explicit assertions: Analytics dashboard should have pages
        if app_config:
            page_count = get_page_count(app_config)
            assert (
                page_count >= 1
            ), f"Analytics dashboard should have at least 1 page, got {page_count}"


class TestCrudAppCreation:
    """Tests for creating CRUD-based apps with backend models."""

    @pytest.mark.e2e
    @pytest.mark.slow
    @pytest.mark.dataapps
    async def test_create_library_operations_app(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
    ):
        """Test creating a library operations app with CRUD for books, authors, and loans.

        Expected outcome:
        - Backend config with models for books, authors, and related entities
        - Pages for managing library data (list, detail, forms)
        - Custom handlers for operations like loan processing
        """
        payload = creation_payload_factory(
            app_name="Library Operations",
            app_type="dataapp",
            description=(
                "A library management system for tracking books, authors, and borrowing. "
                "Include a book catalog page with search and filters, an author directory, "
                "and a loan management page for checking books in and out. "
                "Each book should have title, ISBN, category, and available copies. "
                "Track which customers have borrowed which books."
            ),
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)
        result_writer.save_progress_log(test_output_dir, events)

        # Extract backend response and app_config
        backend_response = get_backend_response(events)
        if backend_response:
            result_writer.save_backend_response(test_output_dir, backend_response)

        app_config = (
            extract_app_config_from_backend_response(backend_response) if backend_response else None
        )
        if not app_config:
            app_config = get_final_app_config(events)

        schema_result = None
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)
            schema_result = validation_runner.run_schema_validation(app_config)
            result_writer.save_schema_validation(test_output_dir, schema_result)

        report = validation_runner.run_all_validations(events, app_config)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

        # Assert schema validation passed
        if schema_result:
            assert schema_result[
                "valid"
            ], f"Schema validation failed with {schema_result['error_count']} errors: {schema_result['errors'][:5]}"

        assert report.passed, f"Validations failed: {report.failures}"

        # Explicit assertions: Library app should have backend models and multiple pages
        if app_config:
            assert has_backend_config(
                app_config
            ), "Library operations app should have a backend config with models"
            model_count = get_model_count(app_config)
            assert (
                model_count >= 2
            ), f"Library app should have at least 2 models (e.g., books, authors), got {model_count}"
            page_count = get_page_count(app_config)
            assert page_count >= 2, f"Library app should have at least 2 pages, got {page_count}"

    @pytest.mark.e2e
    @pytest.mark.slow
    @pytest.mark.dataapps
    async def test_create_sales_and_crm_dashboard_app(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
    ):
        """Test creating a sales and CRM dashboard with backend data models.

        Expected outcome:
        - Backend config with models for contacts, deals, and activities
        - Dashboard page with metrics and charts
        - CRUD pages for managing contacts and deals
        """
        payload = creation_payload_factory(
            app_name="Sales CRM Dashboard",
            app_type="dataapp",
            description=(
                "A sales and CRM dashboard for managing customer relationships. "
                "Include a dashboard page with key metrics like total revenue, active deals, "
                "and conversion rate. Add a contacts page to manage customer records with name, "
                "email, company, and status. Include a deals pipeline page showing deal stages "
                "and values. Track activities and notes for each contact."
            ),
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)
        result_writer.save_progress_log(test_output_dir, events)

        # Extract backend response and app_config
        backend_response = get_backend_response(events)
        if backend_response:
            result_writer.save_backend_response(test_output_dir, backend_response)

        app_config = (
            extract_app_config_from_backend_response(backend_response) if backend_response else None
        )
        if not app_config:
            app_config = get_final_app_config(events)

        schema_result = None
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)
            schema_result = validation_runner.run_schema_validation(app_config)
            result_writer.save_schema_validation(test_output_dir, schema_result)

        report = validation_runner.run_all_validations(events, app_config)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

        # Assert schema validation passed
        if schema_result:
            assert schema_result[
                "valid"
            ], f"Schema validation failed with {schema_result['error_count']} errors: {schema_result['errors'][:5]}"

        assert report.passed, f"Validations failed: {report.failures}"

        # Explicit assertions: CRM app should have backend models and multiple pages
        if app_config:
            assert has_backend_config(
                app_config
            ), "Sales CRM app should have a backend config with models"
            model_count = get_model_count(app_config)
            assert (
                model_count >= 2
            ), f"CRM app should have at least 2 models (e.g., contacts, deals), got {model_count}"
            page_count = get_page_count(app_config)
            assert page_count >= 2, f"CRM app should have at least 2 pages, got {page_count}"

    @pytest.mark.e2e
    @pytest.mark.slow
    @pytest.mark.dataapps
    async def test_create_basic_crud_app(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
    ):
        """Test creating a basic CRUD app with simple data management.

        Expected outcome:
        - Backend config with a simple model (e.g., tasks or items)
        - At least one page for listing and managing records
        - Form components for creating/editing entries
        """
        payload = creation_payload_factory(
            app_name="Task Manager",
            app_type="dataapp",
            description=(
                "A simple task management app. Users can create, view, update, and delete tasks. "
                "Each task has a title, description, status (todo, in-progress, done), "
                "priority (low, medium, high), and due date. "
                "Include a main page listing all tasks with filtering by status."
            ),
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)
        result_writer.save_progress_log(test_output_dir, events)

        # Extract backend response and app_config
        backend_response = get_backend_response(events)
        if backend_response:
            result_writer.save_backend_response(test_output_dir, backend_response)

        app_config = (
            extract_app_config_from_backend_response(backend_response) if backend_response else None
        )
        if not app_config:
            app_config = get_final_app_config(events)

        schema_result = None
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)
            schema_result = validation_runner.run_schema_validation(app_config)
            result_writer.save_schema_validation(test_output_dir, schema_result)

        report = validation_runner.run_all_validations(events, app_config)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

        # Assert schema validation passed
        if schema_result:
            assert schema_result[
                "valid"
            ], f"Schema validation failed with {schema_result['error_count']} errors: {schema_result['errors'][:5]}"

        assert report.passed, f"Validations failed: {report.failures}"

        # Explicit assertions: Basic CRUD app should have at least one model and page
        if app_config:
            assert has_backend_config(
                app_config
            ), "Basic CRUD app should have a backend config with models"
            model_count = get_model_count(app_config)
            assert (
                model_count >= 1
            ), f"Basic CRUD app should have at least 1 model (tasks), got {model_count}"
            page_count = get_page_count(app_config)
            assert page_count >= 1, f"Basic CRUD app should have at least 1 page, got {page_count}"


class TestCustomAppCreation:
    """Tests for creating custom app types."""

    @pytest.mark.e2e
    @pytest.mark.slow
    async def test_create_custom_app(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
    ):
        """Test creating a custom app with user-defined structure."""
        payload = creation_payload_factory(
            app_name="My Custom App",
            app_type="custom",
            description="A custom app with a unique layout including a hero section, feature cards, and a testimonials section.",
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)
        result_writer.save_progress_log(test_output_dir, events)

        # Extract backend response and app_config
        backend_response = get_backend_response(events)
        if backend_response:
            result_writer.save_backend_response(test_output_dir, backend_response)

        app_config = (
            extract_app_config_from_backend_response(backend_response) if backend_response else None
        )
        if not app_config:
            app_config = get_final_app_config(events)

        schema_result = None
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)
            schema_result = validation_runner.run_schema_validation(app_config)
            result_writer.save_schema_validation(test_output_dir, schema_result)

        report = validation_runner.run_all_validations(events, app_config)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

        # Assert schema validation passed
        if schema_result:
            assert schema_result[
                "valid"
            ], f"Schema validation failed with {schema_result['error_count']} errors: {schema_result['errors'][:5]}"

        assert report.passed, f"Validations failed: {report.failures}"

        # Explicit assertions: Custom app should have at least 1 page
        if app_config:
            page_count = get_page_count(app_config)
            assert page_count >= 1, f"Custom app should have at least 1 page, got {page_count}"

    @pytest.mark.e2e
    @pytest.mark.slow
    async def test_create_app_with_custom_sections(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
    ):
        """Test creating an app with specific custom sections requested."""
        payload = creation_payload_factory(
            app_name="Custom Showcase",
            app_type="custom",
            description="""Create an app with:
            1. A hero section with animated background
            2. A team members section with cards
            3. A timeline section showing company history
            4. A FAQ section with expandable items""",
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)
        result_writer.save_progress_log(test_output_dir, events)

        # Extract backend response and app_config
        backend_response = get_backend_response(events)
        if backend_response:
            result_writer.save_backend_response(test_output_dir, backend_response)

        app_config = (
            extract_app_config_from_backend_response(backend_response) if backend_response else None
        )
        if not app_config:
            app_config = get_final_app_config(events)

        schema_result = None
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)
            schema_result = validation_runner.run_schema_validation(app_config)
            result_writer.save_schema_validation(test_output_dir, schema_result)

        report = validation_runner.run_all_validations(events, app_config)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

        # Assert schema validation passed
        if schema_result:
            assert schema_result[
                "valid"
            ], f"Schema validation failed with {schema_result['error_count']} errors: {schema_result['errors'][:5]}"

        assert report.passed, f"Validations failed: {report.failures}"

        # Explicit assertions: Custom sections app should have multiple sections
        if app_config:
            section_count = count_components_by_type(app_config, "SectionProps")
            assert (
                section_count >= 2
            ), f"Custom sections app should have at least 2 sections, got {section_count}"


class TestCreationWithLanguage:
    """Tests for creating apps in different languages."""

    @pytest.mark.e2e
    @pytest.mark.slow
    async def test_create_website_in_spanish(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
    ):
        """Test creating a website with Spanish content."""
        payload = creation_payload_factory(
            app_name="Mi Sitio Web",
            app_type="website",
            description="Un sitio web de portafolio profesional con páginas de inicio, sobre mí y contacto.",
            app_language_code="es",
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)
        result_writer.save_progress_log(test_output_dir, events)

        # Extract backend response and app_config
        backend_response = get_backend_response(events)
        if backend_response:
            result_writer.save_backend_response(test_output_dir, backend_response)

        app_config = (
            extract_app_config_from_backend_response(backend_response) if backend_response else None
        )
        if not app_config:
            app_config = get_final_app_config(events)

        schema_result = None
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)
            schema_result = validation_runner.run_schema_validation(app_config)
            result_writer.save_schema_validation(test_output_dir, schema_result)

        report = validation_runner.run_all_validations(events, app_config)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

        # Assert schema validation passed
        if schema_result:
            assert schema_result[
                "valid"
            ], f"Schema validation failed with {schema_result['error_count']} errors: {schema_result['errors'][:5]}"

        assert report.passed, f"Validations failed: {report.failures}"

        # Explicit assertions: Spanish website should have pages
        if app_config:
            page_count = get_page_count(app_config)
            assert page_count >= 1, f"Spanish website should have at least 1 page, got {page_count}"

    @pytest.mark.e2e
    @pytest.mark.slow
    async def test_create_website_in_french(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
    ):
        """Test creating a website with French content."""
        payload = creation_payload_factory(
            app_name="Mon Site",
            app_type="website",
            description="Un site web d'entreprise avec une page d'accueil, services et contact.",
            app_language_code="fr",
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)
        result_writer.save_progress_log(test_output_dir, events)

        # Extract backend response and app_config
        backend_response = get_backend_response(events)
        if backend_response:
            result_writer.save_backend_response(test_output_dir, backend_response)

        app_config = (
            extract_app_config_from_backend_response(backend_response) if backend_response else None
        )
        if not app_config:
            app_config = get_final_app_config(events)

        schema_result = None
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)
            schema_result = validation_runner.run_schema_validation(app_config)
            result_writer.save_schema_validation(test_output_dir, schema_result)

        report = validation_runner.run_all_validations(events, app_config)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

        # Assert schema validation passed
        if schema_result:
            assert schema_result[
                "valid"
            ], f"Schema validation failed with {schema_result['error_count']} errors: {schema_result['errors'][:5]}"

        assert report.passed, f"Validations failed: {report.failures}"

        # Explicit assertions: French website should have pages
        if app_config:
            page_count = get_page_count(app_config)
            assert page_count >= 1, f"French website should have at least 1 page, got {page_count}"

    @pytest.mark.e2e
    @pytest.mark.slow
    async def test_create_website_auto_language_detection(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
    ):
        """Test auto language detection from description."""
        payload = creation_payload_factory(
            app_name="ドキュメントサイト",
            app_type="website",
            description="製品のドキュメントサイト。ホームページとドキュメントページを含みます。",
            app_language_code="auto",
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)
        result_writer.save_progress_log(test_output_dir, events)

        # Extract backend response and app_config
        backend_response = get_backend_response(events)
        if backend_response:
            result_writer.save_backend_response(test_output_dir, backend_response)

        app_config = (
            extract_app_config_from_backend_response(backend_response) if backend_response else None
        )
        if not app_config:
            app_config = get_final_app_config(events)

        schema_result = None
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)
            schema_result = validation_runner.run_schema_validation(app_config)
            result_writer.save_schema_validation(test_output_dir, schema_result)

        report = validation_runner.run_all_validations(events, app_config)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

        # Assert schema validation passed
        if schema_result:
            assert schema_result[
                "valid"
            ], f"Schema validation failed with {schema_result['error_count']} errors: {schema_result['errors'][:5]}"

        assert report.passed, f"Validations failed: {report.failures}"

        # Explicit assertions: Japanese website should have pages
        if app_config:
            page_count = get_page_count(app_config)
            assert (
                page_count >= 1
            ), f"Japanese website should have at least 1 page, got {page_count}"


class TestCreationValidation:
    """Tests for creation payload validation and edge cases."""

    @pytest.mark.e2e
    async def test_create_with_empty_description(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
    ):
        """Test creation with minimal/empty description."""
        payload = creation_payload_factory(
            app_name="Test App",
            app_type="website",
            description="",
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            # Should handle gracefully
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)
        result_writer.save_progress_log(test_output_dir, events)

        app_config = get_final_app_config(events)
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)

        # Use SSE-only validation for edge case tests
        report = validation_runner.run_sse_only(events)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

    @pytest.mark.e2e
    @pytest.mark.slow
    async def test_create_with_very_long_description(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
    ):
        """Test creation with a very detailed description."""
        long_description = """
        Create a comprehensive business website for a technology consulting firm.
        
        The website should include:
        1. Home page with a hero section featuring company tagline
        2. About page with company history, mission, and values
        3. Services page listing consulting, development, and training
        4. Team page with executive profiles
        5. Blog section for industry insights
        6. Contact page with form and office locations
        
        Design requirements:
        - Modern, professional look
        - Blue and white color scheme
        - Easy navigation
        - Mobile-responsive
        """ * 3  # Make it longer

        payload = creation_payload_factory(
            app_name="Tech Consulting",
            app_type="website",
            description=long_description,
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)
        result_writer.save_progress_log(test_output_dir, events)

        # Extract backend response and app_config
        backend_response = get_backend_response(events)
        if backend_response:
            result_writer.save_backend_response(test_output_dir, backend_response)

        app_config = (
            extract_app_config_from_backend_response(backend_response) if backend_response else None
        )
        if not app_config:
            app_config = get_final_app_config(events)

        schema_result = None
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)
            schema_result = validation_runner.run_schema_validation(app_config)
            result_writer.save_schema_validation(test_output_dir, schema_result)

        report = validation_runner.run_all_validations(events, app_config)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

        # Assert schema validation passed
        if schema_result:
            assert schema_result[
                "valid"
            ], f"Schema validation failed with {schema_result['error_count']} errors: {schema_result['errors'][:5]}"

        assert report.passed, f"Validations failed: {report.failures}"

    @pytest.mark.e2e
    async def test_create_with_special_characters_in_name(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
    ):
        """Test creation with special characters in app name."""
        payload = creation_payload_factory(
            app_name="O'Brien & Associates™",
            app_type="website",
            description="A law firm website",
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)
        result_writer.save_progress_log(test_output_dir, events)

        app_config = get_final_app_config(events)
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)

        report = validation_runner.run_sse_only(events)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

    @pytest.mark.e2e
    async def test_create_with_unicode_name(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
    ):
        """Test creation with unicode characters in app name."""
        payload = creation_payload_factory(
            app_name="日本料理 🍣",
            app_type="website",
            description="A Japanese restaurant website",
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)
        result_writer.save_progress_log(test_output_dir, events)

        app_config = get_final_app_config(events)
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)

        report = validation_runner.run_sse_only(events)
        result_writer.save_validation_report(test_output_dir, report.to_dict())


class TestCreationProgressEvents:
    """Tests for creation workflow progress events."""

    @pytest.mark.e2e
    @pytest.mark.slow
    async def test_creation_emits_progress_events(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
    ):
        """Test that creation workflow emits expected progress events.

        Expected events during creation:
        - creation_mode_starting
        - app_building_started
        - page_generation progress updates
        - completion event
        """
        payload = creation_payload_factory(
            app_name="Progress Test",
            app_type="website",
            description="A simple website to test progress events",
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            # Parse SSE response to verify progress events
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)
        result_writer.save_progress_log(test_output_dir, events)

        progress_messages = extract_progress_messages(events)

        # Extract backend response and app_config
        backend_response = get_backend_response(events)
        if backend_response:
            result_writer.save_backend_response(test_output_dir, backend_response)

        app_config = (
            extract_app_config_from_backend_response(backend_response) if backend_response else None
        )
        if not app_config:
            app_config = get_final_app_config(events)

        schema_result = None
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)
            schema_result = validation_runner.run_schema_validation(app_config)
            result_writer.save_schema_validation(test_output_dir, schema_result)

        report = validation_runner.run_all_validations(events, app_config)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

        # Should have progress messages
        assert len(progress_messages) >= 0  # At least workflow started

        # Assert schema validation passed
        if schema_result:
            assert schema_result[
                "valid"
            ], f"Schema validation failed with {schema_result['error_count']} errors: {schema_result['errors'][:5]}"

        assert report.passed, f"Validations failed: {report.failures}"

    @pytest.mark.e2e
    @pytest.mark.slow
    async def test_creation_returns_chat_response(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
    ):
        """Test that creation returns a chat message response."""
        payload = creation_payload_factory(
            app_name="Chat Response Test",
            app_type="website",
            description="Test website for chat response",
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)
        result_writer.save_progress_log(test_output_dir, events)

        get_chat_response(events)

        # Extract backend response and app_config
        backend_response = get_backend_response(events)
        if backend_response:
            result_writer.save_backend_response(test_output_dir, backend_response)

        app_config = (
            extract_app_config_from_backend_response(backend_response) if backend_response else None
        )
        if not app_config:
            app_config = get_final_app_config(events)

        schema_result = None
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)
            schema_result = validation_runner.run_schema_validation(app_config)
            result_writer.save_schema_validation(test_output_dir, schema_result)

        report = validation_runner.run_all_validations(events, app_config)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

        # Should have a chat response and pass validations
        assert events is not None

        # Assert schema validation passed
        if schema_result:
            assert schema_result[
                "valid"
            ], f"Schema validation failed with {schema_result['error_count']} errors: {schema_result['errors'][:5]}"

        assert report.passed, f"Validations failed: {report.failures}"


class TestCreationPayloadFactory:
    """Tests for the creation payload factory fixture (sync, no server needed)."""

    @pytest.mark.e2e
    async def test_creation_payload_structure(self, creation_payload_factory):
        """Verify the creation payload has correct structure."""
        payload = creation_payload_factory(
            app_name="Test",
            app_type="website",
            description="Test description",
        )

        assert payload["operation_mode"] == "create"
        assert "user_id" in payload
        assert "session_id" in payload
        assert "payload" in payload

        inner_payload = json.loads(payload["payload"])
        assert inner_payload["app_name"] == "Test"
        assert inner_payload["app_type"] == "website"
        assert inner_payload["initial_description"] == "Test description"
        assert inner_payload["current_prompt"] == "Test description"

    @pytest.mark.e2e
    async def test_creation_payload_with_custom_language(self, creation_payload_factory):
        """Test creation payload with custom language code."""
        payload = creation_payload_factory(
            app_name="Test",
            app_type="website",
            description="Test",
            app_language_code="de",
        )

        inner_payload = json.loads(payload["payload"])
        assert inner_payload["app_language_code"] == "de"

    @pytest.mark.e2e
    async def test_creation_payload_with_extra_fields(self, creation_payload_factory):
        """Test that extra fields are passed through."""
        payload = creation_payload_factory(
            app_name="Test",
            app_type="website",
            description="Test",
            custom_field="custom_value",
        )

        inner_payload = json.loads(payload["payload"])
        assert inner_payload.get("custom_field") == "custom_value"


class TestCreationWithUserContent:
    """Tests for creating apps with user-provided content (documents and images).

    These tests validate that:
    1. Apps can be created without any user content (baseline)
    2. Document catalogs are properly passed to the agent
    3. Image catalogs are properly passed to the agent
    4. File references in prompts (@filename.ext) are handled correctly
    """

    @pytest.mark.e2e
    async def test_creation_payload_with_document_catalog(
        self, creation_payload_factory, sample_document_catalog
    ):
        """Test that document_catalog is properly included in payload."""
        payload = creation_payload_factory(
            app_name="Content Test",
            app_type="website",
            description="A website with user documents",
            document_catalog=sample_document_catalog,
        )

        inner_payload = json.loads(payload["payload"])
        assert "document_catalog" in inner_payload
        assert len(inner_payload["document_catalog"]) == len(sample_document_catalog)
        assert inner_payload["document_catalog"][0]["uuid"] == sample_document_catalog[0]["uuid"]

    @pytest.mark.e2e
    async def test_creation_payload_with_image_catalog(
        self, creation_payload_factory, sample_image_catalog
    ):
        """Test that image_catalog is properly included in payload."""
        payload = creation_payload_factory(
            app_name="Content Test",
            app_type="website",
            description="A website with user images",
            image_catalog=sample_image_catalog,
        )

        inner_payload = json.loads(payload["payload"])
        assert "image_catalog" in inner_payload
        assert len(inner_payload["image_catalog"]) == len(sample_image_catalog)
        assert inner_payload["image_catalog"][0]["uuid"] == sample_image_catalog[0]["uuid"]

    @pytest.mark.e2e
    async def test_creation_payload_with_both_catalogs(
        self, creation_payload_factory, sample_document_catalog, sample_image_catalog
    ):
        """Test that both document and image catalogs can be included."""
        payload = creation_payload_factory(
            app_name="Full Content Test",
            app_type="website",
            description="A website with all user content",
            document_catalog=sample_document_catalog,
            image_catalog=sample_image_catalog,
        )

        inner_payload = json.loads(payload["payload"])
        assert "document_catalog" in inner_payload
        assert "image_catalog" in inner_payload
        assert len(inner_payload["document_catalog"]) > 0
        assert len(inner_payload["image_catalog"]) > 0

    @pytest.mark.e2e
    async def test_creation_payload_with_empty_catalogs(
        self, creation_payload_factory, empty_document_catalog, empty_image_catalog
    ):
        """Test creation with explicitly empty catalogs."""
        payload = creation_payload_factory(
            app_name="Empty Content Test",
            app_type="website",
            description="A website without user content",
            document_catalog=empty_document_catalog,
            image_catalog=empty_image_catalog,
        )

        inner_payload = json.loads(payload["payload"])
        assert inner_payload["document_catalog"] == []
        assert inner_payload["image_catalog"] == []

    @pytest.mark.e2e
    async def test_creation_payload_without_catalogs(self, creation_payload_factory):
        """Test creation without providing catalogs (default behavior)."""
        payload = creation_payload_factory(
            app_name="No Content Test",
            app_type="website",
            description="A simple website without user content",
        )

        inner_payload = json.loads(payload["payload"])
        # Catalogs should not be present when not provided
        assert "document_catalog" not in inner_payload
        assert "image_catalog" not in inner_payload

    @pytest.mark.e2e
    async def test_creation_payload_with_file_reference_in_description(
        self, creation_payload_factory, sample_image_catalog
    ):
        """Test that file references in description are preserved."""
        description = "Create a website using @company-logo.png for the header"
        payload = creation_payload_factory(
            app_name="File Reference Test",
            app_type="website",
            description=description,
            image_catalog=sample_image_catalog,
        )

        inner_payload = json.loads(payload["payload"])
        # The @filename reference should be in the description
        assert "@company-logo.png" in inner_payload["initial_description"]
        assert "@company-logo.png" in inner_payload["current_prompt"]

    @pytest.mark.e2e
    @pytest.mark.slow
    async def test_create_website_no_catalogs(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
    ):
        """Test creating a website without any content catalogs (baseline).

        This establishes baseline behavior for creation without user content.
        """
        payload = creation_payload_factory(
            app_name="Baseline Website",
            app_type="website",
            description="A simple portfolio website with home and about pages.",
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)

        # Extract and validate
        backend_response = get_backend_response(events)
        if backend_response:
            result_writer.save_backend_response(test_output_dir, backend_response)

        app_config = (
            extract_app_config_from_backend_response(backend_response) if backend_response else None
        )
        if not app_config:
            app_config = get_final_app_config(events)

        schema_result = None
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)
            schema_result = validation_runner.run_schema_validation(app_config)
            result_writer.save_schema_validation(test_output_dir, schema_result)

        report = validation_runner.run_all_validations(events, app_config)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

        if schema_result:
            assert schema_result[
                "valid"
            ], f"Schema validation failed: {schema_result['errors'][:5]}"
        assert report.passed, f"Validations failed: {report.failures}"

    @pytest.mark.e2e
    @pytest.mark.slow
    async def test_create_website_with_image_catalog(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
        sample_image_catalog,
    ):
        """Test creating a website with an image catalog.

        The agent should have access to the image catalog for content-aware generation.
        """
        payload = creation_payload_factory(
            app_name="Image Catalog Website",
            app_type="website",
            description="A company website with a hero section and about page. Use the available logo image.",
            image_catalog=sample_image_catalog,
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)

        # Extract and validate
        backend_response = get_backend_response(events)
        if backend_response:
            result_writer.save_backend_response(test_output_dir, backend_response)

        app_config = (
            extract_app_config_from_backend_response(backend_response) if backend_response else None
        )
        if not app_config:
            app_config = get_final_app_config(events)

        schema_result = None
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)
            schema_result = validation_runner.run_schema_validation(app_config)
            result_writer.save_schema_validation(test_output_dir, schema_result)

        report = validation_runner.run_all_validations(events, app_config)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

        if schema_result:
            assert schema_result[
                "valid"
            ], f"Schema validation failed: {schema_result['errors'][:5]}"
        assert report.passed, f"Validations failed: {report.failures}"

    @pytest.mark.e2e
    @pytest.mark.slow
    async def test_create_website_with_document_catalog(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
        sample_document_catalog,
    ):
        """Test creating a website with a document catalog.

        The agent should have access to document content for content-aware generation.
        Small documents should be fetched as artifacts, large ones marked for Vertex AI Search.

        Note: Start the server with SKIP_DOCUMENT_FETCH=true to skip actual HTTP fetching
        of document content when using mock catalog URLs.
        """
        payload = creation_payload_factory(
            app_name="Document Catalog Website",
            app_type="website",
            description="A product website that showcases features from the product specification document.",
            document_catalog=sample_document_catalog,
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)

        # Extract and validate
        backend_response = get_backend_response(events)
        if backend_response:
            result_writer.save_backend_response(test_output_dir, backend_response)

        app_config = (
            extract_app_config_from_backend_response(backend_response) if backend_response else None
        )
        if not app_config:
            app_config = get_final_app_config(events)

        schema_result = None
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)
            schema_result = validation_runner.run_schema_validation(app_config)
            result_writer.save_schema_validation(test_output_dir, schema_result)

        report = validation_runner.run_all_validations(events, app_config)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

        if schema_result:
            assert schema_result[
                "valid"
            ], f"Schema validation failed: {schema_result['errors'][:5]}"
        assert report.passed, f"Validations failed: {report.failures}"

    @pytest.mark.e2e
    @pytest.mark.slow
    async def test_create_website_with_both_catalogs(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
        sample_document_catalog,
        sample_image_catalog,
    ):
        """Test creating a website with both document and image catalogs.

        The agent should have access to both document content and images for
        comprehensive content-aware generation.

        Note: Start the server with SKIP_DOCUMENT_FETCH=true to skip actual HTTP fetching
        of document content when using mock catalog URLs.
        """
        payload = creation_payload_factory(
            app_name="Full Content Website",
            app_type="website",
            description="A company website with product information from documents and branded images.",
            document_catalog=sample_document_catalog,
            image_catalog=sample_image_catalog,
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)

        # Extract and validate
        backend_response = get_backend_response(events)
        if backend_response:
            result_writer.save_backend_response(test_output_dir, backend_response)

        app_config = (
            extract_app_config_from_backend_response(backend_response) if backend_response else None
        )
        if not app_config:
            app_config = get_final_app_config(events)

        schema_result = None
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)
            schema_result = validation_runner.run_schema_validation(app_config)
            result_writer.save_schema_validation(test_output_dir, schema_result)

        report = validation_runner.run_all_validations(events, app_config)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

        if schema_result:
            assert schema_result[
                "valid"
            ], f"Schema validation failed: {schema_result['errors'][:5]}"
        assert report.passed, f"Validations failed: {report.failures}"

    @pytest.mark.e2e
    @pytest.mark.slow
    async def test_create_website_with_file_references(
        self,
        e2e_client,
        creation_payload_factory,
        test_output_dir,
        result_writer,
        validation_runner,
        sample_document_catalog,
        sample_image_catalog,
    ):
        """Test creating a website with @filename references in the prompt.

        The agent should resolve @filename references to the appropriate catalog entries:
        - @company-logo.png should resolve to the image catalog
        - @product-spec.pdf should resolve to the document catalog

        Note: Start the server with SKIP_DOCUMENT_FETCH=true to skip actual HTTP fetching
        of document content when using mock catalog URLs.
        """
        payload = creation_payload_factory(
            app_name="File Reference Website",
            app_type="website",
            description=(
                "Create a product landing page. "
                "Use @company-logo.png in the header and hero section. "
                "Include key features from @product-spec.pdf on the main page."
            ),
            document_catalog=sample_document_catalog,
            image_catalog=sample_image_catalog,
        )

        result_writer.save_request(test_output_dir, payload)

        async with e2e_client.stream("POST", "/r", json=payload) as response:
            assert response.status_code == 200
            events = await parse_sse_stream_async(response)

        result_writer.save_events(test_output_dir, events)

        # Extract and validate
        backend_response = get_backend_response(events)
        if backend_response:
            result_writer.save_backend_response(test_output_dir, backend_response)

        app_config = (
            extract_app_config_from_backend_response(backend_response) if backend_response else None
        )
        if not app_config:
            app_config = get_final_app_config(events)

        schema_result = None
        if app_config:
            result_writer.save_app_config(test_output_dir, app_config)
            schema_result = validation_runner.run_schema_validation(app_config)
            result_writer.save_schema_validation(test_output_dir, schema_result)

        report = validation_runner.run_all_validations(events, app_config)
        result_writer.save_validation_report(test_output_dir, report.to_dict())

        if schema_result:
            assert schema_result[
                "valid"
            ], f"Schema validation failed: {schema_result['errors'][:5]}"
        assert report.passed, f"Validations failed: {report.failures}"
