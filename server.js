const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

// YOUR KEYS ARE HIDDEN HERE (In Render Env Variables)
const GITHUB_TOKEN = process.env.GH_TOKEN;
const RENDER_KEY = process.env.RD_KEY;
const GITHUB_USER = process.env.GH_USER;

app.post('/deploy', async (req, res) => {
    const { botName, botCode } = req.body;
    const repoName = `user-bot-${Date.now()}`;
    try {
        // 1. Create Repo
        await axios.post('https://api.github.com/user/repos', { name: repoName, private: true }, { headers: { Authorization: `token ${GITHUB_TOKEN}` }});
        // 2. Upload bot.py
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/bot.py`, { message: "bot", content: Buffer.from(botCode).toString('base64') }, { headers: { Authorization: `token ${GITHUB_TOKEN}` }});
        // 3. Upload requirements.txt
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/requirements.txt`, { message: "req", content: Buffer.from("pyTelegramBotAPI\nflask").toString('base64') }, { headers: { Authorization: `token ${GITHUB_TOKEN}` }});
        // 4. Get Owner ID
        const owners = await axios.get("https://api.render.com/v1/owners", { headers: { Authorization: `Bearer ${RENDER_KEY}` }});
        // 5. Launch Service
        const renderRes = await axios.post("https://api.render.com/v1/services", {
            type: "web_service", name: botName, ownerId: owners.data[0].owner.id,
            repo: `https://github.com/${GITHUB_USER}/${repoName}`, branch: "main",
            serviceDetails: { env: "python", plan: "free", envSpecificDetails: { buildCommand: "pip install -r requirements.txt", startCommand: "python bot.py" }}
        }, { headers: { Authorization: `Bearer ${RENDER_KEY}` }});

        res.json({ success: true, id: renderRes.data.id || renderRes.data.service.id });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.listen(process.env.PORT || 3000);