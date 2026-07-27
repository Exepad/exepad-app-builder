import { React } from "@exepad/sdk";
import * as THREE from "@exepad/ext-three";

const { useRef, useState, useEffect } = React;

// ---------------------------------------------------------------------------
// FPS ARENA — a single-player, first-person Counter-Strike-style shooter on
// real WebGL (Three.js via @exepad/ext-three). Move with WASD, look with the
// mouse (pointer lock) OR the arrow keys (a fallback that also works when the
// preview iframe blocks pointer lock and is drivable from automated tests),
// click / Space to shoot, R to reload, Shift to sprint. Endless waves of enemy
// bots advance on you; survive and rack up score.
//
// ASSETS ARE 100% PROCEDURAL — zero image/audio files, zero network. Surface
// textures are drawn to an offscreen 2D canvas and wrapped as THREE.CanvasTexture
// (makeGridTexture / makeMetalTexture / makeNoiseTexture / makeGradientSky), and
// sound effects are synthesized on the fly with the Web Audio API (makeSfx).
// This keeps the whole game self-contained inside the walled garden.
//
// All mutable game state lives in refs so the rAF loop never triggers a React
// re-render; the HUD numbers are mirrored into state on a slow tick. Rename the
// default export to your component_name before saving.
// ---------------------------------------------------------------------------

