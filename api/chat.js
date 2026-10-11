// api/chat.js
// Vercel Serverless Function – Proxy für KI-Chat
// Verhindert, dass der API-Key im Browser sichtbar ist

export const config = {
    runtime: 'nodejs',
    maxDuration: 30
};

export default async function handler(req, res) {
    // ========== CORS-HEADER ==========
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // ========== METHOD CHECK ==========
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // ========== BODY MANUELL PARSEN (Vercel parst es NICHT automatisch) ==========
    let body = req.body;

    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch (e) {
            body = {};
        }
    }

    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
        body = await new Promise(function (resolve) {
            let data = '';
            req.on('data', function (chunk) { data += chunk; });
            req.on('end', function () {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve({});
                }
            });
            req.on('error', function () { resolve({}); });
        });
    }

    const message = body && body.message;
    const history = body && body.history;

    // ========== VALIDATION ==========
    if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'Message required' });
    }

    if (message.length > 500) {
        return res.status(400).json({ error: 'Message too long (max 500 chars)' });
    }

    // ========== API KEY ==========
    const apiKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;

    if (!apiKey) {
        console.error('No API key found in environment variables');
        return res.status(500).json({
            error: 'AI service not configured',
            fallback: true
        });
    }

    // ========== SYSTEM PROMPT ==========
    const systemPrompt = 'You are Akhi Bot, a friendly and helpful Discord bot assistant for the website akhibot.com.\n\n' +
        'About Akhi Bot:\n' +
        '- 180+ commands across 17 categories\n' +
        '- Features: Moderation, Leveling, Music, Economy, Games, VoiceMaster, Giveaways, Logging, Booster roles, Team management\n' +
        '- Owner and Developer: Baris Al Kurdi\n' +
        '- Currently UNDER MAINTENANCE - the bot is temporarily unavailable due to technical issues but will come back soon, better and more stable than ever\n' +
        '- Free to use, with optional Premium tier\n\n' +
        'Your job:\n' +
        '- Answer questions about Akhi Bot clearly and friendly\n' +
        '- If asked about commands, list the relevant ones\n' +
        '- If asked something unrelated, politely redirect to Akhi Bot topics\n' +
        '- Keep responses SHORT (max 3 sentences unless asked for details)\n' +
        '- Use a casual, friendly tone - like a Discord bot would\n' +
        '- If asked about the bot being offline, mention it is under maintenance and coming back soon\n' +
        '- Never make up features that do not exist\n' +
        '- You can use emojis occasionally';

    // ========== MESSAGE HISTORY ==========
    const messages = [{ role: 'system', content: systemPrompt }];

    if (Array.isArray(history)) {
        history.slice(-6).forEach(function (item) {
            if (item && item.role && item.content && typeof item.content === 'string') {
                messages.push({
                    role: item.role === 'user' ? 'user' : 'assistant',
                    content: item.content.slice(0, 500)
                });
            }
        });
    }

    messages.push({ role: 'user', content: message });

    // ========== AI REQUEST ==========
    try {
        const useGroq = !!process.env.GROQ_API_KEY;
        const endpoint = useGroq
            ? 'https://api.groq.com/openai/v1/chat/completions'
            : 'https://api.openai.com/v1/chat/completions';

        // ========== MODELL-NAME (korrigiert!) ==========
        // Groq: llama-3.3-70b-versatile (aktuell gültig)
        // OpenAI: gpt-4o-mini
        const model = useGroq ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini';

        const aiRes = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                max_tokens: 250,
                temperature: 0.7
            })
        });

        // ========== AI ERROR HANDLING ==========
        if (!aiRes.ok) {
            const errText = await aiRes.text();
            console.error('AI API error:', aiRes.status, errText);

            // Wenn Modell nicht existiert → Fallback auf anderes Modell
            if (aiRes.status === 404 && useGroq) {
                console.log('Trying fallback model: llama-3.1-8b-instant');

                const fallbackRes = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + apiKey
                    },
                    body: JSON.stringify({
                        model: 'llama-3.1-8b-instant',
                        messages: messages,
                        max_tokens: 250,
                        temperature: 0.7
                    })
                });

                if (fallbackRes.ok) {
                    const fallbackData = await fallbackRes.json();
                    const fallbackReply = fallbackData && fallbackData.choices && fallbackData.choices[0] &&
                                          fallbackData.choices[0].message && fallbackData.choices[0].message.content
                                          ? String(fallbackData.choices[0].message.content).trim()
                                          : null;

                    if (fallbackReply) {
                        return res.status(200).json({ reply: fallbackReply });
                    }
                }
            }

            return res.status(500).json({
                error: 'AI service error',
                fallback: true,
                status: aiRes.status
            });
        }

        // ========== RESPONSE PARSEN ==========
        const data = await aiRes.json();

        const reply = data && data.choices && data.choices[0] &&
                      data.choices[0].message && data.choices[0].message.content
                      ? String(data.choices[0].message.content).trim()
                      : null;

        if (!reply) {
            return res.status(500).json({ error: 'Empty response', fallback: true });
        }

        return res.status(200).json({ reply: reply });

    } catch (err) {
        console.error('Server error:', err && err.message);
        return res.status(500).json({
            error: 'Server error',
            fallback: true,
            detail: err && err.message
        });
    }
}
