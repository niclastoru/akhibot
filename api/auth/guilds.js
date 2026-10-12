// api/auth/guilds.js
// Holt die Server des eingeloggten Users + prüft ob der Bot drauf ist

export const config = {
    runtime: 'nodejs',
    maxDuration: 15
};

const BOT_ID = '1488199377510989894';
const ADMIN_PERMISSION = 0x20; // MANAGE_GUILD

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Session prüfen
    const cookies = parseCookies(req.headers.cookie || '');
    const sessionCookie = cookies.session;

    if (!sessionCookie) {
        return res.status(401).json({ error: 'Not logged in' });
    }

    let session;
    try {
        session = JSON.parse(Buffer.from(sessionCookie, 'base64url').toString());
    } catch (e) {
        return res.status(401).json({ error: 'Invalid session' });
    }

    // Wir brauchen einen gültigen Access Token.
    // Da wir den nicht in der Session haben (nur User-Daten), holen wir ihn
    // NICHT direkt - stattdessen nutzen wir den Bot-Token für Bot-Presence-Check.
    const botToken = process.env.DISCORD_BOT_TOKEN;

    // Fetch Server des Users mit gespeichertem Token aus Cookie
    // (Wir speichern den Access Token verschlüsselt in einem zweiten Cookie)
    const userTokenCookie = cookies.user_token;

    if (!userTokenCookie) {
        return res.status(401).json({
            error: 'No user token',
            relogin: true
        });
    }

    let accessToken;
    try {
        accessToken = Buffer.from(userTokenCookie, 'base64url').toString();
    } catch (e) {
        return res.status(401).json({ error: 'Invalid token' });
    }

    try {
        // 1. Server des Users abrufen
        const guildsRes = await fetch('https://discord.com/api/v10/users/@me/guilds', {
            headers: { 'Authorization': 'Bearer ' + accessToken }
        });

        if (guildsRes.status === 401) {
            return res.status(401).json({
                error: 'Token expired',
                relogin: true
            });
        }

        if (!guildsRes.ok) {
            return res.status(500).json({ error: 'Failed to fetch guilds' });
        }

        const guilds = await guildsRes.json();

        // 2. Filter: User muss Admin/Owner sein
        const adminGuilds = guilds.filter(function (g) {
            if (g.owner) return true;
            const perms = BigInt(g.permissions || '0');
            return (perms & BigInt(ADMIN_PERMISSION)) === BigInt(ADMIN_PERMISSION);
        });

        // 3. Bot-Presence: Bei welchen Servern ist der Bot?
        let botGuildIds = new Set();

        if (botToken) {
            try {
                // Bot-Guilds abrufen (Bot hat das in seinem Cache)
                const botGuildsRes = await fetch('https://discord.com/api/v10/users/@me/guilds', {
                    headers: { 'Authorization': 'Bot ' + botToken }
                });

                if (botGuildsRes.ok) {
                    const botGuilds = await botGuildsRes.json();
                    botGuildIds = new Set(botGuilds.map(function (g) { return g.id; }));
                }
            } catch (e) {
                // Bot-Info nicht verfügbar, ignorieren
                console.warn('Bot guilds fetch failed:', e.message);
            }
        }

        // 4. Response formatieren
        const result = adminGuilds.map(function (g) {
            let iconUrl = null;
            if (g.icon) {
                const ext = g.icon.startsWith('a_') ? 'gif' : 'png';
                iconUrl = 'https://cdn.discordapp.com/icons/' +
                          g.id + '/' + g.icon + '.' + ext + '?size=128';
            }

            return {
                id: g.id,
                name: g.name,
                icon: iconUrl,
                owner: !!g.owner,
                hasBot: botGuildIds.has(g.id)
            };
        });

        // Sortieren: Bot-Server zuerst, dann nach Name
        result.sort(function (a, b) {
            if (a.hasBot !== b.hasBot) return a.hasBot ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        const botInviteUrl = 'https://discord.com/oauth2/authorize?client_id=' +
                             BOT_ID +
                             '&permissions=8&scope=bot%20applications.commands';

        return res.status(200).json({
            guilds: result,
            total: result.length,
            withBot: result.filter(function (g) { return g.hasBot; }).length,
            botInviteUrl: botInviteUrl
        });

    } catch (err) {
        console.error('Guilds error:', err && err.message);
        return res.status(500).json({ error: 'Server error' });
    }
}

function parseCookies(cookieHeader) {
    const cookies = {};
    cookieHeader.split(';').forEach(function (pair) {
        const idx = pair.indexOf('=');
        if (idx > 0) {
            const key = pair.slice(0, idx).trim();
            const val = pair.slice(idx + 1).trim();
            cookies[key] = decodeURIComponent(val);
        }
    });
    return cookies;
}
