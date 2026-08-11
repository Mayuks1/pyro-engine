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

// 1. DEPLOY BOT
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

// 2. CONTROL (RESUME/STOP) - FIXED TO PREVENT HANGING
app.post('/control', async (req, res) => {
    const { serviceId, action } = req.body;
    try {
        // We trigger the request but don't wait for Render's long spin-up time
        axios.post(`https://api.render.com/v1/services/${serviceId}/${action}`, {}, { headers: rdHeader })
            .catch(err => console.log("Background Task Info:", err.message));
        
        // Immediately tell frontend it's processing
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 3. FILE MANAGER
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
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 4. DELETE
app.post('/delete', async (req, res) => {
    const { serviceId } = req.body;
    try {
        await axios.delete(`https://api.render.com/v1/services/${serviceId}`, { headers: rdHeader });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.listen(process.env.PORT || 3000);
