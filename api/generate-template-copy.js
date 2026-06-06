module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
  const { name, theme } = req.body || {};

  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!OPENROUTER_KEY) return res.status(200).json({ error: 'OPENROUTER_API_KEY not set in Vercel env vars' });

  const prompt = `You are helping a party printables business owner. Write copy for a digital template pack listing.

Template name: "${name}"
Theme: "${theme || 'General party'}"

Write TWO things:

1. DESCRIPTION — 2 sentences for party planners browsing a template library. Mention that it's a complete bundle and name 4-5 specific printable types included (chip bags, water bottle labels, cupcake toppers, etc). Make it sound professional and exciting.

2. INSTRUCTIONS — Exactly 5 steps telling a customer how to use this Canva template pack after purchase. Assume they received a ZIP file with a Canva template link inside. Keep steps short and clear.

Respond ONLY with valid JSON in this exact format — no extra text:
{"description": "your description here", "instructions": "Step 1 text here\nStep 2 text here\nStep 3 text here\nStep 4 text here\nStep 5 text here"}`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + OPENROUTER_KEY,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://partybizhub.com',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-3.5-haiku',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
      }),
    });

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Could not parse AI response');

    const parsed = JSON.parse(jsonMatch[0]);
    return res.json({
      description: parsed.description || '',
      instructions: parsed.instructions || '',
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};