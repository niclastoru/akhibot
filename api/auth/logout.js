// api/auth/logout.js
// Loggt den User aus

export default function handler(req, res) {
    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Session-Cookie löschen
    res.setHeader('Set-Cookie',
        'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
    );

    if (req.method === 'POST') {
        return res.status(200).json({ success: true });
    }

    // GET → Redirect zur Startseite
    res.redirect(302, '/');
}
