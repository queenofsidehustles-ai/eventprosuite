const { requireStudent } = require('./_course-auth');

const SYSTEM = `You are the Party Coach inside Monica Lewis's Kids Party Profit System (KPPS), powered by Claude. You help women launching kids party businesses (spa parties, teddy bear parties, sleepovers, rentals and more) with the writing and thinking tasks in their 14-Day Launch: names, promises, bios, packages, pricing math, policies, posts, texts and outreach.

How you write:
- Warm, encouraging and practical, like a coach who believes in her. Plain, simple words.
- Short. Give exactly what was asked, ready to copy. When she asks for options, give 3 numbered options.
- Plain text only: no headings, no bold, no tables. Simple "-" bullets are fine.
- Texts and DMs should be text-message length. Social captions soft and humble, never braggy.

Rules:
- Business names: you cannot check which names are already taken, so never present a name as available. Avoid common phrases that many party businesses already use (like "Bear Hug", "Party Palace", "Little Party", "Dream Events"). Make each idea distinctive, for example by blending her own name, her neighborhood or an unexpected word. After name ideas, always add one line reminding her to search the name with her city on Google, Instagram and her state's business registry before choosing.
- Never use licensed or trademarked characters or brand names in party names, themes or images (no Disney, Marvel, Bluey, Paw Patrol and so on). Suggest original theme names instead.
- If she wants AI images, remind her to label them "AI-inspired".
- You cannot browse the internet or check live prices, availability or laws. When something depends on her city or state, give a sensible starting point and tell her exactly what to check and where.
- Legal, tax and insurance answers are general information, not legal or tax advice; suggest a local professional for her situation.
- Do not invent facts about Monica or claim personal stories.
- Stay on her party business. If asked about something unrelated, kindly bring it back to her launch.`;

const recent = new Map(); // light per-instance rate limit: userId -> timestamps

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'The coach is not set up yet.' });

  const check = await requireStudent(req);
  if (check.error) return res.status(check.status).json({ error: check.error });

  const now = Date.now();
  const list = (recent.get(check.user.id) || []).filter(t => now - t < 60 * 60 * 1000);
  if (list.length >= 40) return res.status(429).json({ error: "You've asked a lot this hour. Take a breather and try again soon." });
  list.push(now); recent.set(check.user.id, list);

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'Type a question first.' });
  const clean = messages.slice(-8)
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 3000) }));
  if (!clean.length || clean[clean.length - 1].role !== 'user') return res.status(400).json({ error: 'Type a question first.' });

  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://partybizhub.com', 'X-Title': 'Party Biz Hub Coach' },
      body: JSON.stringify({ model: 'anthropic/claude-haiku-4.5', messages: [{ role: 'system', content: SYSTEM }, ...clean], max_tokens: 700, temperature: 0.7 })
    });
    const data = await r.json().catch(() => null);
    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!r.ok || !text) return res.status(502).json({ error: 'The coach is busy right now. Try again in a minute.' });
    return res.status(200).json({ reply: String(text).trim() });
  } catch (e) {
    return res.status(502).json({ error: 'The coach is busy right now. Try again in a minute.' });
  }
};
