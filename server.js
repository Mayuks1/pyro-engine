const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// 1. HIDDEN CONFIGURATION
// These must be set in Render -> Dashboard -> Environment Variables
const GITHUB_TOKEN = process.env.GH_TOKEN;
const RENDER_KEY = process.env.RD_KEY;
const GITHUB_USER = process.env.GH_USER;

// Global API Headers
const ghHeader = { 
    Authorization: `token ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github.v3+json'
};
const rdHeader = { 
    Authorization: `Bearer ${RENDER_KEY}`,
    'Content-Type': 'application/json'
};

// 2. BOT DEPLOYMENT ROUTE
app.post('/deploy', async (req, res) => {
    const { botName, botCode, requirements } = req.body;
    const repoName = `pyro-bot-${Date.now()}`;

    try {
        // Step A: Create Private GitHub Repo
        await axios.post('https://api.github.com/user/repos', 
            { name: repoName, private: true },
            { headers: ghHeader }
        );

        // Step B: Upload bot.py
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/bot.py`, {
            message: "ignition",
            content: Buffer.from(botCode).toString('base64')
        }, { headers: ghHeader });

        // Step C: Upload requirements.txt
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/requirements.txt`, {
            message: "reqs",
            content: Buffer.from(requirements || "pyTelegramBotAPI\nflask\ngunicorn").toString('base64')
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

        res.json({ 
            success: true, 
            id: renderRes.data.id || renderRes.data.service.id, 
            repo: repoName 
        });

    } catch (e) {
        res.status(500).json({ success: false, error: e.response ? JSON.stringify(e.response.data) : e.message });
    }
});

// 3. REAL-TIME STATUS CHECKER
app.get('/status/:id', async (req, res) => {
    try {
        const r = await axios.get(`https://api.render.com/v1/services/${req.params.id}`, { headers: rdHeader });
        // Returns "suspended" or "not_suspended"
        const state = r.data.suspended === 'suspended' ? 'STOPPED' : 'RUNNING';
        res.json({ success: true, status: state });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// 4. POWER CONTROL (STOP/RESUME)
app.post('/control', async (req, res) => {
    const { serviceId, action } = req.body; // action: 'resume' or 'suspend'
    try {
        if (action === 'resume') {
            // First, wake up the container
            await axios.post(`https://api.render.com/v1/services/${serviceId}/resume`, {}, { headers: rdHeader }).catch(() => {});
            // Second, trigger a fresh deploy (The only way to guarantee Python starts)
            axios.post(`https://api.render.com/v1/services/${serviceId}/deploys`, { clearCache: "clear" }, { headers: rdHeader });
        } else {
            // Stop the container
            await axios.post(`https://api.render.com/v1/services/${serviceId}/suspend`, {}, { headers: rdHeader });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 5. FILE MANAGER (GitHub Bridge)
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
                message: "update", 
                content: Buffer.from(content).toString('base64'), 
                sha: sha 
            }, { headers: ghHeader });
        }
        if (action === 'delete') {
            await axios.delete(url, { 
                data: { message: "delete", sha: sha }, 
                headers: ghHeader 
            });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 6. PURGE ENGINE (Render + GitHub Cleanup)
app.post('/delete', async (req, res) => {
    const { serviceId, repoName } = req.body;
    try {
        if (serviceId) {
            await axios.delete(`https://api.render.com/v1/services/${serviceId}`, { headers: rdHeader });
        }
        if (repoName) {
            await axios.delete(`https://api.github.com/repos/${GITHUB_USER}/${repoName}`, { headers: ghHeader });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`PyroCore Backend Engine Active on Port ${PORT}`));
