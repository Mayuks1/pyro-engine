const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

const GITHUB_TOKEN = process.env.GH_TOKEN;
const RENDER_KEY = process.env.RD_KEY;
const GITHUB_USER = process.env.GH_USER;

const ghHeader = { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' };
const rdHeader = { Authorization: `Bearer ${RENDER_KEY}`, 'Content-Type': 'application/json' };

// --- AUTO-IGNITE: No more user-pasted Flask code ---
const PYRO_WRAPPER = `
import os, threading, time, requests
from flask import Flask
pyro_app = Flask(__name__)
@pyro_app.route('/')
def h(): return "ALIVE"
def run_p(): pyro_app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 10000)))
threading.Thread(target=run_p, daemon=True).start()
`;

app.get('/', (req, res) => { res.send("PyroCore Engine v15.0: Sovereign Active ✅"); });

// 1. DEPLOY (Automatic Flask Injection)
app.post('/deploy', async (req, res) => {
    const { botName, botCode, requirements } = req.body;
    const repoName = `pyro-bot-${Date.now()}`;
    const finalCode = PYRO_WRAPPER + "\n" + botCode;

    try {
        await axios.post('https://api.github.com/user/repos', { name: repoName, private: true }, { headers: ghHeader });
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/bot.py`, { message: "init", content: Buffer.from(finalCode).toString('base64') }, { headers: ghHeader });
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/requirements.txt`, { message: "init", content: Buffer.from(requirements || "pyTelegramBotAPI\nflask\ngunicorn").toString('base64') }, { headers: ghHeader });
        
        const owners = await axios.get("https://api.render.com/v1/owners", { headers: rdHeader });
        const renderRes = await axios.post("https://api.render.com/v1/services", {
            type: "web_service", name: botName, ownerId: owners.data[0].owner.id,
            repo: `https://github.com/${GITHUB_USER}/${repoName}`, branch: "main",
            serviceDetails: { env: "python", plan: "free", envSpecificDetails: { buildCommand: "pip install -r requirements.txt", startCommand: "gunicorn bot:pyro_app --bind 0.0.0.0:$PORT --daemon && python bot.py" }}
        }, { headers: rdHeader });

        res.json({ success: true, id: renderRes.data.id || renderRes.data.service.id, repo: repoName, url: renderRes.data.service.url });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 2. STATUS & CONTROL
app.get('/status/:id', async (req, res) => {
    try {
        const r = await axios.get(`https://api.render.com/v1/services/${req.params.id}`, { headers: rdHeader });
        res.json({ success: true, status: r.data.suspended === 'suspended' ? 'STOPPED' : 'RUNNING' });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/control', async (req, res) => {
    const { serviceId, action } = req.body;
    const ep = action === 'resume' ? 'resume' : 'suspend';
    await axios.post(`https://api.render.com/v1/services/${serviceId}/${ep}`, {}, { headers: rdHeader }).catch(()=>{});
    if(action === 'resume') axios.post(`https://api.render.com/v1/services/${serviceId}/deploys`, {clearCache:"clear"}, { headers: rdHeader }).catch(()=>{});
    res.json({ success: true });
});

// 3. FILE MANAGER
app.post('/files', async (req, res) => {
    const { repo, path, content, sha, action } = req.body;
    const url = `https://api.github.com/repos/${GITHUB_USER}/${repo}/contents/${path}`;
    try {
        if (action === 'list') return res.json((await axios.get(`https://api.github.com/repos/${GITHUB_USER}/${repo}/contents/`, { headers: ghHeader })).data);
        if (action === 'get') {
            const r = await axios.get(url, { headers: ghHeader });
            let clean = Buffer.from(r.data.content, 'base64').toString();
            if(clean.includes("PYROCORE AUTO-IGNITE")) clean = clean.split("# --- PYROCORE AUTO-IGNITE END ---")[1];
            return res.json({ content: clean.trim(), sha: r.data.sha });
        }
        if (action === 'save') {
            const finalCode = path === 'bot.py' ? PYRO_WRAPPER + content : content;
            await axios.put(url, { message: "edit", content: Buffer.from(finalCode).toString('base64'), sha: sha }, { headers: ghHeader });
        }
        if (action === 'delete') await axios.delete(url, { data: { message: "del", sha: sha }, headers: ghHeader });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 4. ENVIRONMENT SYNC
app.post('/env', async (req, res) => {
    const { serviceId, envVars } = req.body; 
    try {
        await axios.put(`https://api.render.com/v1/services/${serviceId}/env-vars`, envVars.map(ev => ({ key: ev.key.toUpperCase(), value: ev.value })), { headers: rdHeader });
        await axios.post(`https://api.render.com/v1/services/${serviceId}/deploys`, { clearCache: "clear" }, { headers: rdHeader });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 5. THE MASTER HEARTBEAT (THE FIX)
// This loop pings ALL your bots every 5 minutes so they never sleep.
setInterval(async () => {
    try {
        const s = await axios.get("https://api.render.com/v1/services?limit=50", { headers: rdHeader });
        s.data.forEach(b => {
            if (b.service.suspended === 'not_suspended' && b.service.url) {
                console.log("Heartbeat pinging:", b.service.name);
                axios.get(b.service.url).catch(() => {});
            }
        });
    } catch (e) { console.log("Heartbeat error"); }
}, 5 * 60 * 1000);

app.listen(process.env.PORT || 3000);
