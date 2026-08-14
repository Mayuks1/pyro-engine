const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

// 1. DYNAMIC CORS CONFIGURATION
app.use(cors({
    origin: '*', // Allows all websites to connect
    methods: ['GET', 'POST', 'DELETE', 'PUT', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// 2. CONFIGURATION
const GITHUB_TOKEN = process.env.GH_TOKEN;
const RENDER_KEY = process.env.RD_KEY;
const GITHUB_USER = process.env.GH_USER;
const DB_URL = "https://songsaas-default-rtdb.asia-southeast1.firebasedatabase.app";

const ghHeader = { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' };
const rdHeader = { Authorization: `Bearer ${RENDER_KEY}`, 'Content-Type': 'application/json' };

// --- AUTO-IGNITE WRAPPER ---
const PYRO_WRAPPER = `
import os, threading
from flask import Flask
app = Flask(__name__)
@app.route('/')
def h(): return "STAY_ALIVE"
def r(): app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 10000)))
threading.Thread(target=r, daemon=True).start()
`;

// Health Check for Render & Cron-Job
app.get('/', (req, res) => {
    res.status(200).send("PyroCore Engine: Operational ✅");
});

// 3. DEPLOY BOT
app.post('/deploy', async (req, res) => {
    const { botName, botCode, requirements } = req.body;
    const repoName = `pyro-bot-${Date.now()}`;
    const finalCode = PYRO_WRAPPER + "\n" + botCode;

    try {
        await axios.post('https://api.github.com/user/repos', { name: repoName, private: true }, { headers: ghHeader });
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/bot.py`, { message: "ignite", content: Buffer.from(finalCode).toString('base64') }, { headers: ghHeader });
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/requirements.txt`, { message: "reqs", content: Buffer.from(requirements || "pyTelegramBotAPI\nflask\ngunicorn").toString('base64') }, { headers: ghHeader });
        
        const owners = await axios.get("https://api.render.com/v1/owners", { headers: rdHeader });
        const renderRes = await axios.post("https://api.render.com/v1/services", {
            type: "web_service", name: botName, ownerId: owners.data[0].owner.id,
            repo: `https://github.com/${GITHUB_USER}/${repoName}`, branch: "main",
            serviceDetails: { env: "python", plan: "free", envSpecificDetails: { buildCommand: "pip install -r requirements.txt", startCommand: "gunicorn bot:app --bind 0.0.0.0:$PORT --daemon && python bot.py" }}
        }, { headers: rdHeader });

        const botUrl = renderRes.data.service ? renderRes.data.service.url : `https://${botName}.onrender.com`;
        res.json({ success: true, id: renderRes.data.id || renderRes.data.service.id, repo: repoName, url: botUrl });
    } catch (e) {
        res.status(500).json({ success: false, error: e.response?.data?.message || e.message });
    }
});

// 4. POWER CONTROL
app.post('/control', async (req, res) => {
    const { serviceId, action } = req.body;
    const ep = action === 'resume' ? 'resume' : 'suspend';
    try {
        await axios.post(`https://api.render.com/v1/services/${serviceId}/${ep}`, {}, { headers: rdHeader });
        if(action === 'resume') await axios.post(`https://api.render.com/v1/services/${serviceId}/deploys`, {clearCache:"clear"}, { headers: rdHeader });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 5. STATUS POLLING
app.get('/status/:id', async (req, res) => {
    try {
        const r = await axios.get(`https://api.render.com/v1/services/${req.params.id}`, { headers: rdHeader });
        res.json({ success: true, status: r.data.suspended === 'suspended' ? 'STOPPED' : 'RUNNING' });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 6. PURGE ENGINE
app.post('/delete', async (req, res) => {
    const { serviceId, repoName } = req.body;
    try {
        if (serviceId) await axios.delete(`https://api.render.com/v1/services/${serviceId}`, { headers: rdHeader });
        if (repoName) await axios.delete(`https://api.github.com/repos/${GITHUB_USER}/${repoName}`, { headers: ghHeader });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 7. HEARTBEAT SYSTEM
setInterval(async () => {
    try {
        const response = await axios.get(`${DB_URL}/users.json`);
        const users = response.data;
        if (!users) return;
        Object.values(users).forEach(u => {
            if (u.bots) Object.values(u.bots).forEach(b => {
                if (b.status === 'running' && b.botUrl) axios.get(b.botUrl).catch(() => {});
            });
        });
    } catch (e) {}
}, 10 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Engine Online on Port ${PORT}`));
