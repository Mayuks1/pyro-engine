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

// --- AUTO-IGNITE WRAPPERS (Hides the boring stuff from users) ---
const PYRO_WRAPPER_PY = `
# --- PYROCORE AUTO-IGNITE START ---
from flask import Flask
from threading import Thread
import os
pyro_app = Flask(__name__)
@pyro_app.route('/')
def pyro_h(): return "PyroCore Engine: Online"
def pyro_r(): pyro_app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 10000)))
Thread(target=pyro_r).start()
# --- PYROCORE AUTO-IGNITE END ---

`;

const PYRO_WRAPPER_JS = `
// --- PYROCORE AUTO-IGNITE START ---
const http = require('http');
http.createServer((req, res) => { res.write('PyroCore Engine: Online'); res.end(); }).listen(process.env.PORT || 10000);
// --- PYROCORE AUTO-IGNITE END ---

`;

const injectWrapper = (content, filename) => {
    if (content.includes("PYROCORE AUTO-IGNITE")) return content; // Don't double inject
    if (filename.endsWith('.py')) return PYRO_WRAPPER_PY + content;
    if (filename.endsWith('.js')) return PYRO_WRAPPER_JS + content;
    return content;
};

// 1. DEPLOY (With Auto-Injection)
app.post('/deploy', async (req, res) => {
    const { botName, botCode, requirements } = req.body;
    const repoName = `bot-${Date.now()}`;
    const mainFile = botCode.includes('import') || botCode.includes('from') ? 'bot.py' : 'index.js';
    const finalCode = injectWrapper(botCode, mainFile);

    try {
        await axios.post('https://api.github.com/user/repos', { name: repoName, private: true }, { headers: ghHeader });
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/${mainFile}`, { 
            message: "auto-ignite", content: Buffer.from(finalCode).toString('base64') 
        }, { headers: ghHeader });
        
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/requirements.txt`, { 
            message: "reqs", content: Buffer.from(requirements || "pyTelegramBotAPI\nflask\ngunicorn").toString('base64') 
        }, { headers: ghHeader });

        const owners = await axios.get("https://api.render.com/v1/owners", { headers: rdHeader });
        const renderRes = await axios.post("https://api.render.com/v1/services", {
            type: "web_service", name: botName, ownerId: owners.data[0].owner.id,
            repo: `https://github.com/${GITHUB_USER}/${repoName}`, branch: "main",
            serviceDetails: { env: "python", plan: "free", envSpecificDetails: { buildCommand: "pip install -r requirements.txt", startCommand: `python ${mainFile}` }}
        }, { headers: rdHeader });

        res.json({ success: true, id: renderRes.data.id || renderRes.data.service.id, repo: repoName, url: renderRes.data.service.url });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 2. FILE MANAGER (With Auto-Injection & Cleaning)
app.post('/files', async (req, res) => {
    const { repo, path, content, sha, action } = req.body;
    const url = `https://api.github.com/repos/${GITHUB_USER}/${repo}/contents/${path}`;
    try {
        if (action === 'list') return res.json((await axios.get(`https://api.github.com/repos/${GITHUB_USER}/${repo}/contents/`, { headers: ghHeader })).data);
        
        if (action === 'get') {
            const r = await axios.get(url, { headers: ghHeader });
            let raw = Buffer.from(r.data.content, 'base64').toString();
            // REMOVE WRAPPER before showing to user in editor
            const clean = raw.split("# --- PYROCORE AUTO-IGNITE END ---").pop().split("// --- PYROCORE AUTO-IGNITE END ---").pop();
            return res.json({ content: clean.trim(), sha: r.data.sha });
        }

        if (action === 'save') {
            const finalCode = injectWrapper(content, path);
            await axios.put(url, { message: "edit", content: Buffer.from(finalCode).toString('base64'), sha: sha }, { headers: ghHeader });
        }
        
        if (action === 'delete') await axios.delete(url, { data: { message: "del", sha: sha }, headers: ghHeader });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 3. STATUS & CONTROL & HEARTBEAT
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

app.post('/delete', async (req, res) => {
    const { serviceId, repoName } = req.body;
    if (serviceId) await axios.delete(`https://api.render.com/v1/services/${serviceId}`, { headers: rdHeader }).catch(()=>{});
    if (repoName) await axios.delete(`https://api.github.com/repos/${GITHUB_USER}/${repoName}`, { headers: ghHeader }).catch(()=>{});
    res.json({ success: true });
});

// HEARTBEAT LOOP (Pings all active bots every 10 mins)
setInterval(async () => {
    try {
        const s = await axios.get("https://api.render.com/v1/services?limit=50", { headers: rdHeader });
        s.data.forEach(b => { if(b.service.suspended === 'not_suspended') axios.get(b.service.url).catch(()=>{}); });
    } catch(e){}
}, 10 * 60 * 1000);

app.listen(process.env.PORT || 3000);
