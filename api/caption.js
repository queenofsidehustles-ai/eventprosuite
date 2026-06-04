module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });

  const { hook, post_type, platform, business_name, city, niche, mode } = req.body || {};

  const biz = business_name || 'my party business';
  const loc = city ? ` in ${city}` : '';
  const nicheLabel = niche || 'kids party entertainment';
  const nicheContext = niche ? `\nSPECIFIC NICHE: ${niche} — ALL content must be focused specifically on this. Do not drift into other party types.` : '';

  let prompt;

  if (mode === 'batch') {
    prompt = `You are a social media strategist specializing in ${nicheLabel} businesses.
Generate 7 varied social media post ideas for a full week for "${biz}"${loc}.${nicheContext}

IMPORTANT: Every single post idea must be specifically about ${nicheLabel}. Do not use generic party content — make it hyper-relevant to this niche.

Mix post types: party recaps, tips, promotional, behind the scenes, testimonials, seasonal, engagement.

Return ONLY valid JSON — no markdown, no explanation, just the JSON object:
{
  "ideas": [
    { "day": "Monday", "post_type": "After Party Recap", "platform": "Instagram", "hook": "Opening line to stop the scroll", "summary": "What to post and why it works" },
    { "day": "Tuesday", "post_type": "Tips & Advice", "platform": "TikTok", "hook": "Opening line", "summary": "Topic and angle" },
    { "day": "Wednesday", "post_type": "Behind the Scenes", "platform": "Instagram", "hook": "Opening line", "summary": "Topic and angle" },
    { "day": "Thursday", "post_type": "Package Promo", "platform": "Facebook", "hook": "Opening line", "summary": "Topic and angle" },
    { "day": "Friday", "post_type": "Testimonial", "platform": "Instagram", "hook": "Opening line", "summary": "Topic and angle" },
    { "day": "Saturday", "post_type": "After Party Recap", "platform": "TikTok", "hook": "Opening line", "summary": "Topic and angle" },
    { "day": "Sunday", "post_type": "Engagement", "platform": "Instagram", "hook": "Opening line", "summary": "Question or poll idea to drive comments" }
  ]
}`;
  } else {
    const platformGuide = {
      'Instagram': 'Instagram caption: 150-250 words, emojis throughout, storytelling, end with CTA and line break before hashtags',
      'TikTok': 'TikTok caption: 80-120 words, punchy, trending feel, 1-2 emojis, question at end',
      'Facebook': 'Facebook post: 100-200 words, conversational, warm community tone, end with question to drive comments'
    };
    const guide = platformGuide[platform] || platformGuide['Instagram'];

    const postTypeGuide = {
      'After Party Recap': 'Show off the finished setup. Make it vivid — colors, reactions, the moment. Build social proof.',
      'Package Promo': 'Sell the experience not just the service. Paint the picture of what the child will feel. Soft sell with value.',
      'Testimonial': 'Lead with the parent\'s exact emotion. Make it feel real and personal, not corporate.',
      'Behind the Scenes': 'Show the work and craft that goes into it. Build respect and authority. Show personality.',
      'Holiday/Seasonal': 'Connect the season or holiday to party planning. Create urgency around booking dates.',
      'Tips & Advice': 'Give genuinely useful party planning advice. Position as the local expert. Build trust before the ask.',
      'Engagement': 'Ask a fun question or poll to drive comments. Keep it party/kids themed. Light and playful.'
    };
    const typeGuide = postTypeGuide[post_type] || '';

    prompt = `You are an expert social media writer specializing in ${nicheLabel} businesses. Write content for "${biz}"${loc}.${nicheContext}

POST TYPE: ${post_type}
PLATFORM: ${platform}
CONTEXT/HOOK: ${hook}

STYLE GUIDE:
- ${guide}
- ${typeGuide}
- Business niche: ${nicheLabel} — every word must feel specific to this niche, not generic
- Use niche-specific language, imagery, and details that resonate with this audience
- Tone: warm, exciting, professional but fun — never corporate
- Always write as the business owner's authentic voice

Return ONLY valid JSON — no markdown, no explanation:
{
  "reel_hook": "One punchy opening line to stop the scroll (max 12 words, no hashtags)",
  "caption": "Full platform-appropriate caption with emojis",
  "story_caption": "Ultra-short 2-sentence version for Stories/Reels cover text",
  "hashtags": "#kidsparty #partytime (30 relevant hashtags as one string, mix of popular and niche)"
}`;
  }

  let upstream;
  try {
    upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://partybizhub.com',
        'X-Title': 'Party Biz Hub Content'
      },
      body: JSON.stringify({
        model: 'anthropic/claude-3.5-haiku',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: mode === 'batch' ? 2000 : 1200,
        temperature: 0.78
      })
    });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach AI: ' + e.message });
  }

  const text = await upstream.text();
  if (!upstream.ok) return res.status(502).json({ error: 'AI error: ' + text });

  try {
    const data = JSON.parse(text);
    const content = data?.choices?.[0]?.message?.content || '';
    // Strip markdown fences if present, then extract JSON object
    const stripped = content.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '').trim();
    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(502).json({ error: 'AI did not return valid JSON', raw: content.slice(0, 400) });
    const parsed = JSON.parse(jsonMatch[0]);
    return res.json(parsed);
  } catch (e) {
    return res.status(502).json({ error: 'Could not parse AI response', raw: text.slice(0, 400) });
  }
};
