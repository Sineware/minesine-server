import { PacketMeta } from "minecraft-protocol"

async function handleSignPackets(data: any, meta: PacketMeta): Promise<void> {
    // todo: change this to a toggle
    if(meta.name === "entity_status") {
        if(data.entityStatus == 24) {
            console.log("Faking OP Permission Level");
            data.entityStatus = 28;
        }
    }
}

module.exports = handleSignPackets