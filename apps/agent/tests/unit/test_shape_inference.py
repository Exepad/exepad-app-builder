"""Unit tests for ``shape_inference`` — the load-bearing AST primitive.

Critical fixture: the ``tfluo79j`` motivating bug — chart reads ``dataKey="rate"``
while handler returns ``percentage``. The mismatch must be detected with
high confidence and zero LLM input.
"""

from main_agent.services.validation.tsx_ast.shape_inference import (
    ConsumerSite,
    Mismatch,
    field_mismatch_report,
    field_mismatch_report_global,
    infer_consumer_field_reads,
    infer_handler_return_shape,
)


# ---------------------------------------------------------------------------
# infer_handler_return_shape
# ---------------------------------------------------------------------------


class TestInferHandlerReturnShape:
    def test_simple_object_return(self):
        tsx = """async function handler(ctx) {
  return { rate: 0.5, count: 12, label: "ok", active: true };
}
export default handler;
"""
        shape = infer_handler_return_shape(tsx)
        assert shape == {
            "rate": "number",
            "count": "number",
            "label": "string",
            "active": "boolean",
        }

    def test_array_and_object_values(self):
        tsx = """async function handler(ctx) {
  return { items: [1, 2, 3], meta: {} };
}
export default handler;
"""
        shape = infer_handler_return_shape(tsx)
        assert shape["items"] == "array"
        assert shape["meta"] == "object"

    def test_template_literal_is_string(self):
        tsx = """async function handler(ctx) {
  const n = 1;
  return { msg: `result is ${n}` };
}
export default handler;
"""
        assert infer_handler_return_shape(tsx)["msg"] == "string"

    def test_unknown_for_call_and_member(self):
        tsx = """async function handler(ctx) {
  const r = await ctx.db.prepare("SELECT 1").first();
  return { row: r, x: r?.id, y: someFn() };
}
export default handler;
"""
        shape = infer_handler_return_shape(tsx)
        assert shape["row"] == "unknown"
        assert shape["x"] == "unknown"
        assert shape["y"] == "unknown"

    def test_shorthand_property(self):
        tsx = """async function handler(ctx) {
  const trendData = [];
  return { trendData };
}
export default handler;
"""
        # Shorthand: we have the key but not its type.
        assert infer_handler_return_shape(tsx) == {"trendData": "unknown"}

    def test_multiple_returns_union_keys(self):
        tsx = """async function handler(ctx) {
  if (ctx.params.x) return { a: 1, b: "x" };
  return { a: 2, c: true };
}
export default handler;
"""
        shape = infer_handler_return_shape(tsx)
        assert shape == {"a": "number", "b": "string", "c": "boolean"}

    def test_conflicting_types_become_mixed(self):
        tsx = """async function handler(ctx) {
  if (ctx.x) return { val: 1 };
  return { val: "two" };
}
export default handler;
"""
        assert infer_handler_return_shape(tsx)["val"] == "mixed"

    def test_parenthesized_return(self):
        tsx = """async function handler(ctx) {
  return ({ rate: 0.5 });
}
export default handler;
"""
        assert infer_handler_return_shape(tsx) == {"rate": "number"}

    def test_bare_identifier_return_skipped(self):
        tsx = """async function handler(ctx) {
  const result = compute();
  return result;
}
export default handler;
"""
        # Bare identifier — out of scope, returns empty shape.
        assert infer_handler_return_shape(tsx) == {}

    def test_parse_failure_returns_empty(self):
        # Severely malformed tree-sitter still parses to *something*; this
        # asserts the function never throws on garbage input.
        assert infer_handler_return_shape("@!@!@$%^&*(") == {}

    def test_empty_string(self):
        assert infer_handler_return_shape("") == {}


# ---------------------------------------------------------------------------
# infer_consumer_field_reads
# ---------------------------------------------------------------------------


