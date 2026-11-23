// ===== BOOM SIM: pure game logic (no DOM) =====
const SIM = (() => {
  // map size presets: [width, height, round seconds]
  const SIZES = { normal: [15, 13, 180], medium: [19, 15, 200], large: [23, 17, 230] };
  let W = 15, H = 13, ROUND_TIME = 180, SPAWNS, PORTALS, RIVER_Y, RIVER_X, BRIDGES, VBRIDGES, SPIRAL, SUDDEN_STEP;
  const BOMB_TIME = 2.6, FLAME_TIME = 0.5, TRAP_TIME = 4.5, COUNT_TIME = 3, END_TIME = 5;
  const KICK_SPEED = 7, THROW_DIST = 3, KILL_PTS = 1, WIN_PTS = 2;
  const DIRS = [[0, 1], [0, -1], [-1, 0], [1, 0]]; // dir 0 down,1 up,2 left,3 right
  const BASE_SPEED = 3.3, SPEED_STEP = 0.45, MAX_SPEED_LVL = 6, TRAP_SPEED = 0.7;
  const idx = (x, y) => y * W + x;
  const isFloor = c => c === '.' || c === 'g' || c === '=';
  const MAPS = ['classic', 'river', 'storm', 'portal'];
  function setDims(size) {
    const d = SIZES[size] || SIZES.normal;
    W = d[0]; H = d[1]; ROUND_TIME = d[2];
    const mx = (W - 1) / 2, my = (H - 1) / 2;
    // seats 0-3: corners; seats 4-7: one more per quarter (clear of the cross river)
    SPAWNS = [[1, 1], [W - 2, H - 2], [W - 2, 1], [1, H - 2], [mx - 2, 1], [mx + 2, H - 2], [1, my + 2], [W - 2, my - 2]];
    PORTALS = [[3, 3], [W - 4, 3], [3, H - 4], [W - 4, H - 4]];
    RIVER_Y = (H - 1) / 2; RIVER_X = (W - 1) / 2;
    BRIDGES = [3, W - 4]; VBRIDGES = [3, H - 4]; // river map: a cross of water, one bridge on each arm
    SPIRAL = [];
    let x0 = 1, y0 = 1, x1 = W - 2, y1 = H - 2;
    while (x0 <= x1 && y0 <= y1) {
      for (let x = x0; x <= x1; x++) SPIRAL.push(idx(x, y0));
      for (let y = y0 + 1; y <= y1; y++) SPIRAL.push(idx(x1, y));
      if (y1 > y0) for (let x = x1 - 1; x >= x0; x--) SPIRAL.push(idx(x, y1));
      if (x1 > x0) for (let y = y1 - 1; y > y0; y--) SPIRAL.push(idx(x0, y));
      x0++; y0++; x1--; y1--;
    }
    SUDDEN_STEP = 80 / SPIRAL.length; // walls fill the arena in ~80 s
  }
  const NPC_FIRE = 2, NPC_SPEED = 1.6, POWER_TIME = 10, POWER_CHANCE = 0.16;
  const effBombs = p => p.pw > 0 ? 8 : p.maxBombs;
  const effFire = p => p.pw > 0 ? 8 : p.fire;
  const effSpd = p => p.pw > 0 ? MAX_SPEED_LVL : p.spd;

  function rng(seed) {
    let s = (seed >>> 0) || 123456789;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }

  function pickItem(r) {
    const v = r();
    if (v < 0.26) return 'b';
    if (v < 0.52) return 'f';
    if (v < 0.72) return 's';
    if (v < 0.82) return 'n';
    if (v < 0.91) return 'k';
    return 't';
  }

  function nearSpawn(x, y) {
    for (const [sx, sy] of SPAWNS) if (Math.abs(sx - x) + Math.abs(sy - y) <= 1) return true;
    return false;
  }

  // cfg: {seed, mode:'ffa'|'team', players:[{name, bot}|null x4], wins:[...]}
  function createGame(cfg) {
    setDims(cfg.size);
    const rand = rng(cfg.seed || (Date.now() & 0xffffffff));
    const mapId = MAPS.includes(cfg.map) ? cfg.map : 'classic';
    const map = new Array(W * H).fill('.');
    const hid = new Array(W * H).fill(null);
    const isPortal = (x, y) => mapId === 'portal' && PORTALS.some(([px, py]) => px === x && py === y);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) map[i] = '#';
      else if (mapId === 'river' && y === RIVER_Y) map[i] = BRIDGES.includes(x) ? '=' : '~';
      else if (mapId === 'river' && x === RIVER_X) map[i] = VBRIDGES.includes(y) ? '=' : '~';
      else if (x % 2 === 0 && y % 2 === 0) map[i] = '#';
      else if (isPortal(x, y)) map[i] = 'o';
      else if (nearSpawn(x, y)) map[i] = '.';
      else if (mapId === 'river' && ((BRIDGES.includes(x) && Math.abs(y - RIVER_Y) === 1) || (VBRIDGES.includes(y) && Math.abs(x - RIVER_X) === 1))) map[i] = '.'; // bridge heads stay open
      else { const r = rand(); if (r < 0.62) { map[i] = 'x'; if (rand() < 0.5) hid[i] = pickItem(rand); } else if (r < 0.75) map[i] = 'g'; }
    }
    const players = [], N = Math.max(2, Math.min(8, (cfg.players || []).length || 4));
    const pad = a => { const o = (a || []).slice(0, N); while (o.length < N) o.push(0); return o; };
    for (let s = 0; s < N; s++) {
      const pc = cfg.players[s];
      if (!pc) { players.push(null); continue; }
      players.push({
        seat: s, name: pc.name, bot: !!pc.bot,
        team: cfg.mode === 'team' ? (s % 2 === 0 ? 0 : 1) : s,
        x: SPAWNS[s][0], y: SPAWNS[s][1], dir: SPAWNS[s][1] > H / 2 ? 1 : 0,
        st: 0, trapT: 0, inv: 0, moving: 0,
        maxBombs: pc.trait === 'b' ? 2 : 1, fire: pc.trait === 'f' ? 2 : 1, spd: pc.trait === 's' ? 1 : 0, needles: pc.trait === 'n' ? 1 : 0, kills: 0, kick: 0, thr: 0, trait: pc.trait || '', pw: 0,
        ghost: new Set(), ai: { wander: null, cool: 0 }, tpCd: 0, trapBy: -1,
        _b: false, _n: false,
      });
    }
    return {
      W, H, rand, mode: cfg.mode || 'ffa', map, hid, mapId, flyItems: [],
      npcs: makeNpcs(cfg, mapId, rand),
      items: new Array(W * H).fill(null),
      flames: new Float32Array(W * H), flameOwner: new Int8Array(W * H).fill(-1),
      drops: new Array(W * H).fill(null),
      bombs: [], bombAt: new Array(W * H).fill(null), bombId: 0,
      players, phase: 'count', t: COUNT_TIME, timeLeft: ROUND_TIME, roundTime: ROUND_TIME, size: SIZES[cfg.size] ? cfg.size : 'normal',
      events: [], evId: cfg.evId || 0, winner: -1, wins: pad(cfg.wins), score: pad(cfg.score),
      endHold: 0,
    };
  }

  // storm clouds: how many the host asked for (default 1, 2 on the storm map)
  function makeNpcs(cfg, mapId, rand) {
    if (cfg.npc === false) return [];
    let n = typeof cfg.npcN === 'number' && isFinite(cfg.npcN) ? Math.round(cfg.npcN) : (mapId === 'storm' ? 2 : 1);
    n = Math.max(0, Math.min(10, n));
    const spots = [[(W - 1) / 2, (H - 1) / 2], [5, 4], [W - 6, H - 5], [W - 6, 4], [5, H - 5], [(W - 1) / 2, 3], [(W - 1) / 2, H - 4], [3, (H - 1) / 2], [W - 4, (H - 1) / 2], [(W - 1) / 2, (H - 1) / 2]];
    if (n >= 2 && mapId === 'storm') spots.shift(); // keep the old storm layout first
    return spots.slice(0, n).map(([x, y], i) => ({ x, y, tx: x, ty: y, next: 7 + i * 2.5 + rand() * 2, anim: 0 }));
  }

  function ev(g, k, a, b) { g.events.push({ i: ++g.evId, k, a, b }); if (g.events.length > 12) g.events.shift(); }

  function passable(g, p, cx, cy) {
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return false;
    const i = idx(cx, cy), c = g.map[i];
    if (c === '#' || c === 'x' || c === '~') return false;
    const b = g.bombAt[i];
    if (b && !(p && p.ghost.has(b.id))) return false;
    return true;
  }

  function moveAxis(g, p, ax, s, dist) {
    const pr = ax === 'x' ? 'y' : 'x';
    const cur = p[ax], c = p[pr];
    const rc = Math.round(c), ci = Math.round(cur);
    const cell = (a, b) => ax === 'x' ? [a, b] : [b, a];
    const [nx, ny] = cell(ci + s, rc);
    if (passable(g, p, nx, ny)) {
      const off = rc - c;
      if (Math.abs(off) > 1e-4) {
        const m = Math.min(Math.abs(off), dist);
        p[pr] += Math.sign(off) * m; dist -= m;
      }
      if (dist > 0) p[ax] += s * dist;
      return;
    }
    // blocked ahead by a resting bomb: kick it if we have the kick item
    const off = c - rc;
    if (p.kick && p.st === 0 && Math.abs(off) < 0.3 && Math.abs(ci - cur) < 0.12) {
      const kb = g.bombAt[idx(nx, ny)];
      if (kb && !kb.air && !kb.vx && !kb.vy && !p.ghost.has(kb.id) && passableForBomb(g, kb, nx + (ax === 'x' ? s : 0), ny + (ax === 'y' ? s : 0))) {
        if (ax === 'x') kb.vx = s; else kb.vy = s;
        kb.kicker = p.seat;
        ev(g, 'kick', p.seat, -1);
      }
    }
    // blocked ahead: corner assist toward the other row/col if mostly there
    if (Math.abs(off) > 0.2) {
      const r2 = rc + Math.sign(off);
      const [ax2, ay2] = cell(ci + s, r2), [bx2, by2] = cell(ci, r2);
      if (passable(g, p, ax2, ay2) && passable(g, p, bx2, by2)) {
        p[pr] += Math.sign(off) * Math.min(dist, Math.abs(r2 - c));
        return;
      }
    }
    const d = ci - cur;
    if (s * d > 0) p[ax] += s * Math.min(dist, Math.abs(d));
    if (Math.abs(off) > 1e-4) p[pr] -= Math.sign(off) * Math.min(dist, Math.abs(off)); // re-center
  }

  // remote players own their movement: take the position they report if it is plausible
  function acceptPos(g, p, inp) {
    const x = +inp.pos.x, y = +inp.pos.y;
    if (!isFinite(x) || !isFinite(y) || x < 0.5 || y < 0.5 || x > W - 1.5 || y > H - 1.5) return false;
    const blocked = (cx, cy) => { const c = g.map[idx(cx, cy)]; return c === '#' || c === 'x' || c === '~'; };
    if (p.lockT > 0) return false; // we just moved them (teleport): wait for their client to follow
    // how far could they have gone since the last report we took? (network hiccups bunch updates up)
    const speed = BASE_SPEED + MAX_SPEED_LVL * SPEED_STEP;
    const d = Math.hypot(x - p.x, y - p.y);
    if (d > Math.min(4, 0.8 + speed * (p.sinceAcc || 0) * 1.3)) return false;
    const n = Math.max(1, Math.ceil(d / 0.25));
    for (let k = 1; k <= n; k++) { const t = k / n; if (blocked(Math.round(p.x + (x - p.x) * t), Math.round(p.y + (y - p.y) * t))) return false; }
    p.sinceAcc = 0;
    const moved = Math.abs(x - p.x) + Math.abs(y - p.y);
    p.x = x; p.y = y;
    if (typeof inp.dir === 'number' && inp.dir >= 0 && inp.dir <= 3) p.dir = inp.dir;
    p.moving = (moved > 1e-3 || inp.dx || inp.dy) ? 1 : 0;
    return true;
  }

  function movePlayer(g, p, dx, dy, dt) {
    if (!dx && !dy) { p.moving = 0; return; }
    const speed = p.st === 1 ? TRAP_SPEED : BASE_SPEED + effSpd(p) * SPEED_STEP;
    let dist = speed * dt;
    if (dx && dy) { // prefer an open axis
      const rc = Math.round(p.y), cc = Math.round(p.x);
      if (passable(g, p, cc + dx, rc)) dy = 0; else dx = 0;
    }
    p.dir = dy > 0 ? 0 : dy < 0 ? 1 : dx < 0 ? 2 : 3;
    const bx = p.x, by = p.y;
    while (dist > 0) {
      const step = Math.min(dist, 0.1); dist -= step;
      if (dx) moveAxis(g, p, 'x', dx, step); else moveAxis(g, p, 'y', dy, step);
    }
    p.moving = (Math.abs(p.x - bx) + Math.abs(p.y - by)) > 1e-4 ? 1 : 0;
  }

  function passableForBomb(g, b, cx, cy) {
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return false;
    const i = idx(cx, cy), c = g.map[i];
    if (c === '#' || c === 'x' || c === '~' || c === 'o') return false;
    if (g.bombAt[i] && g.bombAt[i] !== b) return false;
    for (const q of g.players) if (q && q.st !== 2 && Math.round(q.x) === cx && Math.round(q.y) === cy) return false;
    return true;
  }

  function moveBombs(g, dt) {
    for (const b of g.bombs) {
      if (b.air) {
        const a = b.air; a.t += dt;
        const u = Math.min(1, a.t / a.dur);
        b.fx = a.x0 + (a.tx - a.x0) * u; b.fy = a.y0 + (a.ty - a.y0) * u; b.z = 4 * 1.1 * u * (1 - u) + (b.o === -2 ? 2 * (1 - u) : 0);
        if (u >= 1) {
          b.air = null; b.z = 0; b.x = a.tx; b.y = a.ty; b.fx = b.x; b.fy = b.y;
          const i = idx(b.x, b.y);
          if (!isFloor(g.map[i]) || (g.bombAt[i] && g.bombAt[i] !== b)) { b.t = 0; g.bombAt[i] = g.bombAt[i] || b; }
          else { g.bombAt[i] = b; b.t = Math.max(b.t, 0.6); }
          for (const q of g.players) if (q && q.st !== 2 && Math.abs(q.x - b.x) < 0.95 && Math.abs(q.y - b.y) < 0.95) q.ghost.add(b.id);
        }
        continue;
      }
      if (!b.vx && !b.vy) continue;
      let dist = KICK_SPEED * dt;
      while (dist > 0) {
        const step = Math.min(dist, 0.1); dist -= step;
        const nx = b.x + b.vx, ny = b.y + b.vy;
        const along = b.vx ? b.fx - b.x : b.fy - b.y, sgn = b.vx || b.vy;
        if (!passableForBomb(g, b, nx, ny) && sgn * along >= -1e-6) {
          b.fx = b.x; b.fy = b.y; b.vx = 0; b.vy = 0; break; // stop at cell center
        }
        b.fx += b.vx * step; b.fy += b.vy * step;
        if (Math.abs(b.fx - nx) + Math.abs(b.fy - ny) < 0.5) {
          g.bombAt[idx(b.x, b.y)] = null; b.x = nx; b.y = ny; g.bombAt[idx(nx, ny)] = b;
        }
      }
    }
  }

  function teleport(g, p, from) {
    p.lockT = 0.7;
    const D = dangerMap(g), cand = [], ok = [];
    for (let i = 0; i < W * H; i++) {
      const c = g.map[i]; if (!(c === '.' || c === 'g' || c === '=') || g.bombAt[i] || g.flames[i] > 0) continue;
      const x = i % W, y = (i / W) | 0;
      if (g.players.some(q => q && q !== p && q.st !== 2 && Math.abs(q.x - x) + Math.abs(q.y - y) < 1.5)) continue;
      cand.push(i); if (D[i] === Infinity) ok.push(i);
    }
    const pool = ok.length ? ok : cand; if (!pool.length) return;
    const to = pool[(g.rand() * pool.length) | 0];
    p.x = to % W; p.y = (to / W) | 0; p.ghost.clear(); p.tpCd = 1.2;
    ev(g, 'tele', p.seat, from * 1000 + to);
  }

  function npcStep(g, n, dt) {
    const dx = n.tx - n.x, dy = n.ty - n.y, d = Math.hypot(dx, dy);
    if (d < 0.1) { n.tx = 1 + g.rand() * (W - 3); n.ty = 1 + g.rand() * (H - 3); }
    else { const m = Math.min(d, NPC_SPEED * dt); n.x += dx / d * m; n.y += dy / d * m; }
    if (n.anim > 0) n.anim -= dt;
    n.next -= dt;
    if (n.next > 0) return;
    // ramps up: slow at the start, faster and more bombs later
    const el = g.roundTime - g.timeLeft;
    const count = Math.min(4, 1 + (el > 50 ? 1 : 0) + (el > 100 ? 1 : 0) + (g.sd ? 1 : 0));
    n.next = Math.max(1.8, 8.5 - el * 0.045) + g.rand() * 1.5;
    const free = i => (g.map[i] === '.' || g.map[i] === 'g' || g.map[i] === '=') && !g.bombAt[i] && !g.bombs.some(b => b.air && idx(b.air.tx, b.air.ty) === i);
    const alive = g.players.filter(p => p && p.st === 0);
    for (let k = 0; k < count; k++) {
      let target = -1;
      if (alive.length && g.rand() < 0.55) {
        const p = alive[(g.rand() * alive.length) | 0], c = [];
        for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
          const cx = Math.round(p.x) + x, cy = Math.round(p.y) + y;
          if (cx < 1 || cy < 1 || cx > W - 2 || cy > H - 2) continue;
          if (Math.abs(x) + Math.abs(y) >= 1 && free(idx(cx, cy))) c.push(idx(cx, cy));
        }
        if (c.length) target = c[(g.rand() * c.length) | 0];
      }
      if (target < 0) { const c = []; for (let i = 0; i < W * H; i++) if (free(i)) c.push(i); if (c.length) target = c[(g.rand() * c.length) | 0]; }
      if (target < 0) break;
      const tx = target % W, ty = (target / W) | 0;
      const hasPower = g.items.includes('p') || g.flyItems.length > 0;
      if (k === 0 && !hasPower && el > 15 && g.rand() < POWER_CHANCE) {
        g.flyItems.push({ k: 'p', x0: n.x, y0: n.y, tx, ty, t: 0, dur: 0.9, fx: n.x, fy: n.y, z: 2 });
        ev(g, 'npcItem', -2, target);
        continue;
      }
      const b = { id: ++g.bombId, x: tx, y: ty, fx: n.x, fy: n.y, z: 2, vx: 0, vy: 0, t: BOMB_TIME + k * 0.25, o: -2, fire: NPC_FIRE,
        air: { x0: n.x, y0: n.y, tx, ty, t: 0, dur: 0.6 + Math.hypot(tx - n.x, ty - n.y) * 0.05 + k * 0.12 } };
      g.bombs.push(b);
      ev(g, 'npc', -2, target);
    }
    n.anim = 0.6;
  }

  function throwBomb(g, p, b) {
    const [dx, dy] = DIRS[p.dir];
    let tx = -1, ty = -1, k = 0;
    for (k = THROW_DIST; k < Math.max(W, H); k++) {
      const x = b.x + dx * k, y = b.y + dy * k;
      if (x < 1 || y < 1 || x > W - 2 || y > H - 2) break;
      const i = idx(x, y);
      if (isFloor(g.map[i]) && !g.bombAt[i]) { tx = x; ty = y; break; }
    }
    if (tx < 0) for (k = THROW_DIST - 1; k >= 1; k--) {
      const x = b.x + dx * k, y = b.y + dy * k;
      if (x < 1 || y < 1 || x > W - 2 || y > H - 2) continue;
      const i = idx(x, y);
      if (isFloor(g.map[i]) && !g.bombAt[i]) { tx = x; ty = y; break; }
    }
    if (tx < 0) return false;
    g.bombAt[idx(b.x, b.y)] = null;
    b.vx = b.vy = 0;
    b.air = { x0: b.x, y0: b.y, tx, ty, t: 0, dur: 0.18 + 0.08 * k };
    for (const q of g.players) if (q) q.ghost.delete(b.id);
    ev(g, 'throw', p.seat, -1);
    return true;
  }

  function blastCells(g, bx, by, fire) {
    const out = [[bx, by]];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let k = 1; k <= fire; k++) {
        const x = bx + dx * k, y = by + dy * k;
        const c = g.map[idx(x, y)];
        if (c === '#') break;
        out.push([x, y]);
        if (c === 'x') break;
      }
    }
    return out;
  }

  function explode(g, b) {
    g.bombs.splice(g.bombs.indexOf(b), 1);
    if (g.bombAt[idx(b.x, b.y)] === b) g.bombAt[idx(b.x, b.y)] = null;
    for (const p of g.players) if (p) p.ghost.delete(b.id);
        for (const [x, y] of blastCells(g, b.x, b.y, b.fire)) {
      const i = idx(x, y);
      if (g.map[i] === 'x') { g.map[i] = '.'; g.drops[i] = g.hid[i]; g.hid[i] = null; }
      if (g.items[i] && !g.drops[i]) g.items[i] = null;
      g.flames[i] = FLAME_TIME; g.flameOwner[i] = b.o;
      const ob = g.bombAt[i];
      if (ob && ob !== b) ob.t = Math.min(ob.t, 0.05);
      for (const mb of g.bombs) if (mb !== b && !mb.air && mb.x === x && mb.y === y) mb.t = Math.min(mb.t, 0.05);
    }
  }

  function placeBomb(g, p, want) {
    if (p.st !== 0) return;
    let cx = Math.round(p.x), cy = Math.round(p.y);
    // remote players send the cell they saw themselves on (their screen is ahead of ours): trust it if adjacent
    if (typeof want === 'number' && want >= 0 && want < W * H) {
      const wx = want % W, wy = (want / W) | 0;
      if (Math.abs(wx - cx) + Math.abs(wy - cy) <= 1 && Math.abs(wx - p.x) < 1.6 && Math.abs(wy - p.y) < 1.6 && isFloor(g.map[want])) { cx = wx; cy = wy; }
    }
    const i = idx(cx, cy);
    if (g.bombAt[i] && p.thr && !g.bombAt[i].vx && !g.bombAt[i].vy) { throwBomb(g, p, g.bombAt[i]); return; }
    if (g.bombAt[i] || !isFloor(g.map[i])) return;
    const out = g.bombs.filter(b => b.o === p.seat).length;
    if (out >= effBombs(p)) return;
    const b = { id: ++g.bombId, x: cx, y: cy, fx: cx, fy: cy, z: 0, vx: 0, vy: 0, air: null, t: BOMB_TIME, o: p.seat, fire: effFire(p) };
    g.bombs.push(b); g.bombAt[i] = b;
    for (const q of g.players) if (q && q.st !== 2 && Math.abs(q.x - cx) < 0.95 && Math.abs(q.y - cy) < 0.95) q.ghost.add(b.id);
  }

  const SUDDEN_AT = 90;
  function suddenDeath(g, dt) {
    if (!g.sd) { g.sd = { k: 0, acc: 0 }; ev(g, 'sudden', -1, -1); }
    g.sd.acc += dt;
    while (g.sd.acc >= SUDDEN_STEP && g.sd.k < SPIRAL.length) {
      g.sd.acc -= SUDDEN_STEP;
      const i = SPIRAL[g.sd.k++];
      if (g.map[i] === '#') continue;
      g.map[i] = '#'; g.items[i] = null; g.hid[i] = null; g.drops[i] = null; g.flames[i] = 0;
      const b = g.bombAt[i];
      if (b) { g.bombs.splice(g.bombs.indexOf(b), 1); g.bombAt[i] = null; }
      const x = i % W, y = (i / W) | 0;
      for (const p of g.players) if (p && p.st !== 2 && Math.round(p.x) === x && Math.round(p.y) === y) { p.st = 2; ev(g, 'crush', -1, p.seat); }
    }
  }

  function aliveTeams(g) {
    const s = new Set();
    for (const p of g.players) if (p && p.st !== 2) s.add(p.team);
    return s;
  }

  // inputs[seat] = {dx, dy, bomb, needle}
  function step(g, dt, inputs) {
    if (g.phase === 'count') {
      g.t -= dt;
      if (g.t <= 0) { g.phase = 'play'; ev(g, 'start', -1, -1); }
      return;
    }
    if (g.phase === 'end') { g.t -= dt; return; }
    if (g.phase !== 'play') return;
    g.timeLeft -= dt;
    if (g.timeLeft <= SUDDEN_AT) suddenDeath(g, dt);

    for (const p of g.players) {
      if (!p || p.st === 2) continue;
      const inp = inputs[p.seat] || {};
      if (p.inv > 0) p.inv -= dt;
      if (p.pw > 0) { p.pw -= dt; if (p.pw <= 0) { p.pw = 0; ev(g, 'powerEnd', p.seat, -1); } }
      if (p.st === 1) {
        p.trapT -= dt;
        if (inp.needle && p.needles > 0) { p.needles--; p.st = 0; p.inv = 1.2; ev(g, 'escape', p.seat, p.seat); }
        else if (p.trapT <= 0) {
          p.st = 2;
          const k = g.players[p.trapBy];
          if (k && k !== p && k.team !== p.team) { k.kills++; g.score[k.seat] += KILL_PTS; ev(g, 'drown', k.seat, p.seat); }
          else ev(g, 'drown', -1, p.seat);
          continue;
        }
      }
      p.sinceAcc = (p.sinceAcc || 0) + dt; if (p.lockT > 0) p.lockT -= dt;
      if (!(inp.pos && p.st === 0 && acceptPos(g, p, inp))) movePlayer(g, p, inp.dx | 0, inp.dy | 0, dt);
      if (inp.bomb) placeBomb(g, p, inp.cell);
      for (const id of [...p.ghost]) {
        const b = g.bombs.find(bb => bb.id === id);
        if (!b || Math.abs(p.x - b.x) >= 0.95 || Math.abs(p.y - b.y) >= 0.95) p.ghost.delete(id);
      }
    }

    for (const n of g.npcs) npcStep(g, n, dt);
    for (let k = g.flyItems.length - 1; k >= 0; k--) {
      const f = g.flyItems[k]; f.t += dt;
      const u = Math.min(1, f.t / f.dur);
      f.fx = f.x0 + (f.tx - f.x0) * u; f.fy = f.y0 + (f.ty - f.y0) * u; f.z = 2 * (1 - u) + 4 * 0.8 * u * (1 - u);
      if (u >= 1) { const i = idx(f.tx, f.ty); if (isFloor(g.map[i]) && !g.bombAt[i]) g.items[i] = f.k; g.flyItems.splice(k, 1); }
    }
    // portals
    if (g.mapId === 'portal') for (const p of g.players) {
      if (!p || p.st !== 0) continue;
      if (p.tpCd > 0) { p.tpCd -= dt; continue; }
      const cx = Math.round(p.x), cy = Math.round(p.y);
      if (g.map[idx(cx, cy)] === 'o' && Math.abs(p.x - cx) < 0.35 && Math.abs(p.y - cy) < 0.35) teleport(g, p, idx(cx, cy));
    }
    // bombs
    moveBombs(g, dt);
    for (const b of g.bombs) b.t -= dt;
    let guard = 0;
    while (guard++ < 200) {
      const b = g.bombs.find(bb => bb.t <= 0 && !bb.air);
      if (!b) break;
      explode(g, b);
    }
    // flames
    for (let i = 0; i < W * H; i++) {
      if (g.flames[i] > 0) {
        g.flames[i] -= dt;
        if (g.flames[i] <= 0) { g.flames[i] = 0; g.flameOwner[i] = -1; if (g.drops[i]) { g.items[i] = g.drops[i]; g.drops[i] = null; } }
      }
    }
    // players vs flames / items
    for (const p of g.players) {
      if (!p || p.st === 2) continue;
      const i = idx(Math.round(p.x), Math.round(p.y));
      if (p.st === 0 && p.inv <= 0 && g.flames[i] > 0) {
        p.st = 1; p.trapT = TRAP_TIME; p.trapBy = g.flameOwner[i]; ev(g, 'trap', g.flameOwner[i], p.seat);
      }
      if (p.st === 0 && g.items[i]) {
        const it = g.items[i]; g.items[i] = null;
        if (it === 'b') p.maxBombs = Math.min(8, p.maxBombs + 1);
        else if (it === 'f') p.fire = Math.min(8, p.fire + 1);
        else if (it === 's') p.spd = Math.min(MAX_SPEED_LVL, p.spd + 1);
        else if (it === 'n') p.needles = Math.min(3, p.needles + 1);
        else if (it === 'k') p.kick = 1;
        else if (it === 't') p.thr = 1;
        else if (it === 'p') p.pw = POWER_TIME;
        ev(g, 'item', p.seat, it);
      }
    }
    // touch trapped players
    for (const a of g.players) {
      if (!a || a.st !== 0) continue;
      for (const b of g.players) {
        if (!b || b === a || b.st !== 1) continue;
        if (Math.abs(a.x - b.x) < 0.7 && Math.abs(a.y - b.y) < 0.7) {
          if (a.team !== b.team) { b.st = 2; a.kills++; g.score[a.seat] += KILL_PTS; ev(g, 'pop', a.seat, b.seat); }
          else if (g.mode === 'team') { b.st = 0; b.inv = 1.2; ev(g, 'rescue', a.seat, b.seat); }
        }
      }
    }
    // end conditions
    const teams = aliveTeams(g);
    const total = new Set(g.players.filter(Boolean).map(p => p.team)).size;
    if ((total > 1 && teams.size <= 1) || (total <= 1 && teams.size === 0) || g.timeLeft <= 0) {
      g.endHold += dt;
      if (g.endHold > 0.6 || g.timeLeft <= 0) {
        g.phase = 'end'; g.t = END_TIME;
        if (teams.size === 1 && g.timeLeft > 0) {
          const team = [...teams][0];
          g.winner = team;
          for (const p of g.players) if (p && p.team === team) { g.wins[p.seat]++; g.score[p.seat] += WIN_PTS; }
          ev(g, 'win', team, -1);
        } else { g.winner = -2; ev(g, 'draw', -1, -1); }
      }
    } else g.endHold = 0;
  }

  // ===== bots =====
  function dangerMap(g) {
    const D = new Float32Array(W * H).fill(Infinity);
    for (let i = 0; i < W * H; i++) if (g.flames[i] > 0) D[i] = 0;
    const T = new Map(); for (const b of g.bombs) T.set(b, b.air ? Math.max(b.t, 0.6) : b.t);
    // chain relaxation
    for (let it = 0; it < 6; it++) {
      for (const b of g.bombs) {
        const tb = T.get(b);
        for (const [x, y] of blastCells(g, b.x, b.y, b.fire)) {
          const ob = g.bombAt[idx(x, y)];
          if (ob && T.get(ob) > tb) T.set(ob, tb);
        }
      }
    }
    for (const b of g.bombs) {
      const tb = T.get(b), bx = b.air ? b.air.tx : b.x, by = b.air ? b.air.ty : b.y;
      for (const [x, y] of blastCells(g, bx, by, b.fire)) { const i = idx(x, y); if (tb < D[i]) D[i] = tb; }
      if (b.vx || b.vy) for (let k = 1; k < 6; k++) { // sliding: mark the path as risky
        const x = b.x + b.vx * k, y = b.y + b.vy * k; if (!isFloor(g.map[idx(x, y)])) break;
        for (const [xx, yy] of blastCells(g, x, y, b.fire)) { const i = idx(xx, yy); if (tb < D[i]) D[i] = tb; }
      }
    }
    if (g.sd) for (let j = 0; j < 10 && g.sd.k + j < SPIRAL.length; j++) {
      const i = SPIRAL[g.sd.k + j], tt = (j + 1) * SUDDEN_STEP - g.sd.acc;
      if (tt < D[i]) D[i] = Math.max(0, tt);
    }
    return D;
  }

  // BFS. mode 'flee': may cross danger cells if arrival safely before blast; 'safe': only D==Inf cells
  function bfs(g, p, D, mode, extraBlast) {
    const sx = Math.round(p.x), sy = Math.round(p.y);
    const speed = BASE_SPEED + effSpd(p) * SPEED_STEP;
    const dist = new Int16Array(W * H).fill(-1), par = new Int16Array(W * H).fill(-1);
    const q = [idx(sx, sy)]; dist[q[0]] = 0;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy, n = idx(nx, ny);
        if (dist[n] >= 0 || !passable(g, p, nx, ny) || g.flames[n] > 0) continue;
        let d = D[n]; if (extraBlast && extraBlast.has(n)) d = Math.min(d, BOMB_TIME);
        const arrive = (dist[c] + 1) / speed;
        if (mode === 'safe' && (d !== Infinity || g.map[n] === 'o')) continue;
        if (mode === 'flee' && d !== Infinity && arrive + 0.45 > d) continue;
        dist[n] = dist[c] + 1; par[n] = c; q.push(n);
      }
    }
    return { dist, par, order: q, start: idx(sx, sy), speed };
  }

  function firstStep(r, target) {
    let c = target;
    while (r.par[c] !== -1 && r.par[c] !== r.start) c = r.par[c];
    return c;
  }

  function dirTo(p, cell) {
    const tx = cell % W, ty = (cell / W) | 0;
    const ex = tx - p.x, ey = ty - p.y;
    if (Math.abs(ex) < 0.06 && Math.abs(ey) < 0.06) return { dx: 0, dy: 0 };
    if (Math.abs(ex) > Math.abs(ey)) return { dx: Math.sign(ex), dy: 0 };
    return { dx: 0, dy: Math.sign(ey) };
  }

  function botThink(g, p) {
    const out = { dx: 0, dy: 0, bomb: false, needle: false };
    if (!p || p.st === 2) return out;
    if (p.st === 1) { if (p.needles > 0 && p.trapT < TRAP_TIME - 0.6) out.needle = true; return out; }
    const D = dangerMap(g);
    const sx = Math.round(p.x), sy = Math.round(p.y), si = idx(sx, sy);
    const go = (r, target) => {
      if (target === r.start) return Object.assign(out, dirTo(p, target));
      return Object.assign(out, dirTo(p, firstStep(r, target)));
    };
    if (D[si] !== Infinity) {
      const r = bfs(g, p, D, 'flee');
      let best = -1;
      for (const c of r.order) if (D[c] === Infinity && g.map[c] !== 'o') { best = c; break; }
      if (best >= 0) return go(r, best);
      return out;
    }
    const r = bfs(g, p, D, 'safe');
    const enemies = g.players.filter(q => q && q !== p && q.st !== 2 && q.team !== p.team);
    // pop trapped enemies
    let tgt = -1, bd = 1e9;
    for (const e of enemies) if (e.st === 1) {
      const c = idx(Math.round(e.x), Math.round(e.y));
      if (r.dist[c] >= 0 && r.dist[c] < bd) { bd = r.dist[c]; tgt = c; }
    }
    // rescue teammates
    if (tgt < 0 && g.mode === 'team') for (const m of g.players) if (m && m !== p && m.team === p.team && m.st === 1) {
      const c = idx(Math.round(m.x), Math.round(m.y));
      if (r.dist[c] >= 0 && r.dist[c] < bd) { bd = r.dist[c]; tgt = c; }
    }
    if (tgt >= 0) return go(r, tgt);

    // bomb decision
    const myOut = g.bombs.filter(b => b.o === p.seat).length;
    if (myOut < effBombs(p) && !g.bombAt[si] && p.ai.cool <= 0) {
      const cells = blastCells(g, sx, sy, effFire(p));
      let crates = 0, hitEnemy = false;
      for (const [x, y] of cells) {
        if (g.map[idx(x, y)] === 'x') crates++;
        for (const e of enemies) if (e.st === 0 && Math.round(e.x) === x && Math.round(e.y) === y) hitEnemy = true;
      }
      const nearEnemy = enemies.some(e => e.st === 0 && Math.abs(e.x - sx) + Math.abs(e.y - sy) <= 2.2);
      if (crates > 0 || hitEnemy || nearEnemy) {
        const hb = { id: -1, x: sx, y: sy, t: BOMB_TIME, o: p.seat, fire: effFire(p) };
        g.bombs.push(hb); g.bombAt[si] = hb;
        const D2 = dangerMap(g);
        const gp = { ...p, ghost: new Set([...p.ghost, -1]) };
        const fr = bfs(g, gp, D2, 'flee');
        g.bombs.pop(); g.bombAt[si] = null;
        let ok = false;
        for (const c of fr.order) if (D2[c] === Infinity && g.map[c] !== 'o' && fr.dist[c] / fr.speed < Math.min(BOMB_TIME, D2[si]) - 0.6) { ok = true; break; }
        if ((ok && g.rand() < 0.9) || (!ok && g.sd && hitEnemy && g.rand() < 0.08)) { out.bomb = true; p.ai.cool = 0.35; return out; }
      }
    }
    if (p.ai.cool > 0) p.ai.cool -= 1 / 30;

    // items
    tgt = -1; bd = 1e9;
    for (const c of r.order) if (g.items[c] && r.dist[c] < bd && r.dist[c] <= 9) { bd = r.dist[c]; tgt = c; }
    if (tgt >= 0) return go(r, tgt);
    // spot next to crate or enemy
    let bestScore = -1e9;
    for (const c of r.order) {
      const cx = c % W, cy = (c / W) | 0;
      let score = -r.dist[c] * 0.6;
      let crates = 0;
      for (const [x, y] of blastCells(g, cx, cy, p.fire)) if (g.map[idx(x, y)] === 'x') crates++;
      score += crates * 2;
      for (const e of enemies) {
        const d = Math.abs(e.x - cx) + Math.abs(e.y - cy);
        if (e.st === 0) score += Math.max(0, 4 - d) * (g.sd ? 3 : 1.5);
      }
      if (score > bestScore) { bestScore = score; tgt = c; }
    }
    if (tgt >= 0 && tgt !== r.start) return go(r, tgt);
    if (tgt === r.start && bestScore > 0) {
      // already at a good spot; nothing safe to bomb -> idle
      return Object.assign(out, dirTo(p, r.start));
    }
    // wander toward nearest enemy via any path
    const e = enemies[0];
    if (e) {
      let best = -1, bdd = 1e9;
      for (const c of r.order) { const d = Math.abs(e.x - c % W) + Math.abs(e.y - ((c / W) | 0)); if (d < bdd) { bdd = d; best = c; } }
      if (best >= 0) return go(r, best);
    }
    return Object.assign(out, dirTo(p, r.start));
  }

  // ===== snapshot =====
  function encode(g) {
    let m = '';
    for (let i = 0; i < W * H; i++) {
      if (g.flames[i] > 0) m += '*';
      else if (g.map[i] !== '.') m += g.map[i];
      else m += g.items[i] || '.';
    }
    return {
      W, H, ph: g.phase, t: Math.round(g.t * 10) / 10, tl: Math.max(0, Math.ceil(g.timeLeft)), md: g.mode, m,
      p: g.players.map(p => p ? [Math.round(p.x * 100), Math.round(p.y * 100), p.st, p.dir, effBombs(p), effFire(p), effSpd(p), p.needles, p.kills, Math.max(0, Math.round(p.trapT * 10)), p.moving, p.team, p.inv > 0 ? 1 : 0, p.kick, p.thr, Math.ceil(p.pw * 10)] : 0),
      fi: g.flyItems.map(f => [Math.round(f.fx * 100), Math.round(f.fy * 100), Math.round(f.z * 100), f.k, idx(f.tx, f.ty)]),
      b: g.bombs.map(b => [Math.round(b.fx * 100), Math.round(b.fy * 100), Math.round(Math.max(0, b.t) * 10), b.o, Math.round((b.z || 0) * 100), b.air ? idx(b.air.tx, b.air.ty) : -1]),
      e: g.events.slice(-8), w: g.wins, sc: g.score, wn: g.winner, mp: g.mapId,
      n: g.npcs.map(n => [Math.round(n.x * 100), Math.round(n.y * 100), n.anim > 0 ? 2 : n.next < 1.3 ? 1 : 0]), sd: g.sd ? 1 : 0,
    };
  }

  // preview map for lobby
  function preview(seed, mode) { const g = createGame({ seed, mode, players: [null, null, null, null] }); g.phase = 'lobby'; return g; }

  setDims('normal');
  // client-side prediction: move a lightweight copy of the player against a map snapshot
  function predictMove(world, p, dx, dy, dt) { movePlayer(world, p, dx, dy, dt); }
  function useDims(w, h) { if (w && h && (w !== W || h !== H)) { W = w; H = h; } }
  return { setDims, predictMove, useDims, get W() { return W; }, get H() { return H; }, SIZES, MAPS, COUNT_TIME, KILL_PTS, WIN_PTS, BOMB_TIME, TRAP_TIME, get ROUND_TIME() { return ROUND_TIME; }, createGame, step, botThink, encode, preview, blastCells };
})();


