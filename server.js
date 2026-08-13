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

// 2. INITIAL BOT DEPLOYMENT
app.post('/deploy', async (req, res) => {
    const { botName, botCode, requirements } = req.body;
    const repoName = `bot-${Date.now()}`;

    try {
        // A. Create Private GitHub Repo
        await axios.post('https://api.github.com/user/repos', 
            { name: repoName, private: true }, { headers: ghHeader });

        // B. Upload Main Code (bot.py)
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/bot.py`, {
            message: "ignition",
            content: Buffer.from(botCode).toString('base64')
        }, { headers: ghHeader });

        // C. Upload Requirements
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/requirements.txt`, {
            message: "reqs",
            content: Buffer.from(requirements || "pyTelegramBotAPI\ndiscord.py\nflask\ngunicorn").toString('base64')
        }, { headers: ghHeader });

        // D. Get Render Owner ID
        const owners = await axios.get("https://api.render.com/v1/owners", { headers: rdHeader });
        const ownerId = owners.data[0].owner.id;

        // E. Launch Web Service on Render (Optimized for Discord/Telegram)
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
                    // Force pip upgrade to prevent build failures
                    buildCommand: "pip install --upgrade pip && pip install -r requirements.txt",
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
        const errorMsg = e.response ? JSON.stringify(e.response.data) : e.message;
        res.status(500).json({ success: false, error: errorMsg });
    }
});

// 3. REAL-TIME STATUS CHECKER
app.get('/status/:id', async (req, res) => {
    try {
        const r = await axios.get(`https://api.render.com/v1/services/${req.params.id}`, { headers: rdHeader });
        // Map Render's complex states to simple PyroHost states
        const state = r.data.suspended === 'suspended' ? 'STOPPED' : 'RUNNING';
        res.json({ success: true, status: state });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// 4. POWER CONTROLS (STOP / RESUME / FORCE REBUILD)
app.post('/control', async (req, res) => {
    const { serviceId, action } = req.body;
    try {
        if (action === 'resume') {
            // Wake up container
            await axios.post(`https://api.render.com/v1/services/${serviceId}/resume`, {}, { headers: rdHeader }).catch(() => {});
            // Force Deploy (Clean start to ensure Python script connects to Telegram/Discord)
            await axios.post(`https://api.render.com/v1/services/${serviceId}/deploys`, { clearCache: "do_not_clear" }, { headers: rdHeader });
        } else {
            // Standard suspend
            await axios.post(`https://api.render.com/v1/services/${serviceId}/suspend`, {}, { headers: rdHeader });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 5. ENVIRONMENT VARIABLE SYNC (FIX FOR DISCORD TOKEN)
app.post('/env', async (req, res) => {
    const { serviceId, envVars } = req.body; 
    try {
        // Sync variables to Render
        await axios.put(`https://api.render.com/v1/services/${serviceId}/env-vars`, 
            envVars.map(ev => ({ key: ev.key.toUpperCase(), value: ev.value })), 
            { headers: rdHeader }
        );

        // TRIGGER CLEAN RE-DEPLOY (This is why the token wasn't working before)
        // Clear cache forces a fresh environment load
        await axios.post(`https://api.render.com/v1/services/${serviceId}/deploys`, 
            { clearCache: "clear" }, 
            { headers: rdHeader }
        );

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
                message: "update via console", 
                content: Buffer.from(content).toString('base64'), 
                sha: sha 
            }, { headers: ghHeader });
        }
        if (action === 'delete') {
            await axios.delete(url, { 
                data: { message: "purge via console", sha: sha }, 
                headers: ghHeader 
            });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 7. CLEANUP DELETE (RENDER + GITHUB)
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

// 8. KERNEL START
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[PYRO_CORE] Engine Online | Port: ${PORT}`);
});app.post('/control', async (req, res) => {
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
