const mc = require("minecraft-protocol");
const State = require("./state");
const config = require("./config.json");
const {getClientState, updateClientState} = require("./stateUtils");
const {registerChannelHandler} = require("./channels/channelHandler");
const db = require("./db");
const queue = require("queue");
const pubsubInstance = require("./db/pubsubInstance");
const abstractVersion = require("./abstractVersion")

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Packet processing middleware
const userToServerFunctions = [
    require("./misc/signEditor")
];
const serverToUserFunctions = [
    require("./misc/fakeOpLevel"),
    require("./misc/increaseViewDistance"),
    require("./misc/signEditor")
]

// The packet processing queue ensures packets are processed in order
let qglobal = queue({ autostart: true, concurrency: 1, timeout: 5000 });
let qlength = 0;
/*setInterval(() => {
    console.log("The current total packet queue length is: " + qlength);
    qlength = 0;
}, 5000);*/

function broadcast (message, exclude, username) {
    let client
    const translate = username ? 'chat.type.announcement' : 'chat.type.text'
    username = username || {
        text: "Mine",
        color: "dark_aqua",
        extra: [
            {
                text: "Sine",
                color: "dark_purple"
            }
        ]
    };
    for (const clientId in State.server.clients) {
        if (State.server.clients[clientId] === undefined) continue

        client = State.server.clients[clientId]
        if (client !== exclude) {
            const msg = {
                translate: translate,
                with: [
                    username,
                    message
                ]
            }
            abstractVersion(client).sendChatMessage(msg);
        }
    }
}

function sendChatMessageToClient(client, msg) {
    abstractVersion(client).sendChatMessage(msg);
}

async function joinClientToRemoteServer(client, host) {
    qlength = qglobal.push(async () => joinClientToRemoteServerInternal(client, host));
    // todo cursed race condition when two people join at once
    await sleep(4000);
}


