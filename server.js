const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const GITHUB_TOKEN = process.env.GH_TOKEN;
const RENDER_KEY = process.env.RD_KEY;
const GITHUB_USER = process.env.GH_USER;

app.post('/deploy', async (req, res) => {
    const { botName, botCode, requirements } = req.body;
    const repoName = `pyro-bot-${Date.now()}`;
    try {
        await axios.post('https://api.github.com/user/repos', { name: repoName, private: true }, { headers: { Authorization: `token ${GITHUB_TOKEN}` }});
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/bot.py`, { message: "bot", content: Buffer.from(botCode).toString('base64') }, { headers: { Authorization: `token ${GITHUB_TOKEN}` }});
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/requirements.txt`, { message: "req", content: Buffer.from(requirements || "pyTelegramBotAPI\nflask").toString('base64') }, { headers: { Authorization: `token ${GITHUB_TOKEN}` }});
        const owners = await axios.get("https://api.render.com/v1/owners", { headers: { Authorization: `Bearer ${RENDER_KEY}` }});
        const renderRes = await axios.post("https://api.render.com/v1/services", {
            type: "web_service", name: botName, ownerId: owners.data[0].owner.id,
            repo: `https://github.com/${GITHUB_USER}/${repoName}`, branch: "main",
            serviceDetails: { env: "python", plan: "free", envSpecificDetails: { buildCommand: "pip install -r requirements.txt", startCommand: "python bot.py" }}
        }, { headers: { Authorization: `Bearer ${RENDER_KEY}` }});
        res.json({ success: true, id: renderRes.data.id || renderRes.data.service.id });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// UPDATED CONTROL ROUTE
app.post('/control', async (req, res) => {
    const { serviceId, action } = req.body;
    try {
        if (action === 'resume') {
            // Force a fresh deploy instead of just resuming to ensure bot starts
            await axios.post(`https://api.render.com/v1/services/${serviceId}/deploys`, {}, {
                headers: { Authorization: `Bearer ${RENDER_KEY}` }
            });
        } else {
            // Standard suspend
            await axios.post(`https://api.render.com/v1/services/${serviceId}/${action}`, {}, {
                headers: { Authorization: `Bearer ${RENDER_KEY}` }
            });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/delete', async (req, res) => {
    const { serviceId } = req.body;
    try {
        await axios.delete(`https://api.render.com/v1/services/${serviceId}`, { headers: { Authorization: `Bearer ${RENDER_KEY}` }});
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.listen(process.env.PORT || 3000);
