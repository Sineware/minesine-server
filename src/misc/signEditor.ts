import { PacketMeta } from "minecraft-protocol"

async function handlePacket(data: any, meta: PacketMeta): Promise<void> {
    if(meta.name === "update_sign") {
        console.log(data);
    }
}

module.exports = handlePacket