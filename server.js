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
const hfHeader = { Authorization: `Bearer ${HF_TOKEN}`, 'Content-Type': 'application/json' };

// --- NEW GRADIO WRAPPER (To bypass the PRO requirement) ---
const PYRO_WRAPPER_PY = `
# --- PYROCORE AUTO-IGNITE START ---
import os, threading, gradio as gr
from flask import Flask
def pyro_ui():
    with gr.Blocks(title="PyroHost Node") as demo:
        gr.Markdown("# ❄️ PyroHost Sub-Zero Node\\n**Status:** Engine Operational ✅")
    demo.launch(server_name="0.0.0.0", server_port=7860, prevent_thread_lock=True)

threading.Thread(target=pyro_ui, daemon=True).start()
# --- PYROCORE AUTO-IGNITE END ---

`;

const injectWrapper = (content) => {
    if (content.includes("PYROCORE AUTO-IGNITE")) return content;
    return PYRO_WRAPPER_PY + content;
};

app.get('/', (req, res) => { res.send("PyroCore HF-Engine v14.0: Free Tier Active ✅"); });

// 1. DEPLOY BOT TO HUGGING FACE (Gradio SDK Fix)
app.post('/deploy', async (req, res) => {
    const { botName, botCode, requirements } = req.body;
    const repoName = `bot-${Date.now()}`;
    const spaceName = botName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const finalCode = injectWrapper(botCode);

    try {
        // Step A: Create GitHub Repo (Backup)
        await axios.post('https://api.github.com/user/repos', { name: repoName, private: true }, { headers: ghHeader });
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/bot.py`, { message: "init", content: Buffer.from(botCode).toString('base64') }, { headers: ghHeader });

        // Step B: Create Hugging Face Space (Using 'gradio' SDK for FREE access)
        await axios.post(`https://huggingface.co/api/repos/create`, {
            name: spaceName,
            type: "space",
            sdk: "gradio", // CHANGED FROM DOCKER TO GRADIO
            private: false  // Public spaces are more stable on free tier
        }, { headers: hfHeader });

        // Step C: Upload app.py (HF looks for app.py in Gradio SDK)
        await axios.put(`https://huggingface.co/api/spaces/${HF_USER}/${spaceName}/contents/app.py`, {
            message: "setup app",
            content: Buffer.from(finalCode).toString('base64')
        }, { headers: hfHeader });

        // Step D: Upload requirements
        // Must include 'gradio' for the fix to work
        const finalReqs = (requirements || "pyTelegramBotAPI\ndiscord.py") + "\ngradio\nflask";
        await axios.put(`https://huggingface.co/api/spaces/${HF_USER}/${spaceName}/contents/requirements.txt`, {
            message: "sync reqs",
            content: Buffer.from(finalReqs).toString('base64')
        }, { headers: hfHeader });

        res.json({ success: true, id: spaceName, repo: repoName });
    } catch (e) {
        console.error(e.response?.data);
        res.status(500).json({ success: false, error: e.response?.data?.error || e.message });
    }
});

// 2. POWER CONTROL & STATUS
app.get('/status/:id', async (req, res) => {
    try {
        const r = await axios.get(`https://huggingface.co/api/spaces/${HF_USER}/${req.params.id}`, { headers: hfHeader });
        const state = r.data.runtime.stage === 'RUNNING' ? 'RUNNING' : 'STOPPED';
        res.json({ success: true, status: state });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/control', async (req, res) => {
    const { serviceId, action } = req.body;
    try {
        const endpoint = action === 'resume' ? 'restart' : 'pause';
        await axios.post(`https://huggingface.co/api/spaces/${HF_USER}/${serviceId}/${endpoint}`, {}, { headers: hfHeader });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 3. FILE MANAGER (Updated for app.py)
app.post('/files', async (req, res) => {
    const { repo, path, content, sha, action } = req.body;
    const hfPath = (path === 'bot.py') ? 'app.py' : path;
    const hfUrl = `https://huggingface.co/api/spaces/${HF_USER}/${repo}/contents/${hfPath}`;
    try {
        if (action === 'list') {
            const r = await axios.get(`https://api.github.com/repos/${GITHUB_USER}/${repo}/contents/`, { headers: ghHeader });
            return res.json(r.data);
        }
        if (action === 'save') {
            const finalCode = (hfPath === 'app.py') ? injectWrapper(content) : content;
            await axios.put(hfUrl, { message: "edit", content: Buffer.from(finalCode).toString('base64') }, { headers: hfHeader });
            await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repo}/contents/${path}`, { message: "edit", content: Buffer.from(content).toString('base64'), sha: sha }, { headers: ghHeader });
        }
        if (action === 'delete') {
            await axios.delete(hfUrl, { headers: hfHeader });
            await axios.delete(`https://api.github.com/repos/${GITHUB_USER}/${repo}/contents/${path}`, { data: { message: "del", sha: sha }, headers: ghHeader });
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.post('/delete', async (req, res) => {
    const { serviceId, repoName } = req.body;
    try {
        if (serviceId) await axios.delete(`https://huggingface.co/api/repos/delete`, { data: { name: serviceId, type: "space" }, headers: hfHeader });
        if (repoName) await axios.delete(`https://api.github.com/repos/${GITHUB_USER}/${repoName}`, { headers: ghHeader });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

app.listen(process.env.PORT || 3000);
