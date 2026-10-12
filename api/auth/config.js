// api/auth/config.js
export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({
        clientId: process.env.DISCORD_CLIENT_ID || '1488199377510989894'
    });
}