class TestInferConsumerFieldReads:
    def test_inline_destructure_from_useHandler(self):
        tsx = """function C() {
  const { rate, count } = useHandler('getMetrics');
  return <div>{rate}</div>;
}
"""
        sites = infer_consumer_field_reads(tsx)
        assert len(sites) == 1
        s = sites[0]
        assert s.producer == "getMetrics"
        assert s.producer_kind == "handler"
        assert set(s.fields_read) == {"rate", "count"}

    def test_inline_destructure_off_data_chain(self):
        tsx = """function C() {
  const { rate } = useHandler('getMetrics').data;
  return <div>{rate}</div>;
}
"""
        sites = infer_consumer_field_reads(tsx)
        assert len(sites) == 1
        assert sites[0].producer == "getMetrics"
        assert sites[0].fields_read == ("rate",)

    def test_member_access_via_binding(self):
        tsx = """function C() {
  const trend = useHandler('getOccupancyTrend');
  return <div>{trend.data.percentage}</div>;
}
"""
        sites = infer_consumer_field_reads(tsx)
        assert len(sites) == 1
        s = sites[0]
        assert s.producer == "getOccupancyTrend"
        # `data` is filtered (SDK hook field). `percentage` is the real read.
        assert "percentage" in s.fields_read
        assert "data" not in s.fields_read

    def test_useModel_destructure(self):
        tsx = """function C() {
  const { data } = useModel('rooms', { filters: { status: 'dirty' } });
  return <div>{data?.length}</div>;
}
"""
        sites = infer_consumer_field_reads(tsx)
        # `data` is the SDK-defined field, but it's destructured directly so
        # we record it. Not a useful read for diagnostic purposes — but it's
        # present, and field_mismatch_report will skip it gracefully when
        # the producer's shape is keyed on column names.
        s = next(s for s in sites if s.producer == "rooms")
        assert s.producer_kind == "model"

    def test_jsx_dataKey_attributed_via_chart_data_prop(self):
        # The `tfluo79j` shape: chart's data prop traces through binding.
        tsx = """function C() {
  const trend = useHandler('getOccupancyTrend', { params: { days: 30 } });
  return (
    <Charts.AreaChart data={trend?.trendData ?? []}>
      <Charts.Area dataKey="rate" />
    </Charts.AreaChart>
  );
}
"""
        sites = infer_consumer_field_reads(tsx)
        s = next(s for s in sites if s.producer == "getOccupancyTrend")
        assert "rate" in s.fields_read

    def test_jsx_dataKey_single_producer_fallback(self):
        # data prop is opaque, but the file has exactly one producer — attribute.
        tsx = """function C() {
  const trend = useHandler('getOccupancyTrend');
  return (
    <Charts.AreaChart data={someOpaqueExpr()}>
      <Charts.Area dataKey="rate" />
    </Charts.AreaChart>
  );
}
"""
        sites = infer_consumer_field_reads(tsx)
        s = next(s for s in sites if s.producer == "getOccupancyTrend")
        assert "rate" in s.fields_read

    def test_jsx_dataKey_unknown_when_multiple_producers(self):
        tsx = """function C() {
  const a = useHandler('alpha');
  const b = useHandler('beta');
  return (
    <Charts.AreaChart data={someOpaqueExpr()}>
      <Charts.Area dataKey="rate" />
    </Charts.AreaChart>
  );
}
"""
        sites = infer_consumer_field_reads(tsx)
        unknowns = [s for s in sites if s.producer == "unknown"]
        assert len(unknowns) == 1
        assert "rate" in unknowns[0].fields_read

    def test_renamed_destructure(self):
        tsx = """function C() {
  const { rate: r, count: c } = useHandler('getMetrics');
  return <div>{r}</div>;
}
"""
        sites = infer_consumer_field_reads(tsx)
        s = sites[0]
        assert set(s.fields_read) == {"rate", "count"}

    def test_assignment_pattern_destructure(self):
        tsx = """function C() {
  const { rate = 0, count = 0 } = useHandler('getMetrics');
  return <div>{rate}</div>;
}
"""
        sites = infer_consumer_field_reads(tsx)
        assert set(sites[0].fields_read) == {"rate", "count"}

    def test_no_useHandler_no_reads(self):
        tsx = """function C() {
  return <div>plain content</div>;
}
"""
        assert infer_consumer_field_reads(tsx) == []

    def test_parse_failure_returns_empty(self):
        assert infer_consumer_field_reads("@$&^*()@$") == []


