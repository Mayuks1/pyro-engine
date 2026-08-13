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

// --- AUTO-IGNITE TECHNOLOGY (Mandatory for Render Health Checks) ---
const PYRO_WRAPPER_PY = `
# --- PYROCORE AUTO-IGNITE START ---
import os, threading
from flask import Flask
pyro_app = Flask(__name__)
@pyro_app.route('/')
def pyro_h(): return "Engine: Online"
def pyro_r():
    port = int(os.environ.get('PORT', 10000))
    pyro_app.run(host='0.0.0.0', port=port)
threading.Thread(target=pyro_r, daemon=True).start()
# --- PYROCORE AUTO-IGNITE END ---

`;

const injectWrapper = (content) => {
    if (content.includes("PYROCORE AUTO-IGNITE")) return content;
    return PYRO_WRAPPER_PY + content;
};

app.get('/', (req, res) => { res.send("PyroCore Engine v10.0: Sovereign System Online ✅"); });

// 1. DEPLOY BOT
app.post('/deploy', async (req, res) => {
    const { botName, botCode, requirements } = req.body;
    const repoName = `bot-${Date.now()}`;
    const finalCode = injectWrapper(botCode);

    try {
        await axios.post('https://api.github.com/user/repos', { name: repoName, private: true }, { headers: ghHeader });
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/bot.py`, { 
            message: "ignition", content: Buffer.from(finalCode).toString('base64') 
        }, { headers: ghHeader });
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/requirements.txt`, { 
            message: "reqs", content: Buffer.from(requirements || "pyTelegramBotAPI\ndiscord.py\nflask\ngunicorn").toString('base64') 
        }, { headers: ghHeader });

        const owners = await axios.get("https://api.render.com/v1/owners", { headers: rdHeader });
        const renderRes = await axios.post("https://api.render.com/v1/services", {
            type: "web_service", name: botName, ownerId: owners.data[0].owner.id,
            repo: `https://github.com/${GITHUB_USER}/${repoName}`, branch: "main",
            serviceDetails: {
                env: "python", plan: "free",
                envSpecificDetails: { 
                    buildCommand: "pip install -r requirements.txt", 
                    // CRITICAL FIX: Use gunicorn as the entry point to satisfy port check instantly
                    startCommand: "gunicorn bot:pyro_app --bind 0.0.0.0:$PORT --daemon && python bot.py" 
                }
            }
        }, { headers: rdHeader });

        res.json({ success: true, id: renderRes.data.id || renderRes.data.service.id, repo: repoName, url: renderRes.data.service.url });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 2. FIXED ENVIRONMENT SYSTEM
app.post('/env', async (req, res) => {
    const { serviceId, envVars } = req.body; 
    try {
        await axios.put(`https://api.render.com/v1/services/${serviceId}/env-vars`, 
            envVars.map(ev => ({ key: ev.key.toUpperCase(), value: ev.value })), { headers: rdHeader });
        // Trigger REBUILD to ensure variables are loaded
        await axios.post(`https://api.render.com/v1/services/${serviceId}/deploys`, { clearCache: "clear" }, { headers: rdHeader });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: "Cloud Sync Failed" }); }
});

// 3. POWER CONTROL
app.post('/control', async (req, res) => {
    const { serviceId, action } = req.body;
    const ep = action === 'resume' ? 'resume' : 'suspend';
    try {
        await axios.post(`https://api.render.com/v1/services/${serviceId}/${ep}`, {}, { headers: rdHeader });
        if(action === 'resume') await axios.post(`https://api.render.com/v1/services/${serviceId}/deploys`, { clearCache: "do_not_clear" }, { headers: rdHeader });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 4. REAL STATUS
app.get('/status/:id', async (req, res) => {
    try {
        const r = await axios.get(`https://api.render.com/v1/services/${req.params.id}`, { headers: rdHeader });
        res.json({ success: true, status: r.data.suspended === 'suspended' ? 'STOPPED' : 'RUNNING' });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 5. FILE MANAGER
app.post('/files', async (req, res) => {
    const { repo, path, content, sha, action } = req.body;
    const url = `https://api.github.com/repos/${GITHUB_USER}/${repo}/contents/${path}`;
    try {
        if (action === 'list') return res.json((await axios.get(`https://api.github.com/repos/${GITHUB_USER}/${repo}/contents/`, { headers: ghHeader })).data);
        if (action === 'get') {
            const r = await axios.get(url, { headers: ghHeader });
            let raw = Buffer.from(r.data.content, 'base64').toString();
            const clean = raw.includes("# --- PYROCORE AUTO-IGNITE END ---") ? raw.split("# --- PYROCORE AUTO-IGNITE END ---")[1].trim() : raw;
            return res.json({ content: clean, sha: r.data.sha });
        }
        if (action === 'save') {
            const finalCode = injectWrapper(content);
            await axios.put(url, { message: "edit", content: Buffer.from(finalCode).toString('base64'), sha: sha }, { headers: ghHeader });
            res.json({ success: true });
        }
        if (action === 'delete') {
            await axios.delete(url, { data: { message: "del", sha: sha }, headers: ghHeader });
            res.json({ success: true });
        }
    } catch (e) { res.status(500).json({ success: false }); }
});

// 6. DELETE PURGE
app.post('/delete', async (req, res) => {
    const { serviceId, repoName } = req.body;
    try {
        if (serviceId) await axios.delete(`https://api.render.com/v1/services/${serviceId}`, { headers: rdHeader });
        if (repoName) await axios.delete(`https://api.github.com/repos/${GITHUB_USER}/${repoName}`, { headers: ghHeader });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Engine Sovereign v10.0 Online`));
