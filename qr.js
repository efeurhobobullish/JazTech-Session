const express = require('express');
const fs = require('fs-extra');
const { exec } = require("child_process");
const pino = require("pino");
const { toBuffer } = require("qrcode");
const { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser } = require("baileys");
const { upload } = require('./mega');

let router = express.Router();

if (fs.existsSync('./session')) {
    fs.emptyDirSync('./session');
}

router.get('/', async (req, res) => {
    const sessionId = res.locals.sessionId || generateSessionId();
    
    async function EmpireQr() {
        const { state, saveCreds } = await useMultiFileAuthState(`./session`);
        try {
            let EmpireQrWeb = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.macOS("Safari"),
            });

            EmpireQrWeb.ev.on('creds.update', saveCreds);
            EmpireQrWeb.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect, qr } = s;

                if (qr) {
                    console.log("QR Code received!");
                    if (!res.headersSent) {
                        try {
                            const qrBuffer = await toBuffer(qr);
                            res.setHeader('Content-Type', 'image/png');
                            res.end(qrBuffer);
                            
                            // Update session with QR generated
                            await ConnectionSession.findOneAndUpdate(
                                { sessionId },
                                { 
                                    $set: { 
                                        'connectionData.status': 'qr_generated',
                                        updatedAt: new Date()
                                    } 
                                }
                            );
                            return;
                        } catch (error) {
                            console.error("Error generating QR Code buffer:", error);
                            return;
                        }
                    }
                }

                if (connection === "open") {
                    console.log("Connection opened successfully!");
                    
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
                        const authPath = './session/';
                        const user_jid = jidNormalizedUser(EmpireQrWeb.user.id);

                        function randomMegaId() {
                            const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                            let result = '';
                            for (let i = 0; i < 6; i++) {
                                result += characters.charAt(Math.floor(Math.random() * characters.length));
                            }
                            const number = Math.floor(Math.random() * 10000);
                            return `${result}${number}`;
                        }

                        const sessionFile = authPath + 'creds.json';
                        const mega_url = await upload(fs.createReadStream(sessionFile), `${randomMegaId()}.json`);

                        const sid = mega_url.replace('https://mega.nz/file/', '');

                        await EmpireQrWeb.sendMessage(user_jid, { text: sid });

                        await delay(5000);
                        await EmpireQrWeb.sendMessage(user_jid, {
                            text: `> QR CODE CONNECTED SUCCESSFULLY ✅  \n\n╭────「 𝐂𝐎𝐍𝐍𝐄𝐂𝐓𝐄𝐃 」────◆  \n│ ∘ ʀᴇᴘᴏ:  \n│ ∘ tinyurl.com/Empire-Tech  \n│──────────────────────  \n│ ∘ Gʀᴏᴜᴘ:  \n│ ∘ tinyurl.com/EMPIRE-MD-GROUP  \n│──────────────────────  \n│ ∘ CHANNEL:  \n│ ∘ tinyurl.com/EMPIRE-MD-CHANNEL  \n│──────────────────────  \n│ ∘ Yᴏᴜᴛᴜʙᴇ:  \n│ ∘ youtube.com/only_one_empire  \n│──────────────────────  \n│ ∘ © 2025–2026 𝖤𝗆𝗉𝗂𝗋𝖾 𝖳𝖾𝖼𝗁  \n╰──────────────────────`
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
                    EmpireQr();
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
            fs.emptyDirSync('./session');
            if (!res.headersSent) {
                res.status(503).send({ error: "Service Unavailable" });
            }
        }
    }
    EmpireQr();
});

function generateSessionId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

process.on('uncaughtException', function (err) {
    console.log('Caught exception: ' + err);
    exec('pm2 restart empire-md-session');
});

module.exports = router;