class TestInferConsumerEdgeCases:
    """Coverage for tricky-but-common JS/TS patterns."""

    def test_optional_chain_member_access(self):
        tsx = """function C() {
  const trend = useHandler('foo');
  return <div>{trend?.rate}</div>;
}
"""
        sites = infer_consumer_field_reads(tsx)
        assert any("rate" in s.fields_read for s in sites if s.producer == "foo")

    def test_three_level_member_chain_records_terminal(self):
        # trend.data.results.percentage — the meaningful field is the leaf.
        # Intermediate names are SDK-internal (`data`) or irrelevant (`results`).
        tsx = """function C() {
  const trend = useHandler('foo');
  return <div>{trend.data.results.percentage}</div>;
}
"""
        sites = infer_consumer_field_reads(tsx)
        s = next(s for s in sites if s.producer == "foo")
        assert "percentage" in s.fields_read

    def test_spread_in_destructure_skipped(self):
        tsx = """function C() {
  const { a, ...rest } = useHandler('foo');
  return <div>{a}</div>;
}
"""
        sites = infer_consumer_field_reads(tsx)
        s = next(s for s in sites if s.producer == "foo")
        assert "a" in s.fields_read
        # The spread element doesn't contribute a field name.
        assert "rest" not in s.fields_read

    def test_nested_destructure_records_outer_only(self):
        # Acknowledged MVP limitation: nested patterns are NOT recursively
        # decomposed. We record the outer key (which exists on the producer)
        # and skip the inner. Documented in _iter_destructured_keys.
        tsx = """function C() {
  const { data: { rate } } = useHandler('foo');
  return <div>{rate}</div>;
}
"""
        sites = infer_consumer_field_reads(tsx)
        s = next(s for s in sites if s.producer == "foo")
        assert "data" in s.fields_read
        # rate is read from the inner pattern but not attributed to foo —
        # this is the known limitation. Surface it so future-us doesn't
        # accidentally regress in the other direction.
        assert "rate" not in s.fields_read

    def test_multi_producer_dataKey_attributed_via_data_prop_trace(self):
        # The tfluo79j-class pattern: multiple useHandlers, but the chart's
        # data prop traces through ONE specific binding.
        tsx = """function C() {
  const a = useHandler('alpha');
  const b = useHandler('beta');
  return (
    <Charts.AreaChart data={a?.trendData ?? []}>
      <Charts.Area dataKey="rate" />
    </Charts.AreaChart>
  );
}
"""
        sites = infer_consumer_field_reads(tsx)
        # rate must be attributed to 'alpha' (the chart's data binding),
        # NOT to 'beta' (also a producer in scope) and NOT to 'unknown'.
        alpha_site = next(s for s in sites if s.producer == "alpha")
        assert "rate" in alpha_site.fields_read
        assert not any(
            "rate" in s.fields_read
            for s in sites
            if s.producer in ("beta", "unknown", "<unknown>")
        )


# ---------------------------------------------------------------------------
# field_mismatch_report — the tfluo79j motivating bug class
# ---------------------------------------------------------------------------


