import { PacketMeta } from "minecraft-protocol"

async function handlePacket(data: any, meta: PacketMeta): Promise<boolean> {
    if(meta.name === "update_sign") {
        console.log(data);
    }
    return true;
}

module.exports = handlePacket