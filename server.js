const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

const GITHUB_TOKEN = process.env.GH_TOKEN;
const RENDER_KEY = process.env.RD_KEY;
const GITHUB_USER = process.env.GH_USER;

const ghHeader = { Authorization: `token ${GITHUB_TOKEN}` };
const rdHeader = { Authorization: `Bearer ${RENDER_KEY}`, 'Accept': 'application/json' };

// 1. DEPLOY (Same as before)
app.post('/deploy', async (req, res) => {
    const { botName, botCode, requirements } = req.body;
    const repoName = `bot-${Date.now()}`;
    try {
        await axios.post('https://api.github.com/user/repos', { name: repoName, private: true }, { headers: ghHeader });
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/bot.py`, { message: "init", content: Buffer.from(botCode).toString('base64') }, { headers: ghHeader });
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/requirements.txt`, { message: "init", content: Buffer.from(requirements || "pyTelegramBotAPI\nflask").toString('base64') }, { headers: ghHeader });
        const owners = await axios.get("https://api.render.com/v1/owners", { headers: rdHeader });
        const renderRes = await axios.post("https://api.render.com/v1/services", {
            type: "web_service", name: botName, ownerId: owners.data[0].owner.id,
            repo: `https://github.com/${GITHUB_USER}/${repoName}`, branch: "main",
            serviceDetails: { env: "python", plan: "free", envSpecificDetails: { buildCommand: "pip install -r requirements.txt", startCommand: "python bot.py" }}
        }, { headers: rdHeader });
        res.json({ success: true, id: renderRes.data.id || renderRes.data.service.id, repo: repoName });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 2. REAL ENV VAR SYNC (The "Full Fix")
app.post('/env', async (req, res) => {
    const { serviceId, envVars } = req.body; // envVars is an array: [{key: 'TOKEN', value: '123'}]
    try {
        // Render API for updating environment variables
        await axios.put(`https://api.render.com/v1/services/${serviceId}/env-vars`, 
            envVars.map(ev => ({ key: ev.key, value: ev.value })), 
            { headers: rdHeader }
        );
        // Triggering a deploy to apply new variables
        await axios.post(`https://api.render.com/v1/services/${serviceId}/deploys`, { clearCache: "do_not_clear" }, { headers: rdHeader });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 3. STATUS & CONTROL (List, Get, Save, Delete)
app.get('/status/:id', async (req, res) => {
    try {
        const r = await axios.get(`https://api.render.com/v1/services/${req.params.id}`, { headers: rdHeader });
        res.json({ success: true, status: r.data.suspended === 'suspended' ? 'STOPPED' : 'RUNNING' });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/control', async (req, res) => {
    const { serviceId, action } = req.body;
    try {
        const endpoint = action === 'resume' ? 'resume' : 'suspend';
        await axios.post(`https://api.render.com/v1/services/${serviceId}/${endpoint}`, {}, { headers: rdHeader });
        if(action === 'resume') axios.post(`https://api.render.com/v1/services/${serviceId}/deploys`, {}, { headers: rdHeader });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/files', async (req, res) => {
    const { repo, path, content, sha, action } = req.body;
    const url = `https://api.github.com/repos/${GITHUB_USER}/${repo}/contents/${path}`;
    try {
        if (action === 'list') return res.json((await axios.get(`https://api.github.com/repos/${GITHUB_USER}/${repo}/contents/`, { headers: ghHeader })).data);
        if (action === 'get') { const r = await axios.get(url, { headers: ghHeader }); return res.json({ content: Buffer.from(r.data.content, 'base64').toString(), sha: r.data.sha }); }
        if (action === 'save') await axios.put(url, { message: "update", content: Buffer.from(content).toString('base64'), sha: sha }, { headers: ghHeader });
        if (action === 'delete') await axios.delete(url, { data: { message: "delete", sha: sha }, headers: ghHeader });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/delete', async (req, res) => {
    const { serviceId, repoName } = req.body;
    try {
        if (serviceId) await axios.delete(`https://api.render.com/v1/services/${serviceId}`, { headers: rdHeader });
        if (repoName) await axios.delete(`https://api.github.com/repos/${GITHUB_USER}/${repoName}`, { headers: ghHeader });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.listen(process.env.PORT || 3000);
