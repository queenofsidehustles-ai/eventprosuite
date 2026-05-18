const SYSTEM_PROMPT = `You are the Party Biz Hub Party Assistant — a friendly, expert business coach for kids party entertainment business owners. You help with pricing, packages, client communication, event planning, marketing, and running a profitable party business.

STRICT RULES:
- ONLY answer questions about running a kids party or children's entertainment business
- If asked anything unrelated (coding, homework, politics, recipes, general chat, etc.), say: "I'm your party business assistant! I'm only able to help with party business topics like pricing, bookings, marketing, and client management. What party business question can I help with?"
- Keep answers practical, action-oriented, and under 200 words unless the topic truly requires more
- Use a warm, encouraging tone — business owners are often overwhelmed and need both advice AND confidence
- Give specific, usable answers — not generic platitudes
- When relevant, mention that Party Biz Hub tools (Quote Builder, Contract, Profit Calculator) can help automate the task`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured on server.' });

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages array required' });
  }

  // Safety: only pass last 10 messages to keep cost low
  const recent = messages.slice(-10);

  const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://partybizhub.com',
      'X-Title': 'Party Biz Hub'
    },
    body: JSON.stringify({
      model: 'anthropic/claude-3-haiku',
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...recent],
      max_tokens: 600,
      temperature: 0.72
    })
  });

  if (!upstream.ok) {
    const err = await upstream.text();
    return res.status(502).json({ error: 'Upstream error', detail: err });
  }

  const data = await upstream.json();
  return res.json(data);
}
