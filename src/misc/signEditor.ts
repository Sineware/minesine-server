import { PacketMeta } from "minecraft-protocol"

async function handleSignPackets(data: any, meta: PacketMeta): Promise<void> {
    if(meta.name === "update_sign") {
        console.log(data);
    }
}

module.exports = handleSignPackets