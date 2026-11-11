/**
 * RobotMascot — animated 3D robot for React powered by Three.js.
 *
 * Usage:   <RobotMascot size={360} accent="#22e06b" />
 *
 * Props:
 *   size         width in px (height follows automatically). Use style/className to size it yourself instead.
 *   accent       glow colour for eyes, visor rim and antenna (any CSS hex colour, e.g. "#22e06b")
 *   interactive  follow the mouse, wave on hover, jump on click (default: true)
 *   shadow       soft contact shadow under the wheels (default: true)
 *   autoWave     wave by itself every few seconds (default: true)
 *   jetpack      build a jetpack on its back (default: false); see control.jetpack / thrust
 *   jetColor     colour of the jetpack thrusters (any CSS hex colour, default: "#058875")
 *   control      optional ref to an object the page writes to every frame:
 *                  pose     'idle' | 'hi' (both hands up) | 'bye' (waving)
 *                  move     -1..1, leans and spins the wheels (e.g. scroll speed)
 *                  face     -1..1, turns the body left / right
 *                  jumpReq  set true to make it do a happy jump with a spin
 *                  fly      0..1, superhero flying pose: tilts head-first, arms forward,
 *                           jet flames trailing behind (use with face = ±2.3 to fly sideways)
 *                  flyDir   -1 flying left, 1 flying right
 *                  roll     extra spin (radians) about the screen axis, e.g. a mid-air somersault
 *                  waddle   0..1, a funny slow walk: body rocks, head shakes, steps bounce, arms swing
 *                  jetpack  1: wearing the jetpack, 0: take it off (it drops away)
 *                  thrust   0..1.5, how strongly the jet flames burn (above 1: boost)
 *                  hidden   true: draw one frame, then pause until it is false
 *                  ready    set by the robot once its shaders are compiled and
 *                           its first frame is drawn (safe to show without a hitch)
 *                  failed   set to true if WebGL 2 is not supported on this device
 *   className    CSS class for wrapper
 *   style        inline styles for wrapper
 *
 * The background is transparent, so it sits cleanly on top of any section of your site.
 */
import { useEffect, useRef, useState } from "react";
// Named imports, so the build keeps only the parts of three.js the robot uses.
import {
  ACESFilmicToneMapping, AdditiveBlending, BoxGeometry, CanvasTexture, CircleGeometry, Clock, Color,
  CylinderGeometry, DirectionalLight, DoubleSide, Group, HemisphereLight, Mesh, MeshBasicMaterial,
  MeshPhysicalMaterial, PMREMGenerator, PerspectiveCamera, PlaneGeometry, PointLight, SRGBColorSpace,
  Scene, SphereGeometry, Sprite, SpriteMaterial, TorusGeometry, WebGLRenderer, ConeGeometry,
} from "three";

const THREE = {
  ACESFilmicToneMapping, AdditiveBlending, BoxGeometry, CanvasTexture, CircleGeometry, Clock, Color,
  CylinderGeometry, DirectionalLight, DoubleSide, Group, HemisphereLight, Mesh, MeshBasicMaterial,
  MeshPhysicalMaterial, PMREMGenerator, PerspectiveCamera, PlaneGeometry, PointLight, SRGBColorSpace,
  Scene, SphereGeometry, Sprite, SpriteMaterial, TorusGeometry, WebGLRenderer, ConeGeometry,
};

// three.js needs WebGL 2. Some computers (old graphics drivers, remote desktops,
// hardware acceleration switched off) don't have it.
let webglOk = null;
function hasWebGL2() {
  if (webglOk === null) {
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2");
      webglOk = !!gl;
      if (gl) gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      webglOk = false;
    }
  }
  return webglOk;
}

// Weak / older PCs and most phones: fewer pixels and frames, so the robot never slows the till down.
function isLowEnd() {
  const nav = typeof navigator !== "undefined" ? navigator : {};
  const cores = nav.hardwareConcurrency || 4;
  const memory = nav.deviceMemory || 4; // GB, Chrome/Edge only
  const touch = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  return cores <= 4 || memory <= 4 || touch;
}

