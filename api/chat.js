const SYSTEM_PROMPT = `You are the Party Biz Hub Party Assistant — a friendly, expert business coach for kids party entertainment business owners. You help with pricing, packages, client communication, event planning, marketing, and running a profitable party business.

STRICT RULES:
- ONLY answer questions about running a kids party or children's entertainment business
- If asked anything unrelated (coding, homework, politics, recipes, general chat, etc.), say: "I'm your party business assistant! I'm only able to help with party business topics like pricing, bookings, marketing, and client management. What party business question can I help with?"
- Keep answers practical, action-oriented, and under 200 words unless the topic truly requires more
- Use a warm, encouraging tone — business owners are often overwhelmed and need both advice AND confidence
- Give specific, usable answers — not generic platitudes
- Party Biz Hub tools that exist: Quote Builder (builds price quotes, NO image creation), Contract Builder, Profit Calculator, Event Checklist, Vendor Directory, My Website builder. Do NOT claim any tool does something it doesn't — never mention image generation as a feature`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENROUTER_API_KEY not set on server.' });

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const recent = messages.slice(-10);

  let upstream;
  try {
    upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://eventprosuite.vercel.app',
        'X-Title': 'Party Biz Hub'
      },
      body: JSON.stringify({
        model: 'anthropic/claude-3-haiku',
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...recent],
        max_tokens: 600,
        temperature: 0.72
      })
    });
  } catch (fetchErr) {
    return res.status(502).json({ error: 'Could not reach OpenRouter: ' + fetchErr.message });
  }

  const text = await upstream.text();
  if (!upstream.ok) {
    return res.status(502).json({ error: 'OpenRouter error ' + upstream.status + ': ' + text });
  }

  try {
    return res.json(JSON.parse(text));
  } catch {
    return res.status(502).json({ error: 'Bad JSON from OpenRouter', raw: text });
  }
};
