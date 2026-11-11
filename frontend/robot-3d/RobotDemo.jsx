import { useState, useRef } from 'react';
import RobotMascot from './RobotMascot';
import Mascot from './Mascot';

export default function RobotDemo() {
  const [accent, setAccent] = useState('#22e06b');
  const [size, setSize] = useState(320);
  const [jetpack, setJetpack] = useState(true);
  const jetColor = '#058875';
  const [shadow, setShadow] = useState(true);
  const [interactive, setInteractive] = useState(true);
  const [showFloatingCompanion, setShowFloatingCompanion] = useState(false);

  const controlRef = useRef({
    pose: 'idle',
    move: 0,
    face: 0,
    jumpReq: false,
    fly: 0,
    flyDir: 1,
    waddle: 0,
    thrust: 0,
    jetpack: 1,
  });

  const triggerJump = () => {
    controlRef.current.jumpReq = true;
  };

  const setPose = (pose) => {
    controlRef.current.pose = pose;
    controlRef.current.fly = 0;
    controlRef.current.waddle = 0;
  };

  const triggerFly = () => {
    controlRef.current.fly = controlRef.current.fly ? 0 : 1;
    controlRef.current.face = controlRef.current.fly ? 1.5 : 0;
    controlRef.current.thrust = controlRef.current.fly ? 1 : 0;
  };

  const triggerWaddle = () => {
    controlRef.current.waddle = controlRef.current.waddle ? 0 : 1;
  };

  const colors = [
    { name: 'Emerald / Green', value: '#22e06b' },
    { name: 'Teal / Cyan', value: '#00d2d3' },
    { name: 'Sky Blue', value: '#38bdf8' },
    { name: 'Purple Neon', value: '#a855f7' },
    { name: 'Hot Pink', value: '#f43f5e' },
    { name: 'Amber Gold', value: '#fbbf24' },
  ];

  return (
    <div style={{
      maxWidth: '860px',
      margin: '40px auto',
      padding: '32px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      background: '#ffffff',
      borderRadius: '24px',
      boxShadow: '0 20px 45px -15px rgba(0,0,0,0.1)',
      border: '1px solid #e5e7eb'
    }}>
      <div style={{ textAlign: 'center', marginBottom: '28px' }}>
        <h2 style={{ fontSize: '28px', margin: '0 0 8px 0', color: '#111827' }}>
          🤖 3D Robot Mascot Playground
        </h2>
        <p style={{ margin: 0, color: '#6b7280', fontSize: '15px' }}>
          Interactive Three.js procedural robot — hover, click, or test animations below.
        </p>
      </div>

      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
        borderRadius: '20px',
        border: '1px solid #e2e8f0',
        minHeight: '380px',
        padding: '20px',
        marginBottom: '28px',
        position: 'relative',
        overflow: 'hidden'
      }}>
        <RobotMascot
          size={size}
          accent={accent}
          interactive={interactive}
          shadow={shadow}
          jetpack={jetpack}
          jetColor={jetColor}
          control={controlRef}
        />
      </div>

      {/* Control panel */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '24px' }}>
        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>
            Accent Glow Color
          </label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {colors.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setAccent(c.value)}
                title={c.name}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: c.value,
                  border: accent === c.value ? '3px solid #111827' : '2px solid #ffffff',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                  cursor: 'pointer'
                }}
              />
            ))}
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>
            Size ({size}px)
          </label>
          <input
            type="range"
            min="180"
            max="500"
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            style={{ width: '100%', cursor: 'pointer' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>
            Features
          </label>
          <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={jetpack}
                onChange={(e) => {
                  setJetpack(e.target.checked);
                  controlRef.current.jetpack = e.target.checked ? 1 : 0;
                }}
              />
              Jetpack
            </label>
            <label style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={shadow}
                onChange={(e) => setShadow(e.target.checked)}
              />
              Shadow
            </label>
            <label style={{ fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={interactive}
                onChange={(e) => setInteractive(e.target.checked)}
              />
              Mouse Follow
            </label>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ marginBottom: '28px' }}>
        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#374151', marginBottom: '10px' }}>
          Animations & Poses
        </label>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={triggerJump}
            style={btnStyle}
          >
            🦘 Happy Jump
          </button>
          <button
            type="button"
            onClick={() => setPose('hi')}
            style={btnStyle}
          >
            🙌 Hi (Both Hands)
          </button>
          <button
            type="button"
            onClick={() => setPose('bye')}
            style={btnStyle}
          >
            👋 Bye (Wave)
          </button>
          <button
            type="button"
            onClick={triggerFly}
            style={btnStyle}
          >
            🚀 Fly Superhero
          </button>
          <button
            type="button"
            onClick={triggerWaddle}
            style={btnStyle}
          >
            🐧 Waddle Walk
          </button>
          <button
            type="button"
            onClick={() => setPose('idle')}
            style={{ ...btnStyle, background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db' }}
          >
            Reset to Idle
          </button>
        </div>
      </div>

      {/* Floating Mascot Companion mode toggle */}
      <div style={{
        padding: '16px 20px',
        background: '#f0fdf4',
        border: '1px solid #bbf7d0',
        borderRadius: '16px',
        marginBottom: '24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        <div>
          <strong style={{ color: '#166534', display: 'block', fontSize: '14px' }}>
            Full Screen Companion Mode (`&lt;Mascot /&gt;`)
          </strong>
          <span style={{ color: '#15803d', fontSize: '13px' }}>
            Floats on the screen edge, tracks scroll position, and greets your visitors.
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowFloatingCompanion(!showFloatingCompanion)}
          style={{
            padding: '8px 16px',
            borderRadius: '10px',
            background: showFloatingCompanion ? '#dc2626' : '#16a34a',
            color: '#ffffff',
            border: 'none',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          {showFloatingCompanion ? 'Stop Floating Companion' : 'Preview Screen Companion'}
        </button>
      </div>

      {showFloatingCompanion && (
        <Mascot accent={accent} jetpack={jetpack} jetColor={jetColor} />
      )}

      {/* Code Snippet */}
      <div style={{ background: '#0f172a', padding: '18px 22px', borderRadius: '14px', color: '#e2e8f0', fontSize: '13px' }}>
        <div style={{ color: '#94a3b8', marginBottom: '8px', fontWeight: 600 }}>JSX Usage:</div>
        <pre style={{ margin: 0, fontFamily: 'monospace', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
{`<RobotMascot
  size={${size}}
  accent="${accent}"
  interactive={${interactive}}
  shadow={${shadow}}
  jetpack={${jetpack}}
/>`}
        </pre>
      </div>
    </div>
  );
}

const btnStyle = {
  padding: '8px 16px',
  borderRadius: '10px',
  background: '#1e293b',
  color: '#ffffff',
  border: 'none',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'transform 0.1s ease',
};
