const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Hidden Keys from Render Environment Variables
const GITHUB_TOKEN = process.env.GH_TOKEN;
const RENDER_KEY = process.env.RD_KEY;
const GITHUB_USER = process.env.GH_USER;

// Global Headers
const ghHeader = { 
    Authorization: `token ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github.v3+json'
};
const rdHeader = { 
    Authorization: `Bearer ${RENDER_KEY}`,
    'Content-Type': 'application/json'
};

// 1. DEPLOYMENT ROUTE
app.post('/deploy', async (req, res) => {
    const { botName, botCode, requirements } = req.body;
    const repoName = `pyro-bot-${Date.now()}`;

    try {
        // A. Create Private GitHub Repo
        await axios.post('https://api.github.com/user/repos', 
            { name: repoName, private: true },
            { headers: ghHeader }
        );

        // B. Upload bot.py
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/bot.py`, {
            message: "ignite bot",
            content: Buffer.from(botCode).toString('base64')
        }, { headers: ghHeader });

        // C. Upload requirements.txt
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/requirements.txt`, {
            message: "ignite reqs",
            content: Buffer.from(requirements || "pyTelegramBotAPI\nflask").toString('base64')
        }, { headers: ghHeader });

        // D. Get Render Owner ID
        const owners = await axios.get("https://api.render.com/v1/owners", { headers: rdHeader });
        const ownerId = owners.data[0].owner.id;

        // E. Launch Web Service on Render
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
        const msg = e.response ? JSON.stringify(e.response.data) : e.message;
        res.status(500).json({ success: false, error: msg });
    }
});

// 2. POWER CONTROL (STOP / RESUME)
app.post('/control', async (req, res) => {
    const { serviceId, action } = req.body;
    try {
        if (action === 'resume') {
            // First, wake up the service container
            await axios.post(`https://api.render.com/v1/services/${serviceId}/resume`, {}, { headers: rdHeader }).catch(() => {});
            
            // Second, trigger a fresh deploy to ensure Python script starts (Fix for bot not working bug)
            axios.post(`https://api.render.com/v1/services/${serviceId}/deploys`, { clearCache: "clear" }, { headers: rdHeader })
                .catch(err => console.log("Background Deploy Info:", err.message));
        } else {
            // Standard suspend
            await axios.post(`https://api.render.com/v1/services/${serviceId}/suspend`, {}, { headers: rdHeader });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 3. FILE MANAGER (LIST, GET, SAVE, DELETE)
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
                message: "update file", 
                content: Buffer.from(content).toString('base64'), 
                sha: sha 
            }, { headers: ghHeader });
        }
        if (action === 'delete') {
            await axios.delete(url, { 
                data: { message: "delete file", sha: sha }, 
                headers: ghHeader 
            });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 4. CLEAN DELETE (RENDER + GITHUB CLEANUP)
app.post('/delete', async (req, res) => {
    const { serviceId, repoName } = req.body;
    try {
        // 1. Delete Service from Render
        if (serviceId) {
            await axios.delete(`https://api.render.com/v1/services/${serviceId}`, { headers: rdHeader })
                .catch(e => console.log("Render delete failed:", e.message));
        }

        // 2. Delete Repository from GitHub (Cleanup)
        if (repoName) {
            await axios.delete(`https://api.github.com/repos/${GITHUB_USER}/${repoName}`, { headers: ghHeader })
                .catch(e => console.log("GitHub delete failed:", e.message));
        }

        res.json({ success: true, message: "Engine and Repository purged." });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Pyro Engine Online on port ${PORT}`));