// ===== Boom room server: runs the match for everyone (Cloudflare Durable Object) =====
const BOT_NAMES = ['Bot Bánh Bao', 'Bot Trà Sữa', 'Bot Kẹo Dẻo', 'Bot Bắp Rang', 'Bot Bánh Mì', 'Bot Kem Que', 'Bot Xôi Gà', 'Bot Chè Bưởi'];
const MAXP = 8, Z = () => new Array(MAXP).fill(0);
const TEAM_NAME = ['Đội Đỏ-Vàng', 'Đội Xanh-Lá'];
const TRAIT_KEYS = ['b', 's', 'f', 'n'];
const PICK_TIME = 10, TICK_MS = 1000 / 30;
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁯﻿]/g, '').trim().slice(0, n);
const AUTO = {
  trap: (a, b, self) => self ? [`Ối! ${b} tự nhốt mình trong bong bóng!`, `${b} dính chiêu của chính mình, tai hại quá!`] : [`${b} bị ${a} nhốt vào bong bóng rồi!`, `Pha đặt bóng tuyệt vời của ${a}! ${b} đang gặp nguy!`, `${b} dính đòn! Ai sẽ đến chọc bong bóng đây?`],
  pop: (a, b) => [`${a} chọc vỡ bong bóng, ${b} phải rời cuộc chơi!`, `Kết liễu gọn gàng! ${a} loại ${b}!`],
  drown: (a, b) => [`${b} không kịp thoát ra, đáng tiếc!`],
  rescue: (a, b) => [`${a} giải cứu đồng đội ${b} quá kịp thời!`, `Tinh thần đồng đội! ${a} cứu ${b}!`],
  escape: (a, b) => [`${b} dùng kim thoát hiểm ngoạn mục!`],
  crush: (a, b) => [`${b} bị tường đè, quá đen đủi!`],
  sudden: () => [`Đột tử! Tường đang sập, các bạn mau ra giữa sân!`],
  start: () => [`Trận đấu bắt đầu! Chúc các bạn may mắn!`, `Vào trận! Ai sẽ là người trụ lại cuối cùng?`],
};

