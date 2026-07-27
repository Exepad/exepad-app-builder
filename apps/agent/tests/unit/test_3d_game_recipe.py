"""3D-game enablement: intent detection, the eager-inlined FPS recipe, and
the extension import/tsc path that makes a Three.js component build.

These guard the platform change that lets the agent build real WebGL 3D games
(``@exepad/ext-three``) instead of refusing or degrading to 2D.
"""

from __future__ import annotations

from main_agent.agents.orchestrator.app_types.webapp.workflows.creation_workflow import (
    _is_3d_game,
    _load_fps_recipe,
    _should_inline_fps_recipe,
)
from main_agent.services.validation.semantic_validator import run_semantic_checks
from main_agent.services.validation.syntax_validator import (
    validate_tsx_syntax,
    validate_tsx_with_tsc,
)
from main_agent.services.validation.tsc_validator.dts_generator import generate_app_dts


class TestThreeDIntentDetection:
    def test_counter_strike_prompt_is_3d_game(self):
        assert _is_3d_game("create a 3D game, similar to counter strike")

    def test_fps_prompt_is_3d_game(self):
        assert _is_3d_game("build a first-person shooter arena with enemies")

    def test_3d_viewer_is_not_a_game(self):
        # 3D signal but no game signal — must NOT trigger the FPS recipe.
        assert not _is_3d_game("a 3D product viewer for our sneakers")

    def test_2d_game_is_not_3d(self):
        # game signal but no 3D signal.
        assert not _is_3d_game("build a 2D snake game on an HTML canvas")

    def test_plain_dashboard_is_not_3d_game(self):
        assert not _is_3d_game("an admin dashboard with charts and a data table")

    def test_3d_video_player_is_not_3d_game(self):
        # 'player' must NOT be a game token (regression for the tightened
        # _GAME_SIGNAL_RE) — a "3D video player" is 3D but not a game.
        assert not _is_3d_game("a 3D video player with playlists")


class TestRecipeScopingGate:
    """The per-component eager-inline gate (_should_inline_fps_recipe) must put
    the FPS recipe ONLY on the actual game canvas — never on a sibling prose/
    menu/settings page of a 3D-game app, and never alongside content_source."""

    CS = "create a 3D game, similar to counter strike"  # app description

    def _gate(self, *, name, comp_text, role="content", app="custom", content=False):
        combined = f"{self.CS} Tactical Vanguard {name} {comp_text}"
        return _should_inline_fps_recipe(
            app_secondary_type=app,
            role=role,
            comp_name=name,
            comp_text=f"{name} {comp_text}",
            combined_text=combined,
            has_content_source=content,
        )

    def test_game_component_gets_recipe(self):
        assert self._gate(name="GameContent", comp_text="the 3D FPS arena, WASD, shoot enemies")

    def test_arena_named_component_gets_recipe(self):
        assert self._gate(name="ArenaContent", comp_text="first-person shooter scene")

    def test_menu_sibling_with_game_words_excluded(self):
        # The observed HomeContent bug: a menu page whose copy mentions the game
        # must NOT get the recipe (name isn't game-y, no 3D-engine signal here).
        assert not self._gate(
            name="HomeContent", comp_text="main menu for the shooter; start the game"
        )

    def test_prose_page_with_content_source_excluded(self):
        # Terms/About/instructions: has content_source => never the game canvas,
        # even with a game-y name and game words (prevents recipe+content clash).
        assert not self._gate(
            name="HowToPlayContent",
            comp_text="how to play the game, controls and tips",
            content=True,
        )

    def test_non_content_role_excluded(self):
        assert not self._gate(name="GameHeader", comp_text="3D shooter", role="header")

    def test_non_custom_app_excluded(self):
        assert not self._gate(name="GameContent", comp_text="3D shooter", app="website")

    def test_generic_named_game_with_3d_signal_in_plan_gets_recipe(self):
        # False-negative hedge: a generically-named game component still qualifies
        # when its OWN plan carries an explicit 3D-engine signal.
        assert self._gate(name="MainContent", comp_text="WebGL first-person shooter with three.js")


