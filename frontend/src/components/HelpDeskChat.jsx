import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box, Paper, Typography, IconButton, TextField, Chip, Button, CircularProgress, Tooltip, Grow,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import OpenInFullRoundedIcon from '@mui/icons-material/OpenInFullRounded';
import CloseFullscreenRoundedIcon from '@mui/icons-material/CloseFullscreenRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import api, { errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
// The robot's own colours: glossy white body, dark visor, glowing green eyes and teal jetpack.
export const robot = {
  body: '#F3F6F4',
  soft: '#EAF1EE',
  visor: '#0C0F0D',
  visorLift: '#1B2622',
  glow: '#22E06B',
  emerald: '#02CA96',
  teal: '#058875',
  tealDark: '#046B5C',
  mint: '#E6FBEF',
  line: '#D5E2DC',
  muted: '#5E6B66',
  ink: '#0C0F0D',
};
const btnSolid = { bgcolor: robot.teal, color: '#fff', boxShadow: 'none', '&:hover': { bgcolor: robot.tealDark, boxShadow: `0 0 10px ${robot.glow}55` } };
const btnOutline = { color: robot.teal, borderColor: robot.emerald, '&:hover': { borderColor: robot.teal, bgcolor: robot.mint } };

// Help desk chat opened from the robot. Walks the user through a support request step by step and
// sends it to the system provider's Task Manager via /api/helpdesk (the backend holds the API key).

const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = '.jpg,.jpeg,.png,.gif,.webp,.pdf';
const FALLBACK_META = {
  task_types: ['Error', 'Modification', 'New', 'Installation', 'Maintenance'],
  priorities: ['Normal', 'Urgent', 'Fire'],
};
const TYPE_HINTS = {
  Error: 'Something is broken',
  Modification: 'Change how something works',
  New: 'A new feature',
  Installation: 'Install / set up',
  Maintenance: 'Routine help',
};

const STATUS_COLORS = {
  pending: { bg: '#FFF4D6', fg: '#8A5A00' },
  accepted: { bg: '#E3F1FF', fg: '#1B5A9C' },
  'in progress': { bg: '#E3F1FF', fg: '#1B5A9C' },
  completed: { bg: '#E3F6E8', fg: '#1E7A3A' },
  done: { bg: '#E3F6E8', fg: '#1E7A3A' },
  rejected: { bg: '#FDE7E7', fg: '#A12B2B' },
};
const statusColor = (s) => STATUS_COLORS[String(s || '').toLowerCase()] || { bg: robot.soft, fg: robot.muted };

const fmtDate = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const fmtSize = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

let nextId = 1;
const msg = (from, text, extra = {}) => ({ id: nextId++, from, text, ...extra });

function StatusPill({ value }) {
  if (!value) return null;
  const c = statusColor(value);
  return (
    <Box component="span" sx={{ px: 0.9, py: 0.15, borderRadius: 10, fontSize: 11, fontWeight: 600, bgcolor: c.bg, color: c.fg, whiteSpace: 'nowrap' }}>
      {value}
    </Box>
  );
}

function RequestCard({ r, onOpen }) {
  return (
    <Box
      onClick={onOpen ? () => onOpen(r.id) : undefined}
      sx={{
        p: 1, borderRadius: 1.5, border: `1px solid ${robot.line}`, bgcolor: '#fff',
        cursor: onOpen ? 'pointer' : 'default',
        '&:hover': onOpen ? { borderColor: robot.emerald, bgcolor: robot.mint } : undefined,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ fontSize: 12, color: robot.muted, fontWeight: 600 }}>#{r.id}</Typography>
        <Typography sx={{ fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0 }} noWrap>{r.title}</Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', mt: 0.5, flexWrap: 'wrap' }}>
        <StatusPill value={r.progress || r.status} />
        <Typography sx={{ fontSize: 11, color: robot.muted }}>
          {[r.task_type, r.priority, fmtDate(r.created_at)].filter(Boolean).join(' · ')}
        </Typography>
      </Box>
    </Box>
  );
}