class RoomHost {
  constructor(room) {
    this.room = room; // { peers(): [{id, p, at}], srvSet(patch), feed(text) }
    Object.assign(this, {
      g: null, seats: [0, 1, 2, 3].map(i => ({ type: 'bot', peer: null, name: BOT_NAMES[i] })), seed: (Math.random() * 1e9) | 0, mode: 'ffa', paused: false,
      size: 'normal', mapSel: 'random', curMap: 'classic', npcN: 1, auto: true, autoCm: true, autoSeat: true,
      lastIn: {}, wins: Z(), score: Z(), botTraits: ['b', 's', 'f', 'n', 'b', 's', 'f', 'n'], occ: new Array(MAXP).fill(''), evId: 0,
      rk: (Math.random() * 1e6) | 0, tick: 0, cmQueue: [], cmLast: 0, cmId: 0, seenEv: 0, kicked: new Set(), forced: new Map(),
    });
    this.curMap = this.pickMap();
    this.rebuildLobby();
  }
  peers() { return this.room.peers(); }
  peer(id) { return this.peers().find(p => p.id === id); }
  seatTrait(i) {
    const s = this.seats[i];
    if (s.type === 'human') { const t = this.peer(s.peer)?.p?.tr; return TRAIT_KEYS.includes(t) ? t : 'b'; }
    return this.botTraits[i] || 'b';
  }
  playersCfg() { return this.seats.map((s, i) => s.type === 'empty' ? null : { name: s.type === 'bot' ? s.name || BOT_NAMES[i] : s.name, bot: s.type === 'bot', trait: this.seatTrait(i) }); }
  pickMap() { if (this.mapSel !== 'random') return this.mapSel; const o = SIM.MAPS.filter(m => m !== this.curMap); return o[(Math.random() * o.length) | 0]; }
  create() { const g = SIM.createGame({ seed: this.seed || 1, map: this.curMap, size: this.size, npc: this.npcN > 0, npcN: this.npcN + (this.curMap === 'storm' ? 1 : 0), mode: this.mode, players: this.playersCfg(), wins: this.wins, score: this.score, evId: this.evId }); g.__size = this.size; return g; }
  newGame(phase) {
    this.seed = (Math.random() * 1e9) | 0; this.botTraits = Z().map(() => TRAIT_KEYS[(Math.random() * 4) | 0]);
    this.curMap = this.pickMap(); this.rk++;
    this.g = this.create(); this.g.phase = phase; if (phase === 'pick') this.g.t = PICK_TIME; this.lastIn = {};
  }
  rebuildPick(t, phase) { this.g = this.create(); this.g.phase = phase; this.g.t = t; }
  rebuildLobby() { this.g = this.create(); this.g.phase = 'lobby'; }
  sameNames() { const g = this.g; return g.players.every((p, i) => (p ? p.name + '|' + p.trait : null) === (this.seats[i].type === 'empty' ? null : this.seats[i].name + '|' + this.seatTrait(i))); }
  seatMaintenance() {
    const g = this.g, canSeat = !g || g.phase === 'lobby' || g.phase === 'end' || g.phase === 'pick';
    const peers = this.peers(), ids = new Set(peers.map(p => p.id)), wanting = [];
    for (const pe of peers) {
      const pr = pe.p || {};
      if (this.forced.has(pe.id) && (pr.wv || 0) !== this.forced.get(pe.id)) this.forced.delete(pe.id);
      if (this.forced.has(pe.id)) { wanting.push({ peer: pe.id, name: clean(pr.n, 16) || 'Người chơi' }); continue; }
      if (pr.want !== 'play') this.kicked.delete(pe.id);
      else if (!this.kicked.has(pe.id)) wanting.push({ peer: pe.id, name: clean(pr.n, 16) || 'Người chơi' });
    }
    const wantSet = new Set(wanting.map(w => w.peer));
    let changed = false;
    this.seats.forEach((s, i) => {
      if (s.type !== 'human') return;
      if (!ids.has(s.peer) || !wantSet.has(s.peer)) {
        if (g && g.phase !== 'lobby' && g.phase !== 'end' && g.players[i]) g.players[i].bot = true;
        s.type = 'bot'; s.peer = null; s.name = BOT_NAMES[i]; changed = true;
      } else {
        const w = wanting.find(w => w.peer === s.peer);
        if (w && w.name !== s.name) { s.name = w.name; if (g && g.players[i]) g.players[i].name = w.name; changed = true; }
      }
    });
    if (canSeat && this.autoSeat) for (const w of wanting) {
      if (this.seats.some(s => s.type === 'human' && s.peer === w.peer)) continue;
      let k = this.seats.findIndex(s => s.type === 'empty'); if (k < 0) k = this.seats.findIndex(s => s.type === 'bot'); if (k < 0) break;
      this.seats[k] = { type: 'human', peer: w.peer, name: w.name }; changed = true;
    }
    this.seats.forEach((s, i) => { const key = s.type === 'human' ? 'h:' + s.peer : s.type; if (this.occ[i] !== key) { if (this.occ[i]) { this.wins[i] = 0; this.score[i] = 0; if (g) { g.wins[i] = 0; g.score[i] = 0; } } this.occ[i] = key; } });
    if (changed || (g && (g.phase === 'lobby' || g.phase === 'pick') && !this.sameNames())) {
      if (g && g.phase === 'lobby') this.rebuildLobby(); else if (g && g.phase === 'pick') this.rebuildPick(g.t, 'pick');
    }
  }
  applySeat(i) {
    const g = this.g, s = this.seats[i];
    if (g.phase === 'lobby') return this.rebuildLobby();
    if (g.phase === 'pick') return this.rebuildPick(g.t, 'pick');
    const p = g.players[i]; if (!p) return;
    if (s.type === 'human') { p.bot = false; p.name = s.name; } else { p.bot = true; p.name = s.name || BOT_NAMES[i]; }
  }
  // commands from the room's admin (the player who runs the host panel)
  command(c, from) {
    const v = c.v, g = this.g, idle = g.phase === 'lobby' || g.phase === 'end';
    switch (c.k) {
      case 'mode': if (['ffa', 'team'].includes(v)) { this.mode = v; if (idle) this.rebuildLobby(); } break;
      case 'size': if (SIM.SIZES[v]) { this.size = v; if (idle) this.rebuildLobby(); } break;
      case 'map': if (v === 'random' || SIM.MAPS.includes(v)) { this.mapSel = v; if (idle) { this.curMap = this.pickMap(); this.rebuildLobby(); } } break;
      case 'npcN': { const n = Math.round(+v); if (n >= 0 && n <= 10) { this.npcN = n; if (idle) this.rebuildLobby(); } break; }
      case 'count': {
        const n = Math.round(+v); if (!(n >= 4 && n <= MAXP) || !(idle || g.phase === 'pick')) break;
        while (this.seats.length < n) { const i = this.seats.length; this.seats.push({ type: 'bot', peer: null, name: BOT_NAMES[i] }); }
        while (this.seats.length > n) { const s = this.seats.pop(); if (s.type === 'human' && s.peer) this.kicked.add(s.peer); }
        if (g.phase === 'pick') this.rebuildPick(g.t, 'pick'); else this.rebuildLobby();
        break;
      }
      case 'auto': this.auto = !!v; break;
      case 'autoCm': this.autoCm = !!v; break;
      case 'autoSeat': this.autoSeat = !!v; break;
      case 'start': this.seatMaintenance(); if (this.g.players.some(Boolean)) this.newGame('pick'); break;
      case 'newmap': this.seed = (Math.random() * 1e9) | 0; if (g.phase === 'lobby') { this.curMap = this.pickMap(); this.rebuildLobby(); } else this.newGame('pick'); break;
      case 'stop': this.seed = (Math.random() * 1e9) | 0; this.rk++; this.paused = false; this.rebuildLobby(); break;
      case 'reset': this.wins = Z(); this.score = Z(); g.wins = g.wins.map(() => 0); g.score = g.score.map(() => 0); break;
      case 'pause': if (g.phase !== 'lobby') { this.paused = !this.paused; this.room.feed(this.paused ? '⏸ Host đã tạm dừng trận' : '▶ Trận đấu tiếp tục'); } break;
      case 'cm': this.comment(v); break;
      case 'seat': { const i = v && v.i; if (i >= 0 && i < this.seats.length && this.seats[i].type !== 'human') { this.seats[i] = v.type === 'bot' ? { type: 'bot', peer: null, name: BOT_NAMES[i] } : { type: 'empty', peer: null, name: '' }; if (g.phase === 'lobby') this.rebuildLobby(); else if (g.phase === 'pick') this.rebuildPick(g.t, 'pick'); } break; }
      case 'unseat': { const k = v | 0, s = this.seats[k]; if (s && s.type === 'human') { this.kicked.add(s.peer); this.forced.delete(s.peer); this.seats[k] = { type: 'bot', peer: null, name: BOT_NAMES[k] }; this.applySeat(k); } break; }
      case 'assign': {
        const peer = v && v.peer, k = v && v.k; const pe = this.peer(peer); if (!pe || !(k >= 0 && k < this.seats.length)) break;
        const from = this.seats.findIndex(s => s.type === 'human' && s.peer === peer); if (from === k) break;
        const target = this.seats[k], name = clean(pe.p?.n, 16) || 'Người chơi';
        if (from >= 0) { this.seats[from] = target.type === 'human' ? target : { type: 'bot', peer: null, name: BOT_NAMES[from] }; this.applySeat(from); }
        else if (target.type === 'human' && target.peer) { this.kicked.add(target.peer); this.forced.delete(target.peer); }
        this.seats[k] = { type: 'human', peer, name }; this.kicked.delete(peer); this.forced.set(peer, pe.p?.wv || 0);
        this.applySeat(k); this.room.feed(`🎙️ Host xếp ${name} vào ghế ${k + 1}`);
        break;
      }
    }
  }
  tickOnce(dt) {
    let g = this.g;
    this.dims();
    this.seatMaintenance(); g = this.g;
    const inputs = g.players.map(() => null);
    for (let i = 0; i < g.players.length; i++) {
      const p = g.players[i]; if (!p) continue;
      const seat = this.seats[i]; if (!seat) continue;
      if (p.bot || seat.type !== 'human') { inputs[i] = SIM.botThink(g, p); continue; }
      const src = this.peer(seat.peer)?.p?.inp || { dx: 0, dy: 0, b: 0, nd: 0 };
      const key = i + ':' + seat.peer, li = this.lastIn[key];
      const bomb = li ? src.b !== li.b : false, needle = li ? src.nd !== li.nd : false;
      this.lastIn[key] = { b: src.b, nd: src.nd };
      inputs[i] = { dx: Math.sign(src.dx | 0), dy: Math.sign(src.dy | 0), bomb, needle, cell: -1 };
    }
    if (this.paused && g.phase !== 'lobby') { /* frozen */ }
    else if (g.phase === 'pick') { g.t -= dt; if (g.t <= 0) this.rebuildPick(SIM.COUNT_TIME, 'count'); }
    else SIM.step(g, dt, inputs);
    g = this.g;
    this.evId = g.evId; g.wins.forEach((v, i) => { this.wins[i] = v; }); g.score.forEach((v, i) => { this.score[i] = v; });
    if (g.phase === 'end' && g.t <= 0) {
      if (this.auto) { this.seatMaintenance(); this.newGame('pick'); }
      else { this.seed = (Math.random() * 1e9) | 0; this.curMap = this.pickMap(); this.rebuildLobby(); }
    }
  }
  dims() { const d = SIM.SIZES[this.g.__size] || SIM.SIZES.normal; if (SIM.W !== d[0] || SIM.H !== d[1]) SIM.setDims(this.g.__size); } // another room in this process may have changed the size
  snapshot() {
    this.tick++; this.dims();
    const g = this.g, snap = SIM.encode(g);
    snap.s = this.seats.map((s, i) => s.type === 'empty' ? 0 : [s.type === 'bot' ? 1 : 2, s.name, s.peer || '', g.players[i]?.trait || '']);
    snap.rk = this.rk; snap.auto = this.auto ? 1 : 0; snap.pz = this.paused ? 1 : 0; snap.k = this.tick;
    snap.cfg = { mode: this.mode, map: this.mapSel, size: this.size, npc: this.npcN > 0 ? 1 : 0, npcN: this.npcN, auto: this.auto ? 1 : 0, autoCm: this.autoCm ? 1 : 0, autoSeat: this.autoSeat ? 1 : 0 };
    for (const e of snap.e || []) if (e.i > this.seenEv) { this.seenEv = e.i; if (this.autoCm) this.autoComment(e, snap); }
    if (this.cmQueue.length && Date.now() - this.cmLast > 2600) this.comment(this.cmQueue.shift());
    return snap;
  }
  seatName(S, s) { if (s === -2) return 'Ông Mây Giông'; const st = S?.s?.[s]; return st ? (st[1] || 'Ghế ' + (s + 1)) : 'Ghế ' + (s + 1); }
  autoComment(e, S) {
    const f = AUTO[e.k]; let line = null;
    if (e.k === 'item' && e.b === 'p') line = `${this.seatName(S, e.a)} nhặt được Phách thần! Bom, tốc độ, tia nổ đều tối đa trong 10 giây!`;
    else if (e.k === 'npcItem') line = 'Ông Mây Giông vừa ném xuống Phách thần, ai sẽ nhanh tay hơn?';
    else if (e.k === 'win') line = S.md === 'team' ? `${TEAM_NAME[e.a]} giành chiến thắng chung cuộc!` : `${this.seatName(S, e.a)} là người chiến thắng!`;
    else if (e.k === 'draw') line = 'Hoà rồi! Không ai trụ lại được.';
    else if (f) { const arr = f(this.seatName(S, e.a), this.seatName(S, e.b), e.a === e.b); line = arr[(Math.random() * arr.length) | 0]; }
    if (!line) return;
    if (e.k === 'win' || e.k === 'draw' || e.k === 'start') this.cmQueue = [line]; else if (this.cmQueue.length < 2) this.cmQueue.push(line);
  }
  comment(text) {
    text = clean(text, 200); if (!text) return;
    this.cmLast = Date.now(); this.cmId++;
    this.room.srvSet({ cm: { i: this.cmId + ':' + this.room.born, t: text } });
  }
}

