const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// 1. SECURE CONFIGURATION
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

// 2. DEPLOY BOT
app.post('/deploy', async (req, res) => {
    const { botName, botCode, requirements } = req.body;
    const repoName = `bot-${Date.now()}`;
    try {
        // Create Repo
        await axios.post('https://api.github.com/user/repos', { name: repoName, private: true }, { headers: ghHeader });
        // Upload bot.py
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/bot.py`, { message: "init", content: Buffer.from(botCode).toString('base64') }, { headers: ghHeader });
        // Upload requirements.txt
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/requirements.txt`, { message: "init", content: Buffer.from(requirements || "pyTelegramBotAPI\nflask").toString('base64') }, { headers: ghHeader });
        
        const owners = await axios.get("https://api.render.com/v1/owners", { headers: rdHeader });
        
        const renderRes = await axios.post("https://api.render.com/v1/services", {
            type: "web_service", name: botName, ownerId: owners.data[0].owner.id,
            repo: `https://github.com/${GITHUB_USER}/${repoName}`, branch: "main",
            serviceDetails: { env: "python", plan: "free", envSpecificDetails: { buildCommand: "pip install -r requirements.txt", startCommand: "python bot.py" }}
        }, { headers: rdHeader });

        res.json({ success: true, id: renderRes.data.id || renderRes.data.service.id, repo: repoName });
    } catch (e) {
        console.error("Deploy Error:", e.response?.data || e.message);
        res.status(500).json({ success: false, error: "Deployment Failed. Check GitHub/Render Token." });
    }
});

// 3. CONTROL ENGINE (FIXED)
app.post('/control', async (req, res) => {
    const { serviceId, action } = req.body;
    try {
        let endpoint = action;
        // If action is "kill", we use "suspend" because Render doesn't have a "kill" endpoint
        if (action === 'kill' || action === 'suspend') endpoint = 'suspend';
        if (action === 'resume' || action === 'start') endpoint = 'resume';

        await axios.post(`https://api.render.com/v1/services/${serviceId}/${endpoint}`, {}, { headers: rdHeader });
        
        // If it was a resume, also trigger a fresh deploy for stability
        if (endpoint === 'resume') {
            axios.post(`https://api.render.com/v1/services/${serviceId}/deploys`, { clearCache: "clear" }, { headers: rdHeader }).catch(e => {});
        }

        res.json({ success: true });
    } catch (e) {
        console.error("Control Error:", e.response?.data || e.message);
        res.status(500).json({ success: false, error: "Control Signal Failed." });
    }
});

// 4. FILE MANAGER
app.post('/files', async (req, res) => {
    const { repo, path, content, sha, action } = req.body;
    const url = `https://api.github.com/repos/${GITHUB_USER}/${repo}/contents/${path}`;
    try {
        if (action === 'list') {
            const r = await axios.get(`https://api.github.com/repos/${GITHUB_USER}/${repo}/contents/`, { headers: ghHeader });
            return res.json(r.data);
        }
        if (action === 'get') {
            const r = await axios.get(url, { headers: ghHeader });
            return res.json({ content: Buffer.from(r.data.content, 'base64').toString(), sha: r.data.sha });
        }
        if (action === 'save') {
            await axios.put(url, { message: "update", content: Buffer.from(content).toString('base64'), sha: sha }, { headers: ghHeader });
        }
        if (action === 'delete') {
            await axios.delete(url, { data: { message: "delete", sha: sha }, headers: ghHeader });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 5. DELETE SERVICE
app.post('/delete', async (req, res) => {
    const { serviceId, repoName } = req.body;
    try {
        if (serviceId) await axios.delete(`https://api.render.com/v1/services/${serviceId}`, { headers: rdHeader }).catch(e=>{});
        if (repoName) await axios.delete(`https://api.github.com/repos/${GITHUB_USER}/${repoName}`, { headers: ghHeader }).catch(e=>{});
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend Engine Online on Port ${PORT}`));