function RequestDetail({ r }) {
  const rows = [
    ['Type', r.task_type],
    ['Priority', r.priority],
    ['Status', r.status],
    ['Progress', r.progress],
    ['Task no.', r.task_number],
    ['Sent by', r.requester_name],
    ['Sent on', fmtDate(r.created_at)],
    ['Reviewed', fmtDate(r.reviewed_at)],
    ['Completed', fmtDate(r.completed_at)],
    ['Attachments', r.attachments_count || null],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');
  return (
    <Box>
      <Typography sx={{ fontWeight: 700, fontSize: 13.5, mb: 0.5 }}>#{r.id} · {r.title}</Typography>
      {rows.map(([k, v]) => (
        <Box key={k} sx={{ display: 'flex', gap: 1, fontSize: 12.5, lineHeight: 1.6 }}>
          <Box sx={{ color: robot.muted, width: 82, flexShrink: 0 }}>{k}</Box>
          <Box>{k === 'Status' || k === 'Progress' ? <StatusPill value={v} /> : v}</Box>
        </Box>
      ))}
      {r.rejection_reason && (
        <Typography sx={{ mt: 0.75, fontSize: 12.5, color: '#A12B2B' }}>Reason: {r.rejection_reason}</Typography>
      )}
      {r.description && (
        <Typography sx={{ mt: 0.75, fontSize: 12.5, whiteSpace: 'pre-wrap', color: robot.ink }}>{r.description}</Typography>
      )}
    </Box>
  );
}

export default function HelpDeskChat({ open, onClose, onRobot }) {
  const { user, can } = useAuth();
  const canView = can('helpdesk.view');
  const canCreate = can('helpdesk.create');

  const [messages, setMessages] = useState([]);
  const [step, setStep] = useState('menu'); // menu | type | priority | title | description | files | confirm | busy
  const [draft, setDraft] = useState({ task_type: '', priority: '', title: '', description: '', files: [] });
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [meta, setMeta] = useState(null);
  const [configured, setConfigured] = useState(null); // help desk switched on?
  const [caps, setCaps] = useState([]); // what this user may ask the assistant
  const [ready, setReady] = useState(false);
  const [expanded, setExpanded] = useState(() => {
    try { return localStorage.getItem('aureon_chat_expanded') === 'true'; } catch { return false; }
  });
  const toggleExpanded = () => setExpanded((v) => {
    try { localStorage.setItem('aureon_chat_expanded', String(!v)); } catch {}
    return !v;
  });
  const started = useRef(false);
  const scrollRef = useRef(null);
  const fileRef = useRef(null);
  const inputRef = useRef(null);

  const push = useCallback((...items) => setMessages((m) => [...m, ...items]), []);

  // The robot "types" for a moment before each answer, which reads more like a chat.
  const say = useCallback((text, extra) => new Promise((resolve) => {
    setTyping(true);
    setTimeout(() => {
      setTyping(false);
      push(msg('bot', text, extra));
      resolve();
    }, 450);
  }), [push]);

  const showMenu = useCallback(async (text = 'Anything else I can help with?') => {
    setStep('menu');
    await say(text);
  }, [say]);

  // First open: greet, load what this user may ask, and check the help desk is switched on.
  useEffect(() => {
    if (!open || started.current) return;
    started.current = true;
    onRobot?.('hi');
    (async () => {
      const first = user?.name?.split(' ')[0] || user?.username || 'there';
      await say(`Hi ${first}! 👋 I'm your shop assistant. Ask me about sales, stock, gold prices, customers and more — I'll only show what your role allows.`);
      const [capsRes, deskRes] = await Promise.allSettled([
        api.get('/assistant/capabilities'),
        canView || canCreate ? api.get('/helpdesk/status') : Promise.resolve(null),
      ]);
      if (capsRes.status === 'fulfilled') setCaps(capsRes.value.data.data || []);
      else await say(errorMessage(capsRes.reason), { tone: 'error' });
      setConfigured(deskRes.status === 'fulfilled' && !!deskRes.value?.data?.data?.configured);
      setReady(true);
      await showMenu('What would you like to know? Type a question or tap one below.');
    })();
  }, [open, onRobot, say, showMenu, user, canView, canCreate]);

  // ---- Ask the assistant ------------------------------------------------
  const ask = async (text) => {
    const q = String(text || '').trim();
    if (!q) return;
    push(msg('user', q));
    setInput('');
    setStep('busy');
    setTyping(true);
    try {
      const { data } = await api.post('/assistant/ask', { text: q });
      setTyping(false);
      const a = data.data || {};
      push(msg('bot', a.reply, {
        tone: a.denied ? 'error' : undefined,
        cards: a.cards, list: a.list, note: a.note, suggestions: a.suggestions,
      }));
      if (a.cards?.length || a.list?.length) onRobot?.('jump');
    } catch (err) {
      setTyping(false);
      push(msg('bot', errorMessage(err), { tone: 'error' }));
    }
    setStep('menu');
  };

  // Examples like "Balance of <customer name>" fill the box so the user can finish typing.
  const pickSuggestion = (s) => {
    const cut = s.indexOf('<');
    if (cut >= 0) {
      setInput(s.slice(0, cut));
      setTimeout(() => inputRef.current?.focus(), 30);
    } else ask(s);
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, typing, step]);

  useEffect(() => {
    if (open && (step === 'title' || step === 'description')) setTimeout(() => inputRef.current?.focus(), 60);
  }, [open, step]);

  const loadMeta = async () => {
    if (meta) return meta;
    try {
      const { data } = await api.get('/helpdesk/meta');
      const m = {
        task_types: data.data?.task_types?.length ? data.data.task_types : FALLBACK_META.task_types,
        priorities: data.data?.priorities?.length ? data.data.priorities : FALLBACK_META.priorities,
      };
      setMeta(m);
      return m;
    } catch (err) {
      await say(errorMessage(err), { tone: 'error' });
      return null;
    }
  };

  // ---- Report a problem ------------------------------------------------
  const startReport = async () => {
    push(msg('user', 'Report a problem'));
    setDraft({ task_type: '', priority: '', title: '', description: '', files: [] });
    setStep('busy');
    const m = await loadMeta();
    if (!m) return showMenu();
    setStep('type');
    await say('Sure! What kind of help do you need?');
  };

  const pickType = async (t) => {
    push(msg('user', t));
    setDraft((d) => ({ ...d, task_type: t }));
    setStep('busy');
    await say('How urgent is it?');
    setStep('priority');
  };

  const pickPriority = async (p) => {
    push(msg('user', p));
    setDraft((d) => ({ ...d, priority: p }));
    setStep('busy');
    await say('Give it a short title, e.g. "Bill printer not printing".');
    setStep('title');
  };

  const submitText = async () => {
    const text = input.trim();
    if (!text) return;
    if (step === 'menu') {
      await ask(text);
    } else if (step === 'title') {
      if (text.length > 255) return say('Please keep the title under 255 characters.', { tone: 'error' });
      push(msg('user', text));
      setDraft((d) => ({ ...d, title: text }));
      setInput('');
      setStep('busy');
      await say('Now describe what happened — what you were doing, what you expected and what you saw instead. More detail helps them fix it faster.');
      setStep('description');
    } else if (step === 'description') {
      if (text.length > 10000) return say('That is a bit long — please keep it under 10,000 characters.', { tone: 'error' });
      push(msg('user', text));
      setDraft((d) => ({ ...d, description: text }));
      setInput('');
      setStep('busy');
      await say(`Want to attach screenshots or a PDF? (up to ${MAX_FILES} files, 10 MB each)`);
      setStep('files');
    }
  };

  const addFiles = async (list) => {
    const picked = Array.from(list || []);
    if (fileRef.current) fileRef.current.value = '';
    const ok = [];
    const problems = [];
    for (const f of picked) {
      if (!/\.(jpe?g|png|gif|webp|pdf)$/i.test(f.name)) problems.push(`${f.name}: only images or PDF`);
      else if (f.size > MAX_BYTES) problems.push(`${f.name}: larger than 10 MB`);
      else ok.push(f);
    }
    const room = MAX_FILES - draft.files.length;
    if (ok.length > room) problems.push(`Only ${MAX_FILES} files can be attached`);
    const files = [...draft.files, ...ok.slice(0, Math.max(0, room))];
    setDraft((d) => ({ ...d, files }));
    if (problems.length) await say(problems.join('\n'), { tone: 'error' });
  };

  const removeFile = (i) => setDraft((d) => ({ ...d, files: d.files.filter((_, j) => j !== i) }));

  const toConfirm = async () => {
    push(msg('user', draft.files.length ? `Attached ${draft.files.length} file(s)` : 'No attachments'));
    setStep('busy');
    await say('Here is your request. Shall I send it?', { summary: { ...draft } });
    setStep('confirm');
  };

  const send = async () => {
    push(msg('user', 'Send it'));
    setStep('busy');
    setTyping(true);
    const form = new FormData();
    form.append('title', draft.title);
    form.append('task_type', draft.task_type);
    if (draft.priority) form.append('priority', draft.priority);
    form.append('description', draft.description);
    form.append('page_url', window.location.href.slice(0, 500));
    draft.files.forEach((f) => form.append('files[]', f));
    try {
      const { data } = await api.post('/helpdesk/requests', form);
      setTyping(false);
      onRobot?.('jump');
      const id = data.data?.id;
      await say(
        `Done! 🎉 Your request${id ? ` #${id}` : ''} was sent${data.data?.progress ? ` — status: ${data.data.progress}` : ''}. You can check on it any time under "My requests".`,
        { tone: 'success' },
      );
      setDraft({ task_type: '', priority: '', title: '', description: '', files: [] });
      await showMenu();
    } catch (err) {
      setTyping(false);
      const errs = err.response?.data?.errors;
      const details = Array.isArray(errs)
        ? errs.map((e) => e.message)
        : errs && typeof errs === 'object' ? Object.values(errs).flat() : [];
      await say([errorMessage(err), ...details].join('\n'), { tone: 'error' });
      setStep('confirm');
      await say('You can try sending again, or start over.');
    }
  };

  const restart = async () => {
    push(msg('user', 'Start over'));
    setInput('');
    setDraft({ task_type: '', priority: '', title: '', description: '', files: [] });
    await showMenu('No problem, let\'s start over. What would you like to do?');
  };

  // ---- My requests -----------------------------------------------------
  const openRequest = async (id) => {
    push(msg('user', `Show #${id}`));
    setTyping(true);
    try {
      const { data } = await api.get(`/helpdesk/requests/${id}`);
      setTyping(false);
      push(msg('bot', '', { detail: data.data }));
    } catch (err) {
      setTyping(false);
      await say(errorMessage(err), { tone: 'error' });
    }
  };

  const showRequests = async () => {
    push(msg('user', 'My requests'));
    setStep('busy');
    setTyping(true);
    try {
      const { data } = await api.get('/helpdesk/requests');
      setTyping(false);
      const list = data.data || [];
      if (!list.length) await say('You have not sent any requests yet.');
      else push(msg('bot', `Here are your latest requests (${list.length}). Tap one for details.`, { requests: list.slice(0, 20) }));
    } catch (err) {
      setTyping(false);
      await say(errorMessage(err), { tone: 'error' });
    }
    setStep('menu');
  };

  // ---- UI --------------------------------------------------------------
  const textStep = step === 'title' || step === 'description' || (ready && (step === 'menu' || step === 'busy'));
  const chipSx = { bgcolor: '#fff', border: `1px solid ${robot.emerald}`, color: robot.teal, fontWeight: 600, '&:hover': { bgcolor: robot.mint } };
  const quickAsks = caps.filter((c) => c.id !== 'help' && c.id !== 'whoami').map((c) => c.examples[0]);

  let actions = null;
  if (ready && !typing) {
    if (step === 'menu') {
      actions = (
        <>
          {quickAsks.slice(0, 6).map((q) => <Chip key={q} size="small" label={q} onClick={() => pickSuggestion(q)} sx={chipSx} />)}
          {configured && canCreate && <Chip size="small" label="🛠 Report a problem" onClick={startReport} sx={chipSx} />}
          {configured && canView && <Chip size="small" label="📋 My requests" onClick={showRequests} sx={chipSx} />}
          {!quickAsks.length && !(configured && (canCreate || canView)) && (
            <Typography sx={{ fontSize: 12, color: robot.muted }}>Your role has no shop data access yet — ask your admin.</Typography>
          )}
        </>
      );
    } else if (step === 'type') {
      actions = (meta?.task_types || []).map((t) => (
        <Tooltip key={t} title={TYPE_HINTS[t] || ''} placement="top"><Chip label={t} onClick={() => pickType(t)} sx={chipSx} /></Tooltip>
      ));
    } else if (step === 'priority') {
      actions = (meta?.priorities || []).map((p) => (
        <Chip key={p} label={p === 'Fire' ? '🔥 Fire' : p} onClick={() => pickPriority(p)} sx={chipSx} />
      ));
    } else if (step === 'files') {
      actions = (
        <Box sx={{ width: '100%' }}>
          {draft.files.map((f, i) => (
            <Chip key={`${f.name}-${i}`} size="small" label={`${f.name} (${fmtSize(f.size)})`} onDelete={() => removeFile(i)} sx={{ mr: 0.5, mb: 0.5, maxWidth: '100%' }} />
          ))}
          <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
            <Button size="small" variant="outlined" sx={btnOutline} startIcon={<AttachFileRoundedIcon />} disabled={draft.files.length >= MAX_FILES} onClick={() => fileRef.current?.click()}>
              Attach
            </Button>
            <Button size="small" variant="contained" onClick={toConfirm} sx={{ ...btnSolid, ml: 'auto' }}>
              {draft.files.length ? 'Continue' : 'Skip'}
            </Button>
          </Box>
          <input ref={fileRef} type="file" hidden multiple accept={ACCEPT} onChange={(e) => addFiles(e.target.files)} />
        </Box>
      );
    } else if (step === 'confirm') {
      actions = (
        <>
          <Button size="small" variant="contained" sx={btnSolid} endIcon={<SendRoundedIcon />} onClick={send}>Send request</Button>
          <Button size="small" startIcon={<RestartAltRoundedIcon />} onClick={restart} sx={{ color: robot.muted }}>Start over</Button>
        </>
      );
    }
  }

  return (
    <Grow in={open} style={{ transformOrigin: 'bottom right' }} unmountOnExit={false}>
      <Paper
        elevation={12}
        role="dialog"
        aria-label="Help desk chat"
        sx={{
          pointerEvents: 'auto',
          position: 'fixed',
          right: { xs: 8, sm: 24 },
          bottom: { xs: 128, sm: 150 },
          width: { xs: 'calc(100vw - 16px)', sm: expanded ? 'min(720px, calc(100vw - 48px))' : 460 },
          height: {
            xs: 'calc(100vh - 150px)',
            sm: expanded ? 'calc(100vh - 180px)' : 'min(680px, calc(100vh - 180px))',
          },
          transition: 'width .25s ease, height .25s ease',
          display: open ? 'flex' : 'none',
          flexDirection: 'column',
          borderRadius: 3,
          overflow: 'hidden',
          border: `1px solid ${robot.line}`,
          zIndex: 1160,
        }}
      >
        {/* Header */}
        <Box sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', gap: 1, background: `linear-gradient(135deg, ${robot.visor}, ${robot.visorLift})`, color: '#fff', borderBottom: `2px solid ${robot.glow}`, boxShadow: `0 2px 12px ${robot.glow}33` }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: robot.glow, boxShadow: `0 0 8px ${robot.glow}` }} />
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>Shop Assistant</Typography>
            <Typography sx={{ fontSize: 11.5, color: robot.glow, opacity: 0.85 }}>Ask about sales, stock, gold prices…</Typography>
          </Box>
          <Tooltip title={expanded ? 'Smaller' : 'Bigger'}>
            <IconButton size="small" onClick={toggleExpanded} sx={{ color: '#fff', display: { xs: 'none', sm: 'inline-flex' } }} aria-label={expanded ? 'Make chat smaller' : 'Make chat bigger'}>
              {expanded ? <CloseFullscreenRoundedIcon fontSize="small" /> : <OpenInFullRoundedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <IconButton size="small" onClick={onClose} sx={{ color: '#fff' }} aria-label="Close help desk">
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        </Box>

        {/* Messages */}
        <Box ref={scrollRef} sx={{ flex: 1, overflowY: 'auto', px: 1.5, py: 1.5, bgcolor: robot.body, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {messages.map((m) => {
            const bot = m.from === 'bot';
            const tone = m.tone === 'error' ? { bgcolor: '#FDECEC', color: '#8E2424', border: '1px solid #F5C9C9' }
              : m.tone === 'success' ? { bgcolor: '#E9F7EE', color: '#1E5E35', border: '1px solid #C6E8D2' }
                : bot ? { bgcolor: '#fff', color: robot.ink, border: `1px solid ${robot.line}` }
                  : { bgcolor: robot.teal, color: '#fff', border: 'none' };
            return (
              <Box key={m.id} sx={{ alignSelf: bot ? 'flex-start' : 'flex-end', maxWidth: m.requests || m.detail || m.summary || m.cards || m.list ? '100%' : '85%', width: m.requests || m.detail || m.summary || m.cards?.length || m.list?.length ? '100%' : 'auto' }}>
                <Box sx={{ px: 1.5, py: 1, borderRadius: 2.5, borderTopLeftRadius: bot ? 6 : undefined, borderTopRightRadius: bot ? undefined : 6, fontSize: 13.5, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word', ...tone }}>
                  {m.text}
                  {m.summary && (
                    <Box sx={{ mt: 1, p: 1, borderRadius: 1.5, bgcolor: robot.body, fontSize: 12.5 }}>
                      <Box><b>{m.summary.title}</b></Box>
                      <Box sx={{ color: robot.muted, my: 0.25 }}>{m.summary.task_type}{m.summary.priority ? ` · ${m.summary.priority}` : ''}</Box>
                      <Box sx={{ whiteSpace: 'pre-wrap', maxHeight: 120, overflowY: 'auto' }}>{m.summary.description}</Box>
                      {m.summary.files.length > 0 && <Box sx={{ mt: 0.5, color: robot.muted }}>📎 {m.summary.files.map((f) => f.name).join(', ')}</Box>}
                    </Box>
                  )}
                  {m.requests && (
                    <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                      {m.requests.map((r) => <RequestCard key={r.id} r={r} onOpen={openRequest} />)}
                    </Box>
                  )}
                  {m.detail && <RequestDetail r={m.detail} />}
                  {m.cards?.length > 0 && (
                    <Box sx={{ mt: 1, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 1.25, rowGap: 0.25, p: 1, borderRadius: 1.5, bgcolor: robot.body, fontSize: 12.5 }}>
                      {m.cards.map((c) => (
                        <Box key={c.label} sx={{ display: 'contents' }}>
                          <Box sx={{ color: robot.muted }}>{c.label}</Box>
                          <Box sx={{ fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.value}</Box>
                        </Box>
                      ))}
                    </Box>
                  )}
                  {m.list?.length > 0 && (
                    <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                      {m.list.map((l) => (
                        <Box key={l.ask} onClick={() => !typing && ask(l.ask)} sx={{ p: 1, borderRadius: 1.5, border: `1px solid ${robot.line}`, bgcolor: '#fff', cursor: 'pointer', '&:hover': { borderColor: robot.emerald, bgcolor: robot.mint } }}>
                          <Typography sx={{ fontSize: 13, fontWeight: 600 }} noWrap>{l.title}</Typography>
                          <Typography sx={{ fontSize: 11.5, color: robot.muted }}>{l.subtitle}</Typography>
                        </Box>
                      ))}
                    </Box>
                  )}
                  {m.note && <Typography sx={{ mt: 0.75, fontSize: 12, color: '#8A5A00' }}>{m.note}</Typography>}
                  {m.suggestions?.length > 0 && (
                    <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {m.suggestions.map((s) => <Chip key={s} size="small" label={s} onClick={() => !typing && pickSuggestion(s)} sx={chipSx} />)}
                    </Box>
                  )}
                </Box>
              </Box>
            );
          })}
          {typing && (
            <Box sx={{ alignSelf: 'flex-start', px: 1.5, py: 1, borderRadius: 2.5, bgcolor: '#fff', border: `1px solid ${robot.line}`, display: 'flex', gap: 0.5 }}>
              {[0, 1, 2].map((i) => (
                <Box key={i} sx={{
                  width: 6, height: 6, borderRadius: '50%', bgcolor: robot.emerald,
                  animation: 'hdDot 1s infinite ease-in-out', animationDelay: `${i * 0.15}s`,
                  '@keyframes hdDot': { '0%,80%,100%': { opacity: 0.3, transform: 'translateY(0)' }, '40%': { opacity: 1, transform: 'translateY(-3px)' } },
                }} />
              ))}
            </Box>
          )}
          {configured === null && !typing && messages.length === 0 && <CircularProgress size={20} sx={{ alignSelf: 'center', color: robot.glow }} />}
        </Box>

        {/* Quick replies / actions */}
        {actions && (
          <Box
            sx={{
              px: 1.5, pt: 1, pb: textStep ? 0.25 : 1, display: 'flex', flexWrap: 'wrap', gap: 0.75, borderTop: `1px solid ${robot.line}`, bgcolor: '#fff',
            }}
          >
            {actions}
          </Box>
        )}

        {/* Text input (title / description steps) */}
        {textStep && (
          <Box
            component="form"
            onSubmit={(e) => { e.preventDefault(); submitText(); }}
            sx={{ px: 1.5, pt: actions ? 0.75 : 1.25, pb: 1.25, display: 'flex', alignItems: 'flex-end', gap: 0.75, borderTop: actions ? 'none' : `1px solid ${robot.line}`, bgcolor: '#fff' }}
          >
            <TextField
              inputRef={inputRef}
              sx={{
                '& .MuiOutlinedInput-root': {
                  borderRadius: 5,
                  bgcolor: robot.body,
                  fontSize: 14,
                  pl: 0.5,
                  transition: 'box-shadow .2s, background-color .2s',
                  '& fieldset': { borderColor: robot.line, borderWidth: '1px !important' },
                  '&:hover fieldset': { borderColor: robot.emerald },
                  '&.Mui-focused': { bgcolor: '#fff', boxShadow: `0 0 0 3px ${robot.glow}26` },
                  '&.Mui-focused fieldset': { borderColor: robot.emerald },
                },
                '& textarea, & input': { py: '9px' },
              }}
              size="small"
              fullWidth
              multiline={step === 'description'}
              maxRows={5}
              placeholder={step === 'title' ? 'Short title…' : step === 'description' ? 'Describe the problem… (Ctrl+Enter to send)' : 'Ask me… e.g. "today sales"'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (step === 'description' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submitText(); }
              }}
              slotProps={{ htmlInput: { maxLength: step === 'title' ? 255 : 10000 } }}
            />
            <IconButton
              type="submit"
              disabled={!input.trim() || typing}
              aria-label="Send"
              sx={{
                width: 40, height: 40, flexShrink: 0, bgcolor: robot.teal, color: '#fff',
                transition: 'background-color .2s, box-shadow .2s',
                '&:hover': { bgcolor: robot.tealDark, boxShadow: `0 0 10px ${robot.glow}55` },
                '&.Mui-disabled': { bgcolor: robot.soft, color: robot.muted },
              }}
            >
              <SendRoundedIcon sx={{ fontSize: 19, ml: '2px' }} />
            </IconButton>
            {(step === 'title' || step === 'description') && (
              <Tooltip title="Start over">
                <IconButton size="small" onClick={restart} aria-label="Start over"><RestartAltRoundedIcon fontSize="small" /></IconButton>
              </Tooltip>
            )}
          </Box>
        )}
      </Paper>
    </Grow>
  );
}
