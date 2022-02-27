const config = require("../config.json");
const mcData = require("minecraft-data")(config.version)
function openWindow(client) {
    client.write("open_window", {
        windowId: 1,
        inventoryType: 0,
        windowTitle: JSON.stringify({
            text: "Minesine Metaserver"
        })
    });
    client.write("set_slot", {
        windowId: 1,
        stateId: 1,
        slot: 1,
        item: {
            present: true,
            itemId: 1,
            itemCount: 1,
        }
    })
    client.write("set_slot", {
        windowId: 1,
        stateId: 1,
        slot: 1,
        item: {
            present: true,
            itemId: 126,
            itemCount: 1,
        }
    })
}

module.exports = {
    openWindow
}