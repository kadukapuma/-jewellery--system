import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import './Mascot.css';

// Lazy load RobotMascot so Three.js bundles in its own chunk
const RobotMascot = lazy(() => import('./RobotMascot'));

const MIN_GUTTER = 80;
const TOP = 0.035;
const END = 0.965;
const TALK = 3600;
const GRAB_MS = 1000;
const PULL_MS = 2000;
const RETURN_MS = 2700;
const FLY_MS = 2100;
const SOMERSAULT = [0.08, 0.26];
const LOOP = [0.32, 0.72];
const HEAD = 0.37;
const DASH_MS = 5200;
const STROLL = 260;
const DASH_GAP_MS = 4000;
const TRICKS = ['spin', 'wave', 'dance'];
const IDLE_MS = 1500;
const IDLE_GAP_MS = 2200;
const JIG_MS = 2600;

const DEFAULT_MESSAGES = {
  hi: 'Welcome! 👋',
  bye: 'Bye! 👋 See you soon',
};

function measure(contentWidth = 1200) {
  const vw = typeof document !== 'undefined' ? document.documentElement.clientWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const gutter = (vw - Math.min(contentWidth, vw - 48)) / 2;
  const wide = gutter >= MIN_GUTTER;
  const w = wide ? Math.min(gutter - 10, 170) : vw < 600 ? 70 : 88;
  return { vw, vh, gutter, wide, w, h: w * 1.08 };
}

const smooth = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const smoother = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * k * (k * (k * 6 - 15) + 10));
const easeInOutSine = (k) => -(Math.cos(Math.PI * k) - 1) / 2;

function buildFlightPath(f, to, { vw, vh, w, h }) {
  const N = 320;
  const dist = Math.hypot(to.x - f.x0, to.y - f.y0);
  const lift = Math.min(110, dist * 0.3);
  const cx = (f.x0 + to.x) / 2;
  const cy = Math.min(f.y0, to.y) - lift;
  const base = (u) => [
    (1 - u) * (1 - u) * f.x0 + 2 * (1 - u) * u * cx + u * u * to.x,
    (1 - u) * (1 - u) * f.y0 + 2 * (1 - u) * u * cy + u * u * to.y,
  ];
  const scaleAt = (u) => f.s0 + (1 - f.s0) * u;
  const [, ly] = base((LOOP[0] + LOOP[1]) / 2);
  const R0 = Math.min(120, vh * 0.16, vw * 0.12);
  const above = ly - 10;
  const below = vh - (ly + h * scaleAt(0.5)) - 10;
  const up = above >= 2 * R0 || above >= below;
  const R = Math.max(30, Math.min(R0, (up ? above : below) / 2));
  const sign = up ? 1 : -1;

  const xs = new Float32Array(N + 1);
  const ys = new Float32Array(N + 1);
  const loops = new Float32Array(N + 1);
  const len = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    let [x, y] = base(u);
    const lk = f.tricks ? smoother((u - LOOP[0]) / (LOOP[1] - LOOP[0])) : 0;
    const th = lk * Math.PI * 2;
    x += f.dir * R * Math.sin(th);
    y -= sign * R * (1 - Math.cos(th));
    y += Math.sin(u * Math.PI * 4) * 6 * Math.sin(u * Math.PI);
    const s = scaleAt(u);
    xs[i] = Math.max(0, Math.min(vw - w * s, x));
    ys[i] = Math.max(8, Math.min(vh - h * s, y));
    loops[i] = lk;
    len[i] = i ? len[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]) : 0;
  }
  const total = len[N] || 1;
  return {
    sign,
    at(d) {
      const target = Math.max(0, Math.min(1, d)) * total;
      let lo = 0;
      let hi = N;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (len[mid] < target) lo = mid;
        else hi = mid;
      }
      const seg = len[hi] - len[lo] || 1;
      const t = Math.max(0, Math.min(1, (target - len[lo]) / seg));
      return {
        x: xs[lo] + (xs[hi] - xs[lo]) * t,
        y: ys[lo] + (ys[hi] - ys[lo]) * t,
        loop: loops[lo] + (loops[hi] - loops[lo]) * t,
      };
    },
  };
}

