// Vendor
const { v4: uuidv4 } = require('uuid');
// Internal
const {sendChatMessageToClient} = require("../proxyUtils");
const db = require("../db");
const {pubsubInstance} = require("../db/pubsubInstance");

async function handlePartyCommand(client, args) {
    if(args[2] === undefined)  {
        sendChatMessageToClient(client, "Todo: usage\n newline");
        return;
    }
    switch(args[2]) {
        case "join": {
            // user wants to join a party
            let isLeader = await isClientPartyLeader(client);
            if(isLeader) {
                sendChatMessageToClient(client, "You are the leader of a party! To join another one, first disband your party with /sw party disband");
                return;
            }
            let user = (await db.query("SELECT * FROM minesine_users WHERE uuid=$1", [client.uuid])).rows[0]
            if(user.party_uuid) {
                sendChatMessageToClient(client, "You are already in a party! To leave it, use /sw party leave");
                return;
            }
            // Get from User
            let fromUser = (await db.query("SELECT * FROM minesine_users WHERE username ILIKE $1", [args[3]]));
            console.log(fromUser);
            if(fromUser.rowCount === 0) {
                sendChatMessageToClient(client, "User not found!");
                return;
            }
            // Check if user was actually invited.
            let invitedParty = await db.query("SELECT * FROM minesine_parties WHERE leader_uuid=$1 AND $2=ANY(invited_users)", [fromUser.rows[0].uuid, client.uuid]);
            console.log(invitedParty)
            if(invitedParty.rowCount === 0) {
                sendChatMessageToClient(client, "You were not invited to that users party!");
                return;
            }
            await db.query("UPDATE minesine_users SET party_uuid=$1 WHERE uuid=$2", [invitedParty.rows[0].party_uuid, client.uuid]);
            await pubsubInstance.publish("party_inform", {
                action: "join_party",
                payload: {
                    fromUuid: client.uuid,
                    fromUsername: client.username,
                    partyUuid: invitedParty.rows[0].party_uuid,
                    partyUsers: (await db.query("SELECT uuid FROM minesine_users WHERE party_uuid=$1", [invitedParty.rows[0].party_uuid])).rows
                }
            });
            break;
        }
        case "leave": {
            const userParty = (await db.query("SELECT * FROM minesine_users WHERE uuid=$1", [client.uuid]));
            console.log(userParty);
            if(userParty.rows[0].party_uuid) {
                // They are in a party, check if leader
                const party = (await db.query("SELECT * FROM minesine_parties WHERE party_uuid=$1 AND leader_uuid=$2", [userParty.rows[0].party_uuid, client.uuid]));
                if(party.rowCount === 0) {
                    await db.query("UPDATE minesine_users SET party_uuid=null WHERE uuid=$1", [client.uuid]);
                    await sendChatMessageToClient(client, "You have left the party!");
                    await pubsubInstance.publish("party_inform", {
                        action: "leave_party",
                        payload: {
                            fromUuid: client.uuid,
                            fromUsername: client.username,
                            partyUuid: userParty.rows[0].party_uuid,
                            partyUsers: (await db.query("SELECT uuid FROM minesine_users WHERE party_uuid=$1", [userParty.rows[0].party_uuid])).rows
                        }
                    });
                } else {
                    sendChatMessageToClient(client, "You are the leader of the party! You can only disband the party with /sw party disband.");
                    return;
                }
            } else {
                sendChatMessageToClient(client, "You are not in a party!");
            }
            break;
        }
        case "list": {
            const userParty = (await db.query("SELECT * FROM minesine_users WHERE uuid=$1", [client.uuid]));
            if(userParty.rows[0].party_uuid) {
                const usersInParty = (await db.query("SELECT * FROM minesine_users WHERE party_uuid=$1", [userParty.rows[0].party_uuid])).rows
                console.log(usersInParty);
                // todo note who's online, and the leader.
                sendChatMessageToClient(client,"Party Members: " + usersInParty.map((u) => u.username).join(", "));
            } else {
                sendChatMessageToClient(client, "You are not in a party!");
            }
            break;
        }
        case "disband": {
            const userParty = (await db.query("SELECT * FROM minesine_users WHERE uuid=$1", [client.uuid]));
            console.log(userParty);
            if(userParty.rows[0].party_uuid) {
                // They are in a party, check if leader
                const party = (await db.query("SELECT * FROM minesine_parties WHERE party_uuid=$1 AND leader_uuid=$2", [userParty.rows[0].party_uuid, client.uuid]));
                if(party.rowCount === 0) {
                    sendChatMessageToClient(client, "You are not the leader of the party!");
                    return;
                } else {
                    await db.query("UPDATE minesine_users SET party_uuid=null WHERE party_uuid=$1", [userParty.rows[0].party_uuid]);
                    await db.query("DELETE FROM minesine_parties WHERE party_uuid=$1", [userParty.rows[0].party_uuid]);
                    sendChatMessageToClient(client, "The party has been disbanded!");
                }
            } else {
                sendChatMessageToClient(client, "You are not in a party!");
            }
            break;
        }
        case "chat": {
            // todo party chat toggle
            const userParty = (await db.query("SELECT * FROM minesine_users WHERE uuid=$1", [client.uuid]));
            console.log(userParty);
            if(userParty.rows[0].party_uuid) {
                await pubsubInstance.publish("party_inform", {
                    action: "chat",
                    payload: {
                        fromUuid: client.uuid,
                        fromUsername: client.username,
                        partyUuid: userParty.rows[0].party_uuid,
                        partyUsers: (await db.query("SELECT uuid FROM minesine_users WHERE party_uuid=$1", [userParty.rows[0].party_uuid])).rows,
                        msg: args.slice(3).join(" ")
                    }
                });
            } else {
                sendChatMessageToClient(client, "You are not in a party!");
            }
            break;
        }
        default: {
            // user wants to add another user to their party
            try {
                console.log("adding " + args[2] + " to party!");
                const targetUser = (await db.query("SELECT * FROM minesine_users WHERE username ILIKE $1", [args[2]]));
                if(targetUser.rowCount === 0 || !targetUser.rows[0].online) {
                    sendChatMessageToClient(client, "User does not exist or is not online!");
                    return;
                }
                // Get party user is a part of:
                const userParty = (await db.query("SELECT party_uuid FROM minesine_users WHERE uuid=$1", [client.uuid]));
                console.log(userParty);
                if(userParty.rows[0].party_uuid) {
                    // They are in a party, check if leader
                    const party = (await db.query("SELECT * FROM minesine_parties WHERE party_uuid=$1 AND leader_uuid=$2", [userParty.rows[0].party_uuid, client.uuid]));
                    if(party.rowCount === 0) {
                        sendChatMessageToClient(client, "You are not the leader of the party!");
                        return;
                    }
                } else {
                    // Create a new party
                    let partyUUID = uuidv4();
                    await db.query("INSERT INTO minesine_parties(party_uuid, name, leader_uuid) VALUES($1, $2, $3)", [partyUUID, "Default Party Name", client.uuid]);
                    await db.query("UPDATE minesine_users SET party_uuid=$1 WHERE uuid=$2", [partyUUID, client.uuid]);
                }
                // Invite target user to party
                await db.query("UPDATE minesine_parties SET invited_users=array_append(invited_users, $1) WHERE leader_uuid=$2", [targetUser.rows[0].uuid, client.uuid]);
                await pubsubInstance.publish("party_inform", {
                    action: "invite",
                    payload: {
                        toUuid: targetUser.rows[0].uuid,
                        fromUsername: client.username,
                        partyUuid: (await db.query("SELECT minesine_parties.party_uuid FROM minesine_parties JOIN minesine_users ON minesine_users.party_uuid=minesine_parties.party_uuid WHERE minesine_users.uuid=$1", [client.uuid])).rows[0].party_uuid
                    }
                });
                sendChatMessageToClient(client, "Party invite has been sent!")
            } catch(e) {
                console.log(e);
                sendChatMessageToClient(client, "An error has occurred: " + e.message);
            }

        }
    }
}

async function isClientPartyLeader(client) {
    const userParty = (await db.query("SELECT party_uuid FROM minesine_users WHERE uuid=$1", [client.uuid]));
    console.log(userParty);
    if(userParty.rows[0].party_uuid) {
        // They are in a party, check if leader
        const party = (await db.query("SELECT * FROM minesine_parties WHERE party_uuid=$1 AND leader_uuid=$2", [userParty.rows[0].party_uuid, client.uuid]));
        if(party.rowCount !== 0) {
            return true;
        }
    }
    return false;
}

module.exports = {
    handlePartyCommand,
    isClientPartyLeader
}