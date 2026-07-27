---
name: game-3d
description: "Real 3D / WebGL games and scenes with Three.js via @exepad/ext-three — first-person shooters (Counter-Strike / Doom / Quake style), 3D arenas, walkers, and model viewers. Pointer-lock mouse-look + WASD, hitscan shooting, enemy AI, raycasting. Load for ANY 3D / first-person / FPS / WebGL request. Keywords: 3d, 3D, fps, first-person, first person, shooter, counter-strike, counter strike, doom, quake, wolfenstein, webgl, three.js, threejs, arena, deathmatch, 3d model, model viewer, raycaster."
metadata:
  kind: domain
---
# Skill: 3D / WebGL Games (Three.js)

For **real 3D** rendered with WebGL — first-person shooters, 3D arenas, walkers,
and interactive 3D scenes/viewers. This is the genuine-3D path; for flat 2D
Canvas games (Snake, Breakout, platformers) use `game-arcade` instead.

## The one import rule that matters

3D is powered by **Three.js**, imported as an extension package:

```tsx
import { React } from "@exepad/sdk";
import * as THREE from "@exepad/ext-three";
const { useRef, useState, useEffect } = React;
```

- ✅ `@exepad/ext-three` — the ONLY way to import Three.js. The validator
  admits this exact specifier for components (and resolves it for tsc).
- ❌ `import * as THREE from "three"` — bare `three` is rejected (not in the
  import map; the deploy bundle would fail).
- ❌ **No subpaths / addons:** `@exepad/ext-three/examples/jsm/...`,
  `OrbitControls`, `PointerLockControls`, `GLTFLoader` are **NOT available**
  (the runtime ships the Three.js *core* only). **Hand-roll** orbit/pointer
  controls and procedural geometry — see the recipe. A subpath import fails
  the build.
- `@exepad/ext-pixi` (Pixi.js, 2D WebGL) is the other enabled extension.

Everything else still comes from `@exepad/sdk`. No npm, no other packages.

## Start from the working recipe

A complete, validated, **playable** first-person-shooter component ships with
this skill. Load it and adapt it — do not write a 3D engine from scratch:

    load_skill_resource(skill_name='game-3d', file_path='assets/fps_arena.tsx')

The recipe (`FpsArena`) is a single self-contained component implementing the
full Counter-Strike-style loop: WASD movement, pointer-lock mouse-look **with
an arrow-key look fallback**, click/Space hitscan shooting with headshots,
reload, sprint, endless waves of enemy bots that advance and attack, and a
crosshair + health/score/ammo HUD with start/death overlays. Rename its default
export to your `component_name`; keep the structure. You may save it nearly
verbatim — it already passes validation and renders.

## Canonical Three.js setup (inside one mount-time `useEffect`)

```tsx
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(W, H);
mountRef.current.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e18);
scene.fog = new THREE.Fog(0x0a0e18, 18, 72);

const camera = new THREE.PerspectiveCamera(75, W / H, 0.1, 240);
camera.rotation.order = "YXZ";        // yaw then pitch — correct FPS look order
camera.position.set(0, 1.7, 0);       // eye height

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x1a2030, 1.0));
```

Then `requestAnimationFrame` loop: `const dt = clock.getDelta()`, update, then
`renderer.render(scene, camera)`. ALWAYS `cancelAnimationFrame`, remove every
listener, `renderer.dispose()`, and detach `renderer.domElement` in the effect
cleanup return.

## First-person controls

- **Mouse-look (pointer lock):** request lock on a user gesture
  (`canvas.requestPointerLock()` from a button click), then on `mousemove`
  apply `yaw -= e.movementX * 0.0024; pitch -= e.movementY * 0.0024` (clamp
  pitch to ±1.4). Set `camera.rotation.y = yaw; camera.rotation.x = pitch`.
  Listen for `pointerlockchange` and pause when lock is lost.
- **Arrow-key look fallback (REQUIRED):** also turn with ArrowLeft/Right and
  pitch with ArrowUp/Down. The Studio preview runs in an iframe that may deny
  pointer lock, and automated tests drive the keyboard — without this the game
  looks frozen. `e.preventDefault()` Space + the Arrow keys (they scroll).
- **Move (WASD), camera-relative on the XZ plane** (yaw only — never use
  `camera.getWorldDirection`, which includes pitch and walks you into the floor):
  ```tsx
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  const vx = -sin * fwd + cos * strafe;   // fwd = W−S, strafe = D−A
  const vz = -cos * fwd - sin * strafe;
  ```
  Normalize, multiply by `speed * dt`, clamp to the arena bounds.

## Shooting (hitscan via raycaster — no projectile meshes)

