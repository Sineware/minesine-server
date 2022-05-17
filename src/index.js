/*
    Sineware Minesine
    Copyright (C) 2022  Seshan Ravikumar

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as
    published by the Free Software Foundation, either version 3 of the
    License, or (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// Vendor
require('dotenv').config()
const mc = require('minecraft-protocol');
const crypto = require('crypto');
const glob = require("glob");
const os = require("os");
const fs = require("fs");
const queue = require("queue");

/// Internal
const config = require("./config.json");
const favicon = require("./misc/favicon.json")
let State = require("./state");
const {broadcast, joinClientToRemoteServer, sendChatMessageToClient} = require("./proxyUtils");
const {updateClientState, getClientState, getListOfClients} = require("./stateUtils");
const db = require('./db');
const {registerPubSubHandler, pubsubInstance} = require("./db/pubSubHandler");
const {handlePartyCommand} = require("./parties");

// The packet processing queue ensures packets are processed in order
let q = queue({ autostart: true, concurrency: 1, timeout: 10000 });

const sleep = ms => new Promise(r => setTimeout(r, ms));

const options = {
    motd: '\u00a78Mine\u00a73sine\u00a7r - \u00a7dSineware Cloud Minecraft Services\u00a7r            |  Cross-server chats, parties, and more!  |',
    'max-players': 127,
    port: 25565,
    'online-mode': true,
    keepAlive: false,
    version: config.version,
    favicon: favicon.base64
}

const server = mc.createServer(options);
State.server = server;

server.on('login', async function (client) {
    q.push(async () => {
        const addr = client.socket.remoteAddress + ':' + client.socket.remotePort
        console.log(client.username + ' connected', '(' + addr + ') version' + client.version)

        if(client.socket.remoteAddress === undefined) {
            // Bail, the client probably crashed.
            console.log("Client crashed before connection finished.")
            client.end();
            return;
        }
        // Initialize client object
        updateClientState(client.uuid, {
            mcClient: client, // Reference to the client
            virtualClient: null, // Reference to the virtual client
            currentServer: "", // host of the currently connected server
            isLoggedIn: false, // is the user logged-in to a server (set to false during a server switch)
            username: null, // Microsoft account email
            password: null, // mojang account password (no longer used)
            windowOpen: false // is the inventory window gui open (intercept window/slot events)
        });
        console.log("Initialized local client state object");
        // Welcome Message
        sendChatMessageToClient(client,{
            text: "~~ Minesine Metaserver ~~",
            bold: true,
            color: "dark_aqua"
        });
        sendChatMessageToClient(client,"A Sineware Labs Experiment");
        sendChatMessageToClient(client,"Use the /sw command to get started!");

        console.log("Sent initial chat messages, about to query database");
        // Fill login details from PostgreSQL
        try {
            let clientRowQuery = await db.query("SELECT * FROM minesine_users WHERE uuid=$1", [client.uuid]);
            if(clientRowQuery.rowCount !== 1) {
                // This is a new user.
                console.log("New user (no stored UUID): " + client.username);
                await db.query("INSERT INTO minesine_users(uuid) VALUES($1)", [client.uuid]);
            } else {
                let clientRow = clientRowQuery.rows[0];
                if(clientRow.email !== null) {
                    sendChatMessageToClient(client, "Welcome back! Your email has be automatically set.");
                    updateClientState(client.uuid, {
                        username: clientRow.email
                    });
                }
            }
            // Update username
            await db.query("UPDATE minesine_users SET username=$1, online=true, current_server=$3 WHERE uuid=$2", [client.username, client.uuid, config.hub.host + ":" + config.hub.port]);
        } catch (e) {
            console.log("A database error occurred for user: " + client.username);
            console.log(e);
            client.end("An error occurred, please contact us on Discord! (https://discord.gg/CKNwBmngxJ) Error: " + e.message);
        }

        console.log("Finished initial database queries, about to join player to hub.");
        // Join the hub server.
        joinClientToRemoteServer(client, config.hub.host + ":" + config.hub.port);

        // User Client event handlers
        client.on('error', (e) => {
            console.log(e);
        })
        client.on('end', async function () {
            console.log(client.username + ' disconnected', '(' + addr + ')');
            //todo note this isn't very robust (ex. server crash)
            await db.query("UPDATE minesine_users SET online=false WHERE uuid=$1", [client.uuid]);
            try {
                State.clients.get(client.uuid).virtualClient.end();
                State.clients.get(client.uuid).virtualClient.removeAllListeners();
                State.clients.delete(client.uuid);
            } catch (e) {
                console.log("Failed to end a client");
                console.log(e);
            }

        });

        // todo move out commands to their own files/folders
        client.on('chat', async function (data) {
            if(data.message.startsWith("/sw")) {
                console.log(client.username + ": " + data.message);
                let args = data.message.split(" ");
                switch(args[1]) {
                    case "hub": {
                        sendChatMessageToClient(client, "Sending you to hub...");
                        joinClientToRemoteServer(client, config.hub.host + ":" + config.hub.port);
                        break;
                    }
                    case "join": {
                        if(getClientState(client.uuid).username === null) {
                            sendChatMessageToClient(client, "You are not logged in yet! Use \"/sw auth EMAIL\" to get started.");
                            return;
                        }
                        console.log(args.length)
                        if(args.length <= 2) {
                            sendChatMessageToClient(client, "Use \"/sw join SERVER_IP\" to join a server.");
                            return;
                        }
                        sendChatMessageToClient(client, "Sending you to " + args[2] + "");
                        joinClientToRemoteServer(client, args[2], args[3]);
                        break;
                    }
                    case "auth": {
                        // todo do not let a user change emails after (they must use auth reset to delete cached tokens)
                        // todo SECURITY: do not let a user use an already linked email (else they can steal login with cached token)
                        if(args.length <= 2) {
                            sendChatMessageToClient(client, "Use \"/sw auth EMAIL\" to set your email!");
                            return;
                        }
                        if(args[2] === "reset") {
                            // From https://github.com/PrismarineJS/prismarine-auth/blob/master/src/MicrosoftAuthFlow.js
                            const sha1 = (data) => {
                                return crypto.createHash('sha1').update(data ?? '', 'binary').digest('hex')
                            }
                            const userHash = sha1(getClientState(client.uuid).username).substr(0, 6);
                            console.log(userHash);
                            // todo in the future we should override prismarine-auths caching system (ex. use longer hash)
                            glob(os.homedir() + "/.minecraft/nmp-cache/"+ userHash + "*", options, async function (er, files) {
                                for (let file of files) {
                                    console.log(file);
                                    fs.unlinkSync(file);
                                }
                                await db.query("UPDATE minesine_users SET email=$1 WHERE uuid=$2", [null, client.uuid]);
                                updateClientState(client.uuid, {
                                    username: null
                                });
                                sendChatMessageToClient(client, "Email has been cleared! Please set a new one using \"/sw auth your@email.com\"");
                            });
                        } else {
                            if(getClientState(client.uuid).username !== null) {
                                sendChatMessageToClient(client, "You have already authenticated! If you made a typo and need to reset your email, use \"/sw auth reset\"");
                                return;
                            }

                            // Check if email is already used.
                            if((await db.query("SELECT * FROM minesine_users WHERE email=$1", [args[2]])).rowCount !== 0) {
                                sendChatMessageToClient(client, "This email is already used! If you believe this is a mistake, contact staff on Discord.");
                                return;
                            }

                            updateClientState(client.uuid, {
                                username: args[2],
                                password: args[3]
                            });
                            try {
                                await db.query("UPDATE minesine_users SET email=$1 WHERE uuid=$2", [args[2], client.uuid]);
                            } catch (e) {
                                console.log("A database error occurred for user: " + client.username);
                                console.log(e);
                                sendChatMessageToClient("An error occurred, please contact us on Discord! Error: " + e.message);
                                return;
                            }

                            sendChatMessageToClient(client, "Successfully set account email! You will be prompted to login with Microsoft when you first join a server.");
                        }
                        break;
                    }
                    case "party": {
                        await handlePartyCommand(client, args);
                        break;
                    }

                    case "dm":
                    case "msg": {
                        if(args.length <= 3) {
                            sendChatMessageToClient(client, "Usage: /sw dm USERNAME MESSAGE");
                            return;
                        }
                        let uuidRes = await db.query("SELECT uuid FROM minesine_users WHERE username ILIKE $1", [args[2]]); //todo fuzzy
                        if(uuidRes.rowCount === 0) {
                            // todo inform fail (user not online)
                            sendChatMessageToClient(client, "User not found or is not online!");
                        } else {
                            let uuid = uuidRes.rows[0].uuid;
                            await pubsubInstance.publish('chat_dm', { fromUuid: client.uuid, fromUsername: client.username, toUuid: uuid, msg: args.slice(3).join(" ") });
                            sendChatMessageToClient(client, "me -> " + args[2] + ": " + args.slice(3).join(" "));
                        }
                        break;
                    }

                    case "profile": {
                        // todo
                        break;

                    }

                    case "tp": {
                        if(args.length <= 2) {
                            sendChatMessageToClient(client, "Usage: /sw tp USERNAME");
                            return;
                        }
                        let uuidRes = await db.query("SELECT current_server, online FROM minesine_users WHERE username ILIKE $1", [args[2]]); //todo fuzzy
                        if(uuidRes.rowCount === 0 || !uuidRes.rows[0].online) {
                            sendChatMessageToClient(client, "User not found or is not online!");
                        } else {
                            let currentServer = uuidRes.rows[0].current_server;
                            joinClientToRemoteServer(client, currentServer);

                        }
                        break;
                    }
                    case "discord": {
                        sendChatMessageToClient(client, {
                            text: "https://discord.gg/CKNwBmngxJ",
                            clickEvent:{"action":"open_url","value":"https://discord.gg/CKNwBmngxJ"},
                            underlined: true
                        },)
                        break;
                    }
                    case "debug": {
                        const clientState = getClientState(client.uuid);
                        let debugInfo = {
                            mcClient: typeof clientState.mcClient,
                            virtualClient: typeof clientState.virtualClient,
                            currentServer: clientState.currentServer,
                            isLoggedIn: clientState.isLoggedIn,
                            username: clientState.username
                        }
                        sendChatMessageToClient(client, JSON.stringify(debugInfo, null, 2));
                        break;
                    }
                    case "ping": {
                        if(args.length <= 2) {
                            sendChatMessageToClient(client, "Usage: /sw ping SERVER_IP [PORT]");
                            return;
                        }
                        try {
                            let port = null;
                            let hostOnly;
                            let portSplit = args[2].split(":");
                            if(portSplit.length > 1) {
                                port = portSplit[1];
                                hostOnly = portSplit[0];
                                console.log(port);
                            } else {
                                hostOnly = args[2];
                            }
                            let serverInfo = await mc.ping({
                                host: hostOnly,
                                port: port ?? 25565
                            });
                            sendChatMessageToClient(client, "-- " + args[2] + " --");
                            if(typeof serverInfo.description === "string") {
                                sendChatMessageToClient(client, serverInfo.description);
                            } else {
                                sendChatMessageToClient(client, {
                                    text: "",
                                    extra: serverInfo.description.extra
                                });
                            }
                            
                            sendChatMessageToClient(client, "Online: " + serverInfo.players.online + " / " + serverInfo.players.max);
                            for(let p of serverInfo.players.sample) {
                                sendChatMessageToClient(client, "    - " + p.name);
                            }
                            sendChatMessageToClient(client, "Server: " + serverInfo.version.name + " implementing " + serverInfo.version.protocol);
                            sendChatMessageToClient(client, "Ping: " + serverInfo.latency + "ms");
                        } catch(e) {
                            sendChatMessageToClient(client, e.message);
                            sendChatMessageToClient(client, "Could not ping that server! Is it online?");
                        }
                        break;
                    } 
                    case "list": {
                        sendChatMessageToClient(client, "Players Online: " + server.playerCount);
                        //console.log(getListOfClients())
                        for(const p of getListOfClients()) {
                            sendChatMessageToClient(client, "    - " + p.mcClient.username + " (" + (p.currentServer.startsWith(config.hub.host) ? "Minesine Hub" : p.currentServer)  + ")");
                        }
                        break;
                    }
                    case "help":
                    default: {
                        let helpMsgs = [
                            genHelpMessage("hub", "Teleport back to the hub."),
                            genHelpMessage("join SERVER", "Connect to a server. Replace SERVER with the IP (ex. hypixel.net)."),
                            genHelpMessage("auth EMAIL", "Set your Microsoft account email."),
                            genHelpMessage("auth reset", "Unlink your Microsoft account."),
                            genHelpMessage("dm USER MESSAGE", "Send a DM to USER(name)."),
                            genHelpMessage("tp USER", "Teleport to the server USER(name) is on."),
                            genHelpMessage("party USER", "Create a new party and invite USER(name)"),
                            genHelpMessage("party leave", "Leave a party you're in."),
                            genHelpMessage("party list", "List party members."),
                            genHelpMessage("party disband", "Disband a party (if you are a leader)."),
                            genHelpMessage("party chat MESSAGE", "Send a DM to all party members."),
                            genHelpMessage("party join USER", "Accept a party invite from USER(name)."),
                            genHelpMessage("ping SERVER", "Ping a server (get online users and server info)."),
                            genHelpMessage("list", "List clients using Minesine."),
                        ];
                        sendChatMessageToClient(client, {
                            text: "Minesine Commands: \n",
                            extra: helpMsgs
                        });
                    }
                }

                return;
            }
            const message = '<' + client.username + '>' + ' ' + data.message;
            console.log(message);
        });

        // todo cursed race condition when two people join at once
        await sleep(4000);
    });
});

server.on('error', function (error) {
    console.log('Error:', error);
})

server.on('listening', async function () {
    console.log('Server listening on port', server.socketServer.address().port);
    await registerPubSubHandler()
    setInterval(() => {
        broadcast("You are connected to the Minesine Metaserver Beta.");
        broadcast({
            text: "Link your discord account and report bugs to: ",
            extra: [
                {
                    text: "https://discord.gg/CKNwBmngxJ",
                    clickEvent:{"action":"open_url","value":"https://discord.gg/CKNwBmngxJ"},
                    underlined: true
                },
            ]
        });
    }, 600000);
});

const genHelpMessage = (cmd, desc) => {
    return {
        text: "/sw " + cmd,
        underlined: false,
        color: "dark_aqua",
        extra: [
            {
                text: " - ",
                color: "white",
                underlined: false
            },
            {
                text: desc,
                color: "white",
                underlined: false
            },
            {
                text: "\n",
                underlined: false
            }
        ]
    }
}