function joinClientToRemoteServerInternal(client, host) {
    let q = queue({ autostart: true, concurrency: 1, timeout: 5000 });
    q.on("error", (e) => {
        console.error("An error occurred in the packet processing queue for " + client.username + ": ");
        console.trace(e);
     });
    if(getClientState(client.uuid).username === null && host !== config.hub.host + ":" + config.hub.port) { // username is email
        console.log("Tried to connect, but was not authenticated.")
        sendChatMessageToClient(client, "You are not logged in yet! Use \"/sw auth EMAIL\" to get started.");
        return;
    }
    let port = null;
    let hostOnly;
    let portSplit = host.split(":");
    if(portSplit.length > 1) {
        port = portSplit[1];
        hostOnly = portSplit[0];
        console.log(port);
    } else {
        hostOnly = host;
    }
    console.log("host only: " + hostOnly);
    if(State.clients.has(client.uuid) && getClientState(client.uuid).currentServer === host) {
        console.log(client.username + " attempted to join a server they are already in.");
        sendChatMessageToClient(client, "You are already connected to that server!");
        return;
    }
    if(!host) {
        console.log("Undefined host for " + client.username);
        return;
    }

    // Proxy
    let virtualClient;
    console.log("Current state username: " + getClientState(client.uuid).username);
    try {
        virtualClient = (host !== config.hub.host + ":" + config.hub.port) ? mc.createClient({
            host: hostOnly,
            port: port ?? 25565,
            username: getClientState(client.uuid).username,
            auth: 'microsoft',
            onMsaCode: (data) => {
                console.log(data);
                sendChatMessageToClient(client, {
                    text: "",
                    extra: [
                        {
                            text: "!!! ",
                            color: "red"
                        },
                        {
                            text: "To sign in, use a web browser to open the page "
                        },
                        {
                            text: data.verification_uri,
                            underlined: true,
                            clickEvent: {
                                action: "open_url",
                                value: data.verification_uri
                            },
                            hoverEvent: {
                                action: "show_text",
                                value: "Click to Open Link"
                            }
                        },
                        {
                            text: " and enter the code "
                        },
                        {
                            text: data.user_code,
                            underlined: true,
                            clickEvent: {
                                action: "copy_to_clipboard",
                                value: data.user_code
                            },
                            hoverEvent: {
                                action: "show_text",
                                value: "Click to Copy Code"
                            }
                        },
                        {
                            text: " to authenticate."
                        },
                        {
                            text: " !!! ",
                            color: "red"
                        }
                    ]
                });
            },
            keepAlive: false,
            version: client.version
        }) : mc.createClient({
            host: hostOnly,
            port: port ?? 25565,
            username: client.username, // Hub is "offline" by default (auth is already handled if you are connected)
            auth: 'mojang',
            keepAlive: false,
            version: client.version
        });
    } catch (e) {
        console.log("Failed to create virtualClient (exception caught) for " + client.username);
        console.log(e);
        client.end("An error occurred, please contact us on Discord! (https://discord.gg/CKNwBmngxJ) Error: " + e.message);
    }

    console.log("Ran createClient for " + client.username);

    virtualClient.on("error", async (e) => {
        console.log("Failed to create virtualClient (error caught) for " + client.username);
        console.log(e);
        if(getClientState(client.uuid).isLoggedIn) {
            console.log("The user was logged in.");
            // if in hub, return 
            if(host === config.hub.host + ":" + config.hub.port) {
                console.log("The user was in the hub, returning.");
                return;
            }
        } else {
            console.log("The user was not logged in.");
            // Probably failed to join hub
            client.end("An error occurred, please contact us on Discord! (https://discord.gg/CKNwBmngxJ) Error: " + e);
            return;
        }
        sendChatMessageToClient(client, "An error occurred! You may have connected to a invalid server. Error: " + e);
        sendChatMessageToClient(client, "If the problem persists, contact staff on Discord! (https://discord.gg/CKNwBmngxJ)");
        await sleep(4000);
        await joinClientToRemoteServer(client, config.hub.host + ":" + config.hub.port);
        console.log(e.message);
    });

    virtualClient.on('connect', () => {
        qlength = q.push(async () => {
            // Runs before login, when the initial TCP socket connects.
            console.log("virtualClient connect for " + client.username) ;
            if(State.clients.has(client.uuid) && getClientState(client.uuid).virtualClient !== null) {
                // End the previous virtual client and clean up.
                console.log("Destroying old virtualClient for " + client.username);
                getClientState(client.uuid).virtualClient.end();
                getClientState(client.uuid).virtualClient.removeAllListeners();
                getClientState(client.uuid).virtualClient = null;
                getClientState(client.uuid).q.end();
            }
            console.log("Updating client state on connect");
            // Update client state
            updateClientState(client.uuid, {
                virtualClient: virtualClient, // set new virtualClient reference
                currentServer: host,
                isLoggedIn: false,
                q: q
            });
        });
    });
    virtualClient.on('login', (data, meta) => {
        console.log("login event for " + client.username);

        
        qlength = q.push(async () => {
            if(!getClientState(client.uuid).isLoggedIn) { // Target servers may send additional login events when switching servers/worlds
                console.log("virtualClient logged in for " + virtualClient.username + " to " + host);
                console.log("Setting offline uuid " + virtualClient.uuid);
                console.log(data)
                // Put the user in the respawn state
                abstractVersion(client).respawn(data);

                // Update DB
                await db.query("UPDATE minesine_users SET offline_uuid=$1,client_properties=$2,current_server=$3 WHERE uuid=$4", [virtualClient.uuid, JSON.stringify(client.profile.properties), host, client.uuid]);
                // Register Channel Handlers
                await registerChannelHandler(virtualClient);
                updateClientState(client.uuid, {isLoggedIn: true});

                // Move party members
                const userParty = (await db.query("SELECT * FROM minesine_users WHERE uuid=$1", [client.uuid]));
                await pubsubInstance.publish("change_server", {
                    fromUuid: client.uuid,
                    fromUsername: client.username,
                    partyUuid: userParty.rows[0].party_uuid,
                    partyUsers: (await db.query("SELECT uuid FROM minesine_users WHERE party_uuid=$1", [userParty.rows[0].party_uuid])).rows,
                    host
                });
            }
        });
    });

    // ~~~~~~~~ Proxy user --> server 
    client.on("packet", (data, meta, buf, fullBuf) => {
        
        qlength = q.push(async () => {
            if(meta.name === "custom_payload") {
                console.log("custom_payload user to server: ")
                console.log(data);
                // modify brand to include minesine
                if(data.channel === "minecraft:brand") {
                    console.log("brand: " + data.data.toString()); 
                    // todo
                }
            }

            //if(meta.name === "block_dig") {
                //console.log(data);
            //}
            if(meta.name === abstractVersion(client).protocolCommand.name)
                if(abstractVersion(client).protocolCommand.getString(data).startsWith("sw") || abstractVersion(client).protocolCommand.getString(data).startsWith("/sw"))
                    return; // Already handled, don't pass through to the remote server.

            // Run each middleware function
            for(const f of userToServerFunctions) {
                let res = await f(data, meta, "SERVER", () => getClientState(client.uuid), (newState) => updateClientState(client.uuid, newState));
                if(!res)
                    return;
            }
            
            if (virtualClient.state === mc.states.PLAY && meta.state === mc.states.PLAY) {
                //virtualClient.write(meta.name, data);
                virtualClient.writeRaw(buf)
            }
        });
    });
    // ~~~~~~~~ proxy server --> user ~~~~~~~~
    virtualClient.on("packet", (data, meta, buf, fullBuf) => {
        qlength = q.push(async () => {
            if(meta.name === "custom_payload") {
                console.log("custom_payload server to user: ")
                console.log(data);
                try {
                    if(data.channel === "minecraft:brand") {
                        // modify server brand to include minesine
                        // todo
                    } else {
                        // Respond to bungee connect message
                        // todo we cant actually check the channel this way, only contents
                        let channelMsg = data.data.toString("ascii").split("\x00").slice(1);
                        console.log(channelMsg);
                        if(channelMsg.length !== 0) {
                            // todo THIS IS VERY HACKY, DO SOMETHING PROPERLY LATER!!
                            let bungeeCommand = channelMsg[0].substring(1);
                            let bungeeValue = channelMsg[1].substring(1);
                            console.log("Command: " + bungeeCommand + ", value: " + bungeeValue);
                            switch(bungeeCommand) {
                                case "Connect": {
                                    if(getClientState(client.uuid).username === null) { // username is email
                                        sendChatMessageToClient(client, "You are not logged in yet! Use \"/sw auth EMAIL\" to get started.");
                                        return;
                                    }
                                    await joinClientToRemoteServer(getClientState(client.uuid).mcClient, bungeeValue);
                                    return;
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error("An error occured reading custom_payload: ");
                    console.trace(e);
                }
            
            }
            if (meta.state === mc.states.PLAY && client.state === mc.states.PLAY) {
                // Intercept UUID (offline servers) for Hub
                if(meta.name === "player_info" && host === config.hub.host + ":" + config.hub.port) {
                    try {
                        //console.log("Player info data: ");
                        //console.log(data);
                        for (const player of data.data) {
                            let offlineUUID = player.UUID;
                            let dbUser = (await db.query("SELECT uuid, client_properties FROM minesine_users WHERE offline_uuid=$1", [offlineUUID])).rows[0];
                            console.log(dbUser)
                            if(dbUser.uuid === client.uuid) {
                                player.UUID = dbUser.uuid;
                            }
                            if(data.action === 0) {
                                console.log(player)
                                console.log("UUID of offline to online: ");
                                console.log(dbUser.uuid);
                                player.properties = dbUser.client_properties
                                    .map(property => ({
                                        name:property.name,
                                        value:property.value,
                                        isSigned:true,
                                        signature:property.signature
                                    }));
                            }
                        }
                    } catch(e) {
                        console.error("An error occurred mapping skins onto offline UUIDs for the hub server!");
                        console.trace(e);
                    }
                }

                // Run each middleware function
                for(const f of serverToUserFunctions) {
                    let res = await f(data, meta, "CLIENT", () => getClientState(client.uuid), (newState) => updateClientState(client.uuid, newState));
                    if(!res)
                        return;
                }

                try {
                    //console.log("Sending packet to client: " + meta.name)
                    if(meta.name === "custom_payload") {
                        return;
                    }
                    if(meta.name === "sound_effect") {
                        return;
                    }
                    client.write(meta.name, data);
                } catch(e) {
                    console.error("An error occurred writing to the client: ");
                    console.trace(e);
                }
                if (meta.name === "set_compression") // Set compression
                    client.compressionThreshold = data.threshold;
            }
        });
    });
    console.log("Registered all event listeners.");
}

module.exports = {
    broadcast,
    sendChatMessageToClient,
    joinClientToRemoteServer
};