// api/auth/login.js
// Startet den Discord OAuth2 Flow

export default function handler(req, res) {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const redirectUri = process.env.DISCORD_REDIRECT_URI;

    if (!clientId || !redirectUri) {
        return res.status(500).send('Auth not configured');
    }

    // Optional: Nach dem Login zurück zu einer bestimmten Seite
    const returnTo = (req.query.returnTo || '/').toString().slice(0, 200);

    // State Token gegen CSRF
    const state = Buffer.from(JSON.stringify({
        returnTo: returnTo,
        nonce: Math.random().toString(36).slice(2) + Date.now().toString(36)
    })).toString('base64url');

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'identify guilds',
        state: state,
        prompt: 'consent'
    });

    res.setHeader('Set-Cookie',
        'oauth_state=' + state + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600'
    );

    res.redirect(302, 'https://discord.com/oauth2/authorize?' + params.toString());
}