const ARENA = 60; // floor is ARENA x ARENA world units
const HALF = ARENA / 2 - 1.5; // player clamp (stay inside the walls)
const MAG = 12; // magazine size
const RELOAD_MS = 1100;
const LOOK = 0.0024; // mouse sensitivity
const KEY_LOOK = 1.6; // arrow-key turn speed (rad/s)
const GAME_KEYS = new Set([
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

export default function FpsArena() {
  const mountRef = useRef<HTMLDivElement>(null);
  // One bag of mutable state shared by the loop + event handlers.
  const g = useRef<any>({
    yaw: 0,
    pitch: 0,
    recoil: 0,
    keys: new Set<string>(),
    enemies: [] as any[],
    health: 100,
    score: 0,
    kills: 0,
    ammo: MAG,
    wave: 0,
    reloadingUntil: 0,
    nowMs: 0,
    status: "ready",
    locked: false,
    hitUntil: 0,
  });

  // HUD mirror — refs don't re-render, so copy what JSX shows on a slow tick.
  const [hud, setHud] = useState({
    health: 100,
    score: 0,
    ammo: MAG,
    wave: 1,
    reloading: false,
    status: "ready",
    hit: false,
  });

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // Reset shared mutable state so a remount (React StrictMode double-invoke in
    // dev, or route remount) starts a clean game instead of inheriting ghost
    // enemies / a skewed wave from the previous mount's ref bag.
    Object.assign(g.current, {
      yaw: 0, pitch: 0, recoil: 0, enemies: [], health: 100, score: 0,
      kills: 0, ammo: MAG, wave: 0, reloadingUntil: 0, nowMs: 0,
      status: "ready", locked: false, hitUntil: 0,
    });

    let W = mount.clientWidth || window.innerWidth;
    let H = mount.clientHeight || window.innerHeight;

    // ---- Renderer ----------------------------------------------------
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H);
    mount.appendChild(renderer.domElement);
    const dom = renderer.domElement;
    dom.style.display = "block";

    // ---- Procedural textures (no files, no network) -------------------
    // Each helper draws to an offscreen 2D canvas and wraps it as a
    // THREE.CanvasTexture. document.createElement is allowed here because
    // these helpers are DEFINED INSIDE the useEffect (the validator exempts
    // DOM access inside effects). Every texture is tracked in `textures` and
    // disposed in the cleanup so repeated mounts never leak GPU memory.
    const textures: any[] = [];
    const makeCanvas = (size: number) => {
      const cv = document.createElement("canvas");
      cv.width = size;
      cv.height = size;
      return cv;
    };
    const track = (tex: any, srgb = true) => {
      if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
      textures.push(tex);
      return tex;
    };
    // Floor — dark concrete speckle with a glowing tactical grid.
    const makeGridTexture = () => {
      const cv = makeCanvas(512);
      const ctx = cv.getContext("2d");
      if (!ctx) return track(new THREE.CanvasTexture(cv));
      ctx.fillStyle = "#11182b";
      ctx.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 1600; i++) {
        const v = 12 + Math.floor(Math.random() * 26);
        ctx.fillStyle = `rgb(${v},${v + 6},${v + 16})`;
        ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
      }
      ctx.strokeStyle = "rgba(90,135,215,0.55)";
      ctx.lineWidth = 2;
      for (let i = 0; i <= 512; i += 64) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 512);
        ctx.moveTo(0, i);
        ctx.lineTo(512, i);
        ctx.stroke();
      }
      const tex = new THREE.CanvasTexture(cv);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(10, 10);
      return track(tex);
    };
    // Walls + crates — grayscale brushed metal, tinted per material.color.
    const makeMetalTexture = () => {
      const cv = makeCanvas(256);
      const ctx = cv.getContext("2d");
      if (!ctx) return track(new THREE.CanvasTexture(cv));
      ctx.fillStyle = "#8a8f99";
      ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 280; i++) {
        const x = Math.random() * 256;
        const a = 0.04 + Math.random() * 0.12;
        ctx.fillStyle = Math.random() > 0.5
          ? `rgba(255,255,255,${a})`
          : `rgba(0,0,0,${a})`;
        ctx.fillRect(x, 0, 1, 256);
      }
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      for (const [bx, by] of [[18, 18], [238, 18], [18, 238], [238, 238]]) {
        ctx.beginPath();
        ctx.arc(bx, by, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      const tex = new THREE.CanvasTexture(cv);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      return track(tex);
    };
    // Enemies — grayscale static noise (tinted red/amber via material.color).
    const makeNoiseTexture = () => {
      const cv = makeCanvas(128);
      const ctx = cv.getContext("2d");
      if (!ctx) return track(new THREE.CanvasTexture(cv));
      const img = ctx.createImageData(128, 128);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 120 + Math.floor(Math.random() * 135);
        img.data[i] = v;
        img.data[i + 1] = v;
        img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      const tex = new THREE.CanvasTexture(cv);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      return track(tex);
    };
    // Sky — vertical gradient used as the scene background (zenith → horizon).
    const makeGradientSky = () => {
      const cv = document.createElement("canvas");
      cv.width = 16;
      cv.height = 256;
      const ctx = cv.getContext("2d");
      if (!ctx) return track(new THREE.CanvasTexture(cv));
      const grad = ctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, "#0a1230");
      grad.addColorStop(0.55, "#16203f");
      grad.addColorStop(1, "#3a4668");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 16, 256);
      const tex = new THREE.CanvasTexture(cv);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      return track(tex);
    };

    // ---- SFX: tiny Web-Audio synth (no files, no network, no library) -
    // Oscillator + noise bursts shaped with a gain envelope. The context is
    // created suspended at mount and resumed on the Start click — browsers
    // block audio until a user gesture. Math.random in the noise buffer is
    // exempt (it runs in a helper inside the effect, never during render).
    const makeSfx = () => {
      let ac: any = null;
      const ctx = () => {
        if (!ac) {
          const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
          if (AC) ac = new AC();
        }
        return ac;
      };
      const tone = (
        freq: number, dur: number, type: string, gain: number, slideTo?: number
      ) => {
        const c = ctx();
        if (!c) return;
        const t = c.currentTime;
        const osc = c.createOscillator();
        const env = c.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
        env.gain.setValueAtTime(gain, t);
        env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(env);
        env.connect(c.destination);
        osc.start(t);
        osc.stop(t + dur);
      };
      const burst = (dur: number, gain: number, cutoff: number) => {
        const c = ctx();
        if (!c) return;
        const t = c.currentTime;
        const n = Math.max(1, Math.floor(c.sampleRate * dur));
        const buf = c.createBuffer(1, n, c.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
        const src = c.createBufferSource();
        src.buffer = buf;
        const filt = c.createBiquadFilter();
        filt.type = "lowpass";
        filt.frequency.value = cutoff;
        const env = c.createGain();
        env.gain.setValueAtTime(gain, t);
        env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(filt);
        filt.connect(env);
        env.connect(c.destination);
        src.start(t);
        src.stop(t + dur);
      };
      return {
        resume: () => {
          const c = ctx();
          if (c && c.state === "suspended") c.resume();
        },
        close: () => {
          if (ac && ac.state !== "closed") {
            try {
              ac.close();
            } catch (_) {
              /* ignore — context may already be closing */
            }
          }
        },
        shoot: () => {
          burst(0.11, 0.32, 2200);
          tone(420, 0.08, "square", 0.12, 90);
        },
        hit: () => tone(880, 0.06, "square", 0.16, 1500),
        kill: () => {
          tone(320, 0.2, "sawtooth", 0.2, 70);
          burst(0.22, 0.16, 700);
        },
        reload: () => tone(200, 0.05, "square", 0.1, 320),
        hurt: () => tone(150, 0.18, "sawtooth", 0.22, 60),
      };
    };
    const sfx = makeSfx();
    g.current.sfx = sfx;

    // ---- Scene / camera ----------------------------------------------
    const scene = new THREE.Scene();
    scene.background = makeGradientSky();
    scene.fog = new THREE.Fog(0x3a4668, 22, 82);

    const camera = new THREE.PerspectiveCamera(75, W / H, 0.1, 240);
    camera.rotation.order = "YXZ";
    camera.position.set(0, 1.7, 0);

    // ---- Lights -------------------------------------------------------
    scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x1a2030, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(14, 26, 10);
    scene.add(sun);

    // ---- Floor + perimeter walls + cover ------------------------------
    const floorMat = new THREE.MeshStandardMaterial({
      map: makeGridTexture(),
      roughness: 0.95,
      metalness: 0.0,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA, ARENA), floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const metalTex = makeMetalTexture();
    const wallMat = new THREE.MeshStandardMaterial({
      map: metalTex,
      color: 0x6f7ba0,
      roughness: 0.6,
      metalness: 0.15,
    });
    const wallH = 4;
    const mkWall = (w: number, d: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat);
      m.position.set(x, wallH / 2, z);
      scene.add(m);
    };
    mkWall(ARENA, 1, 0, -ARENA / 2);
    mkWall(ARENA, 1, 0, ARENA / 2);
    mkWall(1, ARENA, -ARENA / 2, 0);
    mkWall(1, ARENA, ARENA / 2, 0);

    const crateMat = new THREE.MeshStandardMaterial({
      map: metalTex,
      color: 0x9aa6c6,
      roughness: 0.5,
      metalness: 0.2,
    });
    const crates: number[][] = [
      [-12, -10, 2.5],
      [10, -14, 3],
      [16, 8, 2.5],
      [-16, 12, 3],
      [0, 18, 2.5],
      [-6, 0, 2],
    ];
    for (const [cx, cz, s] of crates) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
      c.position.set(cx, s / 2, cz);
      scene.add(c);
    }

    // ---- Enemy bots ---------------------------------------------------
    // Geometries + materials are created ONCE and shared by every enemy, so
    // killing/respawning across endless waves never allocates (or leaks) GPU
    // buffers. They're disposed once in the effect cleanup.
    const enemyTex = makeNoiseTexture();
    const enemyBody = new THREE.MeshStandardMaterial({
      map: enemyTex,
      color: 0xff3b3b,
      emissive: 0x4a0000,
      roughness: 0.7,
    });
    const enemyHead = new THREE.MeshStandardMaterial({
      map: enemyTex,
      color: 0xffd166,
      emissive: 0x3a2a00,
      roughness: 0.6,
    });
    const enemyBodyGeo = new THREE.BoxGeometry(0.9, 1.4, 0.5);
    const enemyHeadGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const spawnEnemy = () => {
      const grp = new THREE.Group();
      const body = new THREE.Mesh(enemyBodyGeo, enemyBody);
      body.position.y = 0.9;
      const head = new THREE.Mesh(enemyHeadGeo, enemyHead);
      head.position.y = 1.85;
      grp.add(body, head);
      // Spawn somewhere on the perimeter ring, away from the player.
      const ang = Math.random() * Math.PI * 2;
      const r = HALF - 2 - Math.random() * 6;
      grp.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
      grp.userData = {
        isEnemy: true,
        hp: 100,
        // Varied speed so the pack staggers instead of arriving as one
        // alpha-strike. Ramps up slightly each wave.
        speed: 1.5 + Math.random() * 0.9 + g.current.wave * 0.12,
        cooldown: 0,
      };
      scene.add(grp);
      g.current.enemies.push(grp);
    };
    const spawnWave = () => {
      g.current.wave += 1;
      // Wave 1 stays light (3) so there's time to find your aim; later waves
      // grow. Capped so it never becomes an unwinnable swarm.
      const n = Math.min(1 + g.current.wave * 2, 16);
      for (let i = 0; i < n; i++) spawnEnemy();
    };

    const raycaster = new THREE.Raycaster();
    const CENTER = new THREE.Vector2(0, 0);
    const clock = new THREE.Clock();

    const resetGame = () => {
      for (const e of g.current.enemies) scene.remove(e);
      g.current.enemies = [];
      g.current.health = 100;
      g.current.score = 0;
      g.current.kills = 0;
      g.current.ammo = MAG;
      g.current.wave = 0;
      g.current.reloadingUntil = 0;
      g.current.yaw = 0;
      g.current.pitch = 0;
      g.current.recoil = 0;
      camera.position.set(0, 1.7, 0);
      spawnWave();
    };
    // Expose reset so the restart button (defined outside this effect) can
    // recenter the player + respawn cleanly instead of half-resetting.
    g.current.reset = resetGame;

    // ---- Shooting (hitscan) ------------------------------------------
    const startReload = () => {
      if (g.current.reloadingUntil) return;
      g.current.reloadingUntil = g.current.nowMs + RELOAD_MS;
      sfx.reload();
    };
    const shoot = () => {
      const s = g.current;
      if (s.status !== "playing") return;
      if (s.reloadingUntil) return;
      if (s.ammo <= 0) {
        startReload();
        return;
      }
      s.ammo -= 1;
      s.recoil += 0.035;
      sfx.shoot();
      raycaster.setFromCamera(CENTER, camera);
      const hits = raycaster.intersectObjects(s.enemies, true);
      if (hits.length) {
        let obj: any = hits[0].object;
        while (obj && !(obj.userData && obj.userData.isEnemy)) obj = obj.parent;
        if (obj) {
          // Headshots (the smaller top box) do double damage.
          const headshot = hits[0].object !== obj.children[0];
          obj.userData.hp -= headshot ? 100 : 40;
          s.hitUntil = s.nowMs + 110;
          sfx.hit();
          if (obj.userData.hp <= 0) {
            scene.remove(obj);
            s.enemies = s.enemies.filter((e: any) => e !== obj);
            s.score += headshot ? 150 : 100;
            s.kills += 1;
            sfx.kill();
          }
        }
      }
      if (s.ammo <= 0) startReload();
    };

    // ---- Input --------------------------------------------------------
    const onKeyDown = (e: KeyboardEvent) => {
      g.current.keys.add(e.code);
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (e.code === "KeyR") startReload();
      if (e.code === "Space") shoot();
    };
    const onKeyUp = (e: KeyboardEvent) => g.current.keys.delete(e.code);
    const onMouseMove = (e: MouseEvent) => {
      if (!g.current.locked) return;
      g.current.yaw -= e.movementX * LOOK;
      g.current.pitch -= e.movementY * LOOK;
      g.current.pitch = Math.max(-1.4, Math.min(1.4, g.current.pitch));
    };
    const onMouseDown = () => {
      if (g.current.status === "playing") shoot();
    };
    const onLockChange = () => {
      g.current.locked = document.pointerLockElement === dom;
      if (!g.current.locked && g.current.status === "playing")
        g.current.status = "paused";
    };
    const onResize = () => {
      W = mount.clientWidth || window.innerWidth;
      H = mount.clientHeight || window.innerHeight;
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      renderer.setSize(W, H);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onMouseMove);
    dom.addEventListener("mousedown", onMouseDown);
    document.addEventListener("pointerlockchange", onLockChange);
    window.addEventListener("resize", onResize);

    // ---- Main loop ----------------------------------------------------
    let raf = 0;
    let hudTick = 0;
    const update = (dt: number) => {
      const s = g.current;
      const keys = s.keys;

      // Reload completion.
      if (s.reloadingUntil && s.nowMs >= s.reloadingUntil) {
        s.ammo = MAG;
        s.reloadingUntil = 0;
      }

      // Arrow-key look (fallback / always available).
      if (keys.has("ArrowLeft")) s.yaw += KEY_LOOK * dt;
      if (keys.has("ArrowRight")) s.yaw -= KEY_LOOK * dt;
      if (keys.has("ArrowUp")) s.pitch = Math.min(1.4, s.pitch + KEY_LOOK * dt);
      if (keys.has("ArrowDown")) s.pitch = Math.max(-1.4, s.pitch - KEY_LOOK * dt);

      // Recoil eases back to zero.
      s.recoil = Math.max(0, s.recoil - s.recoil * Math.min(1, dt * 10));
      camera.rotation.y = s.yaw;
      camera.rotation.x = Math.max(-1.5, Math.min(1.5, s.pitch + s.recoil));

      // Movement (camera-relative on the XZ plane).
      const fwd = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
      const strafe = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
      if (fwd || strafe) {
        const sin = Math.sin(s.yaw);
        const cos = Math.cos(s.yaw);
        let vx = -sin * fwd + cos * strafe;
        let vz = -cos * fwd - sin * strafe;
        const len = Math.hypot(vx, vz) || 1;
        const speed = (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 9 : 5.5) * dt;
        camera.position.x = Math.max(-HALF, Math.min(HALF, camera.position.x + (vx / len) * speed));
        camera.position.z = Math.max(-HALF, Math.min(HALF, camera.position.z + (vz / len) * speed));
      }

      // Enemy AI: advance on the player; attack within reach.
      for (const e of s.enemies) {
        const dx = camera.position.x - e.position.x;
        const dz = camera.position.z - e.position.z;
        const d = Math.hypot(dx, dz) || 1;
        e.lookAt(camera.position.x, e.position.y, camera.position.z);
        if (d > 1.6) {
          e.position.x += (dx / d) * e.userData.speed * dt;
          e.position.z += (dz / d) * e.userData.speed * dt;
          e.userData.cooldown = Math.max(0, e.userData.cooldown - dt);
        } else {
          e.userData.cooldown -= dt;
          if (e.userData.cooldown <= 0) {
            e.userData.cooldown = 1.0;
            s.health -= 6;
            sfx.hurt();
            if (s.health <= 0) {
              s.health = 0;
              s.status = "dead";
              if (document.pointerLockElement === dom) document.exitPointerLock();
            }
          }
        }
      }

      if (s.enemies.length === 0) spawnWave();
    };

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      g.current.nowMs += dt * 1000;
      if (g.current.status === "playing") update(dt);
      renderer.render(scene, camera);

      // Mirror HUD ~12Hz; push status changes promptly.
      if (++hudTick >= 5) {
        hudTick = 0;
        const s = g.current;
        setHud({
          health: Math.round(s.health),
          score: s.score,
          ammo: s.ammo,
          wave: s.wave,
          reloading: !!s.reloadingUntil,
          status: s.status,
          hit: s.nowMs < s.hitUntil,
        });
      }
    };
    spawnWave();
    animate();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      dom.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("pointerlockchange", onLockChange);
      window.removeEventListener("resize", onResize);
      if (document.pointerLockElement === dom) document.exitPointerLock();
      // Drop refs to this scene's enemies + free shared GPU + audio resources.
      g.current.enemies = [];
      enemyBodyGeo.dispose();
      enemyHeadGeo.dispose();
      enemyBody.dispose();
      enemyHead.dispose();
      floorMat.dispose();
      wallMat.dispose();
      crateMat.dispose();
      for (const t of textures) t.dispose();
      sfx.close();
      renderer.dispose();
      if (dom.parentNode) dom.parentNode.removeChild(dom);
    };
  }, []);

  // ---- Start / restart -------------------------------------------------
  const startGame = () => {
    const mount = mountRef.current;
    const canvas = mount ? mount.querySelector("canvas") : null;
    g.current.status = "playing";
    // Resume the audio context on this user gesture (browsers block audio
    // until the first interaction).
    if (g.current.sfx) g.current.sfx.resume();
    if (canvas && (canvas as any).requestPointerLock) {
      try {
        (canvas as any).requestPointerLock();
      } catch (_) {
        /* pointer lock may be blocked in an iframe — arrow keys still work */
      }
    }
    setHud((h) => ({ ...h, status: "playing" }));
  };
  const restartGame = () => {
    // Use the effect's reset (recenters the camera + clears/respawns enemies +
    // resets stats); fall back to a minimal stat reset if it's not wired yet.
    const reset = g.current.reset;
    if (typeof reset === "function") {
      reset();
    } else {
      g.current.health = 100;
      g.current.score = 0;
      g.current.ammo = MAG;
    }
    startGame();
  };

  const overlay = hud.status !== "playing";
  const healthPct = Math.max(0, Math.min(100, hud.health));

  return (
    <div ref={mountRef} className="relative w-full h-screen bg-black overflow-hidden select-none">
      <h1 className="sr-only">3D FPS Arena — first-person shooter</h1>

      {/* Crosshair */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className={`relative ${hud.hit ? "scale-150" : "scale-100"} transition-transform duration-75`}>
          <div className="absolute left-1/2 top-1/2 h-4 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-white/80" />
          <div className="absolute left-1/2 top-1/2 h-0.5 w-4 -translate-x-1/2 -translate-y-1/2 bg-white/80" />
        </div>
      </div>

      {/* HUD */}
      <div className="pointer-events-none absolute left-4 bottom-4 w-56">
        <div className="mb-1 flex items-center justify-between text-xs font-semibold text-white/80">
          <span>HEALTH</span>
          <span>{healthPct}</span>
        </div>
        <div className="h-3 w-full rounded bg-zinc-800">
          <div
            className={`h-3 rounded ${healthPct > 30 ? "bg-emerald-400" : "bg-red-500"}`}
            style={{ width: `${healthPct}%` }}
          />
        </div>
      </div>

      <div className="pointer-events-none absolute right-4 bottom-4 text-right text-white">
        <div className="text-3xl font-black tabular-nums">
          {hud.reloading ? "RELOAD" : hud.ammo} <span className="text-base text-white/50">/ {MAG}</span>
        </div>
        <div className="text-xs font-semibold uppercase tracking-wider text-white/60">Ammo · R to reload</div>
      </div>

      <div className="pointer-events-none absolute right-4 top-4 text-right text-white">
        <div className="text-2xl font-black tabular-nums">{hud.score}</div>
        <div className="text-xs font-semibold uppercase tracking-wider text-white/60">Score · Wave {hud.wave}</div>
      </div>

      {/* Start / pause / death overlay */}
      {overlay && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 text-center backdrop-blur-sm">
          <div className="max-w-md px-6">
            <p className="mb-2 text-4xl font-black tracking-tight text-white">
              {hud.status === "dead" ? "YOU DIED" : hud.status === "paused" ? "PAUSED" : "FPS ARENA"}
            </p>
            <p className="mb-6 text-sm text-white/70">
              {hud.status === "dead"
                ? `Final score ${hud.score} · Wave ${hud.wave}`
                : "WASD move · Mouse / Arrow keys look · Click or Space to shoot · R reload · Shift sprint"}
            </p>
            <button
              type="button"
              onClick={hud.status === "dead" ? restartGame : startGame}
              className="rounded-lg bg-emerald-500 px-8 py-3 text-base font-bold text-black transition-colors hover:bg-emerald-400"
            >
              {hud.status === "dead" ? "Play Again" : hud.status === "paused" ? "Resume" : "Click to Play"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
