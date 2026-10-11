// api/chat.js
// Vercel Serverless Function – Proxy für KI-Chat mit Rate Limiting

export const config = {
    runtime: 'nodejs',
    maxDuration: 30
};

// ========== IN-MEMORY RATE LIMIT STORAGE ==========
const rateLimitStore = new Map();

const RATE_LIMIT = {
    maxRequests: 10,
    windowMs: 60 * 1000,
    blockDurationMs: 5 * 60 * 1000
};

function getClientIP(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return String(forwarded).split(',')[0].trim();
    }
    return req.headers['x-real-ip'] ||
           (req.socket && req.socket.remoteAddress) ||
           'unknown';
}

function checkRateLimit(ip) {
    const now = Date.now();
    const record = rateLimitStore.get(ip);

    if (!record) {
        rateLimitStore.set(ip, {
            count: 1,
            firstRequest: now,
            blockedUntil: 0
        });
        return { allowed: true, remaining: RATE_LIMIT.maxRequests - 1 };
    }

    if (record.blockedUntil > now) {
        return {
            allowed: false,
            blocked: true,
            retryAfter: Math.ceil((record.blockedUntil - now) / 1000)
        };
    }

    if (now - record.firstRequest > RATE_LIMIT.windowMs) {
        record.count = 1;
        record.firstRequest = now;
        record.blockedUntil = 0;
        rateLimitStore.set(ip, record);
        return { allowed: true, remaining: RATE_LIMIT.maxRequests - 1 };
    }

    record.count++;

    if (record.count > RATE_LIMIT.maxRequests) {
        record.blockedUntil = now + RATE_LIMIT.blockDurationMs;
        rateLimitStore.set(ip, record);
        return {
            allowed: false,
            blocked: true,
            retryAfter: Math.ceil(RATE_LIMIT.blockDurationMs / 1000)
        };
    }

    rateLimitStore.set(ip, record);
    return { allowed: true, remaining: RATE_LIMIT.maxRequests - record.count };
}

setInterval(() => {
    const now = Date.now();
    const maxAge = RATE_LIMIT.windowMs * 2;
    for (const [ip, record] of rateLimitStore.entries()) {
        if (now - record.firstRequest > maxAge && record.blockedUntil < now) {
            rateLimitStore.delete(ip);
        }
    }
}, 5 * 60 * 1000);


export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const clientIP = getClientIP(req);
    const rateCheck = checkRateLimit(clientIP);

    if (!rateCheck.allowed) {
        console.warn('Rate limit hit for IP:', clientIP);
        return res.status(429).json({
            error: 'Too many requests',
            message: 'You have sent too many messages. Please wait a few minutes.',
            retryAfter: rateCheck.retryAfter,
            fallback: true
        });
    }

    res.setHeader('X-RateLimit-Remaining', String(rateCheck.remaining || 0));

    let body = req.body;

    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { body = {}; }
    }

    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
        body = await new Promise(function (resolve) {
            let data = '';
            req.on('data', function (chunk) { data += chunk; });
            req.on('end', function () {
                try { resolve(JSON.parse(data)); } catch (e) { resolve({}); }
            });
            req.on('error', function () { resolve({}); });
        });
    }

    const message = body && body.message;
    const history = body && body.history;

    if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'Message required' });
    }

    if (message.length > 500) {
        return res.status(400).json({ error: 'Message too long (max 500 chars)' });
    }

    const apiKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY;

    if (!apiKey) {
        console.error('No API key found in environment variables');
        return res.status(500).json({
            error: 'AI service not configured',
            fallback: true
        });
    }

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

    try {
        const useGroq = !!process.env.GROQ_API_KEY;
        const endpoint = useGroq
            ? 'https://api.groq.com/openai/v1/chat/completions'
            : 'https://api.openai.com/v1/chat/completions';

        const model = useGroq ? 'openai/gpt-oss-120b' : 'gpt-4o-mini';

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

        if (!aiRes.ok) {
            const errText = await aiRes.text();
            console.error('AI API error:', aiRes.status, errText);

            if (aiRes.status === 404 && useGroq) {
                console.log('Trying fallback model: openai/gpt-oss-20b');

                const fallbackRes = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + apiKey
                    },
                    body: JSON.stringify({
                        model: 'openai/gpt-oss-20b',
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

        const data = await aiRes.json();

        const reply = data && data.choices && data.choices[0] &&
                      data.choices[0].message && data.choices[0].message.content
                      ? String(data.choices[0].message.content).trim()
                      : null;

        if (!reply) {
            return res.status(500).json({ error: 'Empty response', fallback: true });
        }

        return res.status(200).json({
            reply: reply,
            remaining: rateCheck.remaining
        });

    } catch (err) {
        console.error('Server error:', err && err.message);
        return res.status(500).json({
            error: 'Server error',
            fallback: true,
            detail: err && err.message
        });
    }
}