// Shown instead of the 3D robot when WebGL is not available, so it can still be clicked.
function FlatRobot({ accent }) {
  return (
    <svg viewBox="0 0 100 108" width="100%" height="100%" aria-hidden="true" style={{ display: "block" }}>
      <ellipse cx="50" cy="103" rx="24" ry="3.5" fill="#000" opacity="0.12" />
      <line x1="50" y1="10" x2="50" y2="20" stroke="#0c0f0d" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="50" cy="8" r="4.5" fill={accent} />
      <rect x="18" y="20" width="64" height="48" rx="20" fill="#f3f6f4" stroke="#d5e2dc" strokeWidth="1.5" />
      <rect x="25" y="28" width="50" height="30" rx="13" fill="#0c0f0d" />
      <rect x="35" y="37" width="8" height="12" rx="4" fill={accent} />
      <rect x="57" y="37" width="8" height="12" rx="4" fill={accent} />
      <rect x="30" y="70" width="40" height="24" rx="10" fill="#f3f6f4" stroke="#d5e2dc" strokeWidth="1.5" />
      <circle cx="50" cy="82" r="4" fill={accent} opacity="0.85" />
    </svg>
  );
}

export default function RobotMascot({
  size = 360,
  accent = "#22e06b",
  interactive = true,
  shadow = true,
  autoWave = true,
  jetpack = false,
  jetColor = "#058875",
  control,
  className,
  style,
}) {
  const holder = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!holder.current || failed) return undefined;
    const robot = startRobot(holder.current, {
      accent, interactive, shadow, autoWave, jetpack, jetColor, control: control && control.current,
      onFail: () => setFailed(true),
    });
    if (!robot) setFailed(true);
    return () => robot && robot.dispose();
  }, [accent, interactive, shadow, autoWave, jetpack, jetColor, control, failed]);

  return (
    <div
      ref={holder}
      className={className}
      role="img"
      aria-label="Animated robot mascot"
      style={{ width: size, maxWidth: "100%", aspectRatio: "1 / 1.08", ...style }}
    >
      {failed && <FlatRobot accent={accent} />}
    </div>
  );
}

/* If 3D can't run on this device, report it (control.failed) and show nothing,
 * instead of throwing and taking the whole page down. */
function startRobot(container, options) {
  if (hasWebGL2()) {
    try {
      return mountRobot(container, options);
    } catch (err) {
      console.warn("RobotMascot: 3D is not available here.", err);
      container.querySelectorAll("canvas").forEach((c) => c.remove());
    }
  }
  if (options.control) options.control.failed = true;
  return null;
}

/* ------------------------------------------------------------------ *
 * mountRobot(container, options)
 * Builds the robot from basic shapes (no external 3D model file required),
 * animates it, and returns { dispose } for cleanup.
 * ------------------------------------------------------------------ */
