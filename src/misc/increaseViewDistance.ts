import { PacketMeta } from "minecraft-protocol"

async function handlePacket(data: any, meta: PacketMeta): Promise<boolean> {
    // todo: change this to a toggle
    if(meta.name === "login") {
        data.viewDistance = 32
    }
    if(meta.name === "update_view_distance") {
        data.viewDistance = 32
        console.log(data)
    }
    if(meta.name === "unload_chunk") {
        return false;
    }
    return true;
}

module.exports = handlePacket