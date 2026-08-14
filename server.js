const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// 1. CONFIGURATION
const GITHUB_TOKEN = process.env.GH_TOKEN;
const RENDER_KEY = process.env.RD_KEY;
const GITHUB_USER = process.env.GH_USER;
// Use your RTDB URL from your firebase config
const DB_URL = "https://songsaas-default-rtdb.asia-southeast1.firebasedatabase.app";

const ghHeader = { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' };
const rdHeader = { Authorization: `Bearer ${RENDER_KEY}`, 'Content-Type': 'application/json' };

// --- AUTO-IGNITE: Invisible Flask Injection ---
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
    res.send("PyroCore Engine v15.0: Sovereign Active ✅");
});

// 2. DEPLOY BOT
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
        res.status(500).json({ success: false, error: e.message });
    }
});

// 3. HEARTBEAT SYSTEM (Keeps Bots Online)
const runHeartbeat = async () => {
    console.log("💓 Running Heartbeat...");
    try {
        // Fetch all user data from Firebase RTDB (.json adds no complexity)
        const response = await axios.get(`${DB_URL}/users.json`);
        const users = response.data;
        if (!users) return;

        Object.values(users).forEach(user => {
            if (user.bots) {
                Object.values(user.bots).forEach(bot => {
                    if (bot.status === 'running' && bot.botUrl) {
                        // Ping the bot to keep it awake
                        axios.get(bot.botUrl).catch(() => {});
                    }
                });
            }
        });
    } catch (e) {
        console.log("Heartbeat error: skipping cycle.");
    }
};

// Start the Heartbeat every 5 minutes
setInterval(runHeartbeat, 5 * 60 * 1000);

// 4. CONTROL, FILES, DELETE (Simplified)
app.post('/control', async (req, res) => {
    const { serviceId, action } = req.body;
    const ep = action === 'resume' ? 'resume' : 'suspend';
    await axios.post(`https://api.render.com/v1/services/${serviceId}/${ep}`, {}, { headers: rdHeader }).catch(()=>{});
    if(action === 'resume') axios.post(`https://api.render.com/v1/services/${serviceId}/deploys`, {clearCache:"clear"}, { headers: rdHeader }).catch(()=>{});
    res.json({ success: true });
});

app.post('/delete', async (req, res) => {
    const { serviceId, repoName } = req.body;
    if (serviceId) axios.delete(`https://api.render.com/v1/services/${serviceId}`, { headers: rdHeader }).catch(()=>{});
    if (repoName) axios.delete(`https://api.github.com/repos/${GITHUB_USER}/${repoName}`, { headers: ghHeader }).catch(()=>{});
    res.json({ success: true });
});

app.post('/files', async (req, res) => {
    const { repo, path, content, sha, action } = req.body;
    const url = `https://api.github.com/repos/${GITHUB_USER}/${repo}/contents/${path}`;
    try {
        if (action === 'list') return res.json((await axios.get(`https://api.github.com/repos/${GITHUB_USER}/${repo}/contents/`, { headers: ghHeader })).data);
        if (action === 'save') await axios.put(url, { message: "edit", content: Buffer.from(path === 'bot.py' ? PYRO_WRAPPER + content : content).toString('base64'), sha: sha }, { headers: ghHeader });
        if (action === 'delete') await axios.delete(url, { data: { message: "del", sha: sha }, headers: ghHeader });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Engine Online on Port ${PORT}`));
