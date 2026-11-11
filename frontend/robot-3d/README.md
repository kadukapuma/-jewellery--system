# 🤖 3D Robot Mascot (Procedural Three.js)

An animated, interactive 3D robot mascot built completely with **Three.js**.

- **No external 3D model files required** (.glb / .gltf / .obj): All body parts, glossy materials, visor, glowing eyes, wheels, antenna, and jetpack thrusters are generated procedurally on-the-fly.
- **Transparent background**: Sits cleanly on top of any background color, card, or banner.
- **Interactive**: Tracks the user's mouse/pointer, waves on hover, jumps with a happy spin on click, and squints/blinks naturally.
- **Dual usage modes**:
  1. **Standalone 3D Widget (`<RobotMascot />`)**: Embed anywhere on your page (hero cards, headers, contact forms).
  2. **Screen Companion (`<Mascot />`)**: A floating assistant that roams the viewport, reacts to scroll speeds, waddles across page gaps, and delivers speech bubble greetings.
  3. **Vanilla JS Support (`mountRobot()`)**: Works in any framework (React, Vue, Svelte, Angular, Solid, Astro, or plain HTML/JS).

---

## 📁 Files Included in this Folder

| File | Purpose |
|------|---------|
| `RobotMascot.jsx` | Core React component for the standalone 3D Robot |
| `mountRobot.js` | Vanilla JS module to mount the robot in non-React environments |
| `Mascot.jsx` | Full-screen roaming companion that tracks scroll & greetings |
| `Mascot.css` | Styles, chat bubbles, tumble animations & particle trail for `Mascot.jsx` |
| `RobotDemo.jsx` | Interactive test playground with live controls & sliders |
| `index.js` | Clean barrel exports for the entire module |
| `package.json` | Dependency metadata (`three`, `react`) |

---

## 🚀 How to Add to Another Project

### 1. Copy the Folder
Copy this entire `robot-3d` folder into your new project's source directory, for example:
`src/components/robot-3d/` or `src/robot-3d/`.

### 2. Install Dependencies
The only 3D dependency required is **`three`**:

```bash
npm install three
```

*(If you are using React, ensure `react` and `react-dom` are installed as well).*

---

## 💻 Usage Examples

### Option A: Standalone 3D Robot Component (`RobotMascot`)

Place the 3D robot inside any container or card:

```jsx
import RobotMascot from './robot-3d/RobotMascot';

export default function HeroSection() {
  return (
    <div style={{ width: 350, margin: '0 auto' }}>
      <RobotMascot
        size={350}
        accent="#22e06b"
        interactive={true}
        jetpack={true}
      />
    </div>
  );
}
```

---

### Option B: Floating Screen Mascot Companion (`Mascot`)

Renders a floating companion that tracks scroll position along the margins, waves hello at the top of the page, waddles into gaps between sections, and says bye at the bottom:

```jsx
import Mascot from './robot-3d/Mascot';

export default function App() {
  return (
    <>
      <main>
        {/* Your website sections */}
      </main>
      <Mascot
        accent="#02ca96"
        jetpack={true}
        messages={{
          hi: 'Welcome to our website! 👋',
          bye: 'Thanks for visiting! 👋'
        }}
      />
    </>
  );
}
```

---

### Option C: Vanilla JavaScript / Non-React Project

Works in Vanilla JS, Webflow, Astro, Svelte, Vue, or HTML:

```html
<div id="robot-container" style="width: 320px; aspect-ratio: 1 / 1.08;"></div>

<script type="module">
  import { mountRobot } from './robot-3d/mountRobot.js';

  const container = document.getElementById('robot-container');
  const robot = mountRobot(container, {
    size: 320,
    accent: '#22e06b',
    interactive: true,
    shadow: true,
    jetpack: true,
  });

  // When unmounting or changing pages:
  // robot.dispose();
</script>
```

---

### Option D: Interactive Playground Component (`RobotDemo`)

Import `RobotDemo` to test all poses, jetpack flames, jump animations, and color schemes in real time:

```jsx
import RobotDemo from './robot-3d/RobotDemo';

export default function DemoPage() {
  return <RobotDemo />;
}
```

---

## ⚙️ Component Props (`<RobotMascot />`)

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `size` | `number` | `360` | Width in pixels (height scales at `1:1.08` automatically). |
| `accent` | `string` | `"#22e06b"` | CSS hex color for glowing eyes, visor rim, and antenna bulb. |
| `interactive` | `boolean` | `true` | Enables head/eye mouse-tracking, wave on hover, jump on click. |
| `shadow` | `boolean` | `true` | Renders a soft ground contact shadow beneath wheels. |
| `autoWave` | `boolean` | `true` | Periodically waves at the user when standing idle. |
| `jetpack` | `boolean` | `false` | Mounts dual thrusters to the robot's back. |
| `jetColor` | `string` | `"#058875"` | CSS hex color for the jetpack thruster casing. |
| `control` | `React.Ref` | `null` | Ref object to control poses, leaning, flying, and walking. |
| `className` | `string` | `undefined` | CSS class for the wrapper `div`. |
| `style` | `object` | `undefined` | Inline styles for the wrapper `div`. |

---

## 🎮 Programmatic Control API (`control` Ref)

Pass a ref to `control` to command the robot in real-time from anywhere in your app:

```jsx
import { useRef } from 'react';
import RobotMascot from './robot-3d/RobotMascot';

function ControllerExample() {
  const robotRef = useRef({
    pose: 'idle', // 'idle' | 'hi' (both hands up) | 'bye' (waving)
    move: 0,      // -1..1 (leans and spins wheels)
    face: 0,      // -1..1 (turns body left / right)
    jumpReq: false,// set true to trigger a happy jump with spin
    fly: 0,       // 0..1 (superhero flying pose with jet flames)
    flyDir: 1,    // 1 for right, -1 for left
    waddle: 0,    // 0..1 (funny rocking walk)
    jetpack: 1,   // 1 to wear, 0 to drop off
    thrust: 0,    // 0..1.5 (jet flame intensity)
  });

  return (
    <div>
      <RobotMascot control={robotRef} jetpack={true} />
      <button onClick={() => { robotRef.current.jumpReq = true; }}>
        Jump!
      </button>
      <button onClick={() => { robotRef.current.pose = 'hi'; }}>
        Say Hi!
      </button>
    </div>
  );
}
```

---

## 💡 Customization Tips

1. **Brand Colors**: Set `accent` to your brand's primary color (e.g., `#3b82f6` for blue, `#ec4899` for pink, `#eab308` for yellow). The robot will automatically calculate highlights, reflections, and glow halos based on your accent color.
2. **Reduced Motion**: Respects `prefers-reduced-motion: reduce` automatically by damping animations for sensitive users.
3. **Hardware Acceleration**: Detects WebGL 2 support gracefully. If a client device lacks WebGL 2, it silently degrades without throwing errors or breaking your page layout.

