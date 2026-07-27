// Bloop World — original retro pixel platformer
// Tile = 32px. Level chars:
//   '#' ground, 'B' brick, 'Q' question block, 'P' pipe-top-left, 'p' pipe-top-right,
//   'I' pipe-body-left, 'i' pipe-body-right, '=' platform, 's' spike,
//   'c' coin, 'w' wobbler enemy, 'x' spiker enemy, 'f' floater enemy,
//   'S' player spawn, 'G' goal flag, 'h' hill (decor), 'C' cloud (decor)

const TILE = 32;

const LEVELS = [
  {
    name: "World 1-1 — Sunny Plains",
    hint: "← → run    SPACE jump (×2)    SHIFT dash    Stomp wobblers!",
    rows: [
      "                                                                                  ",
      "  C        C                          C                C                          ",
      "                                                                                  ",
      "                                                                                  ",
      "        c c c                                                                     ",
      "                                                                                  ",
      "                          BBQBB         c c c                                     ",
      "                                                                                  ",
      "                                                              c c c               ",
      "                  c c                                                            G",
      "                                       Pp                                         ",
      "  h          h            BB           Ii        h                       h        ",
      "      w           w                  w  Ii   w        x   w                w      ",
      "##################   #####################################   ###############     ",
      "##################   #####################################   ###############     ",
      "##################   #####################################   ###############     ",
      "##################   #####################################   ###############     ",
    ],
  },
  {
    name: "World 1-2 — Brick & Sky",
    hint: "Mind the floaters. Bricks are solid.",
    rows: [
      "                                                                                              ",
      "       C                  C                       C              C                            ",
      "                                                                                              ",
      "                  c c c                                                                       ",
      "                BBBBBBB                                                                       ",
      "                                                  c c                                         ",
      "                                                BBBBB                                         ",
      "          f                       f                              f                            ",
      "                          c c                                                                 ",
      "                        BBQQBB                       c c                                      ",
      "                                                  =======                                     ",
      "                                                                       c c c                  ",
      "                                                                                              ",
      "                       Pp                                                                  G  ",
      "  h     w        x     Ii        w   w        x        w       w     w       BBBB             ",
      "##############   ##############################   #################################          ",
      "##############   ##############################   #################################          ",
      "##############   ##############################   #################################          ",
    ],
  },
  {
    name: "World 1-3 — Castle Run",
    hint: "Final stretch. Spikers, gaps, glory.",
    rows: [
      "                                                                                                ",
      "    C            C                  C                       C            C                     ",
      "                                                                                                ",
      "                                                                                                ",
      "                                                                                                ",
      "          c c                              c c c                                                ",
      "        BBBBB                            BBBBBBB                                                ",
      "                                                                                                ",
      "                  f                                          f                                  ",
      "                          c                                                  c c c              ",
      "                        BBB                                                =========            ",
      "                                          c c                                                   ",
      "                                        BBQBB                                                   ",
      "                                                                                                ",
      "                                                  s s s s s                              G      ",
      "  h    w       x     w         x x         w                  w     x      w      BBBBBBB       ",
      "###########   ###########   ###########################   ###########################          ",
      "###########   ###########   ###########################   ###########################          ",
      "###########   ###########   ###########################   ###########################          ",
    ],
  },
];

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

function parseLevel(rows) {
  const w = Math.max(...rows.map(r => r.length));
  const h = rows.length;
  const tiles = [];
  let spawn = { x: 64, y: 64 };
  let goal = { x: 0, y: 0 };
  const spikes = [], coins = [], enemies = [], decor = [];
  for (let y = 0; y < h; y++) {
    const r = rows[y].padEnd(w, ' ');
    for (let x = 0; x < w; x++) {
      const ch = r[x];
      const px = x * TILE, py = y * TILE;
      if (ch === '#') tiles.push({ x, y, type: 'ground' });
      else if (ch === 'B') tiles.push({ x, y, type: 'brick' });
      else if (ch === 'Q') tiles.push({ x, y, type: 'question' });
      else if (ch === 'P') tiles.push({ x, y, type: 'pipe-tl' });
      else if (ch === 'p') tiles.push({ x, y, type: 'pipe-tr' });
      else if (ch === 'I') tiles.push({ x, y, type: 'pipe-bl' });
      else if (ch === 'i') tiles.push({ x, y, type: 'pipe-br' });
      else if (ch === '=') tiles.push({ x, y, type: 'platform' });
      else if (ch === 's') spikes.push({ x: px, y: py + 18, w: TILE, h: 14 });
      else if (ch === 'c') coins.push({ x: px + TILE / 2, y: py + TILE / 2, taken: false, t: Math.random() * Math.PI * 2 });
      else if (ch === 'w') enemies.push(makeEnemy('wobbler', px, py));
      else if (ch === 'x') enemies.push(makeEnemy('spiker', px, py));
      else if (ch === 'f') enemies.push(makeEnemy('floater', px, py));
      else if (ch === 'h') decor.push({ type: 'hill', x: px, y: py });
      else if (ch === 'C') decor.push({ type: 'cloud', x: px, y: py });
      else if (ch === 'S') spawn = { x: px, y: py };
      else if (ch === 'G') goal = { x: px, y: py };
    }
  }
  // Default spawn for level 1 if no S marker: leftmost ground gap
  if (!rows.some(r => r.includes('S'))) spawn = { x: TILE * 2, y: TILE * 11 };
  return { w: w * TILE, h: h * TILE, tiles, spikes, coins, enemies, decor, spawn, goal };
}