export class BoomRoom {
  constructor(state, env) {
    this.state = state; this.conns = new Map(); this.born = Date.now();
    this.srv = { n: 'Máy chủ', role: 'host', hs: 1, srv: 1 };
    this.host = null; this.timer = 0; this.mapSent = null; this.mapTick = 0;
  }
  peers() { const out = []; for (const [id, c] of this.conns) out.push({ id, p: c.p, at: c.at }); return out; }
  send(c, m) { try { c.ws.send(typeof m === 'string' ? m : JSON.stringify(m)); } catch (e) { /* closed */ } }
  bcast(m, except) { const raw = JSON.stringify(m); for (const [id, c] of this.conns) if (id !== except) this.send(c, raw); }
  srvSet(patch) { Object.assign(this.srv, patch); this.bcast({ t: 'p', id: 'srv', p: this.srv }); }
  feed(text) { this.bcast({ t: 'e', id: 'srv', k: 'feed', d: text }); }
  pickAdmin() {
    let best = null;
    for (const [id, c] of this.conns) {
      const claim = typeof c.p.adm === 'number' ? c.p.adm : Infinity;
      if (!best || claim < best.claim || (claim === best.claim && c.joined < best.joined)) best = { id, claim, joined: c.joined };
    }
    const ad = best ? best.id : '';
    if (ad !== this.srv.ad) this.srvSet({ ad });
  }
  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Boom room server', { status: 200 });
    const pair = new WebSocketPair(), ws = pair[1];
    ws.accept();
    const id = 'u' + crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    const c = { ws, p: {}, at: Date.now(), joined: Date.now() };
    this.conns.set(id, c);
    if (!this.host) this.host = new RoomHost(this);
    this.send(c, { t: 'hi', id, peers: [['srv', this.srv], ...[...this.conns].filter(([k]) => k !== id).map(([k, v]) => [k, v.p])] });
    this.bcast({ t: 'p', id, p: c.p }, id);
    c.full = true; this.pickAdmin(); this.startLoop();
    ws.addEventListener('message', ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m || typeof m !== 'object') return;
      c.at = Date.now();
      if (m.t === 'p' && m.p && typeof m.p === 'object') {
        const n = { ...c.p }; for (const k in m.p) { if (m.p[k] === null) delete n[k]; else n[k] = m.p[k]; }
        c.p = n;
        const keys = Object.keys(m.p);
        if (!(keys.length === 1 && keys[0] === 'inp')) this.bcast({ t: 'p', id, p: n }, id); // inputs only matter to the server
        if ('adm' in m.p) this.pickAdmin();
      } else if (m.t === 'e' && typeof m.k === 'string') {
        if (m.k === 'adm') { if (this.srv.ad === id && m.d && typeof m.d === 'object') try { this.host.command(m.d, id); } catch (e) { /* ignore bad command */ } }
        else this.bcast({ t: 'e', id, k: m.k, d: m.d }, id);
      } else if (m.t === 'ping') this.send(c, { t: 'pong', c: m.c });
    });
    const bye = () => { if (this.conns.get(id) !== c) return; this.conns.delete(id); this.bcast({ t: 'bye', id }); this.pickAdmin(); if (!this.conns.size) this.stopLoop(); };
    ws.addEventListener('close', bye); ws.addEventListener('error', bye);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  startLoop() {
    if (this.timer) return;
    let last = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now(); let dt = Math.min(1, (now - last) / 1000); last = now;
      try {
        while (dt > 0) { const d = Math.min(dt, 0.05); dt -= d; this.host.tickOnce(d); }
        const snap = this.host.snapshot();
        const full = JSON.stringify({ t: 's', d: snap });
        let delta = full;
        if (snap.m === this.mapSent && this.host.tick - this.mapTick < 60) { const d = { ...snap }; delete d.m; delta = JSON.stringify({ t: 's', d }); }
        else { this.mapSent = snap.m; this.mapTick = this.host.tick; }
        for (const c of this.conns.values()) { this.send(c, c.full ? full : delta); c.full = false; }
        for (const [id, c] of this.conns) if (Date.now() - c.at > 20000) { try { c.ws.close(1000, 'idle'); } catch (e) { /* ignore */ } this.conns.delete(id); this.bcast({ t: 'bye', id }); this.pickAdmin(); }
      } catch (e) { console.log('tick error', e && e.stack || e); }
    }, TICK_MS);
  }
  stopLoop() { clearInterval(this.timer); this.timer = 0; }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/ws\/([a-z0-9_-]{1,40})$/i);
    if (!m) return new Response('Boom 2.5D server OK', { headers: { 'Access-Control-Allow-Origin': '*' } });
    const id = env.ROOMS.idFromName(m[1].toLowerCase());
    return env.ROOMS.get(id, { locationHint: 'apac' }).fetch(req);
  },
};