class TestFieldMismatchReport:
    def test_tfluo79j_rate_vs_percentage_detected(self):
        """The exact bug shipped on 2026-05-08.

        Handler returns ``percentage``, chart reads ``dataKey="rate"``.
        The mismatch report MUST flag a missing_in_producer for ``rate``.
        """
        handler_tsx = """async function handler(ctx) {
  const trendData = [{ date: '2026-05-01', percentage: 0.5 }];
  return { trendData };
}
export default handler;
"""
        component_tsx = """function DashboardContent() {
  const trend = useHandler('getOccupancyTrend', { params: { days: 30 } });
  return (
    <Charts.AreaChart data={trend?.trendData ?? []}>
      <Charts.Area dataKey="rate" />
    </Charts.AreaChart>
  );
}
"""
        producer_shape = infer_handler_return_shape(handler_tsx)
        consumer_sites = infer_consumer_field_reads(component_tsx)
        report = field_mismatch_report(
            {"getOccupancyTrend": producer_shape},
            consumer_sites,
            consumer_label="DashboardContent.tsx",
        )

        missing = [m for m in report if m.kind == "missing_in_producer" and m.field == "rate"]
        assert len(missing) == 1, f"Expected one missing_in_producer for 'rate', got: {report}"
        assert missing[0].producer == "getOccupancyTrend"
        assert missing[0].consumer == "DashboardContent.tsx"
        assert missing[0].sites  # at least one source location

    def test_no_mismatch_when_fields_align(self):
        # Note: shape inference is FLAT — both `trendData` (chart data prop
        # member access) and `rate` (dataKey, attributed via the data-prop
        # trace) are read from `foo`. Producer must declare both for the
        # report to be empty. Tests that the absence-of-mismatch path is clean.
        producer_shape = {"trendData": "array", "rate": "number"}
        component_tsx = """function C() {
  const trend = useHandler('foo');
  return (
    <Charts.AreaChart data={trend?.trendData ?? []}>
      <Charts.Area dataKey="rate" />
    </Charts.AreaChart>
  );
}
"""
        sites = infer_consumer_field_reads(component_tsx)
        report = field_mismatch_report({"foo": producer_shape}, sites)
        missing = [m for m in report if m.kind == "missing_in_producer"]
        assert missing == []

    def test_dead_in_consumer_flagged_globally(self):
        # Global aggregation: foo returns {rate, extra}; A reads rate; nothing
        # reads extra anywhere → flag extra once at the global level.
        producer_shape = {"rate": "number", "extra": "string"}
        component_a = """function A() {
  const trend = useHandler('foo');
  return <div>{trend.rate}</div>;
}
"""
        sites_a = infer_consumer_field_reads(component_a)
        report = field_mismatch_report_global(
            {"foo": producer_shape},
            {"A.tsx": sites_a},
        )
        dead = [m for m in report if m.kind == "dead_in_consumer"]
        assert len(dead) == 1
        assert dead[0].field == "extra"
        assert dead[0].producer == "foo"
        assert dead[0].consumer == "<global>"

    def test_dead_NOT_flagged_when_sibling_component_reads_field(self):
        # A reads rate; B reads extra. Neither field is dead globally.
        # The OLD per-component logic would have flagged both (rate dead in
        # B's report, extra dead in A's report). The new global logic
        # correctly suppresses both.
        producer_shape = {"rate": "number", "extra": "string"}
        component_a = """function A() {
  const trend = useHandler('foo');
  return <div>{trend.rate}</div>;
}
"""
        component_b = """function B() {
  const trend = useHandler('foo');
  return <div>{trend.extra}</div>;
}
"""
        sites_a = infer_consumer_field_reads(component_a)
        sites_b = infer_consumer_field_reads(component_b)
        report = field_mismatch_report_global(
            {"foo": producer_shape},
            {"A.tsx": sites_a, "B.tsx": sites_b},
        )
        dead = [m for m in report if m.kind == "dead_in_consumer"]
        assert dead == []

    def test_dead_skipped_when_producer_has_zero_consumers_anywhere(self):
        # Producer is in the shape map but no consumer in any component
        # reads it. We DON'T flag — the producer is probably consumed by
        # something we can't see (different app, future code).
        producer_shape = {"rate": "number"}
        component_tsx = """function C() {
  return <div>plain</div>;
}
"""
        sites = infer_consumer_field_reads(component_tsx)
        report = field_mismatch_report_global(
            {"foo": producer_shape},
            {"C.tsx": sites},
        )
        assert report == []

    def test_dead_skipped_per_component_function(self):
        # The per-component function (used for missing_in_producer only)
        # no longer emits dead_in_consumer at all — that's the global
        # function's job. Verify the per-component variant returns no
        # dead mismatches even when the data would warrant it.
        producer_shape = {"rate": "number", "extra": "string"}
        component_tsx = """function C() {
  const trend = useHandler('foo');
  return <div>{trend.rate}</div>;
}
"""
        sites = infer_consumer_field_reads(component_tsx)
        report = field_mismatch_report({"foo": producer_shape}, sites)
        dead = [m for m in report if m.kind == "dead_in_consumer"]
        assert dead == []  # never emitted by the per-component function

    def test_unknown_producer_consumer_falls_back_to_global_check(self):
        # Two producers in the file, neither has a `secret` field. The dataKey
        # is unattributable but the field doesn't exist anywhere → flag it.
        producer_shapes = {
            "alpha": {"rate": "number"},
            "beta": {"count": "number"},
        }
        component_tsx = """function C() {
  const a = useHandler('alpha');
  const b = useHandler('beta');
  return (
    <Charts.AreaChart data={someOpaqueExpr()}>
      <Charts.Area dataKey="secret" />
    </Charts.AreaChart>
  );
}
"""
        sites = infer_consumer_field_reads(component_tsx)
        report = field_mismatch_report(producer_shapes, sites)
        missing = [m for m in report if m.kind == "missing_in_producer" and m.field == "secret"]
        assert len(missing) == 1
        assert missing[0].producer == "<unknown>"

    def test_unknown_producer_silent_when_field_exists_somewhere(self):
        # Same shape as above, but `count` IS a field on `beta`. Don't flag —
        # we can't be sure which producer it belongs to and over-reporting
        # wastes the agent's attention.
        producer_shapes = {
            "alpha": {"rate": "number"},
            "beta": {"count": "number"},
        }
        component_tsx = """function C() {
  const a = useHandler('alpha');
  const b = useHandler('beta');
  return (
    <Charts.AreaChart data={someOpaqueExpr()}>
      <Charts.Area dataKey="count" />
    </Charts.AreaChart>
  );
}
"""
        sites = infer_consumer_field_reads(component_tsx)
        report = field_mismatch_report(producer_shapes, sites)
        # No missing_in_producer for `count` — a producer in this file has it.
        missing_count = [
            m for m in report if m.kind == "missing_in_producer" and m.field == "count"
        ]
        assert missing_count == []

    def test_unknown_producer_in_shape_map_skipped(self):
        # Consumer reads from `unknownHandler` but we don't have a shape for
        # it. Should silently skip rather than over-report.
        component_tsx = """function C() {
  const x = useHandler('unknownHandler');
  return <div>{x.foo}</div>;
}
"""
        sites = infer_consumer_field_reads(component_tsx)
        report = field_mismatch_report({}, sites)  # no shapes provided
        assert report == []
