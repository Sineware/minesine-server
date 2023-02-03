import { Client } from "minecraft-protocol";
interface AbstractedClientFunctions {
  respawn: (data: any) => void;
  sendChatMessage: (msg: string) => void;
  protocolCommand: {
    name: string
    getString: (data: any) => string
  }
}
// Abstract functions for multiple protocol versions
export default function abstractVersion(client: Client): AbstractedClientFunctions {
  switch(client.protocolVersion) {
    case 758: {
      // 1.18.2
      return {
        protocolCommand: {
          name: "chat",
          getString: (data: any) => {
            return data.message
          }
        },
        respawn: (data: any) => {
          console.log(data);
          const { dimension, worldName, hashedSeed, previousGamemode, isDebug, isFlat, gameMode: gamemode } = data;
          client.write('respawn', {
              dimension,
              worldName,
              hashedSeed,
              gamemode,
              previousGamemode,
              isDebug,
              isFlat,
              copyMetadata: false
          });
        },
        sendChatMessage: (msg) => {
          const msgJSON = {
            translate: "chat.type.announcement",
            with: [
                {
                    text: "Mine",
                    color: "dark_aqua",
                    extra: [
                        {
                            text: "sine",
                            color: "dark_purple"
                        }
                    ]
                },
                msg
            ]
          };
          client.write('chat', {
            message: JSON.stringify(msgJSON),
            position: 0,
            sender: '0'
          });
        }
      }
    }
    case 761:
    case 759: {
      // 1.19
      return {
        protocolCommand: {
          name: "chat_command",
          getString: (data: any) => {
            return data.command
          }
        },
        respawn: (data: any) => {
          const { worldType: dimension, worldName, hashedSeed, previousGamemode, isDebug, isFlat, gameMode: gamemode } = data;
          client.write('respawn', {
              worldName,
              dimension,
              hashedSeed,
              gamemode,
              previousGamemode,
              isDebug,
              isFlat,
              copyMetadata: false
          });
        },
        sendChatMessage: (msg) => {
          const msgJSON = {
            translate: "chat.type.announcement",
            with: [
                {
                    text: "Mine",
                    color: "dark_aqua",
                    extra: [
                        {
                            text: "sine",
                            color: "dark_purple"
                        }
                    ]
                },
                msg
            ]
         }
          client.write('system_chat', {
              content: JSON.stringify(msgJSON),
              type: 1
          });
        }
      }
    }
  }
  throw new Error("Unsupported protocol version " + client.protocolVersion);
}

module.exports = abstractVersion;