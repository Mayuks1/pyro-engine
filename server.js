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

// 1. DEPLOYMENT ROUTE
app.post('/deploy', async (req, res) => {
    const { botName, botCode, requirements } = req.body;
    const repoName = `pyro-bot-${Date.now()}`;

    try {
        // A. Create Private GitHub Repo
        await axios.post('https://api.github.com/user/repos', 
            { name: repoName, private: true },
            { headers: { Authorization: `token ${GITHUB_TOKEN}` }}
        );

        // B. Upload bot.py
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/bot.py`, {
            message: "ignite bot",
            content: Buffer.from(botCode).toString('base64')
        }, { headers: { Authorization: `token ${GITHUB_TOKEN}` }});

        // C. Upload requirements.txt
        await axios.put(`https://api.github.com/repos/${GITHUB_USER}/${repoName}/contents/requirements.txt`, {
            message: "ignite reqs",
            content: Buffer.from(requirements || "pyTelegramBotAPI\nflask").toString('base64')
        }, { headers: { Authorization: `token ${GITHUB_TOKEN}` }});

        // D. Get Render Owner ID
        const owners = await axios.get("https://api.render.com/v1/owners", {
            headers: { Authorization: `Bearer ${RENDER_KEY}` }
        });
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
        }, { headers: { Authorization: `Bearer ${RENDER_KEY}` }});

        res.json({ success: true, id: renderRes.data.id || renderRes.data.service.id });

    } catch (e) {
        console.error(e.response ? e.response.data : e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 2. CONTROL ROUTE
app.post('/control', async (req, res) => {
    const { serviceId, action } = req.body;
    try {
        await axios.post(`https://api.render.com/v1/services/${serviceId}/${action}`, {}, {
            headers: { Authorization: `Bearer ${RENDER_KEY}` }
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.listen(process.env.PORT || 3000, () => console.log("Pyro Engine Online"));        const auth = firebase.auth();
        const database = firebase.database();

        auth.onAuthStateChanged(user => {
            if (!user) window.location.href = "login.html";
            else {
                database.ref('users/' + user.uid).once('value', snap => {
                    const d = snap.val();
                    document.getElementById('profileIcon').innerText = (d.username || 'U').charAt(0);
                    document.getElementById('dropName').innerText = d.username || "Hoster";
                    document.getElementById('dropEmail').innerText = user.email;
                });
                listen(user.uid);
            }
        });

        function toggleProfile() { document.getElementById('profileMenu').classList.toggle('active'); }
        function logout() { auth.signOut().then(() => window.location.href = "login.html"); }

        function listen(uid) {
            database.ref('users/' + uid + '/bots').on('value', snap => {
                const list = document.getElementById('botList');
                const data = snap.val();
                if (!data) { list.innerHTML = `<p class="col-span-full text-center text-gray-700 py-10 uppercase text-[10px]">No active bots.</p>`; updateBars(0); return; }
                const keys = Object.keys(data);
                updateBars(keys.length);
                list.innerHTML = "";
                keys.forEach(k => {
                    const b = data[k];
                    list.innerHTML += `<div class="glass-card p-5 rounded-3xl flex justify-between items-center">
                        <h4 class="text-xs font-black italic uppercase">${b.botName}</h4>
                        <a href="console.html?id=${k}" class="text-[10px] font-black uppercase text-orange-500 bg-orange-500/10 px-4 py-2 rounded-xl">Console</a>
                    </div>`;
                });
            });
        }

        function updateBars(c) {
            document.getElementById('botCount').innerText = `${c} / 2`;
            document.getElementById('botProgress').style.width = (c / 2 * 100) + "%";
        }

        function openModal() { document.getElementById('modal').classList.remove('hidden'); }
        function closeModal() { document.getElementById('modal').classList.add('hidden'); }
        function next() { document.getElementById('step1').classList.add('hidden'); document.getElementById('step2').classList.remove('hidden'); }

        async function read(f) { return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsText(f); }); }

        async function finish() {
            const name = document.getElementById('newBotName').value;
            const fBot = document.getElementById('fileBot').files[0];
            const fReq = document.getElementById('fileReq').files[0];
            const btn = document.getElementById('finishBtn');

            if(!fBot) return alert("bot.py is required!");
            btn.disabled = true; btn.innerText = "IGNITING ENGINE...";

            try {
                const bCode = await read(fBot);
                const rText = fReq ? await read(fReq) : "pyTelegramBotAPI\nflask";

                const res = await fetch(`${ENGINE_URL}/deploy`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ botName: name, botCode: bCode, requirements: rText })
                });

                const data = await res.json();
                if(data.success) {
                    await database.ref('users/' + auth.currentUser.uid + '/bots').push({
                        botName: name, serviceId: data.id, status: 'running', createdAt: Date.now()
                    });
                    closeModal();
                    alert("Bot Successfully Ignited!");
                } else { alert("Engine Error: " + data.error); }
            } catch (e) { alert("Deployment Failed."); }
            btn.disabled = false; btn.innerText = "Ignite Bot";
        }
    </script>
</body>
</html>
