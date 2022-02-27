async function registerChannelHandler(client) {
    // Invoked for virtualClient
    console.log("Registering plugin messaging channels for " + client.username);
    client.write("custom_payload", {
        channel: 'minecraft:register',
        data: Buffer.from("bungeecord:main", "utf8")
    });
}

async function handleChannelMessage() {

}

module.exports = {
    registerChannelHandler
}