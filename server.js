const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const GITHUB_TOKEN = process.env.GH_TOKEN;
const GITHUB_USER = process.env.GH_USER;
const HF_TOKEN = process.env.HF_TOKEN;
const HF_USER = process.env.HF_USER;

const ghHeader = { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' };
const hfHeader = { Authorization: `Bearer ${HF_TOKEN}` };

app.get('/', (req, res) => { res.send("PyroCore HF-Engine v13.0: Sovereign Active ✅"); });

// 1. DEPLOY BOT TO HUGGING FACE
app.post('/deploy', async (req, res) => {
    const { botName, botCode, requirements } = req.body;
    const repoName = `bot-${Date.now()}`;
    const spaceName = botName.toLowerCase().replace(/[^a-z0-9]/g, '-');

    try {
        // Step A: Create GitHub Repo (Backup)
        await axios.post('https://api.github.com/user/repos', { name: repoName, private: true }, { headers: ghHeader });
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/bot.py`, { message: "init", content: Buffer.from(botCode).toString('base64') }, { headers: ghHeader });
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/requirements.txt`, { message: "init", content: Buffer.from(requirements || "pyTelegramBotAPI\ndiscord.py").toString('base64') }, { headers: ghHeader });

        // Step B: Create Hugging Face Space (Docker-based for total freedom)
        // This creates a Python SDK space which is very efficient
        const hfRes = await axios.post(`https://huggingface.co/api/repos/create`, {
            name: spaceName,
            type: "space",
            sdk: "docker", // Using Docker gives us true 24/7 background power
            private: true
        }, { headers: hfHeader });

        // Step C: Push Dockerfile to HF to run the bot
        const dockerfile = `FROM python:3.10\nWORKDIR /app\nCOPY . .\nRUN pip install -r requirements.txt\nCMD ["python", "bot.py"]`;
        
        await axios.put(`https://huggingface.co/api/spaces/${HF_USER}/${spaceName}/contents/Dockerfile`, {
            message: "setup docker",
            content: Buffer.from(dockerfile).toString('base64')
        }, { headers: hfHeader });

        await axios.put(`https://huggingface.co/api/spaces/${HF_USER}/${spaceName}/contents/bot.py`, {
            message: "sync bot",
            content: Buffer.from(botCode).toString('base64')
        }, { headers: hfHeader });

        await axios.put(`https://huggingface.co/api/spaces/${HF_USER}/${spaceName}/contents/requirements.txt`, {
            message: "sync reqs",
            content: Buffer.from(requirements || "pyTelegramBotAPI\ndiscord.py").toString('base64')
        }, { headers: hfHeader });

        res.json({ success: true, id: spaceName, repo: repoName });
    } catch (e) {
        res.status(500).json({ success: false, error: e.response ? JSON.stringify(e.response.data) : e.message });
    }
});

// 2. STATUS CHECKER (HF)
app.get('/status/:id', async (req, res) => {
    try {
        const r = await axios.get(`https://huggingface.co/api/spaces/${HF_USER}/${req.params.id}`, { headers: hfHeader });
        // HF status: 'running', 'building', 'stopped', etc.
        const state = r.data.runtime.stage === 'RUNNING' ? 'RUNNING' : 'STOPPED';
        res.json({ success: true, status: state });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 3. POWER CONTROL
app.post('/control', async (req, res) => {
    const { serviceId, action } = req.body;
    try {
        // action: 'suspend' (Pause) or 'resume' (Restart)
        const endpoint = action === 'resume' ? 'restart' : 'pause';
        await axios.post(`https://huggingface.co/api/spaces/${HF_USER}/${serviceId}/${endpoint}`, {}, { headers: hfHeader });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 4. ENV SYNC
app.post('/env', async (req, res) => {
    const { serviceId, envVars } = req.body;
    try {
        // HF uses a different method for secrets
        for (let ev of envVars) {
            await axios.post(`https://huggingface.co/api/spaces/${HF_USER}/${serviceId}/secrets`, {
                key: ev.key.toUpperCase(),
                value: ev.value
            }, { headers: hfHeader });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 5. FILE MANAGER
app.post('/files', async (req, res) => {
    const { repo, path, content, sha, action } = req.body;
    // We update BOTH GitHub and HF to keep them in sync
    const hfUrl = `https://huggingface.co/api/spaces/${HF_USER}/${repo}/contents/${path}`;
    try {
        if (action === 'list') {
            const r = await axios.get(`https://api.github.com/repos/${GITHUB_USER}/${repo}/contents/`, { headers: ghHeader });
            return res.json(r.data);
        }
        if (action === 'save') {
            // Save to HF
            await axios.put(hfUrl, { message: "edit", content: Buffer.from(content).toString('base64') }, { headers: hfHeader });
            // Save to GitHub
            await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repo}/contents/${path}`, { message: "edit", content: Buffer.from(content).toString('base64'), sha: sha }, { headers: ghHeader });
        }
        if (action === 'delete') {
            await axios.delete(hfUrl, { headers: hfHeader });
            await axios.delete(`https://api.github.com/repos/${GITHUB_USER}/${repo}/contents/${path}`, { data: { message: "del", sha: sha }, headers: ghHeader });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 6. DELETE
app.post('/delete', async (req, res) => {
    const { serviceId, repoName } = req.body;
    try {
        if (serviceId) await axios.delete(`https://huggingface.co/api/repos/delete`, { data: { name: serviceId, type: "space" }, headers: hfHeader });
        if (repoName) await axios.delete(`https://api.github.com/repos/${GITHUB_USER}/${repoName}`, { headers: ghHeader });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.listen(process.env.PORT || 3000);