```tsx
raycaster.setFromCamera(new THREE.Vector2(0, 0), camera); // screen center
const hits = raycaster.intersectObjects(enemyGroups, true);
if (hits.length) {
  let o = hits[0].object;
  while (o && !(o.userData && o.userData.isEnemy)) o = o.parent; // walk to group
  if (o) { o.userData.hp -= 40; if (o.userData.hp <= 0) scene.remove(o); }
}
```

Enemy AI: each frame move the group toward the player on XZ, `lookAt` the
player, and damage health on a per-enemy cooldown when within reach.

## Assets — procedural textures, sky & SFX (no files, no network)

The walled garden ships **no image or audio assets** and components may not
`fetch()` them. Generate everything at runtime instead — it's a big visual/audio
upgrade over flat-colored primitives for ~40 lines. The recipe already does all
of this; keep it.

- **Textures → `THREE.CanvasTexture`.** Draw to an offscreen 2D canvas, wrap it:
  ```tsx
  // MUST be defined INSIDE the useEffect — the validator only allows
  // document.createElement there (DOM access is exempt inside effects).
  const makeGridTexture = () => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 512;
    const ctx = cv.getContext("2d");
    if (!ctx) return new THREE.CanvasTexture(cv);
    ctx.fillStyle = "#11182b"; ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = "rgba(90,135,215,0.55)"; ctx.lineWidth = 2;
    for (let i = 0; i <= 512; i += 64) { /* grid lines */ }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;       // color maps are sRGB
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(10, 10);
    return tex;                                   // material.map = makeGridTexture()
  };
  ```
  The recipe has four: `makeGridTexture` (floor), `makeMetalTexture`
  (grayscale brushed metal → walls/crates, **tinted via `material.color`**),
  `makeNoiseTexture` (enemy surface), `makeGradientSky` (→ `scene.background`).
  Pixel noise: use `ctx.createImageData`/`putImageData`, not 60k `fillRect`s.
- **Keep `metalness` low (0–0.2).** With no environment map, high-metalness
  surfaces render near-black (metals reflect an environment that isn't there).
  Lean on the texture `map` + `roughness`, not metalness, for the metal look.
- **SFX → Web Audio (no library).** Synthesize short oscillator/noise bursts;
  never load an audio file. Create the `AudioContext` lazily and **`.resume()`
  it on the Start-button click** — browsers block audio until a user gesture:
  ```tsx
  const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
  const ac = new AC();                            // store on the ref bag
  const tone = (f, dur, type, gain) => {
    const t = ac.currentTime, osc = ac.createOscillator(), env = ac.createGain();
    osc.type = type; osc.frequency.setValueAtTime(f, t);
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env); env.connect(ac.destination); osc.start(t); osc.stop(t + dur);
  };
  ```
- **Dispose on cleanup.** Track every `CanvasTexture` in an array and
  `.dispose()` each (plus the materials), and `ac.close()` the audio context, in
  the effect's return — otherwise repeated mounts leak GPU + audio resources.

## State & HUD

- Keep ALL mutable game state in **one `useRef` bag** (THREE objects, enemies,
  input, player) so the loop never re-renders. Mirror only the HUD numbers
  (health/score/ammo/wave/status) into `useState` on a ~5-frame tick.
- **WebGL uses hex / `THREE.Color`, not CSS theme tokens** (`var(--color-*)`
  means nothing to WebGL). Pick a fixed palette. The DOM HUD overlay can still
  use Tailwind classes.

## Anti-Patterns
- NEVER `import ... from "three"` — use `@exepad/ext-three`.
- NEVER import an addon/subpath (`OrbitControls`, `GLTFLoader`, `.../jsm/...`) —
  not shipped; hand-roll it.
- NEVER skip the arrow-key look fallback (pointer lock can be denied in the iframe).
- NEVER forget `renderer.dispose()` + `cancelAnimationFrame` + listener removal
  in the effect cleanup — WebGL contexts leak otherwise.
- NEVER assign `var(--color-*)` to a Three.js material — use a hex/THREE.Color.
- NEVER bind `{ref.current.foo}` to JSX for live HUD numbers — mirror into state.
- NEVER use `setInterval` for the loop — use `requestAnimationFrame` with cleanup.
- NEVER load a texture/audio FILE (`TextureLoader`, `fetch`, `new Audio('...')`,
  `decodeAudioData`) — no asset files exist and components can't `fetch`. Generate
  textures with `CanvasTexture` and sound with the Web Audio API instead.
- NEVER call `document.createElement('canvas')` at module scope or in the
  component body — only inside the `useEffect` (the validator forbids it elsewhere).
- NEVER set `metalness` high without an environment map — the surface goes black.
- NEVER forget to `.dispose()` every `CanvasTexture` (and `ac.close()` the audio
  context) in cleanup.

## Limits (state them in your result message if asked)
- **No networked multiplayer** (no server/sockets) — single-player only; local
  hotseat is fine.
- Core Three.js only (no loaders/controls addons); build geometry procedurally.
