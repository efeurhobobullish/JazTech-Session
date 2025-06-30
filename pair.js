const express = require('express');
const fs = require('fs-extra');
const { exec } = require("child_process");
const pino = require("pino");
const { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser } = require("baileys");
const { upload } = require('./mega');
const ConnectionSession = require('./models/ConnectionSession'); // Assuming you've moved the model to a separate file

let router = express.Router();

if (fs.existsSync('./session')) {
    fs.emptyDirSync('./session');
}

router.get('/', async (req, res) => {
    const sessionId = res.locals.sessionId || generateSessionId();
    let num = req.query.number;

    async function EmpirePair() {
        const { state, saveCreds } = await useMultiFileAuthState(`./session`);
        try {
            let EmpirePairWeb = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.macOS("Safari"),
            });

            if (!EmpirePairWeb.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                const code = await EmpirePairWeb.requestPairingCode(num);
                
                // Update session with pairing code generated
                await ConnectionSession.findOneAndUpdate(
                    { sessionId },
                    { 
                        $set: { 
                            'connectionData.status': 'pairing_code_generated',
                            updatedAt: new Date()
                        } 
                    }
                );
                
                if (!res.headersSent) {
                    res.send({ code });
                }
            }

            EmpirePairWeb.ev.on('creds.update', saveCreds);
            EmpirePairWeb.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;
                if (connection === "open") {
                    // Update session with connection success
                    await ConnectionSession.findOneAndUpdate(
                        { sessionId },
                        { 
                            $set: { 
                                'connectionData.status': 'connected',
                                'connectionData.connectedAt': new Date(),
                                updatedAt: new Date()
                            } 
                        }
                    );

                    try {
                        await delay(10000);
                        const auth_path = './session/';
                        const user_jid = jidNormalizedUser(EmpirePairWeb.user.id);

                        function randomMegaId() {
                            const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                            let result = '';
                            for (let i = 0; i < 6; i++) {
                                result += characters.charAt(Math.floor(Math.random() * characters.length));
                            }
                            const number = Math.floor(Math.random() * 10000);
                            return `${result}${number}`;
                        }

                        const mega_url = await upload(fs.createReadStream(auth_path + 'creds.json'), `${randomMegaId()}.json`);
                        const sid = mega_url.replace('https://mega.nz/file/', '');

                        await EmpirePairWeb.sendMessage(user_jid, { text: sid });

                        await delay(5000);
                        await EmpirePairWeb.sendMessage(user_jid, {
                            text: `> PAIR CODE CONNECTED SUCCESSFULLY ✅  \n\n╭────「 𝐂𝐎𝐍𝐍𝐄𝐂𝐓𝐄𝐃 」────◆  \n│ ∘ ʀᴇᴘᴏ:  \n│ ∘ tinyurl.com/Empire-Tech  \n│──────────────────────  \n│ ∘ Gʀᴏᴜᴘ:  \n│ ∘ tinyurl.com/EMPIRE-MD-GROUP  \n│──────────────────────  \n│ ∘ CHANNEL:  \n│ ∘ tinyurl.com/EMPIRE-MD-CHANNEL  \n│──────────────────────  \n│ ∘ Yᴏᴜᴛᴜʙᴇ:  \n│ ∘ youtube.com/only_one_empire  \n│──────────────────────  \n│ ∘ 𝙴𝙼𝙿𝙸𝚁𝙴-𝙼𝙳 𝙿𝚘𝚠𝚎𝚛𝚎𝚍 𝚋𝚢 𝙴𝚖𝚙𝚒𝚛𝚎 𝚃𝚎𝚌𝚑  \n╰──────────────────────`
                        });
                    } catch (e) {
                        exec('pm2 restart empire-md-session');
                    }
                    await delay(100);
                    fs.emptyDirSync('./session');
                    process.exit(0);
                } else if (connection === "close" && lastDisconnect?.error?.output?.statusCode !== 401) {
                    // Update session with disconnection
                    await ConnectionSession.findOneAndUpdate(
                        { sessionId },
                        { 
                            $set: { 
                                'connectionData.status': 'disconnected',
                                'connectionData.disconnectedAt': new Date(),
                                updatedAt: new Date()
                            } 
                        }
                    );
                    
                    await delay(10000);
                    EmpirePair();
                }
            });
        } catch (err) {
            // Update session with error
            await ConnectionSession.findOneAndUpdate(
                { sessionId },
                { 
                    $set: { 
                        'connectionData.status': 'error',
                        updatedAt: new Date()
                    } 
                }
            );
            
            exec('pm2 restart empire-md-session');
            console.log("Service restarted");
            EmpirePair();
            fs.emptyDirSync('./session');
            if (!res.headersSent) {
                res.status(503).send({ error: "Service Unavailable" });
            }
        }
    }
    EmpirePair();
});

function generateSessionId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

process.on('uncaughtException', function (err) {
    console.log('Caught exception: ' + err);
    exec('pm2 restart empire-md-session');
});

module.exports = router;
