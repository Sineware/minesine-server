import { Client } from "minecraft-protocol";

// Client States:
export type MinesineClient = {
    mcClient: Client,
    virtualClient: Client | null,
    currentServer: string,
    isLoggedIn: boolean,
    username: string | null,
    password: string | null, 
    windowOpen: boolean
}
class State {
    clients = new Map<string, MinesineClient>();
    server = null;
}

module.exports = new State();