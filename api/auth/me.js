// api/auth/me.js
export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const cookies = parseCookies(req.headers.cookie || '');
    const sessionCookie = cookies.session;

    if (!sessionCookie) {
        return res.status(200).json({ loggedIn: false });
    }

    try {
        const session = JSON.parse(Buffer.from(sessionCookie, 'base64url').toString());

        if (!session || !session.id || !session.username) {
            return res.status(200).json({ loggedIn: false });
        }

        let avatarUrl = null;
        if (session.avatar) {
            const ext = session.avatar.startsWith('a_') ? 'gif' : 'png';
            avatarUrl = 'https://cdn.discordapp.com/avatars/' +
                        session.id + '/' + session.avatar + '.' + ext + '?size=128';
        } else {
            const defaultIdx = session.discriminator === '0'
                ? (BigInt(session.id) >> 22n) % 6n
                : Number(session.discriminator) % 5;
            avatarUrl = 'https://cdn.discordapp.com/embed/avatars/' + defaultIdx + '.png';
        }

        return res.status(200).json({
            loggedIn: true,
            user: {
                id: session.id,
                username: session.username,
                displayName: session.global_name || session.username,
                avatar: avatarUrl,
                discriminator: session.discriminator
            }
        });

    } catch (err) {
        return res.status(200).json({ loggedIn: false });
    }
}

function parseCookies(cookieHeader) {
    const cookies = {};
    cookieHeader.split(';').forEach(function (pair) {
        const idx = pair.indexOf('=');
        if (idx > 0) {
            cookies[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
        }
    });
    return cookies;
}