function makeTrail(canvas) {
  const ctx = canvas.getContext('2d');
  const sprites = ['236,255,214', '147,220,44', '2,202,150', '5,136,117', '170,200,188'].map((rgb) => {
    const s = document.createElement('canvas');
    s.width = s.height = 64;
    const g2 = s.getContext('2d');
    const grad = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, `rgba(${rgb},1)`);
    grad.addColorStop(0.45, `rgba(${rgb},0.55)`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g2.fillStyle = grad;
    g2.fillRect(0, 0, 64, 64);
    return s;
  });
  let parts = [];
  let dpr = 1;
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
  };
  resize();
  return {
    resize,
    emit(x, y, bx, by, size, power) {
      const n = Math.round(1.5 + power * 3);
      for (let i = 0; i < n; i++) {
        if (parts.length > 260) parts.shift();
        const speed = (120 + Math.random() * 220) * (0.6 + power * 0.6);
        const spread = (Math.random() - 0.5) * 0.9;
        parts.push({
          x: x + (Math.random() - 0.5) * size * 0.18,
          y: y + (Math.random() - 0.5) * size * 0.18,
          vx: (bx + -by * spread) * speed,
          vy: (by + bx * spread) * speed,
          age: 0,
          life: 0.35 + Math.random() * 0.4,
          r0: size * (0.06 + Math.random() * 0.04),
          r1: size * (0.17 + Math.random() * 0.12),
        });
      }
    },
    step(dt) {
      if (!parts.length) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      parts = parts.filter((q) => q.age < q.life);
      for (const q of parts) {
        q.age += dt;
        q.x += q.vx * dt;
        q.y += q.vy * dt - 30 * dt;
        const drag = Math.pow(0.93, dt * 60);
        q.vx *= drag;
        q.vy *= drag;
        const k = Math.min(1, q.age / q.life);
        const r = q.r0 + (q.r1 - q.r0) * k;
        const sprite = sprites[k < 0.15 ? 0 : k < 0.35 ? 1 : k < 0.55 ? 2 : k < 0.75 ? 3 : 4];
        ctx.globalAlpha = (k < 0.75 ? 0.75 : 0.35) * Math.pow(1 - k, 1.5);
        ctx.drawImage(sprite, q.x - r, q.y - r, r * 2, r * 2);
      }
      if (!parts.length) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    },
  };
}