function mountRobot(container, options) {
  const opts = Object.assign(
    { accent: "#22e06b", interactive: true, shadow: true, autoWave: true, jetpack: false, jetColor: "#058875", control: null },
    options || {}
  );
  const ctl = opts.control || {};
  const reduceMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- renderer ---------- */
  const lowEnd = isLowEnd();
  const MAX_DPR = lowEnd ? 1.25 : 1.75;
  // 30 fps is plenty for a mascot and halves the GPU work of a 60 Hz (or 120 Hz) screen.
  const FRAME_MS = 1000 / (lowEnd ? 24 : 30);
  const renderer = new THREE.WebGLRenderer({ antialias: !lowEnd, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.style.cssText = "display:block;width:100%;height:100%;outline:none";
  if (opts.interactive) canvas.style.cursor = "pointer";
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  const disposables = [];
  const track = (x) => (disposables.push(x), x);

  /* ---------- colours ---------- */
  const accent = new THREE.Color(opts.accent);
  const accentBright = accent.clone().lerp(new THREE.Color("#ffffff"), 0.35);

  /* ---------- studio reflections (gives the glossy toy look) ---------- */
  const envTarget = (function makeEnv() {
    const s = new THREE.Scene();
    const geos = [];
    const mats = [];
    const add = (geo, color, intensity, pos) => {
      const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
      mat.color.multiplyScalar(intensity);
      const m = new THREE.Mesh(geo, mat);
      if (pos) { m.position.set(pos[0], pos[1], pos[2]); m.lookAt(0, 0, 0); }
      geos.push(geo); mats.push(mat); s.add(m);
    };
    add(new THREE.BoxGeometry(24, 24, 24), 0x3a4040, 1);
    add(new THREE.PlaneGeometry(10, 10), 0xffffff, 7, [0, 11, 2]);
    add(new THREE.PlaneGeometry(5, 9), 0xffffff, 5, [-11, 4, 5]);
    add(new THREE.PlaneGeometry(3, 7), 0xffffff, 3.5, [11, 3, 4]);
    add(new THREE.PlaneGeometry(7, 3), 0xffffff, 2, [0, 5, 11]);
    add(new THREE.PlaneGeometry(9, 9), accent.getHex(), 1.6, [0, -11, 0]);
    add(new THREE.PlaneGeometry(6, 8), accent.getHex(), 0.9, [4, 3, -11]);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromScene(s, 0.03);
    pmrem.dispose();
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
    return rt;
  })();
  scene.environment = envTarget.texture;

  /* ---------- lights ---------- */
  scene.add(new THREE.HemisphereLight(0xffffff, 0x1b2a22, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(-3, 7, 6);
  scene.add(key);
  const rim = new THREE.PointLight(accent.getHex(), 40, 14);
  rim.position.set(3, 4, -4);
  scene.add(rim);

  /* ---------- materials ---------- */
  const white = track(new THREE.MeshPhysicalMaterial({
    color: 0xf3f6f4, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.14,
  }));
  const black = track(new THREE.MeshPhysicalMaterial({
    color: 0x0c0f0d, roughness: 0.3, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.12,
  }));
  const glass = track(new THREE.MeshPhysicalMaterial({
    color: 0x040706, roughness: 0.06, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03,
  }));
  const glowMat = track(new THREE.MeshBasicMaterial({ color: accentBright, toneMapped: false }));
  const bulbMat = track(new THREE.MeshBasicMaterial({ color: accent.clone().lerp(new THREE.Color("#ffffff"), 0.18), toneMapped: false }));
  const rimMat = track(new THREE.MeshBasicMaterial({ color: accent, toneMapped: false }));

  /* ---------- textures made on the fly ---------- */
  function radialTexture(stops) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    stops.forEach((s) => grad.addColorStop(s[0], s[1]));
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const t = track(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const haloTex = radialTexture([
    [0, "rgba(255,255,255,0.9)"], [0.25, "rgba(255,255,255,0.35)"],
    [0.6, "rgba(255,255,255,0.08)"], [1, "rgba(255,255,255,0)"],
  ]);
  const eyeTex = radialTexture([
    [0, "#ffffff"], [0.35, "#" + accentBright.getHexString()],
    [0.8, "#" + accent.getHexString()], [1, "#" + accent.getHexString()],
  ]);
  const eyeMat = track(new THREE.MeshBasicMaterial({ map: eyeTex, toneMapped: false }));

  function halo(size, opacity) {
    const m = track(new THREE.SpriteMaterial({
      map: haloTex, color: accent, transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const s = new THREE.Sprite(m);
    s.scale.setScalar(size);
    return s;
  }

  /* ---------- small helpers ---------- */
  const geo = (g) => track(g);
  const mesh = (g, m, x, y, z) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x || 0, y || 0, z || 0);
    return o;
  };
  const sphereGeo = geo(new THREE.SphereGeometry(1, 48, 32));
  const ball = (m, r, x, y, z, sx, sy, sz) => {
    const o = mesh(sphereGeo, m, x, y, z);
    o.scale.set(r * (sx || 1), r * (sy || 1), r * (sz || 1));
    return o;
  };

  /* A rounded-rectangle patch wrapped onto a sphere: the visor. */
  function visorGeometry(R, halfYaw, halfPitch, pitch0, seg) {
    const g = new THREE.PlaneGeometry(2, 2, seg, seg);
    const p = g.attributes.position;
    const n = 4.2; // higher = squarer corners
    for (let i = 0; i < p.count; i++) {
      let u = p.getX(i), v = p.getY(i);
      const m = Math.max(Math.abs(u), Math.abs(v));
      if (m > 1e-6) {
        const s = m / Math.pow(Math.pow(Math.abs(u), n) + Math.pow(Math.abs(v), n), 1 / n);
        u *= s; v *= s;
      }
      const yaw = u * halfYaw, pitch = pitch0 + v * halfPitch;
      p.setXYZ(i,
        R * Math.sin(yaw) * Math.cos(pitch),
        R * Math.sin(pitch),
        R * Math.cos(yaw) * Math.cos(pitch));
    }
    g.computeVertexNormals();
    return geo(g);
  }
  function placeOnSphere(o, R, yaw, pitch) {
    o.position.set(
      R * Math.sin(yaw) * Math.cos(pitch),
      R * Math.sin(pitch),
      R * Math.cos(yaw) * Math.cos(pitch));
    o.rotation.set(-pitch, yaw, 0, "YXZ");
  }

  /* ================== BUILD THE ROBOT ================== */
  // The pivot tilts the whole robot about its middle (flying head-first);
  // root does everything else and has its feet at y = 0.
  const PIVOT_Y = 2.4;
  const pivot = new THREE.Group();
  pivot.position.y = PIVOT_Y;
  scene.add(pivot);
  const root = new THREE.Group();
  root.position.y = -PIVOT_Y;
  pivot.add(root);

  /* ---- wheels + lower body ---- */
  const WHEEL_R = 0.5;
  const tyreGeo = geo(new THREE.TorusGeometry(0.3, 0.2, 24, 48));
  const hubGeo = geo(new THREE.CylinderGeometry(0.25, 0.25, 0.3, 32));
  const dotGeo = geo(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 12));
  const wheels = [-1, 1].map((side) => {
    const w = new THREE.Group();
    w.position.set(side * 0.7, WHEEL_R, 0);
    const tyre = mesh(tyreGeo, black);
    tyre.rotation.y = Math.PI / 2;
    tyre.scale.z = 1.25;
    const hub = mesh(hubGeo, black);
    hub.rotation.z = Math.PI / 2;
    w.add(tyre, hub);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const d = mesh(dotGeo, rimMat, side * 0.16, Math.cos(a) * 0.13, Math.sin(a) * 0.13);
      d.rotation.z = Math.PI / 2;
      w.add(d);
    }
    root.add(w);
    return w;
  });
  root.add(ball(white, 0.6, 0, 0.63, 0, 1, 0.95, 0.98));
  root.add(ball(black, 0.4, 0, 1.2, 0, 1, 0.55, 1));

  /* ---- upper body (sways from the waist) ---- */
  const upper = new THREE.Group();
  upper.position.y = 1.2;
  root.add(upper);
  upper.add(ball(white, 0.74, 0, 0.62, 0, 1, 1.02, 0.9));
  upper.add(mesh(geo(new THREE.CylinderGeometry(0.3, 0.34, 0.3, 32)), black, 0, 1.36, 0));

  const chest = mesh(geo(new THREE.CircleGeometry(0.055, 24)), glowMat);
  chest.position.set(0, 0.78, 0.655);
  chest.rotation.x = -0.22;
  upper.add(chest);

  /* ---- arms ---- */
  const fingerGeo = sphereGeo;
  const arms = [-1, 1].map((side) => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.82, 0.96, 0);
    arm.add(ball(black, 0.25, 0, 0, 0));
    arm.add(ball(white, 0.27, 0, -0.52, 0, 1, 1.45, 1));
    arm.add(ball(black, 0.13, 0, -0.93, 0, 1, 0.6, 1));
    arm.add(ball(black, 0.19, 0, -1.11, 0, 0.95, 1.2, 0.8));
    const thumb = mesh(fingerGeo, black, -side * 0.15, -1.08, 0.04);
    thumb.scale.set(0.06, 0.13, 0.07);
    thumb.rotation.z = -side * 0.7;
    arm.add(thumb);
    upper.add(arm);
    return arm;
  });

  /* ---- head ---- */
  const HEAD_R = 1.05;
  const head = new THREE.Group();
  head.position.y = 1.45;
  upper.add(head);
  const skull = new THREE.Group();          // squashed a little, like the reference
  skull.position.y = 0.9;
  skull.scale.set(1, 0.92, 0.96);
  head.add(skull);
  skull.add(ball(white, HEAD_R, 0, 0, 0));
  skull.add(mesh(visorGeometry(HEAD_R * 1.004, 0.86, 0.56, -0.06, 56), rimMat));
  skull.add(mesh(visorGeometry(HEAD_R * 1.012, 0.80, 0.50, -0.06, 56), glass));

  const eyeGeo = geo(new THREE.CircleGeometry(0.185, 40));
  const eyeHaloGeo = geo(new THREE.CircleGeometry(0.46, 40));
  const EYE_YAW = 0.3, EYE_PITCH = -0.08;
  const eyes = [-1, 1].map((side) => {
    const e = new THREE.Group();
    e.add(mesh(eyeGeo, eyeMat));
    const h = mesh(eyeHaloGeo, track(new THREE.MeshBasicMaterial({
      map: haloTex, color: accent, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    })));
    h.position.z = 0.012;
    e.add(h);
    skull.add(e);
    return { group: e, side, halo: h };
  });

  const earGeo = geo(new THREE.CylinderGeometry(0.3, 0.3, 0.22, 36));
  [-1, 1].forEach((side) => {
    const ear = mesh(earGeo, black, side * HEAD_R * 0.98, 0.9, 0);
    ear.rotation.z = Math.PI / 2;
    head.add(ear);
  });

  /* ---- antenna ---- */
  const antenna = new THREE.Group();
  antenna.position.y = 0.9 + HEAD_R * 0.92 - 0.03;
  head.add(antenna);
  antenna.add(ball(black, 0.16, 0, 0, 0, 1, 0.45, 1));
  antenna.add(mesh(geo(new THREE.CylinderGeometry(0.04, 0.05, 0.5, 16)), black, 0, 0.27, 0));
  const bulb = ball(bulbMat, 0.16, 0, 0.6, 0);
  const bulbHalo = halo(1.5, 0.8);
  bulbHalo.position.y = 0.6;
  antenna.add(bulb, bulbHalo);

  /* ---- jetpack: two thrusters strapped to the back, with flames ---- */
  // ctl.jetpack (0/1) puts it on or drops it off; ctl.thrust (0..1) lights the flames.
  const JET = { y: 0.72, z: -0.66 };
  let jet = null;
  const flames = [];
  if (opts.jetpack) {
    jet = new THREE.Group();
    jet.position.set(0, JET.y, JET.z);
    upper.add(jet);
    const jetMat = track(new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(opts.jetColor), roughness: 0.28, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1,
    }));
    jet.add(mesh(geo(new THREE.BoxGeometry(0.9, 0.8, 0.16)), black, 0, 0.02, 0.02)); // back plate
    const bodyGeo = geo(new THREE.CylinderGeometry(0.23, 0.23, 0.9, 28));
    const capGeo = geo(new THREE.SphereGeometry(0.23, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2));
    const bandGeo = geo(new THREE.CylinderGeometry(0.237, 0.237, 0.07, 28));
    const nozzleGeo = geo(new THREE.CylinderGeometry(0.17, 0.25, 0.22, 28, 1, true));
    const outerGeo = geo(new THREE.ConeGeometry(0.22, 1, 20, 1, true));
    const innerGeo = geo(new THREE.ConeGeometry(0.12, 1, 16, 1, true));
    const wideGeo = geo(new THREE.ConeGeometry(0.31, 1, 20, 1, true));
    // solid (not additive) flames, so they read clearly on a white page
    const flameMat = (color, opacity) => track(new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false,
    }));
    const outerMat = flameMat(0x02ca96, 0.75); // emerald
    const innerMat = flameMat(0xe4ffb8, 0.9); // pale lime-white core
    const wideMat = flameMat(0x058875, 0.45); // the wide, soft teal outer flame
    const glowMatJet = track(new THREE.SpriteMaterial({
      map: haloTex, color: 0x93dc2c, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    [-1, 1].forEach((side) => {
      const tube = new THREE.Group();
      tube.position.set(side * 0.33, 0, -0.22);
      tube.add(mesh(bodyGeo, jetMat));
      tube.add(mesh(capGeo, jetMat, 0, 0.45, 0));
      tube.add(mesh(bandGeo, rimMat, 0, 0.18, 0));
      tube.add(mesh(nozzleGeo, black, 0, -0.56, 0));
      // the flame hangs below the nozzle; its tip points down (behind it in flight)
      const flame = new THREE.Group();
      flame.position.y = -0.67;
      const outer = mesh(outerGeo, outerMat, 0, -0.5, 0);
      outer.rotation.x = Math.PI;
      const inner = mesh(innerGeo, innerMat, 0, -0.5, 0);
      inner.rotation.x = Math.PI;
      // three layers, drawn back to front: soft teal outer, emerald, pale lime core
      const wide = mesh(wideGeo, wideMat, 0, -0.62, 0);
      wide.rotation.x = Math.PI;
      wide.scale.y = 1.25;
      outer.renderOrder = 1;
      inner.renderOrder = 2;
      const glow = new THREE.Sprite(glowMatJet);
      glow.scale.setScalar(0.9);
      flame.add(wide, outer, inner, glow);
      // kept "visible" but shrunk to nothing, so it is compiled up front with the rest (no hitch at take-off)
      flame.scale.setScalar(0.0001);
      tube.add(flame);
      jet.add(tube);
      flames.push(flame);
    });
  }
  let packAmt = ctl.jetpack ? 1 : 0;
  let thrust = 0;
  function updateJet(dt, t) {
    packAmt = damp(packAmt, ctl.jetpack ? 1 : 0, 3.2, dt);
    // taking it off: it unclips, tips back and drops away while shrinking out of sight
    const drop = 1 - packAmt;
    jet.visible = packAmt > 0.02;
    jet.position.set(0, JET.y - drop * 1.7, JET.z - drop * 0.9);
    jet.rotation.x = drop * 1.4;
    jet.scale.setScalar(Math.max(0.001, 1 - drop * drop));
    thrust = damp(thrust, ctl.jetpack ? ctl.thrust || 0 : 0, 9, dt);
    flames.forEach((f, n) => {
      const flicker = 0.82 + 0.18 * Math.sin(t * 47 + n * 2.1) + 0.12 * Math.sin(t * 83 + n);
      const on = thrust > 0.03 ? 1 : 0.0001;
      f.scale.set((0.8 + 0.3 * thrust) * on, Math.max(0.0001, thrust * (1.05 + 0.6 * thrust) * flicker * on), (0.8 + 0.3 * thrust) * on);
    });
  }

  /* ---- soft contact shadow ---- */
  let shadow = null;
  if (opts.shadow) {
    const tex = radialTexture([
      [0, "rgba(0,0,0,0.42)"], [0.45, "rgba(0,0,0,0.18)"], [1, "rgba(0,0,0,0)"],
    ]);
    shadow = mesh(geo(new THREE.PlaneGeometry(3.6, 2.4)),
      track(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.005;
    scene.add(shadow);
  }

  /* ---------- sizing ---------- */
  // HALF_H leaves head-room for the arms when both hands go up.
  const CENTER_Y = 2.75, HALF_H = 3.15, HALF_W = 2.15;
  function resize() {
    const w = container.clientWidth || 300, h = container.clientHeight || 300;
    // the pixel density can change (window moved to another monitor, browser zoom)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const t = Math.tan((camera.fov * Math.PI) / 360);
    const dist = Math.max(HALF_H / t, HALF_W / (t * camera.aspect));
    camera.position.set(0, CENTER_Y + dist * 0.07, dist);
    camera.lookAt(0, CENTER_Y, 0);
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(container);
  window.addEventListener("resize", resize);

  /* ---------- interaction ---------- */
  const pointer = { tx: 0, ty: 0, x: 0, y: 0 };
  let waveUntil = 0, jumpStart = -10, now = 0;
  function onMove(e) {
    const r = container.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height * 0.35;
    pointer.tx = Math.max(-1, Math.min(1, (e.clientX - cx) / (window.innerWidth * 0.5)));
    pointer.ty = Math.max(-1, Math.min(1, (e.clientY - cy) / (window.innerHeight * 0.5)));
  }
  const onEnter = () => { waveUntil = now + 1.8; };
  const onClick = () => { if (now - jumpStart > 0.9) jumpStart = now; };
  if (opts.interactive) {
    window.addEventListener("pointermove", onMove, { passive: true });
    canvas.addEventListener("pointerenter", onEnter);
    canvas.addEventListener("click", onClick);
  }

  let visible = true;
  const io = typeof IntersectionObserver !== "undefined"
    ? new IntersectionObserver((en) => { visible = en[0].isIntersecting; })
    : null;
  if (io) io.observe(container);

  // The graphics driver can drop the 3D context (sleep, driver update, too many tabs).
  // Stop drawing and fall back to the flat robot instead of leaving a blank box.
  let lost = false;
  const onLost = (e) => {
    e.preventDefault();
    lost = true;
    if (opts.onFail) opts.onFail();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  /* ---------- animation loop ---------- */
  const clock = new THREE.Clock();
  let raf = 0, nextBlink = 2, blinkStart = -10, nextWave = 5;
  const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
  const mix = (a, b, k) => a + (b - a) * k;
  let armWave = 0;
  let hiAmt = 0, byeAmt = 0, lean = 0, face = 0, roll = 0, flyAmt = 0, wadAmt = 0;

  // Compile the shaders up front (off the main thread where the browser allows it),
  // so the robot never freezes the page the moment it first appears.
  let compiled = false;
  let drawn = false;
  const onCompiled = () => { compiled = true; };
  if (renderer.compileAsync) renderer.compileAsync(scene, camera).then(onCompiled, onCompiled);
  else onCompiled();

  let lastFrame = -Infinity;
  function frame(ts = 0) {
    if (lost) return;
    raf = requestAnimationFrame(frame);
    // always draw the first frame (even off-screen), so "ready" can be reported
    if (!compiled || (drawn && (!visible || document.hidden || ctl.hidden))) { clock.getDelta(); return; }
    if (drawn && ts - lastFrame < FRAME_MS - 1) return; // frame-rate cap
    lastFrame = ts;
    const dt = Math.min(clock.getDelta(), 0.05);
    now += dt;
    const idle = reduceMotion ? 0 : 1;
    const t = now;

    /* what the page wants right now */
    const pose = ctl.pose || "idle";
    hiAmt = damp(hiAmt, pose === "hi" ? 1 : 0, 6, dt);
    byeAmt = damp(byeAmt, pose === "bye" ? 1 : 0, 6, dt);
    lean = damp(lean, Math.max(-1, Math.min(1, ctl.move || 0)), 6, dt);
    face = damp(face, ctl.face || 0, 4, dt);
    flyAmt = damp(flyAmt, ctl.fly || 0, 6, dt);
    wadAmt = damp(wadAmt, ctl.waddle || 0, 8, dt);
    const stepPh = t * 7; // walking rhythm: slow and lazy
    const rock = Math.sin(stepPh) * wadAmt * idle;
    roll += lean * dt * 9 * idle;
    if (ctl.jumpReq) { ctl.jumpReq = false; if (now - jumpStart > 0.9 && !reduceMotion) jumpStart = now; }

    pointer.x = damp(pointer.x, pointer.tx, 5, dt);
    pointer.y = damp(pointer.y, pointer.ty, 5, dt);

    /* roll gently back and forth on the wheels */
    const rollX = Math.sin(t * 0.7) * 0.14 * idle;
    root.position.x = rollX;
    wheels.forEach((w) => { w.rotation.x = rollX / WHEEL_R + roll; });

    /* click = happy jump with a spin */
    const j = (now - jumpStart) / 0.75;
    let jumpY = 0, spin = 0, happy = 0;
    if (j >= 0 && j < 1 && !reduceMotion) {
      jumpY = Math.sin(j * Math.PI) * 0.42;
      const e = j < 0.5 ? 2 * j * j : 1 - Math.pow(-2 * j + 2, 2) / 2;
      spin = e * Math.PI * 2;
      happy = Math.sin(j * Math.PI);
    }
    happy = Math.max(happy, hiAmt * 0.6, byeAmt * 0.35);
    root.position.y = jumpY - PIVOT_Y + Math.abs(rock) * 0.16; // bouncy steps
    // flying: tip over head-first in the direction of travel, a little smaller so it stays in frame
    pivot.rotation.z = -(ctl.flyDir || 1) * flyAmt * 1.0 + (ctl.roll || 0);
    pivot.scale.setScalar(1 - 0.22 * flyAmt);
    root.rotation.y = pointer.x * 0.14 + spin + face * 0.45;
    // lean into the scroll like it is riding along, with a little wobble
    root.rotation.x = Math.abs(lean) * 0.12;
    root.rotation.z = -lean * 0.16 + Math.sin(t * 9) * Math.abs(lean) * 0.05 * idle;

    /* body + head */
    upper.rotation.z = Math.sin(t * 1.1) * 0.025 * idle - pointer.x * 0.03;
    upper.rotation.x = Math.sin(t * 0.9 + 1) * 0.02 * idle;
    upper.position.y = 1.2 + Math.sin(t * 2.2) * 0.025 * idle;
    head.rotation.y = pointer.x * 0.36;
    head.rotation.x = pointer.y * 0.28 + Math.sin(t * 1.3) * 0.02 * idle;
    head.rotation.z = Math.sin(t * 0.8) * 0.045 * idle - pointer.x * 0.05 + byeAmt * 0.16;
    head.position.y = 1.45 + Math.sin(t * 2.2 - 0.6) * 0.03 * idle;

    /* antenna wobble + pulse */
    antenna.rotation.z = Math.sin(t * 2.6) * 0.07 * idle - head.rotation.z * 1.5 + lean * 0.3;
    const pulse = 0.85 + Math.sin(t * 3) * 0.15 * idle + happy * 0.4;
    bulbHalo.scale.setScalar(1.5 * pulse);
    bulb.scale.setScalar(0.16 * (0.95 + 0.08 * pulse));
    chest.scale.setScalar(0.8 + 0.3 * pulse);

    /* eyes: follow, blink, squint when happy */
    if (now > nextBlink && !reduceMotion) { blinkStart = now; nextBlink = now + 2.2 + Math.random() * 3.5; }
    const b = (now - blinkStart) / 0.16;
    let lid = b >= 0 && b < 1 ? 1 - Math.sin(b * Math.PI) * 0.92 : 1;
    lid *= 1 - happy * 0.5;
    eyes.forEach((e) => {
      placeOnSphere(e.group, HEAD_R * 1.022,
        e.side * EYE_YAW + pointer.x * 0.1, EYE_PITCH - pointer.y * 0.07);
      e.group.scale.set(1 + happy * 0.12, lid, 1);
      e.halo.material.opacity = 0.75 * lid;
    });

    /* arms: idle swing, wave on hover / every so often */
    if (opts.autoWave && pose === "idle" && now > nextWave && !reduceMotion) { waveUntil = now + 1.8; nextWave = now + 9 + Math.random() * 5; }
    armWave = damp(armWave, now < waveUntil || happy > 0.05 || pose === "bye" ? 1 : 0, 7, dt);
    const swing = Math.sin(t * 2.2) * 0.07 * idle;
    arms[0].rotation.z = -0.24 - swing * 0.5 - happy * 1.2;
    arms[0].rotation.x = swing;
    arms[1].rotation.z = 0.24 + swing * 0.5 + armWave * (2.25 + Math.sin(t * 11) * 0.3);
    arms[1].rotation.x = -swing * (1 - armWave);
    /* "hi": both hands up, waving */
    const cheer = Math.sin(t * 10) * 0.22 * idle;
    arms[0].rotation.z = mix(arms[0].rotation.z, -2.55 - cheer, hiAmt);
    arms[1].rotation.z = mix(arms[1].rotation.z, 2.55 + cheer, hiAmt);
    arms[0].rotation.x = mix(arms[0].rotation.x, 0, hiAmt);
    arms[1].rotation.x = mix(arms[1].rotation.x, 0, hiAmt);
    /* waddling: the body rocks side to side, head shakes, arms swing in turn */
    if (wadAmt > 0.01) {
      upper.rotation.z += rock * 0.16;
      head.rotation.z -= rock * 0.12;
      head.rotation.y += Math.sin(t * 5.5) * 0.42 * wadAmt * idle; // shakes its head side to side
      arms[0].rotation.x += rock * 0.7;
      arms[1].rotation.x -= rock * 0.7;
    }
    /* flying: both arms stretched forward, superhero style */
    arms.forEach((arm, n) => {
      arm.rotation.x = mix(arm.rotation.x, -2.75 + (n ? 0.12 : 0), flyAmt);
      arm.rotation.z = mix(arm.rotation.z, (n ? 1 : -1) * 0.12, flyAmt);
    });
    if (jet) updateJet(dt, t);

    if (shadow) {
      shadow.position.x = rollX;
      const s = 1 - jumpY * 0.35;
      shadow.scale.set(s, s, 1);
      shadow.material.opacity = (1 - jumpY * 0.6) * (1 - flyAmt);
    }
    renderer.render(scene, camera);
    if (!drawn) { drawn = true; ctl.ready = true; }
  }
  frame();

  /* ---------- cleanup ---------- */
  return {
    dispose() {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      window.removeEventListener("resize", resize);
      if (io) io.disconnect();
      window.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerenter", onEnter);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("webglcontextlost", onLost);
      disposables.forEach((d) => d.dispose && d.dispose());
      envTarget.dispose();
      renderer.dispose();
      renderer.forceContextLoss(); // free GPU context immediately
      if (canvas.parentNode === container) container.removeChild(canvas);
    },
  };
}
