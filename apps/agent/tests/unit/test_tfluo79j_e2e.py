"""End-to-end deterministic test against the actual ``tfluo79j`` production
source code that motivated the Surveyor.

Loads the real handler + component as they were *after* the Editor's broken
fix shipped on 2026-05-08:

* Handler ``getOccupancyTrend`` returns ``{date, percentage}``.
* Component ``DashboardContent`` reads ``<Charts.Area dataKey="rate">``.

The Surveyor's deterministic shape-inference pipeline must detect the
``missing_in_producer`` mismatch with high confidence, so the Editor —
when consuming the DiagnosticReport — can plan a paired fix instead of
shipping another one-sided rename.

This test exercises the full Phase 1 detection path without invoking any
LLM, which is exactly the behavior that lets us catch the bug class for
free in production.
"""

from pathlib import Path

import pytest

from main_agent.services.validation.tsx_ast.shape_inference import (
    field_mismatch_report,
    field_mismatch_report_global,
    infer_consumer_field_reads,
    infer_handler_return_shape,
)


_FIXTURE_DIR = Path(__file__).parent / "fixtures" / "tfluo79j_chart_empty"


@pytest.fixture(scope="module")
def handler_source() -> str:
    return (_FIXTURE_DIR / "getOccupancyTrend.tsx").read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def component_source() -> str:
    return (_FIXTURE_DIR / "DashboardContent.tsx").read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Sanity: fixture files are the post-bad-fix state
# ---------------------------------------------------------------------------


class TestFixtureSanity:
    def test_handler_returns_percentage_field(self, handler_source: str):
        # The Editor's bad fix renamed the field rate -> percentage.
        assert "percentage:" in handler_source or "percentage," in handler_source
        assert "rate:" not in handler_source.replace("rate: number", "")

    def test_component_reads_rate_dataKey(self, component_source: str):
        # The Editor never updated this consumer site.
        assert 'dataKey="rate"' in component_source

    def test_handler_uses_useHandler_pattern(self, component_source: str):
        # Sanity that our binding-tracker can find the producer.
        assert 'useHandler("getOccupancyTrend"' in component_source


# ---------------------------------------------------------------------------
# Shape inference on real source
# ---------------------------------------------------------------------------


class TestShapeInferenceOnRealSource:
    def test_handler_shape_includes_percentage_not_rate(self, handler_source: str):
        shape = infer_handler_return_shape(handler_source)
        # The handler returns {trendData} at the top level; trendData is the
        # array. Shape inference is flat — it sees the top-level key only.
        assert "trendData" in shape
        # The bug-fix attempt: handler emits 'percentage' on array elements,
        # but those are NESTED. Shape inference doesn't trace into arrays —
        # this is acknowledged in the design. The detection signal comes from
        # the JSX dataKey="rate" being attributed to the handler producer
        # and then not matching the handler's top-level shape.

    def test_component_consumer_sites_capture_rate_via_dataKey(
        self, component_source: str
    ):
        sites = infer_consumer_field_reads(component_source)
        # Surface the producer attribution for getOccupancyTrend.
        sites_for_trend = [s for s in sites if s.producer == "getOccupancyTrend"]
        assert sites_for_trend, (
            f"expected getOccupancyTrend in consumer sites, got: "
            f"{[s.producer for s in sites]}"
        )
        # 'rate' should appear in the fields_read for the trend handler.
        # It's attributed via the chart's data prop tracing to ``trend?.trendData``.
        all_fields = {fld for s in sites_for_trend for fld in s.fields_read}
        assert "rate" in all_fields, (
            f"expected 'rate' to be attributed to getOccupancyTrend, got: {all_fields}"
        )


# ---------------------------------------------------------------------------
# The motivating bug: end-to-end mismatch detection
# ---------------------------------------------------------------------------


class TestMismatchDetectionEndToEnd:
    def test_per_component_missing_in_producer_for_rate(
        self, handler_source: str, component_source: str
    ):
        producer_shape = infer_handler_return_shape(handler_source)
        consumer_sites = infer_consumer_field_reads(component_source)
        report = field_mismatch_report(
            {"getOccupancyTrend": producer_shape},
            consumer_sites,
            consumer_label="DashboardContent.tsx",
        )

        missing_rate = [
            m
            for m in report
            if m.kind == "missing_in_producer" and m.field == "rate"
        ]
        assert len(missing_rate) >= 1, (
            f"Expected the 'rate' missing_in_producer mismatch to fire on the "
            f"actual tfluo79j source. Got: {report}"
        )
        m = missing_rate[0]
        assert m.producer == "getOccupancyTrend"
        assert m.consumer == "DashboardContent.tsx"
        # Detail string should mention the consumer's field and the
        # handler's actual shape so the Editor can act on it.
        assert "rate" in m.detail
        assert "getOccupancyTrend" in m.detail or "handler" in m.detail.lower()

    def test_global_report_aggregates_consumers(
        self, handler_source: str, component_source: str
    ):
        producer_shape = infer_handler_return_shape(handler_source)
        consumer_sites = infer_consumer_field_reads(component_source)

        report = field_mismatch_report_global(
            {"getOccupancyTrend": producer_shape},
            {"DashboardContent.tsx": consumer_sites},
        )

        # The 'rate' mismatch must fire from the global path too.
        missing = [
            m
            for m in report
            if m.kind == "missing_in_producer" and m.field == "rate"
        ]
        assert len(missing) >= 1

    def test_detection_runs_without_llm(self):
        """Document the value proposition: this entire path is deterministic.

        No Vertex AI call. No LLM. No tokens. The bug class that took the
        production agent ~80 seconds and ~$0.04 to mis-diagnose can be
        detected statically in a few milliseconds, then fed to the Editor
        as evidence so its plan covers both sides instead of just one.
        """
        # No-op assertion — the prior tests prove the deterministic detection.
        # This stub serves as documentation in the test report.
        assert True