export default function Mascot({
  control,
  intro = false,
  accent = '#02ca96',
  jetColor = '#058875',
  jetpack = true,
  messages = DEFAULT_MESSAGES,
  contentWidth = 1200,
}) {
  const ownControl = useRef({ pose: 'idle', move: 0, face: 0, jumpReq: false, hidden: true, jetpack: jetpack ? 1 : 0 });
  const ctlRef = control || ownControl;
  const boxRef = useRef(null);
  const bodyRef = useRef(null);
  const trailRef = useRef(null);
  const introRef = useRef(intro);
  const pos = useRef(null);
  const [box, setBox] = useState(() => measure(contentWidth));
  const [bubble, setBubble] = useState({ on: false, msg: 'hi' });
  const [failed, setFailed] = useState(false);

  const activeMessages = { ...DEFAULT_MESSAGES, ...messages };

  useEffect(() => {
    introRef.current = intro;
  }, [intro]);

  useEffect(() => {
    const update = () =>
      setBox((b) => {
        const n = measure(contentWidth);
        return n.vw === b.vw && n.vh === b.vh ? b : n;
      });
    update();
    window.addEventListener('resize', update);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (ro) ro.observe(document.documentElement);
    return () => {
      window.removeEventListener('resize', update);
      if (ro) ro.disconnect();
    };
  }, [contentWidth]);

  useEffect(() => {
    const el = boxRef.current;
    const body = bodyRef.current;
    const trail = trailRef.current ? makeTrail(trailRef.current) : null;
    if (!el || !body) return undefined;
    const c = ctlRef.current;
    const { vw, vh, gutter, wide, w, h } = box;
    const marginX = (gutter - w) / 2;
    const cornerX = 12;
    if (!pos.current) {
      pos.current = {
        mode: 'wait',
        x: wide ? marginX : cornerX,
        y: vh + 40,
        s: 1,
        quiet: false,
        flight: null,
        dash: null,
        doneGaps: new Set(),
        lastDashAt: -Infinity,
        lastActive: 0,
        lastWalkGap: null,
        jig: null,
      };
    }
    const st = pos.current;
    st.x = Math.max(-w, Math.min(vw, st.x));
    let raf = 0;
    let last = performance.now();
    let lastY = window.scrollY;
    let vel = 0;
    let stage = '';
    let stageAt = 0;
    let said = '';
    let clock = 0;

    const homeSpot = (stg, p) => {
      if (!wide) return stg === 'bye' ? { x: vw - w - 12, y: vh - h - 76 } : { x: cornerX, y: vh - h - 10 };
      const x = marginX;
      if (stg === 'hi') return { x, y: Math.max(96, vh * 0.15) };
      if (stg === 'bye') return { x: vw - gutter + (gutter - w) / 2, y: vh - h - 20 };
      return { x, y: vh * 0.52 - h / 2 + Math.sin(p * Math.PI * 10) * vh * 0.14 };
    };

    let gaps = [];
    let measureTimer = 0;
    let idleId = 0;
    const measureGaps = () => {
      const vy = window.scrollY;
      st.doneGaps.forEach((id) => {
        if (id * 40 < vy - vh * 0.5 || id * 40 > vy + vh * 1.5) st.doneGaps.delete(id);
      });
      const sy0 = window.scrollY;
      const solid = [];
      document.querySelectorAll('main > section, footer, section, article').forEach((sec) => {
        const parts = sec.classList.contains('work') ? [sec] : Array.from(sec.children);
        parts.forEach((el2) => {
          if (el2.getAttribute('aria-hidden') === 'true') return;
          const style = getComputedStyle(el2);
          if (style.position === 'absolute' || style.position === 'fixed') return;
          const r = el2.getBoundingClientRect();
          if (r.height > 0) solid.push([r.top + sy0, r.bottom + sy0]);
        });
      });
      solid.sort((a, b) => a[0] - b[0]);
      gaps = [];
      let end = -Infinity;
      for (const [t, b] of solid) {
        if (end > -Infinity && t - end > h + 30) gaps.push({ id: Math.round(end / 40), top: end + 10, bottom: t - 10 });
        end = Math.max(end, b);
      }
    };
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 60));
    const cancelIdle = window.cancelIdleCallback || clearTimeout;
    const scheduleMeasure = () => {
      cancelIdle(idleId);
      idleId = idle(measureGaps, { timeout: 800 });
    };
    scheduleMeasure();
    measureTimer = setInterval(scheduleMeasure, 1500);

    const pickGap = (sy, isIdle) => {
      if (Math.abs(vel) > 0.5) return null;
      const fits = [];
      for (const g of gaps) {
        const top = g.top - sy;
        const bot = g.bottom - sy;
        if (isIdle) {
          if (top >= 70 && bot <= vh - 10 && g.id !== st.lastWalkGap) fits.push(g);
        } else if (!st.doneGaps.has(g.id)) {
          const mid = (top + bot) / 2;
          if (mid > vh * 0.3 && mid < vh * 0.7) return g;
        }
      }
      return fits.length ? fits[Math.floor(Math.random() * fits.length)] : null;
    };

    const grabSpot = () => ({ x: 2, y: Math.max(90, vh * 0.42 - h / 2) });

    const jetTrail = (f) => {
      if (!trail) return;
      const jx = st.x + (w * st.s) / 2;
      const jy = st.y + h * st.s * 0.58;
      if (f.px !== null) {
        const mx = jx - f.px;
        const my = jy - f.py;
        const len = Math.hypot(mx, my);
        if (len > 0.5) {
          const bx = -mx / len;
          const by = -my / len;
          const size = w * st.s;
          const steps = Math.min(6, Math.ceil(len / (size * 0.3)));
          for (let i = 0; i < steps; i++) {
            const t = i / steps;
            trail.emit(jx - mx * t + bx * size * 0.2, jy - my * t + by * size * 0.2, bx, by, size, c.thrust / steps + 0.15);
          }
        }
      }
      f.px = jx;
      f.py = jy;
    };

    const place = () => {
      el.style.transform = `translate3d(${st.x.toFixed(1)}px, ${st.y.toFixed(1)}px, 0) scale(${st.s.toFixed(3)})`;
    };
    const show = (on) => {
      el.style.visibility = on ? '' : 'hidden';
    };
    const say = (msg) => {
      if (msg !== said) {
        said = msg;
        setBubble((b) => (msg ? { on: true, msg } : { ...b, on: false }));
      }
    };

    show(st.mode !== 'wait');
    place();

    const loop = (now) => {
      if (c.failed) {
        setFailed(true);
        return;
      }
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!c.ready) return;
      clock += dt * 1000;
      if (trail) trail.step(dt);

      const sy = window.scrollY;
      const max = document.documentElement.scrollHeight - vh;
      const p = max > 0 ? sy / max : 0;
      const speed = (sy - lastY) / Math.max(dt, 0.001) / 1800;
      vel += (Math.max(-1, Math.min(1, speed)) - vel) * Math.min(1, dt * 8);
      lastY = sy;

      /* 1. intro */
      if (st.mode === 'wait') {
        const land = c.intro;
        if (land) {
          st.mode = 'intro';
          st.quiet = true;
          st.s = land.w / w;
          st.x = land.x - (w * st.s) / 2;
          st.y = land.y - h * st.s * HEAD;
          c.hidden = false;
          c.jumpReq = true;
          el.classList.add('mascot--intro');
          body.classList.add('is-tumble');
          place();
          show(true);
        } else if (!introRef.current) {
          st.mode = 'home';
          c.hidden = false;
          c.jetpack = jetpack ? 1 : 0;
          show(true);
        } else {
          return;
        }
      }
      if (st.mode === 'intro') {
        const stg = c.intro.stage;
        c.pose = stg === 'in' ? 'idle' : 'hi';
        c.face = 0;
        c.thrust = stg === 'in' ? 0 : 0.3;
        if (stg === 'grab' || stg === 'fly') {
          const grab = stg === 'grab';
          const to = grab ? grabSpot() : homeSpot(p < TOP ? 'hi' : 'roam', p);
          const dir = to.x + w / 2 >= st.x + (w * st.s) / 2 ? 1 : -1;
          st.flight = { x0: st.x, y0: st.y, s0: st.s, t0: now, dir, to, ms: grab ? GRAB_MS : FLY_MS, tricks: !grab, next: grab ? 'pull' : 'home', px: null, py: null };
          st.mode = 'fly';
          body.classList.remove('is-tumble');
        } else {
          return;
        }
      }

      /* 2. flights */
      if (st.mode === 'fly') {
        const f = st.flight;
        if (!f.path) f.path = buildFlightPath(f, f.to, { vw, vh, w, h });
        const k = Math.max(0, Math.min(1, (now - f.t0) / f.ms));
        const at = f.path.at(easeInOutSine(k));
        st.x = at.x;
        st.y = at.y;
        st.s = f.s0 + (1 - f.s0) * smooth(k);
        const fly = smooth(k / 0.16) * (1 - smooth((k - 0.82) / 0.18));
        c.fly = fly;
        c.flyDir = f.dir;
        c.face = f.dir * 2.3 * fly;
        c.thrust = (0.35 + 0.65 * fly) * (1 + 0.5 * Math.sin(at.loop * Math.PI));
        const flip = f.tricks ? Math.PI * 2 * smooth((k - SOMERSAULT[0]) / (SOMERSAULT[1] - SOMERSAULT[0])) : 0;
        c.roll = f.dir * (flip + f.path.sign * at.loop * Math.PI * 2);
        c.pose = 'idle';
        c.move = 0;
        place();
        jetTrail(f);
        if (k >= 1) {
          const end = f.path.at(1);
          st.x = end.x;
          st.y = end.y;
          st.s = 1;
          c.roll = 0;
          if (f.next === 'pull' && !c.skipPull) {
            st.pull = { t0: now, y0: st.y, px: null, py: null };
            c.curtainPull = { t0: now, ms: PULL_MS };
            st.mode = 'pull';
          } else if (f.next === 'pull') {
            const to = homeSpot(p < TOP ? 'hi' : 'roam', p);
            st.flight = { x0: st.x, y0: st.y, s0: 1, t0: now, dir: -1, to, ms: RETURN_MS, tricks: true, next: 'home', px: null, py: null };
          } else {
            st.mode = 'home';
            st.quiet = false;
            st.dropAt = now + 450;
            c.fly = 0;
            c.thrust = 0;
            c.jumpReq = true;
            el.classList.remove('mascot--intro');
          }
        }
        return;
      }

      /* 2b. curtain pull */
      if (st.mode === 'pull') {
        const q0 = Math.max(0, Math.min(1, (now - st.pull.t0) / PULL_MS));
        const q = easeInOutSine(q0);
        const edgeX = vw * q;
        st.x = Math.max(2, Math.min(vw - w - 2, edgeX - w * 0.3));
        st.y = st.pull.y0 - Math.sin(q * Math.PI) * vh * 0.04;
        const fly = smooth(q0 / 0.15) * (1 - smooth((q0 - 0.9) / 0.1));
        c.fly = fly;
        c.flyDir = 1;
        c.face = 2.3 * fly;
        c.thrust = 0.45 + 0.55 * fly;
        c.pose = 'idle';
        c.move = 0;
        place();
        jetTrail(st.pull);
        if (q0 >= 1) {
          const to = homeSpot(p < TOP ? 'hi' : 'roam', p);
          st.flight = { x0: st.x, y0: st.y, s0: 1, t0: now, dir: -1, to, ms: RETURN_MS, tricks: true, next: 'home', px: null, py: null };
          st.mode = 'fly';
        }
        return;
      }

      /* 3. home page roaming */
      if (st.dropAt && now >= st.dropAt) {
        st.dropAt = 0;
        c.jetpack = 0;
      }
      const next = p < TOP ? 'hi' : p > END ? 'bye' : 'roam';
      if (next !== stage) {
        stage = next;
        stageAt = clock;
        if (stage !== 'hi') st.quiet = false;
        if (stage !== 'roam' && !st.quiet) c.jumpReq = true;
      }
      const greeting = stage !== 'roam' && !st.quiet && clock - stageAt < TALK;
      c.pose = greeting ? stage : 'idle';
      c.move = vel;

      const spot = homeSpot(stage, p);

      if (Math.abs(vel) > 0.04 || !st.lastActive) st.lastActive = now;
      const isIdle = now - st.lastActive > IDLE_MS;
      const restMs = isIdle ? IDLE_GAP_MS : DASH_GAP_MS;
      if (!st.dash && !st.jig && now - st.lastDashAt > restMs) {
        const g = stage === 'roam' ? pickGap(sy, isIdle) : null;
        if (g) {
          const trick = TRICKS[Math.floor(Math.random() * TRICKS.length)];
          st.dash = { g, t0: now, x0: st.x, y0: st.y, fromX: spot.x, flipped: false, trick };
          if (!isIdle) st.doneGaps.add(g.id);
          st.lastWalkGap = g.id;
          st.lastDashAt = now;
        } else if (isIdle && !greeting) {
          st.jig = { t0: now, spin: Math.random() < 0.5, spun: false };
          st.lastWalkGap = null;
          st.lastDashAt = now;
        }
      }
      if (st.jig) {
        const j = st.jig;
        const k = (now - j.t0) / JIG_MS;
        if (k >= 1 || !isIdle) {
          st.jig = null;
          c.waddle = 0;
        } else {
          c.waddle = 1;
          c.pose = k > 0.15 && k < 0.85 ? 'hi' : 'idle';
          c.face = Math.sin(k * Math.PI * 4) * 0.9;
          c.move = 0;
          if (j.spin && !j.spun && k > 0.5) {
            j.spun = true;
            c.jumpReq = true;
          }
          const sx = Math.max(0, Math.min(vw - w, spot.x + Math.sin(k * Math.PI * 4) * 10));
          const kk = 1 - Math.exp(-6 * dt);
          st.x += (sx - st.x) * kk;
          st.y += (spot.y - st.y) * kk;
          place();
          el.dataset.side = st.x > vw / 2 ? 'right' : 'left';
          say('');
          return;
        }
      }
      if (st.dash) {
        const d = st.dash;
        const k = (now - d.t0) / DASH_MS;
        const gTop = d.g.top - sy;
        const gBot = d.g.bottom - sy;
        if (k >= 1 || stage !== 'roam' || gBot < 20 || gTop > vh - 20) {
          if (k < 0.45) {
            st.lastDashAt = now - DASH_GAP_MS + 800;
            st.doneGaps.delete(d.g.id);
          }
          st.dash = null;
          c.waddle = 0;
        } else {
          const gapY = Math.max(8, Math.min(vh - h - 8, Math.max(gTop + 6, Math.min(gBot - h - 6, (gTop + gBot) / 2 - h / 2))));
          const inY = smooth(k / 0.12) * (1 - smooth((k - 0.88) / 0.12));
          const out = smooth((k - 0.1) / 0.32);
          const back = smooth((k - 0.6) / 0.3);
          const homeX = spot.x;
          const dir = homeX + w / 2 < vw / 2 ? 1 : -1;
          const farX = Math.max(4, Math.min(vw - w - 4, homeX + dir * Math.min(STROLL, vw * 0.4)));
          st.x = homeX + (farX - homeX) * (out - back);
          st.y = d.y0 + (gapY - d.y0) * inY;
          if (k > 0.12) d.y0 = spot.y;
          const going = k > 0.1 && k < 0.42 ? 1 : k > 0.6 && k < 0.9 ? -1 : 0;
          const atFar = k >= 0.42 && k <= 0.6;
          c.waddle = going ? 1 : atFar && d.trick === 'dance' ? 1 : 0;
          c.move = going * dir * 0.25;
          c.face = going ? going * dir * 1.4 : atFar ? -0.8 * dir : 0.4 * dir;
          if (!d.flipped && atFar) {
            d.flipped = true;
            if (d.trick === 'spin') c.jumpReq = true;
          }
          c.pose = atFar ? (d.trick === 'wave' ? 'bye' : d.trick === 'dance' ? 'hi' : 'idle') : 'idle';
          place();
          el.dataset.side = st.x > vw / 2 ? 'right' : 'left';
          say('');
          return;
        }
      }

      const crossing = Math.abs(spot.x - st.x) > vw * 0.25;
      if (crossing) stageAt = clock;
      const tx = spot.x;
      const ty = crossing ? vh - h - 14 : spot.y;
      c.face = st.x > vw / 2 ? (wide ? -1 : -0.6) : wide ? 1 : 0.6;
      if (crossing) {
        c.move = spot.x > st.x ? 0.8 : -0.8;
        c.face = spot.x > st.x ? 1.2 : -1.2;
      }

      const k = 1 - Math.exp(-(crossing ? 3.2 : 5) * dt);
      st.x += (tx - st.x) * k;
      st.y += (ty - st.y) * k;
      place();
      el.dataset.side = st.x > vw / 2 ? 'right' : 'left';
      say(greeting && !crossing ? stage : '');
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(measureTimer);
      cancelIdle(idleId);
      c.waddle = 0;
    };
  }, [box, ctlRef, contentWidth, jetpack]);

  if (failed) return null;

  const bubbleWidth = box.wide ? Math.max(110, box.gutter - 14) : 190;

  return (
    <>
      <canvas ref={trailRef} className="mascot__trail" aria-hidden="true" />
      <div ref={boxRef} className="mascot" style={{ width: box.w, '--bw': `${bubbleWidth}px` }}>
        <p className={`mascot__bubble${bubble.on ? ' is-on' : ''}`} aria-live="polite">
          {activeMessages[bubble.msg] || ''}
        </p>
        <div ref={bodyRef} className="mascot__body">
          <span className="mascot__flash" aria-hidden="true" />
          <Suspense fallback={null}>
            <RobotMascot
              size={box.w}
              accent={accent}
              jetpack={jetpack}
              jetColor={jetColor}
              control={ctlRef}
              className="mascot__robot"
            />
          </Suspense>
        </div>
      </div>
    </>
  );
}

