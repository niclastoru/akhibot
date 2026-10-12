// api/auth/callback.js
// Verarbeitet den Discord OAuth Callback

export const config = {
    runtime: 'nodejs',
    maxDuration: 15
};

export default async function handler(req, res) {
    const { code, state, error } = req.query;

    if (error) {
        return res.redirect(302, '/?auth_error=' + encodeURIComponent(String(error)));
    }

    if (!code || !state) {
        return res.redirect(302, '/?auth_error=missing_params');
    }

    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const redirectUri = process.env.DISCORD_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
        return res.redirect(302, '/?auth_error=not_configured');
    }

    const cookies = parseCookies(req.headers.cookie || '');
    const stateCookie = cookies.oauth_state;

    if (!stateCookie || stateCookie !== state) {
        return res.redirect(302, '/?auth_error=invalid_state');
    }

    let returnTo = '/';
    try {
        const decoded = JSON.parse(Buffer.from(state, 'base64url').toString());
        if (decoded && typeof decoded.returnTo === 'string') {
            returnTo = decoded.returnTo.startsWith('/') ? decoded.returnTo : '/';
        }
    } catch (e) {}

    try {
        // 1. Code gegen Access Token tauschen
        const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                grant_type: 'authorization_code',
                code: String(code),
                redirect_uri: redirectUri
            })
        });

        if (!tokenRes.ok) {
            console.error('Token exchange failed:', tokenRes.status, await tokenRes.text());
            return res.redirect(302, '/?auth_error=token_failed');
        }

        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;

        if (!accessToken) {
            return res.redirect(302, '/?auth_error=no_token');
        }

        // 2. User-Daten abrufen
        const userRes = await fetch('https://discord.com/api/v10/users/@me', {
            headers: { 'Authorization': 'Bearer ' + accessToken }
        });

        if (!userRes.ok) {
            return res.redirect(302, '/?auth_error=user_fetch_failed');
        }

        const user = await userRes.json();

        // 3. Session-Cookie mit User-Info setzen
        const sessionData = {
            id: user.id,
            username: user.username,
            discriminator: user.discriminator,
            global_name: user.global_name || null,
            avatar: user.avatar,
            created: Date.now()
        };

        const sessionValue = Buffer.from(JSON.stringify(sessionData)).toString('base64url');
        const tokenValue = Buffer.from(accessToken).toString('base64url');

        const secureCookie = 'session=' + sessionValue +
            '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + (60 * 60 * 24 * 30);

        // Access Token in eigenem Cookie (7 Tage gültig – Discord Token laufen nach 7 Tagen ab)
        const tokenCookie = 'user_token=' + tokenValue +
            '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + (60 * 60 * 24 * 7);

        const clearState = 'oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';

        res.setHeader('Set-Cookie', [secureCookie, tokenCookie, clearState]);
        return res.redirect(302, returnTo);

    } catch (err) {
        console.error('Callback error:', err && err.message);
        return res.redirect(302, '/?auth_error=server_error');
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