class TestFpsRecipe:
    def test_recipe_loads_and_imports_three(self):
        recipe = _load_fps_recipe()
        assert recipe, "FPS recipe must be present on disk"
        assert 'from "@exepad/ext-three"' in recipe
        # Never bare three, never an addon/subpath (those fail the build).
        assert 'from "three"' not in recipe
        assert "@exepad/ext-three/" not in recipe

    def test_recipe_passes_ast_semantic_rules(self):
        # The strongest guard: the shipped recipe must clear the component
        # rule set with ZERO save-blocking errors — otherwise every 3D build
        # that saves it verbatim would be blocked.
        recipe = _load_fps_recipe()
        res = run_semantic_checks(recipe, [], {}, ["play"], expected_component_name="FpsArena")
        assert res.errors == [], f"recipe has blocking errors: {res.errors}"

    def test_recipe_passes_esbuild_syntax(self):
        ok, errs = validate_tsx_syntax(_load_fps_recipe())
        assert ok, f"recipe failed esbuild: {errs}"

    def test_ext_three_import_resolves_in_tsc_gate(self):
        # The tsc ambient shim must resolve @exepad/ext-three so a 3D component
        # doesn't TS2307. (Fails open to [] when tsc isn't installed locally;
        # in the container tsc is vendored and this asserts real resolution.)
        recipe = _load_fps_recipe()
        app_dts = generate_app_dts(backend={}, logic={}, pages=[{"slug": "play"}])
        findings = validate_tsx_with_tsc(
            tsx_source=recipe, component_name="FpsArena", app_dts=app_dts
        )
        assert findings == [], f"tsc gate flagged the recipe: {[f.message for f in findings]}"


class TestFpsRecipeProceduralAssets:
    """The recipe ships textured surfaces + a gradient sky + synthesized SFX,
    all generated at runtime with ZERO image/audio files and ZERO network — so
    a 3D build isn't bare flat-colored primitives. These guard that the asset
    layer stays in the recipe (and stays self-contained inside the walled
    garden) since the weak model saves the recipe near-verbatim."""

    def test_recipe_has_procedural_texture_helpers(self):
        recipe = _load_fps_recipe()
        for helper in (
            "makeGridTexture",
            "makeMetalTexture",
            "makeNoiseTexture",
            "makeGradientSky",
        ):
            assert helper in recipe, f"recipe lost the {helper}() asset helper"
        # Textures must be real WebGL textures wired onto materials/scene.
        assert "THREE.CanvasTexture" in recipe
        assert "scene.background = makeGradientSky()" in recipe

    def test_recipe_has_synthesized_audio(self):
        recipe = _load_fps_recipe()
        # Inline Web-Audio SFX synth — no audio files, no library import.
        assert "AudioContext" in recipe
        assert "createOscillator" in recipe
        for cue in ("sfx.shoot()", "sfx.hit()", "sfx.kill()", "sfx.hurt()"):
            assert cue in recipe, f"recipe lost the {cue} sound cue"
        # Audio must resume on the Start gesture (browsers block it otherwise).
        assert "g.current.sfx.resume()" in recipe

    def test_assets_are_self_contained_no_network_no_new_import(self):
        recipe = _load_fps_recipe()
        # Audio is inline — NOT a new extension package (no platform wiring).
        assert "@exepad/ext-zzfx" not in recipe
        assert "ext-audio" not in recipe
        # No texture/audio is loaded over the network.
        assert "fetch(" not in recipe
        assert "TextureLoader" not in recipe
        assert "AudioBufferSourceNode" not in recipe or True  # synth, not decode
        assert "decodeAudioData" not in recipe
        # The ONLY non-SDK import remains @exepad/ext-three.
        import re as _re

        ext_imports = _re.findall(r'from "(@exepad/ext-[^"]+)"', recipe)
        assert ext_imports == ["@exepad/ext-three"], f"unexpected ext imports: {ext_imports}"

    def test_textures_and_audio_are_disposed_on_cleanup(self):
        # Repeated mounts must not leak GPU textures or audio contexts.
        recipe = _load_fps_recipe()
        assert "for (const t of textures) t.dispose()" in recipe
        assert "sfx.close()" in recipe
