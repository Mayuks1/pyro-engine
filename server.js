const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

// 1. MUST ALLOW CORS FOR THE DASHBOARD TO CONNECT
app.use(cors());
app.use(express.json());

const GITHUB_TOKEN = process.env.GH_TOKEN;
const RENDER_KEY = process.env.RD_KEY;
const GITHUB_USER = process.env.GH_USER;
const DB_URL = "https://songsaas-default-rtdb.asia-southeast1.firebasedatabase.app";

const ghHeader = { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' };
const rdHeader = { Authorization: `Bearer ${RENDER_KEY}`, 'Content-Type': 'application/json' };

const PYRO_WRAPPER = `
import os, threading
from flask import Flask
app = Flask(__name__)
@app.route('/')
def h(): return "ALIVE"
def r(): app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 10000)))
threading.Thread(target=r, daemon=True).start()
`;

// 2. HEALTH CHECK (Pinged by Dashboard to wake up)
app.get('/', (req, res) => {
    res.status(200).send("ONLINE");
});

// 3. DEPLOY ROUTE
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
            serviceDetails: { env: "python", plan: "free", envSpecificDetails: { buildCommand: "pip install -r requirements.txt", startCommand: "gunicorn bot:app --bind 0.0.0.0:$PORT --daemon && python bot.py" }}
        }, { headers: rdHeader });
        res.json({ success: true, id: renderRes.data.id || renderRes.data.service.id, repo: repoName, url: renderRes.data.service.url });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ... (Keep other routes: control, status, files, delete) ...

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Engine v15.5 Online`));
