const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// 1. ENGINE CONFIGURATION
const GITHUB_TOKEN = process.env.GH_TOKEN;
const RENDER_KEY = process.env.RD_KEY;
const GITHUB_USER = process.env.GH_USER;

const ghHeader = { 
    Authorization: `token ${GITHUB_TOKEN}`, 
    Accept: 'application/vnd.github.v3+json' 
};
const rdHeader = { 
    Authorization: `Bearer ${RENDER_KEY}`, 
    'Content-Type': 'application/json' 
};

// --- AUTO-IGNITE TECHNOLOGY ---
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

const injectWrapper = (content, filename) => {
    if (content.includes("PYROCORE AUTO-IGNITE")) return content;
    if (filename.endsWith('.py')) return PYRO_WRAPPER_PY + content;
    return content;
};

// --- SYSTEM HEALTH CHECK ---
app.get('/', (req, res) => { res.send("PyroCore Engine v9.5: Sovereign System Online ✅"); });

// 2. DEPLOY BOT
app.post('/deploy', async (req, res) => {
    const { botName, botCode, requirements } = req.body;
    const repoName = `bot-${Date.now()}`;
    const mainFile = 'bot.py';
    const finalCode = injectWrapper(botCode, mainFile);

    try {
        // Create GitHub Repo
        await axios.post('https://api.github.com/user/repos', { name: repoName, private: true }, { headers: ghHeader });
        
        // Upload Files
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/${mainFile}`, { 
            message: "ignition", content: Buffer.from(finalCode).toString('base64') 
        }, { headers: ghHeader });
        
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/requirements.txt`, { 
            message: "reqs", content: Buffer.from(requirements || "pyTelegramBotAPI\nflask\ngunicorn").toString('base64') 
        }, { headers: ghHeader });

        // Create Render Service
        const owners = await axios.get("https://api.render.com/v1/owners", { headers: rdHeader });
        const renderRes = await axios.post("https://api.render.com/v1/services", {
            type: "web_service", name: botName, ownerId: owners.data[0].owner.id,
            repo: `https://github.com/${GITHUB_USER}/${repoName}`, branch: "main",
            serviceDetails: {
                env: "python", plan: "free",
                envSpecificDetails: { buildCommand: "pip install -r requirements.txt", startCommand: `python ${mainFile}` }
            }
        }, { headers: rdHeader });

        res.json({ 
            success: true, 
            id: renderRes.data.id || renderRes.data.service.id, 
            repo: repoName,
            url: renderRes.data.service ? renderRes.data.service.url : "" 
        });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 3. CORRECTED ENVIRONMENT SYSTEM (THE FIX)
app.post('/env', async (req, res) => {
    const { serviceId, envVars } = req.body; 
    // envVars arrives as: [{key: 'TOKEN', value: '123'}]
    
    try {
        // Step 1: Update variables on Render
        // API Docs: PUT /services/{serviceId}/env-vars
        await axios.put(`https://api.render.com/v1/services/${serviceId}/env-vars`, 
            envVars.map(ev => ({ key: ev.key.toUpperCase(), value: ev.value })), 
            { headers: rdHeader }
        );

        // Step 2: Trigger fresh deploy to apply variables
        await axios.post(`https://api.render.com/v1/services/${serviceId}/deploys`, 
            { clearCache: "clear" }, 
            { headers: rdHeader }
        );

        res.json({ success: true, message: "Variables synced & Rebuilding..." });
    } catch (e) {
        console.error("Env Sync Error:", e.response?.data || e.message);
        res.status(500).json({ success: false, error: "Cloud rejected variables." });
    }
});

// 4. POWER CONTROL
app.post('/control', async (req, res) => {
    const { serviceId, action } = req.body;
    const ep = action === 'resume' ? 'resume' : 'suspend';
    try {
        await axios.post(`https://api.render.com/v1/services/${serviceId}/${ep}`, {}, { headers: rdHeader });
        if(action === 'resume') {
            // Force a deploy on start to ensure health
            await axios.post(`https://api.render.com/v1/services/${serviceId}/deploys`, {}, { headers: rdHeader });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 5. REAL STATUS POLLING
app.get('/status/:id', async (req, res) => {
    try {
        const r = await axios.get(`https://api.render.com/v1/services/${req.params.id}`, { headers: rdHeader });
        res.json({ success: true, status: r.data.suspended === 'suspended' ? 'STOPPED' : 'RUNNING' });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 6. FILE MANAGER (GITHUB BRIDGE)
app.post('/files', async (req, res) => {
    const { repo, path, content, sha, action } = req.body;
    const url = `https://api.github.com/repos/${GITHUB_USER}/${repo}/contents/${path}`;
    try {
        if (action === 'list') return res.json((await axios.get(`https://api.github.com/repos/${GITHUB_USER}/${repo}/contents/`, { headers: ghHeader })).data);
        
        if (action === 'get') {
            const r = await axios.get(url, { headers: ghHeader });
            let raw = Buffer.from(r.data.content, 'base64').toString();
            // Strip the Auto-Ignite code before showing to user
            const clean = raw.includes("# --- PYROCORE AUTO-IGNITE END ---") ? 
                          raw.split("# --- PYROCORE AUTO-IGNITE END ---")[1].trim() : raw;
            return res.json({ content: clean, sha: r.data.sha });
        }

        if (action === 'save') {
            const finalCode = injectWrapper(content, path);
            await axios.put(url, { message: "update", content: Buffer.from(finalCode).toString('base64'), sha: sha }, { headers: ghHeader });
            res.json({ success: true });
        }
        
        if (action === 'delete') {
            await axios.delete(url, { data: { message: "delete", sha: sha }, headers: ghHeader });
            res.json({ success: true });
        }
    } catch (e) { res.status(500).json({ success: false }); }
});

// 7. CLEANUP (PURGE)
app.post('/delete', async (req, res) => {
    const { serviceId, repoName } = req.body;
    try {
        if (serviceId) await axios.delete(`https://api.render.com/v1/services/${serviceId}`, { headers: rdHeader });
        if (repoName) await axios.delete(`https://api.github.com/repos/${GITHUB_USER}/${repoName}`, { headers: ghHeader });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// HEARTBEAT (Keeps Free Tier services awake)
setInterval(async () => {
    try {
        const s = await axios.get("https://api.render.com/v1/services?limit=20", { headers: rdHeader });
        s.data.forEach(b => { 
            if(b.service.suspended === 'not_suspended' && b.service.url) {
                axios.get(b.service.url).catch(()=>{}); 
            }
        });
    } catch(e){}
}, 14 * 60 * 1000); // Every 14 mins

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Engine Master Online | Port ${PORT}`));
