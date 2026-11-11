import { useState, useRef, useCallback, lazy, Suspense } from 'react';
import {
  Box,
  IconButton,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import { stone } from '../theme';
import HelpDeskChat, { robot } from './HelpDeskChat';

// Lazy-load Three.js 3D mascot component so the initial app bundle stays compact
const RobotMascot = lazy(() => import('./robot-3d/RobotMascot'));

export default function SystemRobot() {
  // Robot animation controller ref
  const robotControlRef = useRef({
    pose: 'idle',
    move: 0,
    face: 0,
    jumpReq: false,
    fly: 0,
    flyDir: 1,
    roll: 0,
    waddle: 0,
    jetpack: 0,
    thrust: 0,
    hidden: false,
  });

  // State: whether the robot is ducking underground
  const [minimized, setMinimized] = useState(() => {
    try {
      return localStorage.getItem('aureon_robot_minimized') === 'true';
    } catch {
      return false;
    }
  });

  // Help desk chat opened by clicking the robot
  const [chatOpen, setChatOpen] = useState(false);
  const [hintSeen, setHintSeen] = useState(() => {
    try {
      return localStorage.getItem('aureon_helpdesk_hint_seen') === 'true';
    } catch {
      return false;
    }
  });

  const openChat = (value) => {
    setChatOpen(value);
    if (value && !hintSeen) {
      setHintSeen(true);
      try {
        localStorage.setItem('aureon_helpdesk_hint_seen', 'true');
      } catch {}
    }
  };

  // The chat drives the robot: wave hello, jump for joy when a request is sent.
  const handleRobot = useCallback((action) => {
    const ctl = robotControlRef.current;
    if (!ctl) return;
    if (action === 'jump') ctl.jumpReq = true;
    if (action === 'hi') {
      ctl.pose = 'hi';
      setTimeout(() => {
        if (robotControlRef.current.pose === 'hi') robotControlRef.current.pose = 'idle';
      }, 1600);
    }
  }, []);

  // Toggle ducking underground / popping up
  const handleToggleMinimize = (e) => {
    if (e) e.stopPropagation();
    setMinimized((prev) => {
      const next = !prev;
      if (next) setChatOpen(false);
      try {
        localStorage.setItem('aureon_robot_minimized', String(next));
      } catch {}
      // Keep Three.js actively rendering so his eyes and antenna track the mouse from underground!
      if (robotControlRef.current) {
        robotControlRef.current.hidden = false;
        if (!next) {
          // Popping up from underground: trigger a happy jump!
          robotControlRef.current.jumpReq = true;
        }
      }
      return next;
    });
  };

  return (
    <Box
      sx={{
        position: 'fixed',
        bottom: 0,
        right: { xs: 12, sm: 24 },
        zIndex: 1150, // Above normal content, below MUI dialogs (1300)
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        pointerEvents: 'none', // Transparent wrapper so it doesn't block clicks outside
      }}
    >
      <HelpDeskChat open={chatOpen} onClose={() => setChatOpen(false)} onRobot={handleRobot} />

      {/* "Need help?" bubble until the user has opened the chat once */}
      {!minimized && !chatOpen && !hintSeen && (
        <Box
          onClick={() => openChat(true)}
          sx={{
            pointerEvents: 'auto',
            cursor: 'pointer',
            mr: { xs: 1, sm: 2 },
            mb: -0.5,
            px: 1.25,
            py: 0.6,
            borderRadius: 2,
            bgcolor: robot.body,
            border: `1px solid ${robot.emerald}`,
            boxShadow: '0 4px 14px rgba(0,0,0,.08)',
            fontSize: 12.5,
            fontWeight: 600,
            color: robot.teal,
            position: 'relative',
            '&::after': {
              content: '""', position: 'absolute', bottom: -6, right: 28, width: 10, height: 10,
              bgcolor: '#fff', borderRight: `1px solid ${robot.emerald}`, borderBottom: `1px solid ${robot.emerald}`,
              transform: 'rotate(45deg)',
            },
          }}
        >
          Need help? Ask me! 💬
        </Box>
      )}
      {/* 3D Robot Mascot (Full view or peeking from underground) */}
      <Box
        sx={{
          pointerEvents: 'auto',
          position: 'relative',
          width: { xs: 110, sm: 135 },
          transform: minimized ? 'translateY(60%)' : 'translateY(-6px)',
          transition: 'transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)',
          cursor: minimized ? 'pointer' : 'default',
          '&:hover': minimized
            ? {
                transform: 'translateY(52%)', // Peek a little higher on hover when underground
              }
            : {
                transform: 'translateY(-8px)',
              },
        }}
      >
        {/* Top Control Bar: Minimize button (Only visible when fully surfaced) */}
        <Box
          sx={{
            position: 'absolute',
            top: 4,
            right: 6,
            zIndex: 10,
            opacity: minimized ? 0 : 0.65,
            pointerEvents: minimized ? 'none' : 'auto',
            transition: 'opacity 0.25s ease',
            '&:hover': { opacity: 1 },
          }}
        >
          <Tooltip title="Hide underground" placement="top">
            <IconButton
              size="small"
              onClick={handleToggleMinimize}
              sx={{
                width: 24,
                height: 24,
                bgcolor: 'rgba(255,255,255,0.85)',
                backdropFilter: 'blur(4px)',
                border: `1px solid ${stone[200]}`,
                p: 0,
                '&:hover': { bgcolor: '#fff' },
              }}
              aria-label="Hide robot underground"
            >
              <KeyboardArrowDownRoundedIcon sx={{ fontSize: 16, color: stone[600] }} />
            </IconButton>
          </Tooltip>
        </Box>

        {/* 3D Robot Three.js Mascot */}
        <Tooltip
          title={minimized ? 'Click to pop up! 🤖' : chatOpen ? 'Close help desk' : 'Need help? Click me 💬'}
          placement="left"
          arrow
        >
          <Box
            onClick={() => {
              if (minimized) {
                // Clicking while peeking underground pops him up with a celebratory jump!
                handleToggleMinimize();
              } else {
                openChat(!chatOpen);
              }
            }}
            sx={{
              cursor: 'pointer',
              display: 'block',
              width: '100%',
            }}
          >
            <Suspense
              fallback={
                <Box
                  sx={{
                    width: '100%',
                    aspectRatio: '1 / 1.08',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <CircularProgress size={24} sx={{ color: '#22e06b' }} />
                </Box>
              }
            >
              <RobotMascot
                size={135}
                interactive={true}
                shadow={true}
                autoWave={true}
                control={robotControlRef}
                style={{ width: '100%', height: 'auto' }}
              />
            </Suspense>
          </Box>
        </Tooltip>
      </Box>
    </Box>
  );
}
