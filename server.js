const express = require('express');
const axios = require('axios');
const cors = require('cors');
const admin = require('firebase-admin'); // Added for global database access
const app = express();
app.use(cors());
app.use(express.json());

// 1. CONFIGURATION
const GITHUB_TOKEN = process.env.GH_TOKEN;
const RENDER_KEY = process.env.RD_KEY;
const GITHUB_USER = process.env.GH_USER;

// 2. FIREBASE ADMIN (To see all bots for the heartbeat)
// You need to add your Firebase Service Account JSON to Render Env Vars
// Or use the Database URL if the rules allow
const dbUrl = "https://songsaas-default-rtdb.asia-southeast1.firebasedatabase.app";

const ghHeader = { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' };
const rdHeader = { Authorization: `Bearer ${RENDER_KEY}`, 'Content-Type': 'application/json' };

// --- AUTO-IGNITE WRAPPER ---
const PYRO_WRAPPER = `
import os, threading, time
from flask import Flask
app = Flask(__name__)
@app.route('/')
def h(): return "STAY_ALIVE"
def r(): app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 10000)))
threading.Thread(target=r, daemon=True).start()
`;

app.get('/', (req, res) => { res.send("PyroCore v15.0: Sovereign Engine Awake ✅"); });

// 3. DEPLOY BOT
app.post('/deploy', async (req, res) => {
    const { botName, botCode, requirements } = req.body;
    const repoName = `bot-${Date.now()}`;
    const finalCode = PYRO_WRAPPER + "\n" + botCode;

    try {
        await axios.post('https://api.github.com/user/repos', { name: repoName, private: true }, { headers: ghHeader });
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/bot.py`, { message: "ignite", content: Buffer.from(finalCode).toString('base64') }, { headers: ghHeader });
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/requirements.txt`, { message: "reqs", content: Buffer.from(requirements || "pyTelegramBotAPI\nflask\ngunicorn").toString('base64') }, { headers: ghHeader });
        
        const owners = await axios.get("https://api.render.com/v1/owners", { headers: rdHeader });
        const renderRes = await axios.post("https://api.render.com/v1/services", {
            type: "web_service", name: botName, ownerId: owners.data[0].owner.id,
            repo: `https://github.com/${GITHUB_USER}/${repoName}`, branch: "main",
            serviceDetails: { env: "python", plan: "free", envSpecificDetails: { buildCommand: "pip install -r requirements.txt", startCommand: "gunicorn bot:app --bind 0.0.0.0:$PORT --daemon && python bot.py" }}
        }, { headers: rdHeader });

        res.json({ success: true, id: renderRes.data.id || renderRes.data.service.id, repo: repoName, url: renderRes.data.service.url });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 4. THE ULTIMATE HEARTBEAT (The Fix)
const heartbeat = async () => {
    console.log("💓 Heartbeat: Checking cloud pulses...");
    try {
        // 1. Self-Ping (Wakes up the engine itself)
        const engineUrl = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}.onrender.com/`;
        axios.get(engineUrl).catch(() => {});

        // 2. Fetch all bots from Firebase RTDB
        const response = await axios.get(`${dbUrl}/users.json`);
        const users = response.data;

        if (users) {
            Object.keys(users).forEach(uid => {
                const bots = users[uid].bots;
                if (bots) {
                    Object.keys(bots).forEach(bid => {
                        const bot = bots[bid];
                        if (bot.status === 'running' && bot.botUrl) {
                            console.log(`Ping: ${bot.botName} -> ${bot.botUrl}`);
                            axios.get(bot.botUrl).catch(() => {}); // This wakes the bot up
                        }
                    });
                }
            });
        }
    } catch (e) { console.error("Heartbeat skipped: Engine Busy"); }
};

// Run Heartbeat every 5 minutes (Render Free sleeps at 15 mins)
setInterval(heartbeat, 5 * 60 * 1000);

// --- OTHER ROUTES (Control, Env, Delete, Files) STAY THE SAME ---
app.post('/control', async (req, res) => {
    const { serviceId, action } = req.body;
    const ep = action === 'resume' ? 'resume' : 'suspend';
    await axios.post(`https://api.render.com/v1/services/${serviceId}/${ep}`, {}, { headers: rdHeader }).catch(()=>{});
    if(action === 'resume') axios.post(`https://api.render.com/v1/services/${serviceId}/deploys`, {clearCache:"clear"}, { headers: rdHeader }).catch(()=>{});
    res.json({ success: true });
});

app.post('/delete', async (req, res) => {
    const { serviceId, repoName } = req.body;
    if (serviceId) axios.delete(`https://api.render.com/v1/services/${serviceId}`, { headers: rdHeader }).catch(()=>{});
    if (repoName) axios.delete(`https://api.github.com/repos/${GITHUB_USER}/${repoName}`, { headers: ghHeader }).catch(()=>{});
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sovereign Heartbeat Engine Online`));
