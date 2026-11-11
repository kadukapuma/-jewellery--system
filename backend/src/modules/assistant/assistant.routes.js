import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../../config/db.js';
import { understand } from './assistant.matcher.js';
import { INTENTS, allowedIntents, canUse } from './assistant.intents.js';

// The robot chat assistant: offline, rule-based and read-only. Every answer is checked against
// the user's own permissions before any data is read, so it never shows more than their screens do.
const router = Router();

const askSchema = z.object({
  text: z.string({ error: 'Type a question' }).trim().min(1, 'Type a question').max(300, 'Please keep it under 300 characters'),
});

function suggestionsFor(req, limit = 4) {
  return allowedIntents(req)
    .filter((id) => id !== 'help' && id !== 'whoami')
    .map((id) => INTENTS[id].examples[0])
    .slice(0, limit);
}

// Quick-reply chips for the chat: only what this user may ask.
router.get('/capabilities', (req, res) => {
  res.json({
    success: true,
    data: allowedIntents(req).map((id) => ({ id, label: INTENTS[id].label, examples: INTENTS[id].examples })),
  });
});

router.post('/ask', async (req, res) => {
  const { text } = askSchema.parse(req.body ?? {});
  const { intent, args } = understand(text);

  if (!intent) {
    return res.json({
      success: true,
      data: {
        intent: null,
        reply: "Sorry, I didn't understand that. 🤔 Try one of these:",
        suggestions: suggestionsFor(req),
      },
    });
  }

  if (!canUse(req, intent)) {
    return res.json({
      success: true,
      data: {
        intent,
        denied: true,
        reply: `Sorry, your role${req.user.role_name ? ` (${req.user.role_name})` : ''} doesn't have access to ${INTENTS[intent].label.toLowerCase()}. Ask your admin if you need it.`,
        suggestions: suggestionsFor(req, 3),
      },
    });
  }

  const answer = await INTENTS[intent].run({ db: pool, req, args });
  res.json({
    success: true,
    data: {
      intent,
      ...answer,
      cards: answer.cards?.map(([label, value]) => ({ label, value: String(value ?? '—') })),
    },
  });
});

export default router;
