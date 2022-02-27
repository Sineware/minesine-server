const PGPubsub = require('pg-pubsub');
const db = require("../db");
const State = require("../state");
const {getClientState, updateClientState} = require("../stateUtils");
const {sendChatMessageToClient, joinClientToRemoteServer} = require("../proxyUtils");

const pubsubInstance = require("./pubsubInstance");
const {isClientPartyLeader} = require("../parties");

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function registerPubSubHandler() {
    console.log("Registering PubSub for DMs...");
    await pubsubInstance.addChannel('chat_dm', async function (data) {
        console.log(data);
        if(State.clients.has(data.toUuid)) {
            sendChatMessageToClient(getClientState(data.toUuid).mcClient, data.fromUsername + " -> me: " + data.msg);
        }
    });
    await pubsubInstance.addChannel('party_inform', async function (data) {
        console.log(data);
        switch(data.action) {
            case "invite": {
                if(State.clients.has(data.payload.toUuid)) {
                    sendChatMessageToClient(getClientState(data.payload.toUuid).mcClient, {
                        text: "You have been invited to a party by " + data.payload.fromUsername + "! ",
                        extra: [
                            {
                                text: "Click here to accept!",
                                underlined: true,
                                clickEvent: {
                                    action: "run_command",
                                    value: "/sw party join " + data.payload.fromUsername
                                }
                            }
                        ]
                    });
                }
                break;
            }
            case "join_party": {
                for(let user of data.payload.partyUsers) {
                    if(State.clients.has(user.uuid)) {
                        sendChatMessageToClient(getClientState(user.uuid).mcClient,"[Party] " + data.payload.fromUsername + " has joined the party!");
                    }
                }
                break;
            }
            case "leave_party": {
                for(let user of data.payload.partyUsers) {
                    if(State.clients.has(user.uuid)) {
                        sendChatMessageToClient(getClientState(user.uuid).mcClient,"[Party] " + data.payload.fromUsername + " has left the party!");
                    }
                }
                break;
            }
            case "chat": {
                for(let user of data.payload.partyUsers) {
                    try {
                        if(State.clients.has(user.uuid)) {
                            sendChatMessageToClient(getClientState(user.uuid).mcClient,"[Party] " + data.payload.fromUsername + ": " + data.payload.msg);
                        }
                    } catch(e) {
                        console.log(e)
                    }

                }
                break;
            }
        }
    });
    await pubsubInstance.addChannel('change_server', async function (data) {
        console.log(data);
        if(await isClientPartyLeader({uuid: data.fromUuid})) {
            console.log("Party leader " + data.fromUsername + " is moving to " + data.host);
            for(let user of data.partyUsers) {
                if(user.uuid === data.fromUuid) {
                    continue;
                }
                if(State.clients.has(user.uuid)) {
                    await sleep(4000); // todo cursed
                    sendChatMessageToClient(getClientState(user.uuid).mcClient, "The party is moving to " + data.host);
                    joinClientToRemoteServer(getClientState(user.uuid).mcClient,data.host);
                }
            }
        }
    });
}
module.exports = {
    pubsubInstance,
    registerPubSubHandler
}