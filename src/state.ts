import { Client } from "minecraft-protocol";
import Queue from "queue";

// Client States:
export type MinesineClient = {
    mcClient: Client,
    virtualClient: Client | null,
    currentServer: string,
    isLoggedIn: boolean,
    username: string | null,
    password: string | null, 
    windowOpen: boolean,
    lastSign: object | undefined,
    cloneLastSign: boolean | undefined,
    q: Queue
}
class State {
    clients = new Map<string, MinesineClient>();
    server = null;
}

module.exports = new State();