function makeEnemy(type, x, y) {
  if (type === 'wobbler') return { type, x, y: y + 4, w: 28, h: 28, vx: -50, vy: 0, alive: true, squashT: 0, t: 0 };
  if (type === 'spiker') return { type, x, y: y + 4, w: 28, h: 28, vx: -40, vy: 0, alive: true, t: 0 };
  if (type === 'floater') return { type, x, y, w: 26, h: 26, vx: 0, vy: -120, alive: true, baseY: y, t: Math.random() * Math.PI * 2 };
  return null;
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function Game() {
  const canvasRef = React.useRef(null);
  const stateRef = React.useRef(null);
  const [hud, setHud] = React.useState({ coins: 0, totalCoins: 0, level: 0, levelName: "", hint: "", deaths: 0, time: 0, complete: false, lives: 3, paused: false });

  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "gravity": 1600,
    "jumpVel": 540,
    "moveSpeed": 240,
    "doubleJump": true,
    "dash": true,
    "cameraShake": true,
    "skyColor": "#6BB6FF",
    "groundColor": "#C8722A",
    "groundGrass": "#3FAA3F",
    "brickColor": "#C9602B",
    "playerHat": "#E63946",
    "playerSkin": "#F2C49B",
    "playerSuit": "#1D5FB4"
  }/*EDITMODE-END*/;

  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const tweaksRef = React.useRef(tweaks);
  React.useEffect(() => { tweaksRef.current = tweaks; }, [tweaks]);

  React.useEffect(() => {
    const level = parseLevel(LEVELS[0].rows);
    stateRef.current = {
      level,
      levelIdx: 0,
      player: makePlayer(level.spawn),
      keys: {},
      jumpBuffer: 0,
      coyote: 0,
      camera: { x: 0, y: 0, shakeT: 0, shakeAmp: 0 },
      coinsCollected: 0,
      deaths: 0,
      lives: 3,
      time: 0,
      complete: false,
      paused: false,
      flash: 0,
      particles: [],
      goalReached: false,
      transition: 1,
      cloudOffset: 0,
    };
    setHud(h => ({ ...h, totalCoins: level.coins.length, levelName: LEVELS[0].name, hint: LEVELS[0].hint, lives: 3 }));
  }, []);

  function makePlayer(spawn) {
    return {
      x: spawn.x, y: spawn.y, w: 26, h: 30,
      vx: 0, vy: 0,
      onGround: false, facing: 1,
      jumps: 0, maxJumps: 2,
      dashing: 0, dashCd: 0, dashDir: 1,
      squash: 1, stretch: 1,
      legPhase: 0,
      dead: false, respawnT: 0,
      invuln: 1.0,
    };
  }

  function loadLevel(idx, keepLives = true) {
    const lvl = LEVELS[idx];
    if (!lvl) return;
    const level = parseLevel(lvl.rows);
    const s = stateRef.current;
    s.level = level;
    s.levelIdx = idx;
    s.player = makePlayer(level.spawn);
    s.coinsCollected = 0;
    s.particles = [];
    s.goalReached = false;
    s.camera.x = 0; s.camera.y = 0;
    s.transition = 1;
    if (!keepLives) s.lives = 3;
    setHud(h => ({ ...h, level: idx, totalCoins: level.coins.length, coins: 0, levelName: lvl.name, hint: lvl.hint, complete: false, lives: s.lives }));
  }

  React.useEffect(() => {
    const down = (e) => {
      const s = stateRef.current; if (!s) return;
      const k = e.key.toLowerCase();
      s.keys[k] = true;
      if (k === ' ' || k === 'arrowup' || k === 'w') {
        s.jumpBuffer = 0.12;
        e.preventDefault();
      }
      if (k === 'r') loadLevel(s.levelIdx);
      if (k === 'p' || k === 'escape') {
        s.paused = !s.paused;
        setHud(h => ({ ...h, paused: s.paused }));
      }
      if (k === 'n' && s.complete) { s.complete = false; s.lives = 3; loadLevel(0, false); }
    };
    const up = (e) => {
      const s = stateRef.current; if (!s) return;
      s.keys[e.key.toLowerCase()] = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  function tileAt(level, tx, ty) {
    return level.tiles.find(t => t.x === tx && t.y === ty);
  }

  function isSolidAt(level, tx, ty, fromAbove = false) {
    const t = tileAt(level, tx, ty);
    if (!t) return false;
    if (t.type === 'platform') return fromAbove;
    return true; // all other tiles are solid
  }

  function moveAndCollide(p, level, dt) {
    p.x += p.vx * dt;
    let tx0 = Math.floor(p.x / TILE);
    let tx1 = Math.floor((p.x + p.w - 1) / TILE);
    let ty0 = Math.floor(p.y / TILE);
    let ty1 = Math.floor((p.y + p.h - 1) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (isSolidAt(level, tx, ty, false)) {
          if (p.vx > 0) p.x = tx * TILE - p.w - 0.01;
          else if (p.vx < 0) p.x = (tx + 1) * TILE + 0.01;
          p.vx = 0;
        }
      }
    }
    p.y += p.vy * dt;
    p.onGround = false;
    tx0 = Math.floor(p.x / TILE);
    tx1 = Math.floor((p.x + p.w - 1) / TILE);
    ty0 = Math.floor(p.y / TILE);
    ty1 = Math.floor((p.y + p.h - 1) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = tileAt(level, tx, ty);
        if (!t) continue;
        if (t.type === 'platform') {
          if (p.vy > 0) {
            const prevBottom = (p.y - p.vy * dt) + p.h;
            const platTop = ty * TILE;
            if (prevBottom <= platTop + 0.5) {
              p.y = platTop - p.h - 0.01;
              p.vy = 0; p.onGround = true;
            }
          }
        } else {
          if (p.vy > 0) {
            p.y = ty * TILE - p.h - 0.01;
            p.vy = 0; p.onGround = true;
          } else if (p.vy < 0) {
            p.y = (ty + 1) * TILE + 0.01;
            p.vy = 0;
            // brick bump
            if (t.type === 'brick' || t.type === 'question') {
              t.bump = 0.2;
              if (t.type === 'question' && !t.hit) {
                t.hit = true;
                const s = stateRef.current;
                const tw = tweaksRef.current;
                s.coinsCollected += 1;
                for (let i = 0; i < 10; i++) {
                  s.particles.push({ x: tx * TILE + TILE / 2, y: ty * TILE, vx: (Math.random() - 0.5) * 200, vy: -100 - Math.random() * 200, life: 0.5, color: '#FFD93D', r: 2 + Math.random() * 2 });
                }
                setHud(h => ({ ...h, coins: s.coinsCollected }));
              }
            }
          }
        }
      }
    }
  }

  function moveEnemyAndCollide(e, level, dt) {
    if (e.type === 'floater') {
      // Bobbing motion, no tile collision
      e.t += dt;
      e.y = e.baseY + Math.sin(e.t * 2) * 60;
      return;
    }
    e.x += e.vx * dt;
    let tx0 = Math.floor(e.x / TILE);
    let tx1 = Math.floor((e.x + e.w - 1) / TILE);
    let ty0 = Math.floor(e.y / TILE);
    let ty1 = Math.floor((e.y + e.h - 1) / TILE);
    let bumped = false;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (isSolidAt(level, tx, ty, false)) {
          if (e.vx > 0) e.x = tx * TILE - e.w - 0.01;
          else if (e.vx < 0) e.x = (tx + 1) * TILE + 0.01;
          bumped = true;
        }
      }
    }
    if (bumped) e.vx = -e.vx;

    // gravity
    e.vy += 1400 * dt;
    if (e.vy > 700) e.vy = 700;
    e.y += e.vy * dt;
    let onGround = false;
    tx0 = Math.floor(e.x / TILE);
    tx1 = Math.floor((e.x + e.w - 1) / TILE);
    ty0 = Math.floor(e.y / TILE);
    ty1 = Math.floor((e.y + e.h - 1) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (isSolidAt(level, tx, ty, false)) {
          if (e.vy > 0) { e.y = ty * TILE - e.h - 0.01; e.vy = 0; onGround = true; }
          else if (e.vy < 0) { e.y = (ty + 1) * TILE + 0.01; e.vy = 0; }
        }
      }
    }
    // Edge detection — turn around if no ground ahead
    if (onGround) {
      const aheadX = e.vx > 0 ? e.x + e.w + 2 : e.x - 2;
      const footY = e.y + e.h + 2;
      const tx = Math.floor(aheadX / TILE);
      const ty = Math.floor(footY / TILE);
      if (!isSolidAt(level, tx, ty, false)) e.vx = -e.vx;
    }
    e.t = (e.t || 0) + dt;
  }

  React.useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    let last = performance.now();
    let raf;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cvs.width = cvs.clientWidth * dpr;
      cvs.height = cvs.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cvs);

    function step(now) {
      raf = requestAnimationFrame(step);
      let dt = (now - last) / 1000;
      last = now;
      dt = Math.min(dt, 1 / 30);
      const s = stateRef.current;
      if (!s) return;
      const tw = tweaksRef.current;
      const VW = cvs.clientWidth;
      const VH = cvs.clientHeight;
      if (!s.complete && !s.paused) update(dt, tw, VW, VH);
      render(ctx, VW, VH, tw);
    }

    function update(dt, tw, VW, VH) {
      const s = stateRef.current;
      const p = s.player;
      const lvl = s.level;
      s.time += dt;
      s.flash = Math.max(0, s.flash - dt * 3);
      s.cloudOffset += dt * 8;
      p.invuln = Math.max(0, p.invuln - dt);

      if (p.dead) {
        p.respawnT -= dt;
        if (p.respawnT <= 0) {
          if (s.lives <= 0) {
            // game over → restart level 1 with fresh lives
            s.lives = 3;
            loadLevel(0, false);
            return;
          }
          s.player = makePlayer(lvl.spawn);
          s.flash = 0.3;
        }
        return;
      }

      const left = s.keys['arrowleft'] || s.keys['a'];
      const right = s.keys['arrowright'] || s.keys['d'];
      const dashKey = s.keys['shift'];
      const jumpHeld = s.keys[' '] || s.keys['arrowup'] || s.keys['w'];

      const target = (right ? 1 : 0) - (left ? 1 : 0);
      const speed = tw.moveSpeed;
      const accel = p.onGround ? 2200 : 1400;
      const targetVx = target * speed;
      if (p.dashing > 0) {
        p.vx = p.dashDir * speed * 2.4;
      } else {
        p.vx += clamp(targetVx - p.vx, -accel * dt, accel * dt);
        if (Math.abs(target) < 0.01 && p.onGround) {
          p.vx *= Math.pow(0.0001, dt);
          if (Math.abs(p.vx) < 5) p.vx = 0;
        }
      }
      if (target !== 0) p.facing = target;
      if (p.onGround && Math.abs(p.vx) > 10) p.legPhase += dt * 14;

      if (p.onGround) { s.coyote = 0.12; p.jumps = 0; }
      else s.coyote -= dt;
      s.jumpBuffer -= dt;

      const canJump = (p.onGround || s.coyote > 0) && p.jumps === 0;
      const canDoubleJump = tw.doubleJump && !p.onGround && p.jumps < (p.maxJumps - 1);
      if (s.jumpBuffer > 0 && (canJump || canDoubleJump)) {
        p.vy = -tw.jumpVel;
        p.jumps += 1;
        s.jumpBuffer = 0;
        s.coyote = 0;
        p.stretch = 1.25; p.squash = 0.8;
        for (let i = 0; i < 6; i++) {
          s.particles.push({ x: p.x + p.w / 2, y: p.y + p.h, vx: (Math.random() - 0.5) * 120, vy: -Math.random() * 60, life: 0.4, color: '#ffffff', r: 2 + Math.random() * 2 });
        }
      }
      if (!jumpHeld && p.vy < -tw.jumpVel * 0.4) p.vy = -tw.jumpVel * 0.4;

      p.dashCd -= dt;
      p.dashing -= dt;
      if (tw.dash && dashKey && p.dashCd <= 0 && p.dashing <= 0) {
        p.dashing = 0.18;
        p.dashCd = 0.6;
        p.dashDir = target !== 0 ? target : p.facing;
        p.vy = 0;
        for (let i = 0; i < 10; i++) {
          s.particles.push({ x: p.x + p.w / 2, y: p.y + p.h / 2, vx: -p.dashDir * Math.random() * 200, vy: (Math.random() - 0.5) * 60, life: 0.35, color: tw.playerHat, r: 2 + Math.random() * 3 });
        }
      }

      if (p.dashing <= 0) {
        p.vy += tw.gravity * dt;
        if (p.vy > 900) p.vy = 900;
      } else p.vy = 0;

      moveAndCollide(p, lvl, dt);
      p.stretch = lerp(p.stretch, 1, Math.min(1, dt * 10));
      p.squash = lerp(p.squash, 1, Math.min(1, dt * 10));

      // Tile bump animation decay
      for (const t of lvl.tiles) {
        if (t.bump) t.bump = Math.max(0, t.bump - dt);
      }

      if (p.y > lvl.h + 200) killPlayer(tw);

      const pbox = { x: p.x + 3, y: p.y + 3, w: p.w - 6, h: p.h - 6 };
      for (const sp of lvl.spikes) {
        if (rectsOverlap(pbox, sp)) { killPlayer(tw); break; }
      }

      // Enemies
      for (const e of lvl.enemies) {
        if (!e.alive) {
          e.squashT = (e.squashT || 0) + dt;
          continue;
        }
        moveEnemyAndCollide(e, lvl, dt);
        const ebox = { x: e.x + 2, y: e.y + 2, w: e.w - 4, h: e.h - 4 };
        if (rectsOverlap(pbox, ebox)) {
          // Stomp logic — only wobblers/floaters can be stomped
          const stompable = e.type === 'wobbler' || e.type === 'floater';
          const isStomp = stompable && (p.vy > 0) && ((p.y + p.h - 8) <= e.y + 4);
          if (isStomp) {
            e.alive = false;
            e.squashT = 0;
            p.vy = -tw.jumpVel * 0.7;
            p.jumps = Math.max(0, p.jumps - 1);
            for (let i = 0; i < 8; i++) {
              s.particles.push({ x: e.x + e.w / 2, y: e.y + e.h, vx: (Math.random() - 0.5) * 200, vy: -Math.random() * 100, life: 0.4, color: '#8B5A2B', r: 2 });
            }
          } else if (p.dashing > 0 && stompable) {
            e.alive = false;
            for (let i = 0; i < 12; i++) {
              s.particles.push({ x: e.x + e.w / 2, y: e.y + e.h / 2, vx: (Math.random() - 0.5) * 300, vy: (Math.random() - 0.5) * 200, life: 0.5, color: '#8B5A2B', r: 2 });
            }
          } else if (p.invuln <= 0) {
            killPlayer(tw);
            break;
          }
        }
      }

      // Coins
      for (const c of lvl.coins) {
        if (c.taken) continue;
        c.t += dt * 4;
        const cb = { x: c.x - 10, y: c.y - 10, w: 20, h: 20 };
        if (rectsOverlap(pbox, cb)) {
          c.taken = true;
          s.coinsCollected += 1;
          for (let i = 0; i < 8; i++) {
            s.particles.push({ x: c.x, y: c.y, vx: (Math.random() - 0.5) * 200, vy: -Math.random() * 200, life: 0.5, color: '#FFD93D', r: 2 + Math.random() * 2 });
          }
          setHud(h => ({ ...h, coins: s.coinsCollected }));
        }
      }

      // Goal
      const gbox = { x: lvl.goal.x, y: lvl.goal.y, w: TILE, h: TILE * 4 };
      if (!s.goalReached && rectsOverlap(pbox, gbox)) {
        s.goalReached = true;
        s.flash = 0.5;
        for (let i = 0; i < 50; i++) {
          s.particles.push({ x: lvl.goal.x + TILE / 2, y: lvl.goal.y + TILE * 2, vx: (Math.random() - 0.5) * 400, vy: (Math.random() - 0.5) * 400, life: 0.9, color: ['#FFD93D', '#E63946', '#6BB6FF'][Math.floor(Math.random() * 3)], r: 2 + Math.random() * 3 });
        }
        setTimeout(() => {
          if (s.levelIdx + 1 < LEVELS.length) loadLevel(s.levelIdx + 1, true);
          else { s.complete = true; setHud(h => ({ ...h, complete: true })); }
        }, 800);
      }

      // Camera
      const targetCx = clamp(p.x + p.w / 2 - VW / 2, 0, Math.max(0, lvl.w - VW));
      const targetCy = clamp(p.y + p.h / 2 - VH / 2, 0, Math.max(0, lvl.h - VH));
      s.camera.x = lerp(s.camera.x, targetCx, Math.min(1, dt * 8));
      s.camera.y = lerp(s.camera.y, targetCy, Math.min(1, dt * 8));
      s.camera.shakeT = Math.max(0, s.camera.shakeT - dt);
      s.camera.shakeAmp = lerp(s.camera.shakeAmp, 0, Math.min(1, dt * 12));

      for (const pt of s.particles) {
        pt.x += pt.vx * dt; pt.y += pt.vy * dt;
        pt.vy += 600 * dt; pt.life -= dt;
      }
      s.particles = s.particles.filter(p => p.life > 0);
      // Drop dead enemies after a beat
      lvl.enemies = lvl.enemies.filter(e => e.alive || (e.squashT || 0) < 0.5);

      s.transition = Math.max(0, s.transition - dt * 2);
      setHud(h => ({ ...h, time: s.time, deaths: s.deaths, lives: s.lives }));
    }

    function killPlayer(tw) {
      const s = stateRef.current;
      const p = s.player;
      if (p.dead) return;
      p.dead = true;
      p.respawnT = 0.7;
      s.deaths += 1;
      s.lives -= 1;
      if (tw.cameraShake) { s.camera.shakeAmp = 8; s.camera.shakeT = 0.3; }
      for (let i = 0; i < 24; i++) {
        s.particles.push({ x: p.x + p.w / 2, y: p.y + p.h / 2, vx: (Math.random() - 0.5) * 400, vy: (Math.random() - 0.5) * 400, life: 0.7, color: tw.playerHat, r: 2 + Math.random() * 3 });
      }
    }

    // ---------- RENDER ----------
    function render(ctx, VW, VH, tw) {
      const s = stateRef.current;
      if (!s) return;
      const lvl = s.level;

      // Sky gradient
      const grad = ctx.createLinearGradient(0, 0, 0, VH);
      grad.addColorStop(0, tw.skyColor);
      grad.addColorStop(1, mixColors(tw.skyColor, '#ffffff', 0.4));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, VW, VH);

      let camX = s.camera.x;
      let camY = s.camera.y;
      if (s.camera.shakeAmp > 0.1) {
        camX += (Math.random() - 0.5) * s.camera.shakeAmp * 2;
        camY += (Math.random() - 0.5) * s.camera.shakeAmp * 2;
      }

      // Decor (parallax)
      ctx.save();
      ctx.translate(-camX * 0.3 + s.cloudOffset * 0.3, -camY * 0.3);
      for (const d of lvl.decor) {
        if (d.type === 'cloud') drawCloud(ctx, d.x, d.y);
      }
      ctx.restore();

      ctx.save();
      ctx.translate(-camX * 0.6, -camY * 0.6);
      for (const d of lvl.decor) {
        if (d.type === 'hill') drawHill(ctx, d.x, d.y, tw);
      }
      ctx.restore();

      ctx.save();
      ctx.translate(-camX, -camY);

      // Goal flag (drawn behind player area but in world)
      drawFlag(ctx, lvl.goal.x, lvl.goal.y, s.time);

      // Tiles
      for (const t of lvl.tiles) {
        const x = t.x * TILE;
        const y = t.y * TILE - (t.bump ? 6 * t.bump : 0);
        if (x + TILE < camX || x > camX + VW || y + TILE < camY || y > camY + VH + 50) continue;
        drawTile(ctx, t, x, y, tw, lvl);
      }

      // Spikes
      for (const sp of lvl.spikes) drawSpikes(ctx, sp);

      // Coins
      for (const c of lvl.coins) {
        if (c.taken) continue;
        c.t += 0; // already updated
        drawCoin(ctx, c);
      }

      // Enemies
      for (const e of lvl.enemies) drawEnemy(ctx, e, s.time);

      // Particles
      for (const pt of s.particles) {
        ctx.globalAlpha = clamp(pt.life * 2, 0, 1);
        ctx.fillStyle = pt.color;
        ctx.fillRect(pt.x - pt.r, pt.y - pt.r, pt.r * 2, pt.r * 2);
      }
      ctx.globalAlpha = 1;

      // Player
      const p = s.player;
      if (!p.dead) drawPlayer(ctx, p, tw, s.time);

      ctx.restore();

      // Flash + transition
      if (s.transition > 0) {
        ctx.fillStyle = `rgba(0,0,0,${clamp(s.transition, 0, 1)})`;
        ctx.fillRect(0, 0, VW, VH);
      }
      if (s.flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${s.flash * 0.4})`;
        ctx.fillRect(0, 0, VW, VH);
      }
    }

    function drawTile(ctx, t, x, y, tw, lvl) {
      if (t.type === 'ground') {
        // grass top
        ctx.fillStyle = tw.groundColor;
        ctx.fillRect(x, y, TILE, TILE);
        // brick lines
        ctx.fillStyle = mixColors(tw.groundColor, '#000000', 0.18);
        ctx.fillRect(x, y + 14, TILE, 2);
        ctx.fillRect(x + 14, y, 2, 14);
        ctx.fillRect(x + 4, y + 18, 2, 14);
        ctx.fillRect(x + 24, y + 18, 2, 14);
        // grass cap if no tile above
        if (!tileAt(lvl, t.x, t.y - 1)) {
          ctx.fillStyle = tw.groundGrass;
          ctx.fillRect(x, y, TILE, 6);
          ctx.fillStyle = mixColors(tw.groundGrass, '#000000', 0.2);
          ctx.fillRect(x, y + 6, TILE, 2);
        }
      } else if (t.type === 'brick') {
        ctx.fillStyle = tw.brickColor;
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = mixColors(tw.brickColor, '#000000', 0.25);
        ctx.fillRect(x, y, TILE, 2);
        ctx.fillRect(x, y, 2, TILE);
        ctx.fillStyle = mixColors(tw.brickColor, '#ffffff', 0.2);
        ctx.fillRect(x + 2, y + 2, TILE - 2, 2);
        ctx.fillRect(x + 2, y + 2, 2, TILE - 2);
        // mortar lines
        ctx.fillStyle = mixColors(tw.brickColor, '#000000', 0.4);
        ctx.fillRect(x, y + 14, TILE, 2);
        ctx.fillRect(x + 14, y, 2, 14);
        ctx.fillRect(x + 4, y + 18, 2, 14);
        ctx.fillRect(x + 24, y + 18, 2, 14);
      } else if (t.type === 'question') {
        const hit = t.hit;
        ctx.fillStyle = hit ? '#8B6F2D' : '#E8B43A';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = mixColors(hit ? '#8B6F2D' : '#E8B43A', '#000000', 0.3);
        ctx.fillRect(x, y, TILE, 2);
        ctx.fillRect(x, y, 2, TILE);
        ctx.fillRect(x + TILE - 2, y, 2, TILE);
        ctx.fillRect(x, y + TILE - 2, TILE, 2);
        if (!hit) {
          ctx.fillStyle = '#3B2A0F';
          // pixel "?"
          ctx.fillRect(x + 12, y + 6, 8, 2);
          ctx.fillRect(x + 10, y + 8, 2, 2);
          ctx.fillRect(x + 20, y + 8, 2, 2);
          ctx.fillRect(x + 18, y + 10, 4, 2);
          ctx.fillRect(x + 14, y + 14, 4, 2);
          ctx.fillRect(x + 14, y + 18, 4, 2);
          ctx.fillRect(x + 14, y + 22, 4, 2);
        }
      } else if (t.type === 'pipe-tl' || t.type === 'pipe-tr') {
        const isLeft = t.type === 'pipe-tl';
        ctx.fillStyle = '#3FAA3F';
        ctx.fillRect(x - (isLeft ? 0 : 0), y, TILE, TILE);
        // rim extends 4px outward
        ctx.fillStyle = mixColors('#3FAA3F', '#000000', 0.25);
        ctx.fillRect(x, y, TILE, 4);
        if (isLeft) ctx.fillRect(x - 4, y + 4, 4, 10);
        else ctx.fillRect(x + TILE, y + 4, 4, 10);
        ctx.fillStyle = mixColors('#3FAA3F', '#ffffff', 0.3);
        if (isLeft) ctx.fillRect(x + 4, y + 8, 4, TILE - 12);
      } else if (t.type === 'pipe-bl' || t.type === 'pipe-br') {
        ctx.fillStyle = '#3FAA3F';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = mixColors('#3FAA3F', '#000000', 0.25);
        if (t.type === 'pipe-br') ctx.fillRect(x + TILE - 4, y, 4, TILE);
        ctx.fillStyle = mixColors('#3FAA3F', '#ffffff', 0.3);
        if (t.type === 'pipe-bl') ctx.fillRect(x + 4, y, 4, TILE);
      } else if (t.type === 'platform') {
        ctx.fillStyle = tw.brickColor;
        ctx.fillRect(x, y, TILE, 10);
        ctx.fillStyle = mixColors(tw.brickColor, '#000000', 0.3);
        ctx.fillRect(x, y + 8, TILE, 2);
        ctx.fillStyle = mixColors(tw.brickColor, '#ffffff', 0.2);
        ctx.fillRect(x, y, TILE, 2);
      }
    }

    function drawCloud(ctx, x, y) {
      ctx.fillStyle = '#ffffff';
      const r = 14;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.arc(x + 16, y - 6, r - 2, 0, Math.PI * 2);
      ctx.arc(x + 32, y, r, 0, Math.PI * 2);
      ctx.arc(x + 16, y + 4, r - 4, 0, Math.PI * 2);
      ctx.fill();
    }

    function drawHill(ctx, x, y, tw) {
      ctx.fillStyle = mixColors(tw.groundGrass, '#000000', 0.1);
      ctx.beginPath();
      ctx.moveTo(x - 30, y + TILE);
      ctx.quadraticCurveTo(x + TILE / 2, y - 50, x + TILE + 30, y + TILE);
      ctx.closePath();
      ctx.fill();
      // highlight
      ctx.fillStyle = mixColors(tw.groundGrass, '#ffffff', 0.2);
      ctx.beginPath();
      ctx.arc(x + 4, y - 10, 5, 0, Math.PI * 2);
      ctx.arc(x + 14, y - 18, 6, 0, Math.PI * 2);
      ctx.fill();
    }

    function drawSpikes(ctx, sp) {
      ctx.fillStyle = '#9CA0A6';
      const n = 3;
      const w = sp.w / n;
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.moveTo(sp.x + i * w, sp.y + sp.h);
        ctx.lineTo(sp.x + i * w + w / 2, sp.y);
        ctx.lineTo(sp.x + (i + 1) * w, sp.y + sp.h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = mixColors('#9CA0A6', '#ffffff', 0.4);
      for (let i = 0; i < n; i++) {
        ctx.fillRect(sp.x + i * w + w / 2 - 1, sp.y + 2, 1, 6);
      }
    }

    function drawCoin(ctx, c) {
      const wob = Math.sin(c.t) * 3;
      const sx = Math.abs(Math.cos(c.t * 0.8));
      ctx.save();
      ctx.translate(c.x, c.y + wob);
      ctx.scale(sx, 1);
      ctx.fillStyle = '#FFD93D';
      ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#E8A82A';
      ctx.fillRect(-1, -5, 2, 10);
      ctx.fillStyle = mixColors('#FFD93D', '#ffffff', 0.5);
      ctx.fillRect(-3, -4, 1, 6);
      ctx.restore();
    }

    function drawFlag(ctx, gx, gy, t) {
      // pole
      ctx.fillStyle = '#E0E0E0';
      ctx.fillRect(gx + TILE / 2 - 2, gy, 4, TILE * 4);
      ctx.fillStyle = '#9CA0A6';
      ctx.fillRect(gx + TILE / 2, gy, 2, TILE * 4);
      // Ball top
      ctx.fillStyle = '#FFD93D';
      ctx.beginPath(); ctx.arc(gx + TILE / 2, gy - 4, 6, 0, Math.PI * 2); ctx.fill();
      // Flag wave
      ctx.fillStyle = '#E63946';
      const wave = Math.sin(t * 4) * 3;
      ctx.beginPath();
      ctx.moveTo(gx + TILE / 2 + 2, gy + 6);
      ctx.lineTo(gx + TILE / 2 + 26 + wave, gy + 12);
      ctx.lineTo(gx + TILE / 2 + 2, gy + 22);
      ctx.closePath();
      ctx.fill();
    }

    function drawEnemy(ctx, e, time) {
      if (!e.alive) {
        // squashed
        ctx.fillStyle = '#8B5A2B';
        ctx.fillRect(e.x, e.y + e.h - 6, e.w, 6);
        return;
      }
      if (e.type === 'wobbler') {
        const walk = Math.sin(e.t * 8) * 2;
        const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
        // Feet
        ctx.fillStyle = '#3B1E0A';
        ctx.fillRect(e.x + 2, e.y + e.h - 4 + walk, 8, 4);
        ctx.fillRect(e.x + e.w - 10, e.y + e.h - 4 - walk, 8, 4);
        // Body (mushroom-ish dome — original)
        ctx.fillStyle = '#8B5A2B';
        ctx.beginPath();
        ctx.ellipse(cx, cy + 2, e.w / 2, e.h / 2 - 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = mixColors('#8B5A2B', '#000000', 0.3);
        ctx.fillRect(e.x, e.y + e.h - 8, e.w, 2);
        // Eyes (angry)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(e.x + 6, e.y + 8, 5, 6);
        ctx.fillRect(e.x + e.w - 11, e.y + 8, 5, 6);
        ctx.fillStyle = '#000000';
        ctx.fillRect(e.x + 8, e.y + 10, 2, 3);
        ctx.fillRect(e.x + e.w - 10, e.y + 10, 2, 3);
        // brow
        ctx.fillRect(e.x + 5, e.y + 6, 7, 2);
        ctx.fillRect(e.x + e.w - 12, e.y + 6, 7, 2);
      } else if (e.type === 'spiker') {
        const walk = Math.sin(e.t * 8) * 2;
        const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
        // Body — purple spiked ball
        ctx.fillStyle = '#6B3FA0';
        ctx.beginPath();
        ctx.arc(cx, cy + 2, e.w / 2 - 2, 0, Math.PI * 2);
        ctx.fill();
        // Spikes
        ctx.fillStyle = '#3B1E5A';
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + e.t;
          const sx = cx + Math.cos(a) * (e.w / 2 - 2);
          const sy = cy + 2 + Math.sin(a) * (e.h / 2 - 4);
          ctx.fillRect(sx - 2, sy - 2, 4, 4);
        }
        // feet
        ctx.fillStyle = '#3B1E5A';
        ctx.fillRect(e.x + 2, e.y + e.h - 4 + walk, 6, 4);
        ctx.fillRect(e.x + e.w - 8, e.y + e.h - 4 - walk, 6, 4);
        // eyes
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(e.x + 8, e.y + 10, 4, 4);
        ctx.fillRect(e.x + e.w - 12, e.y + 10, 4, 4);
        ctx.fillStyle = '#FF3D3D';
        ctx.fillRect(e.x + 9, e.y + 11, 2, 2);
        ctx.fillRect(e.x + e.w - 11, e.y + 11, 2, 2);
      } else if (e.type === 'floater') {
        const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
        const flap = Math.sin(time * 10) * 4;
        // wings
        ctx.fillStyle = '#E0E0FF';
        ctx.beginPath();
        ctx.ellipse(cx - 12, cy - 2 + flap, 8, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(cx + 12, cy - 2 + flap, 8, 4, 0, 0, Math.PI * 2);
        ctx.fill();
        // body — pink blob
        ctx.fillStyle = '#FF6FAE';
        ctx.beginPath();
        ctx.arc(cx, cy, e.w / 2 - 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = mixColors('#FF6FAE', '#000000', 0.25);
        ctx.fillRect(e.x + 2, e.y + e.h - 6, e.w - 4, 2);
        // eyes
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(cx - 6, cy - 3, 4, 5);
        ctx.fillRect(cx + 2, cy - 3, 4, 5);
        ctx.fillStyle = '#000000';
        ctx.fillRect(cx - 5, cy - 1, 2, 2);
        ctx.fillRect(cx + 3, cy - 1, 2, 2);
      }
    }

    function drawPlayer(ctx, p, tw, time) {
      if (p.invuln > 0 && Math.floor(p.invuln * 10) % 2 === 0) return;
      const cx = p.x + p.w / 2;
      const cy = p.y + p.h / 2;
      const f = p.facing;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(f * p.squash, p.stretch);

      const w = p.w, h = p.h;
      // Suit (overall)
      ctx.fillStyle = tw.playerSuit;
      ctx.fillRect(-w / 2 + 2, -h / 2 + 12, w - 4, h - 14);
      // Skin / face area
      ctx.fillStyle = tw.playerSkin;
      ctx.fillRect(-w / 2 + 4, -h / 2 + 6, w - 8, 10);
      // Hat
      ctx.fillStyle = tw.playerHat;
      ctx.fillRect(-w / 2 + 2, -h / 2, w - 4, 6);
      ctx.fillRect(-w / 2 + 6, -h / 2 - 4, w - 12, 4);
      // Hat brim (front)
      ctx.fillStyle = mixColors(tw.playerHat, '#000000', 0.2);
      ctx.fillRect(-w / 2 + 2, -h / 2 + 4, w - 4, 2);
      ctx.fillRect(2, -h / 2 + 4, w / 2 - 4, 2);
      // Eye
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(2, -h / 2 + 8, 4, 5);
      ctx.fillStyle = '#000000';
      ctx.fillRect(3, -h / 2 + 9, 2, 3);
      // Mustache
      ctx.fillStyle = '#3B2010';
      ctx.fillRect(-w / 2 + 5, -h / 2 + 13, w - 10, 2);
      // Buttons
      ctx.fillStyle = '#FFD93D';
      ctx.fillRect(-3, -h / 2 + 16, 2, 2);
      ctx.fillRect(1, -h / 2 + 16, 2, 2);
      // Legs
      const onGround = p.onGround;
      const legSwing = onGround ? Math.sin(p.legPhase) * 4 : 0;
      ctx.fillStyle = '#3B1E0A';
      if (!onGround) {
        ctx.fillRect(-w / 2 + 4, h / 2 - 4, 6, 4);
        ctx.fillRect(w / 2 - 10, h / 2 - 4, 6, 4);
      } else {
        ctx.fillRect(-w / 2 + 4, h / 2 - 4 + legSwing, 6, 4);
        ctx.fillRect(w / 2 - 10, h / 2 - 4 - legSwing, 6, 4);
      }
      ctx.restore();

      // Dash trail
      if (p.dashing > 0) {
        ctx.fillStyle = tw.playerHat;
        ctx.globalAlpha = 0.4;
        for (let i = 1; i <= 3; i++) {
          ctx.fillRect(p.x - p.facing * i * 8, p.y + 4, p.w, p.h - 8);
        }
        ctx.globalAlpha = 1;
      }
    }

    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: tweaks.skyColor, fontFamily: '"Press Start 2P", "IBM Plex Mono", ui-monospace, monospace', overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', imageRendering: 'pixelated' }} />

      {/* HUD */}
      <div style={{ position: 'absolute', top: 16, left: 16, right: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', pointerEvents: 'none', color: '#ffffff', textShadow: '2px 2px 0 rgba(0,0,0,0.5)' }}>
        <div>
          <div style={{ fontSize: 10, opacity: 0.85, letterSpacing: '0.2em' }}>BLOOP WORLD</div>
          <div style={{ fontSize: 16, marginTop: 6 }}>{hud.levelName}</div>
          <div style={{ fontSize: 9, opacity: 0.85, marginTop: 4 }}>{hud.hint}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'flex-end', alignItems: 'center', fontSize: 12 }}>
            <span style={{ color: '#FFD93D' }}>★ {String(hud.coins).padStart(2, '0')}<span style={{ opacity: 0.6 }}>/{String(hud.totalCoins).padStart(2, '0')}</span></span>
            <span style={{ color: '#E63946' }}>♥ {hud.lives}</span>
            <span style={{ opacity: 0.85 }}>{fmtTime(hud.time)}</span>
          </div>
          <div style={{ fontSize: 9, opacity: 0.7, marginTop: 6 }}>WORLD {hud.level + 1}-{LEVELS.length}</div>
        </div>
      </div>

      {/* Pause button */}
      <button
        onClick={() => {
          const s = stateRef.current; if (!s || s.complete) return;
          s.paused = !s.paused;
          setHud(h => ({ ...h, paused: s.paused }));
        }}
        title="Pause (P)"
        style={{
          position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
          width: 44, height: 44, border: '3px solid #ffffff', background: 'rgba(0,0,0,0.35)',
          color: '#ffffff', fontFamily: 'inherit', fontSize: 14, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
          boxShadow: '0 4px 0 rgba(0,0,0,0.3)'
        }}
      >
        {hud.paused ? (
          <svg width="14" height="14" viewBox="0 0 14 14"><polygon points="2,1 13,7 2,13" fill="#ffffff" /></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" y="1" width="3" height="12" fill="#ffffff" /><rect x="9" y="1" width="3" height="12" fill="#ffffff" /></svg>
        )}
      </button>

      {/* Pause overlay */}
      {hud.paused && !hud.complete && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, background: 'rgba(0,0,0,0.55)', color: '#ffffff', textAlign: 'center' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.3em', opacity: 0.7 }}>▮▮</div>
          <div style={{ fontSize: 32 }}>PAUSED</div>
          <div style={{ fontSize: 9, opacity: 0.7 }}>PRESS P OR ESC TO RESUME</div>
          <button onClick={() => { const s = stateRef.current; s.paused = false; setHud(h => ({ ...h, paused: false })); }} style={{ marginTop: 12, padding: '12px 24px', border: '3px solid #ffffff', background: '#3FAA3F', color: '#ffffff', fontFamily: 'inherit', fontSize: 11, cursor: 'pointer', letterSpacing: '0.15em' }}>RESUME</button>
        </div>
      )}

      {/* Controls */}
      <div style={{ position: 'absolute', bottom: 16, left: 16, color: '#ffffff', textShadow: '1px 1px 0 rgba(0,0,0,0.5)', fontSize: 9, lineHeight: 1.8, pointerEvents: 'none', opacity: 0.85 }}>
        <div>← → MOVE · SPACE JUMP (×2) · SHIFT DASH · P PAUSE · R RETRY</div>
      </div>

      {hud.complete && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, background: 'rgba(0,0,0,0.7)', color: '#ffffff', textAlign: 'center' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', opacity: 0.7 }}>★ ★ ★</div>
          <div style={{ fontSize: 36 }}>YOU SAVED THE DAY!</div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>{fmtTime(hud.time)} · {hud.deaths} deaths</div>
          <button onClick={() => { stateRef.current.lives = 3; loadLevel(0, false); }} style={{ marginTop: 16, padding: '12px 24px', border: '3px solid #ffffff', background: '#E63946', color: '#ffffff', fontFamily: 'inherit', fontSize: 11, cursor: 'pointer', letterSpacing: '0.15em' }}>PLAY AGAIN</button>
        </div>
      )}

      <TweaksPanel title="Tweaks">
        <TweakSection title="Feel">
          <TweakSlider label="Move speed" value={tweaks.moveSpeed} min={120} max={400} step={10} onChange={v => setTweak('moveSpeed', v)} />
          <TweakSlider label="Jump velocity" value={tweaks.jumpVel} min={300} max={800} step={10} onChange={v => setTweak('jumpVel', v)} />
          <TweakSlider label="Gravity" value={tweaks.gravity} min={600} max={2400} step={50} onChange={v => setTweak('gravity', v)} />
        </TweakSection>
        <TweakSection title="Abilities">
          <TweakToggle label="Double jump" value={tweaks.doubleJump} onChange={v => setTweak('doubleJump', v)} />
          <TweakToggle label="Dash (Shift)" value={tweaks.dash} onChange={v => setTweak('dash', v)} />
          <TweakToggle label="Camera shake" value={tweaks.cameraShake} onChange={v => setTweak('cameraShake', v)} />
        </TweakSection>
        <TweakSection title="Look">
          <TweakColor label="Sky" value={tweaks.skyColor} onChange={v => setTweak('skyColor', v)} />
          <TweakColor label="Ground" value={tweaks.groundColor} onChange={v => setTweak('groundColor', v)} />
          <TweakColor label="Grass" value={tweaks.groundGrass} onChange={v => setTweak('groundGrass', v)} />
          <TweakColor label="Bricks" value={tweaks.brickColor} onChange={v => setTweak('brickColor', v)} />
        </TweakSection>
        <TweakSection title="Bloop's outfit">
          <TweakColor label="Hat" value={tweaks.playerHat} onChange={v => setTweak('playerHat', v)} />
          <TweakColor label="Suit" value={tweaks.playerSuit} onChange={v => setTweak('playerSuit', v)} />
          <TweakColor label="Skin" value={tweaks.playerSkin} onChange={v => setTweak('playerSkin', v)} />
        </TweakSection>
        <TweakSection title="World">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {LEVELS.map((l, i) => (
              <button key={i} onClick={() => loadLevel(i, true)} style={{ padding: '6px 10px', border: `1px solid #00000040`, background: hud.level === i ? '#1D5FB4' : 'transparent', color: hud.level === i ? '#ffffff' : '#1D5FB4', fontFamily: 'inherit', fontSize: 10, cursor: 'pointer', borderRadius: 4 }}>
                1-{i + 1}
              </button>
            ))}
          </div>
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

function fmtTime(t) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(v, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function mixColors(a, b, t) {
  const ca = hexToRgb(a), cb = hexToRgb(b);
  const r = Math.round(ca.r + (cb.r - ca.r) * t);
  const g = Math.round(ca.g + (cb.g - ca.g) * t);
  const bl = Math.round(ca.b + (cb.b - ca.b) * t);
  return `rgb(${r},${g},${bl})`;
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<Game />);
