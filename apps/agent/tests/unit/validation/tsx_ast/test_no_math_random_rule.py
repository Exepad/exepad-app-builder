"""Tests for ``NoMathRandomInComponentRule``.

Forbids ``Math.random()`` in component bodies. The LLM uses it to
invent demo data when its plan is incomplete — chart slices, list
items, KPI numbers — and the random output never matches the user's
intent. Doc forbade it already (12_ANTI_PATTERNS.md:109) but the LLM
ignored the textual ban; the rule enforces it deterministically.

Regression: app ``r3hfcgx5`` (2026-05-14) Nexus Ops DashboardContent
shipped a "Category Mix" donut populated with
``Math.floor(Math.random() * 50)`` because the plan had no
category-aggregation handler.
"""

from __future__ import annotations

from main_agent.services.validation.tsx_ast import (
    AstContext,
    parse_tsx,
    run_rules,
    source_bytes,
)
from main_agent.services.validation.tsx_ast.rules.component_no_math_random import (
    NoMathRandomInComponentRule,
)


def _run(tsx: str) -> list:
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree)
    return list(run_rules(ctx, [NoMathRandomInComponentRule()]))


class TestNoMathRandomRule:
    def test_r3hfcgx5_donut_random_data_blocked(self):
        """The exact pattern from the r3hfcgx5 DashboardContent donut."""
        tsx = """
function DashboardContent() {
  const categoryData = useMemo(() => {
    return (categories ?? []).map((cat) => ({
      name: cat.name,
      value: Math.floor(Math.random() * 50) + 10,
    }));
  }, [categories]);
  return null;
}
"""
        findings = _run(tsx)
        assert len(findings) == 1
        assert findings[0].severity == "error"
        assert "Math.random" in findings[0].message

    def test_bare_call_in_render_blocked(self):
        tsx = """
function X() {
  return <p>id-{Math.random()}</p>;
}
"""
        findings = _run(tsx)
        assert len(findings) == 1
        assert findings[0].severity == "error"

    def test_usememo_empty_deps_allowed(self):
        """``useMemo(() => Math.random(), [])`` is a legitimate one-shot id."""
        tsx = """
function X() {
  const stableId = useMemo(() => Math.random().toString(36).slice(2), []);
  return <p>{stableId}</p>;
}
"""
        findings = _run(tsx)
        assert findings == []

    def test_useref_allowed(self):
        """``useRef(Math.random())`` is a legitimate one-shot init."""
        tsx = """
function X() {
  const seed = useRef(Math.random());
  return <p>{seed.current}</p>;
}
"""
        findings = _run(tsx)
        assert findings == []

    def test_usememo_with_real_deps_still_blocked(self):
        """``useMemo`` with non-empty deps would re-run on dep change → still demo data."""
        tsx = """
function X({ count }) {
  const fake = useMemo(() => Math.random() * count, [count]);
  return <p>{fake}</p>;
}
"""
        findings = _run(tsx)
        assert len(findings) == 1

    def test_unrelated_random_not_matched(self):
        """``customMath.random`` / ``MyRandom.random`` etc. are not flagged."""
        tsx = """
function X() {
  const v = customMath.random();
  return <p>{v}</p>;
}
"""
        findings = _run(tsx)
        assert findings == []

    def test_no_call_no_finding(self):
        tsx = """
function X() {
  return <p>hello</p>;
}
"""
        findings = _run(tsx)
        assert findings == []

    # ── Canvas / arcade game exemption (app ak8wl9cw7 "PixelDash") ──────
    # A GENUINE canvas game draws imperatively to a <canvas> every frame,
    # where Math.random is legitimate per-frame variation (spawns,
    # particles, procedural layout), not React-render demo data. The
    # exemption requires a real game signature (useGameLoop, OR canvas
    # draw + animation loop) detected on the AST — NOT merely the presence
    # of a loop token. This guards the original donut anti-pattern from
    # re-opening when a non-game component happens to use rAF for UI
    # animation. See _is_canvas_game_component.

    def test_game_canvas_plus_raf_allowed(self):
        """Canvas draw (getContext) + rAF loop + Math.random → allowed."""
        tsx = """
function GameCanvas() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const ctx = canvasRef.current.getContext('2d');
    let id;
    const loop = () => {
      const enemyX = Math.random() * 800;
      const jitter = Math.random() * 4 - 2;
      ctx.fillRect(enemyX, jitter, 10, 10);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);
  return <canvas ref={canvasRef} />;
}
"""
        assert _run(tsx) == []

    def test_game_with_use_game_loop_allowed(self):
        """``useGameLoop`` is a game-only SDK hook → exempt on its own."""
        tsx = """
function GameCanvas() {
  useGameLoop((dt) => {
    spawnParticle(Math.random() * 100, Math.random() * 100);
  });
  return <canvas />;
}
"""
        assert _run(tsx) == []

    def test_game_random_in_helper_outside_loop_still_allowed(self):
        """A canvas game's Math.random may live in an init/helper function,
        not only inside the rAF callback. The exemption is component-level,
        so it must NOT re-flag legitimate game randomness in helpers."""
        tsx = """
function GameCanvas() {
  const canvasRef = useRef(null);
  function buildStars(w, h) {
    return Array.from({ length: 50 }, () => ({ x: Math.random() * w, y: Math.random() * h }));
  }
  useEffect(() => {
    const ctx = canvasRef.current.getContext('2d');
    const stars = buildStars(800, 600);
    const loop = () => { ctx.clearRect(0,0,800,600); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }, []);
  return <canvas ref={canvasRef} />;
}
"""
        assert _run(tsx) == []

    # ── Regressions confirmed by adversarial review (do NOT weaken) ─────

    def test_dashboard_raf_countup_plus_random_chart_still_flagged(self):
        """FINDING #1: a dashboard with an unrelated rAF count-up animation
        AND a Math.random chart-data array is the EXACT r3hfcgx5 donut
        anti-pattern. A loop token alone must NOT exempt it — there is no
        canvas, so the random chart data stays flagged."""
        tsx = """
function DashboardContent() {
  const [n, setN] = useState(0);
  useEffect(() => {
    let id;
    const tick = () => { setN((v) => v + 1); id = requestAnimationFrame(tick); };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);
  const data = categories.map((c) => ({ name: c, value: Math.floor(Math.random() * 50) + 10 }));
  return <DonutChart data={data} count={n} />;
}
"""
        findings = _run(tsx)
        assert len(findings) == 1
        assert findings[0].severity == "error"

    def test_comment_mentioning_raf_does_not_exempt(self):
        """FINDING #2: a comment naming requestAnimationFrame is not a real
        call — AST detection ignores it, so the random chart stays flagged."""
        tsx = """
function DashboardContent() {
  // TODO: animate this with requestAnimationFrame later
  const value = Math.floor(Math.random() * 50);
  return <p>{value}</p>;
}
"""
        findings = _run(tsx)
        assert len(findings) == 1

    def test_string_mentioning_raf_does_not_exempt(self):
        """FINDING #2: a string literal naming the marker is not a call."""
        tsx = """
function DashboardContent() {
  const note = "we use requestAnimationFrame in the chart lib";
  const value = Math.floor(Math.random() * 50);
  return <p title={note}>{value}</p>;
}
"""
        assert len(_run(tsx)) == 1

    def test_import_binding_does_not_exempt(self):
        """FINDING #2: importing the name is not calling the loop."""
        tsx = """
import { requestAnimationFrame } from './polyfill';
function DashboardContent() {
  const value = Math.floor(Math.random() * 50);
  return <p>{value}</p>;
}
"""
        assert len(_run(tsx)) == 1

    def test_member_access_raf_on_other_object_does_not_exempt(self):
        """FINDING #2: obj.requestAnimationFrame() on a non-window object is
        not a real loop — only bare or window.requestAnimationFrame counts."""
        tsx = """
function DashboardContent() {
  scheduler.requestAnimationFrame(() => {});
  const value = Math.floor(Math.random() * 50);
  return <p>{value}</p>;
}
"""
        assert len(_run(tsx)) == 1

    def test_static_canvas_chart_no_loop_still_blocked(self):
        """A canvas chart with NO animation loop is the original
        anti-pattern (random demo data) — canvas alone must not exempt."""
        tsx = """
function ChartContent() {
  const ctx = canvasRef.current.getContext('2d');
  const value = Math.floor(Math.random() * 50);
  ctx.fillRect(0, 0, value, 10);
  return <canvas ref={canvasRef} />;
}
"""
        findings = _run(tsx)
        assert len(findings) == 1
        assert findings[0].severity == "error"

    def test_window_qualified_raf_with_canvas_allowed(self):
        """window.requestAnimationFrame + canvas is a real game loop."""
        tsx = """
function GameCanvas() {
  useEffect(() => {
    const ctx = canvasRef.current.getContext('2d');
    const loop = () => { ctx.fillRect(Math.random()*9, 0, 2, 2); window.requestAnimationFrame(loop); };
    window.requestAnimationFrame(loop);
  }, []);
  return <canvas ref={canvasRef} />;
}
"""
        assert _run(tsx) == []

    # ── DOM keyboard games (app atshab922 "2048") ───────────────────────
    # A DOM game (no canvas, no rAF) like 2048/Tetris/Snake-on-DOM also
    # needs Math.random for tile spawns / shuffles / AI. The signature is a
    # keyboard handler + directional keys. Charts/dashboards never read
    # arrow keys, so the donut bug stays flagged.

    def test_dom_game_keydown_plus_arrows_allowed(self):
        """2048-style: window keydown listener + arrow keys + Math.random
        tile spawn → allowed."""
        tsx = """
function GameContent() {
  useEffect(() => {
    const handler = (e) => {
      const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
      const dir = map[e.code];
      if (dir) { e.preventDefault(); move(dir); }
    };
    window.addEventListener('keydown', handler, { passive: false });
    return () => window.removeEventListener('keydown', handler);
  }, []);
  function addRandomTile(board) {
    const empty = board.flat().filter((c) => c === 0);
    const r = Math.floor(Math.random() * empty.length);
    const val = Math.random() < 0.9 ? 2 : 4;
    return placeTile(empty[r], val);
  }
  return <div className="grid" />;
}
"""
        assert _run(tsx) == []

    def test_dom_game_usekeys_allowed(self):
        """A DOM game wiring the SDK ``useKeys`` hook → allowed."""
        tsx = """
function GameContent() {
  const keys = useKeys();
  function shuffle(deck) {
    return deck.sort(() => Math.random() - 0.5);
  }
  return <div>{render(keys)}</div>;
}
"""
        assert _run(tsx) == []

    def test_dom_game_onkeydown_jsx_allowed(self):
        """A focusable-div DOM game using an onKeyDown prop + arrow keys."""
        tsx = """
function GameContent() {
  const onKeyDown = (e) => {
    if (e.code === 'ArrowUp') move('up');
    if (e.code === 'ArrowDown') move('down');
  };
  function spawn() { return Math.floor(Math.random() * 16); }
  return <div tabIndex={0} onKeyDown={onKeyDown}>{board}</div>;
}
"""
        assert _run(tsx) == []

    def test_keydown_without_directional_keys_still_flagged(self):
        """A keyboard handler that is NOT a game (e.g. an Escape-to-close
        modal) + a Math.random chart → still flagged. Requires BOTH a key
        handler AND directional keys to exempt."""
        tsx = """
function DashboardContent() {
  useEffect(() => {
    const onKey = (e) => { if (e.code === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const data = cats.map((c) => ({ name: c, value: Math.floor(Math.random() * 50) }));
  return <Donut data={data} />;
}
"""
        findings = _run(tsx)
        assert len(findings) == 1

    def test_directional_keys_without_handler_still_flagged(self):
        """Directional-key strings with NO keyboard handler (e.g. a legend
        listing controls) must not exempt a Math.random chart."""
        tsx = """
function DashboardContent() {
  const legend = ['ArrowUp', 'ArrowDown'];
  const data = cats.map((c) => ({ value: Math.floor(Math.random() * 50) }));
  return <div>{legend}{<Donut data={data} />}</div>;
}
"""
        findings = _run(tsx)
        assert len(findings) == 1

    # ── AST detection skips comments / strings (LCG-workaround case) ─────

    def test_math_random_in_comment_not_flagged(self):
        """app atshab922: the model wrote an LCG and a comment 'avoids
        Math.random()'. AST member-expression detection must NOT flag the
        comment (no real Math.random call here)."""
        tsx = """
function GameContent() {
  /* simple LCG prng — avoids Math.random() which the validator rejects */
  let seed = 12345;
  function rng() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  return <div>{rng()}</div>;
}
"""
        assert _run(tsx) == []

    def test_math_random_in_string_not_flagged(self):
        """A string literal mentioning Math.random() is not a real call."""
        tsx = """
function HelpContent() {
  const note = "Do not use Math.random() for chart data.";
  return <p>{note}</p>;
}
"""
        assert _run(tsx) == []

    # ── Render-position: deferred contexts are exempt (game logic, handlers) ──
    # Math.random in a handler/effect/loop/helper runs AFTER render, not as
    # render data — exempt regardless of app type (canvas, keyboard, click).

    def test_random_in_event_handler_allowed(self):
        """Math.random in an onClick handler is deferred, not render data."""
        tsx = """
function GameContent() {
  const [seed, setSeed] = useState(0);
  return <button onClick={() => setSeed(Math.random())}>Roll</button>;
}
"""
        assert _run(tsx) == []

    def test_random_in_useeffect_allowed(self):
        """Math.random inside a useEffect callback is deferred."""
        tsx = """
function GameContent() {
  useEffect(() => { const r = Math.random(); apply(r); }, []);
  return <div />;
}
"""
        assert _run(tsx) == []

    def test_click_game_shuffle_in_handler_allowed(self):
        """Click DOM game (memory/cards): a shuffle helper called from a
        handler is deferred → allowed (no canvas, no keyboard)."""
        tsx = """
function GameContent() {
  const shuffle = (deck) => deck.sort(() => Math.random() - 0.5);
  const onNewGame = () => setDeck(shuffle(makeDeck()));
  return <button onClick={onNewGame}>New Game</button>;
}
"""
        assert _run(tsx) == []

    def test_dice_roller_in_handler_allowed(self):
        """A dice roller computing Math.random in a click handler → allowed."""
        tsx = """
function GameContent() {
  const [face, setFace] = useState(1);
  const roll = () => setFace(Math.floor(Math.random() * 6) + 1);
  return <button onClick={roll}>Roll {face}</button>;
}
"""
        assert _run(tsx) == []

    # ── Render-position: render-data Math.random stays FLAGGED ───────────
    # (adversarial-review reproductions — must NOT slip through)

    def test_donut_plus_unrelated_arrow_shortcut_still_flagged(self):
        """The literal r3hfcgx5 donut PLUS an unrelated arrow-key shortcut.
        The shortcut is irrelevant — the Math.random is in render data."""
        tsx = """
function DashboardContent() {
  useEffect(() => {
    const onKey = (e) => { if (e.code === 'ArrowRight') focusNextWidget(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const categoryData = useMemo(
    () => (categories ?? []).map((c) => ({ name: c.name, value: Math.floor(Math.random() * 50) + 10 })),
    [categories]
  );
  return <Donut data={categoryData} />;
}
"""
        findings = _run(tsx)
        assert len(findings) == 1

    def test_arrow_nav_table_plus_random_sparkline_flagged(self):
        """A data-table that reads arrow keys for cell nav + a Math.random
        sparkline computed in render → flagged (random is render data)."""
        tsx = """
function ReportContent() {
  const onKeyDown = (e) => { if (e.code === 'ArrowUp') moveSelection(-1); };
  const spark = rows.map((r) => ({ x: r.t, y: Math.floor(Math.random() * 100) }));
  return <table tabIndex={0} onKeyDown={onKeyDown}><Spark data={spark} /></table>;
}
"""
        findings = _run(tsx)
        assert len(findings) == 1

    def test_trend_icon_map_plus_chart_flagged(self):
        """A trend-arrow icon map {ArrowUp: Icon} + a Math.random chart →
        flagged. The arrow names are an icon lookup, not game input."""
        tsx = """
function KpiContent() {
  const iconMap = { ArrowUp: TrendingUpIcon, ArrowDown: TrendingDownIcon };
  useEffect(() => {
    const onKey = (e) => { if (e.code === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const data = kpis.map((k) => ({ ...k, delta: Math.floor(Math.random() * 20), icon: iconMap.ArrowUp }));
  return <Kpis data={data} />;
}
"""
        findings = _run(tsx)
        assert len(findings) == 1

    # ── window/globalThis-qualified Math.random (regression guard) ──────

    def test_window_qualified_math_random_flagged(self):
        """window.Math.random() in render data must be flagged like Math.random()."""
        tsx = """
function ChartContent() {
  const data = cats.map((c) => ({ v: Math.floor(window.Math.random() * 50) }));
  return <Donut data={data} />;
}
"""
        findings = _run(tsx)
        assert len(findings) == 1

    def test_globalthis_qualified_math_random_flagged(self):
        """globalThis.Math.random() in render data is flagged."""
        tsx = """
function ChartContent() {
  const v = globalThis.Math.random();
  return <p>{v}</p>;
}
"""
        findings = _run(tsx)
        assert len(findings) == 1

    def test_non_global_math_random_not_matched(self):
        """scheduler.Math.random / customMath.random are not the Math global."""
        tsx = """
function X() {
  const a = scheduler.Math.random();
  const b = customMath.random();
  return <p>{a}{b}</p>;
}
"""
        assert _run(tsx) == []

    # ── Game-hook import vs call (#7) ───────────────────────────────────

    def test_game_hook_import_only_does_not_exempt(self):
        """Importing useKeys without CALLING it is not a game signal — a
        Math.random chart in render still flags."""
        tsx = """
import { useKeys } from '@exepad/sdk';
function DashboardContent() {
  const data = cats.map((c) => ({ v: Math.floor(Math.random() * 50) }));
  return <Donut data={data} />;
}
"""
        findings = _run(tsx)
        assert len(findings) == 1

    # ── Helper called from render = render data (one-hop call-graph) ─────
    # A donut refactored into a one-line helper must still be flagged; a game
    # helper called only from handlers/loops must stay exempt.

    def test_arrow_helper_called_from_render_still_flagged(self):
        """`const make = () => ...Math.random...; const data = make()` — the
        helper builds render data, so it is flagged despite the const binding."""
        tsx = """
function DashboardContent() {
  const make = () => cats.map((c) => ({ v: Math.floor(Math.random() * 50) }));
  const data = make();
  return <Donut data={data} />;
}
"""
        findings = _run(tsx)
        assert len(findings) == 1

    def test_named_helper_called_from_render_still_flagged(self):
        """`function buildData(){...Math.random...}; const d = buildData()` —
        render data via a named helper is flagged."""
        tsx = """
function DashboardContent() {
  function buildData() { return cats.map((c) => ({ value: Math.floor(Math.random() * 50) })); }
  const data = buildData();
  return <Donut data={data} />;
}
"""
        findings = _run(tsx)
        assert len(findings) == 1

    def test_helper_called_inside_usememo_with_deps_still_flagged(self):
        """A helper invoked inside a useMemo-with-deps callback runs on every
        dep change = render data → flagged."""
        tsx = """
function DashboardContent() {
  const make = () => Math.floor(Math.random() * 50);
  const data = useMemo(() => cats.map(() => make()), [cats]);
  return <Donut data={data} />;
}
"""
        findings = _run(tsx)
        assert len(findings) == 1

    def test_helper_called_only_from_handler_still_allowed(self):
        """A game/shuffle helper whose only call site is a handler stays
        exempt (its randomness runs on the event, not during render)."""
        tsx = """
function GameContent() {
  const shuffle = (deck) => deck.sort(() => Math.random() - 0.5);
  const onNewGame = () => setDeck(shuffle(makeDeck()));
  return <button onClick={onNewGame}>New Game</button>;
}
"""
        assert _run(tsx) == []

    def test_helper_called_from_useeffect_still_allowed(self):
        """A helper called only from a useEffect is deferred → exempt."""
        tsx = """
function GameContent() {
  function seedBoard() { return grid.map(() => Math.floor(Math.random() * 4)); }
  useEffect(() => { setBoard(seedBoard()); }, []);
  return <div />;
}
"""
        assert _run(tsx) == []

    # ── useState lazy init / useReducer (one-shot / dispatch = deferred) ──

    def test_usestate_lazy_initializer_allowed(self):
        """useState(() => Math.random()) runs once at mount, like useRef."""
        tsx = """
function GameContent() {
  const [board] = useState(() => grid.map(() => Math.floor(Math.random() * 8)));
  return <Board board={board} />;
}
"""
        assert _run(tsx) == []

    def test_usestate_eager_arg_still_flagged(self):
        """useState(Math.random()) (eager, non-function arg) runs every render
        → flagged. Locks the lazy-vs-eager asymmetry."""
        tsx = """
function DashboardContent() {
  const [v] = useState(Math.random());
  return <p>{v}</p>;
}
"""
        findings = _run(tsx)
        assert len(findings) == 1

    def test_usereducer_inline_arrow_allowed(self):
        """A useReducer reducer runs on dispatch (an event), never during
        render → its Math.random (e.g. a tile spawn) is exempt."""
        tsx = """
function GameContent() {
  const [state, dispatch] = useReducer((s, a) => ({ ...s, tile: Math.floor(Math.random() * 4) }), { tile: 0 });
  return <button onClick={() => dispatch({})}>Spawn {state.tile}</button>;
}
"""
        assert _run(tsx) == []

    def test_shadowed_helper_name_does_not_flag_game_helper(self):
        """Name-collision guard: a game helper called from a handler must stay
        exempt even when a same-named, unrelated binding is called during
        render (the call-site scan is identifier-only, so we fall back to
        deferred when the name is shadowed). Without the guard the game's
        Math.random would be wrongly flagged → re-broken build."""
        tsx = """
function Game() {
  const pick = () => Math.floor(Math.random() * 6);
  const onRoll = () => setN(pick());
  return <ul>{xs.map((x) => { const pick = (v) => v; return <li>{pick(x)}</li>; })}</ul>;
}
"""
        assert _run(tsx) == []

    # ── Module-level helpers: transitive call-graph resolution ────────────
    #
    # Regression: app aycz3tzsl (2026-06-28), a memory-match card game. Its
    # deck shuffle lived in a MODULE-LEVEL helper (`shuffleArray` ← `buildCards`
    # ← `useState(() => ...)` lazy init) and confetti in another (`buildConfetti`
    # ← `useEffect`). The render-position pass treated every top-level function
    # as the render boundary, so it flagged all 8 Math.random sites — a false
    # positive that burned the model's retry and fell to the salvage path.

    def test_module_helper_from_lazy_init_allowed(self):
        """shuffle ← buildDeck ← useState(() => ...) — a two-hop chain ending
        in a lazy initializer is deferred. The memory-game deck-shuffle pattern."""
        tsx = """
function shuffle(a) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}
function buildDeck() { return shuffle([1, 1, 2, 2]); }
function Game() {
  const [cards, setCards] = useState(() => buildDeck());
  return <div>{cards.length}</div>;
}
"""
        assert _run(tsx) == []

    def test_module_helper_from_effect_allowed(self):
        """A module-level factory called only from useEffect is deferred — the
        memory-game confetti pattern (Array.from with per-particle randomness)."""
        tsx = """
function buildConfetti() {
  return Array.from({ length: 40 }, (_, i) => ({
    left: `${Math.random() * 100}%`,
    round: Math.random() > 0.5,
  }));
}
function Game() {
  const [c, setC] = useState([]);
  useEffect(() => { setC(buildConfetti()); }, []);
  return <div>{c.length}</div>;
}
"""
        assert _run(tsx) == []

    def test_module_helper_from_callback_allowed(self):
        """A module-level helper called from a useCallback handler is deferred
        (the memory game's newGame() reshuffle)."""
        tsx = """
function buildDeck() { return [1, 2].map((n) => ({ n, k: Math.random() })); }
function Game() {
  const [cards, setCards] = useState([]);
  const newGame = useCallback(() => { setCards(buildDeck()); }, []);
  return <button onClick={newGame}>{cards.length}</button>;
}
"""
        assert _run(tsx) == []

    def test_module_helper_called_from_render_flagged(self):
        """A module-level helper whose value flows into render (called in the
        component body) is still the refactored donut → flagged."""
        tsx = """
function makeData() { return cats.map((c) => ({ v: Math.floor(Math.random() * 50) })); }
function DashboardContent() {
  const data = makeData();
  return <div>{data.length}</div>;
}
"""
        findings = _run(tsx)
        assert len(findings) == 1

    def test_two_hop_donut_now_flagged(self):
        """Formerly a documented residual: make ← wrap ← render. Transitive
        call-graph resolution now follows the second hop and flags it."""
        tsx = """
function make() { return cats.map((c) => ({ v: Math.random() * 50 })); }
function wrap() { return make(); }
function DashboardContent() {
  const data = wrap();
  return <div>{data.length}</div>;
}
"""
        findings = _run(tsx)
        assert len(findings) == 1

    def test_module_helper_render_and_deferred_flagged(self):
        """A helper reachable from BOTH render and a deferred site is flagged —
        any render call site means its random flows into render data."""
        tsx = """
function gen() { return Math.random(); }
function Game() {
  const x = gen();
  useEffect(() => { gen(); }, []);
  return <div>{x}</div>;
}
"""
        findings = _run(tsx)
        assert len(findings) == 1

    def test_component_body_random_still_flagged(self):
        """Math.random directly in the component body (with module-level helpers
        present) must still be flagged — the component is the render boundary,
        not a helper, so its call-site scan never exempts the body."""
        tsx = """
function shuffle(a) { return a; }
function Game() {
  const seed = Math.random();
  return <div>{seed}</div>;
}
"""
        findings = _run(tsx)
        assert len(findings) == 1

    def test_arrow_component_with_module_helper_allowed(self):
        """Arrow-function component (`const Game = () => ...`) + a module-level
        random helper called from a handler — the component is still detected as
        the render boundary by its hooks/JSX, and the helper stays deferred."""
        tsx = """
function roll() { return Math.floor(Math.random() * 6); }
const Game = () => {
  const [n, setN] = useState(0);
  return <button onClick={() => setN(roll())}>{n}</button>;
};
"""
        assert _run(tsx) == []
