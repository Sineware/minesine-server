import { PacketMeta } from "minecraft-protocol"

async function handlePacket(data: any, meta: PacketMeta, bound: string, getClientState: Function, updateClientState: Function): Promise<boolean> {
    if(bound === "CLIENT" && meta.name === "open_sign_entity") {
        if(getClientState().cloneLastSign && getClientState().lastSign !== undefined) {
            let sign = getClientState().lastSign;
            getClientState().virtualClient.write("update_sign", {
                location: data.location,
                text1: sign.text1,
                text2: sign.text2,
                text3: sign.text3,
                text4: sign.text4
            });
            return false;
        }
    }
    if(bound === "SERVER" && meta.name === "update_sign") {
        console.log(data);
        updateClientState({lastSign: data});
    }
    return true;
}

module.exports = handlePacket