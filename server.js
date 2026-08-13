const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// 1. ENGINE CONFIGURATION
// Ensure these are set in your Render "Environment" tab
const GITHUB_TOKEN = process.env.GH_TOKEN;
const RENDER_KEY = process.env.RD_KEY;
const GITHUB_USER = process.env.GH_USER;

// API Headers
const ghHeader = { 
    Authorization: `token ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github.v3+json'
};
const rdHeader = { 
    Authorization: `Bearer ${RENDER_KEY}`,
    'Content-Type': 'application/json'
};

// 2. BOT DEPLOYMENT (INITIAL IGNITION)
app.post('/deploy', async (req, res) => {
    const { botName, botCode, requirements } = req.body;
    const repoName = `pyro-bot-${Date.now()}`;

    try {
        // Step A: Create Private GitHub Repo
        await axios.post('https://api.github.com/user/repos', 
            { name: repoName, private: true }, { headers: ghHeader });

        // Step B: Upload Main File (bot.py)
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/bot.py`, {
            message: "init bot",
            content: Buffer.from(botCode).toString('base64')
        }, { headers: ghHeader });

        // Step C: Upload Requirements
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/requirements.txt`, {
            message: "init reqs",
            content: Buffer.from(requirements || "pyTelegramBotAPI\nflask\ndiscord.py").toString('base64')
        }, { headers: ghHeader });

        // Step D: Get Render Owner ID
        const owners = await axios.get("https://api.render.com/v1/owners", { headers: rdHeader });
        const ownerId = owners.data[0].owner.id;

        // Step E: Create Web Service on Render
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
                    buildCommand: "pip install -r requirements.txt",
                    startCommand: "python bot.py"
                }
            }
        }, { headers: rdHeader });

        res.json({ success: true, id: renderRes.data.id || renderRes.data.service.id, repo: repoName });
    } catch (e) {
        res.status(500).json({ success: false, error: e.response ? JSON.stringify(e.response.data) : e.message });
    }
});

// 3. ENVIRONMENT VARIABLE SYNC (FIXED FOR DISCORD BOTS)
app.post('/env', async (req, res) => {
    const { serviceId, envVars } = req.body; 
    try {
        // Update all variables on Render
        await axios.put(`https://api.render.com/v1/services/${serviceId}/env-vars`, 
            envVars.map(ev => ({ key: ev.key, value: ev.value })), 
            { headers: rdHeader }
        );

        // Trigger a fresh deployment with Clear Cache to apply changes
        await axios.post(`https://api.render.com/v1/services/${serviceId}/deploys`, 
            { clearCache: "clear" }, 
            { headers: rdHeader }
        );

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 4. POWER CONTROL (STOP / RESUME / KILL)
app.post('/control', async (req, res) => {
    const { serviceId, action } = req.body;
    try {
        if (action === 'resume') {
            // Wake up container
            await axios.post(`https://api.render.com/v1/services/${serviceId}/resume`, {}, { headers: rdHeader }).catch(() => {});
            // Force Deploy to ensure Python starts correctly
            await axios.post(`https://api.render.com/v1/services/${serviceId}/deploys`, { clearCache: "do_not_clear" }, { headers: rdHeader });
        } else {
            // Suspend (Stop/Kill)
            await axios.post(`https://api.render.com/v1/services/${serviceId}/suspend`, {}, { headers: rdHeader });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 5. REAL-TIME STATUS CHECKER
app.get('/status/:id', async (req, res) => {
    try {
        const r = await axios.get(`https://api.render.com/v1/services/${req.params.id}`, { headers: rdHeader });
        const state = r.data.suspended === 'suspended' ? 'STOPPED' : 'RUNNING';
        res.json({ success: true, status: state });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// 6. FILE MANAGER (GitHub Bridge)
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
            // Re-deploy after save
            const botData = await axios.get(`https://api.github.com/repos/${GITHUB_USER}/${repo}`, { headers: ghHeader });
            // Logic to find service ID by name could go here, or handled by frontend
        }
        if (action === 'delete') {
            await axios.delete(url, { data: { message: "delete", sha: sha }, headers: ghHeader });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 7. PURGE SYSTEM (CLEANUP RENDER + GITHUB)
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

// START
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PyroCore Engine v8.0 is operational on port ${PORT}`));
