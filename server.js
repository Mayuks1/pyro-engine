const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// 1. ENGINE CONFIGURATION
// Ensure these are set in Render -> Dashboard -> Environment
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

// --- SYSTEM HEALTH CHECK ---
app.get('/', (req, res) => {
    res.send("PyroCore Engine v8.5: Sovereign System Online ✅");
});

// 2. BOT DEPLOYMENT (INITIAL IGNITION)
app.post('/deploy', async (req, res) => {
    const { botName, botCode, requirements } = req.body;
    const repoName = `bot-${Date.now()}`;

    try {
        // Step A: Create Private GitHub Repo
        await axios.post('https://api.github.com/user/repos', 
            { name: repoName, private: true }, { headers: ghHeader });

        // Step B: Upload Main Code (bot.py)
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/bot.py`, {
            message: "ignition",
            content: Buffer.from(botCode).toString('base64')
        }, { headers: ghHeader });

        // Step C: Upload Requirements
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/requirements.txt`, {
            message: "reqs",
            content: Buffer.from(requirements || "pyTelegramBotAPI\ndiscord.py\nflask\ngunicorn").toString('base64')
        }, { headers: ghHeader });

        // Step D: Get Render Owner ID
        const owners = await axios.get("https://api.render.com/v1/owners", { headers: rdHeader });
        const ownerId = owners.data[0].owner.id;

        // Step E: Launch Web Service on Render
        const renderRes = await axios.post("https://api.render.com/v1/services", {
            type: "web_service",
            name: botName,
            ownerId: ownerId,
            repo: `https://github.com/${GITHUB_USER}/${repoName}`,
            branch: "main",
            serviceDetails: {
                env: "python",
                plan: "free",
                envSpecificDetails: {
                    buildCommand: "pip install --upgrade pip && pip install -r requirements.txt",
                    // THE PRO FIX: Runs Gunicorn health-check in background and bot in foreground
                    startCommand: "gunicorn bot:app --bind 0.0.0.0:$PORT --worker-class gthread --threads 4 & python bot.py"
                }
            }
        }, { headers: rdHeader });

        res.json({ 
            success: true, 
            id: renderRes.data.id || renderRes.data.service.id, 
            repo: repoName 
        });

    } catch (e) {
        const errorMsg = e.response ? JSON.stringify(e.response.data) : e.message;
        res.status(500).json({ success: false, error: errorMsg });
    }
});

// 3. REAL-TIME STATUS CHECKER
app.get('/status/:id', async (req, res) => {
    try {
        const r = await axios.get(`https://api.render.com/v1/services/${req.params.id}`, { headers: rdHeader });
        const state = r.data.suspended === 'suspended' ? 'STOPPED' : 'RUNNING';
        res.json({ success: true, status: state });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// 4. POWER CONTROLS (STOP / RESUME)
app.post('/control', async (req, res) => {
    const { serviceId, action } = req.body;
    try {
        if (action === 'resume') {
            await axios.post(`https://api.render.com/v1/services/${serviceId}/resume`, {}, { headers: rdHeader }).catch(() => {});
            // Force Deploy with Clear Cache to ensure the Python loop starts fresh
            await axios.post(`https://api.render.com/v1/services/${serviceId}/deploys`, { clearCache: "clear" }, { headers: rdHeader });
        } else {
            await axios.post(`https://api.render.com/v1/services/${serviceId}/suspend`, {}, { headers: rdHeader });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 5. ENVIRONMENT VARIABLE SYNC
app.post('/env', async (req, res) => {
    const { serviceId, envVars } = req.body; 
    try {
        await axios.put(`https://api.render.com/v1/services/${serviceId}/env-vars`, 
            envVars.map(ev => ({ key: ev.key.toUpperCase(), value: ev.value })), 
            { headers: rdHeader }
        );
        // Redeploy to apply new env vars
        await axios.post(`https://api.render.com/v1/services/${serviceId}/deploys`, { clearCache: "clear" }, { headers: rdHeader });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 6. FILE MANAGER (GITHUB BRIDGE)
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
            await axios.put(url, { 
                message: "update via pyro-console", 
                content: Buffer.from(content).toString('base64'), 
                sha: sha 
            }, { headers: ghHeader });
        }
        if (action === 'delete') {
            await axios.delete(url, { 
                data: { message: "delete via pyro-console", sha: sha }, 
                headers: ghHeader 
            });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 7. PURGE SYSTEM (CLEANUP)
app.post('/delete', async (req, res) => {
    const { serviceId, repoName } = req.body;
    try {
        if (serviceId) await axios.delete(`https://api.render.com/v1/services/${serviceId}`, { headers: rdHeader });
        if (repoName) await axios.delete(`https://api.github.com/repos/${GITHUB_USER}/${repoName}`, { headers: ghHeader });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 8. START ENGINE
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[PYRO_CORE] Engine Online | Port: ${PORT}`);
});
