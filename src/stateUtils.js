const State = require("./state");

function getClientState(uuid) {
    return State.clients.get(uuid);
}

function updateClientState(uuid, newState) {
    if(!State.clients.has(uuid)) {
        State.clients.set(uuid, newState);
    } else {
        const oldState = State.clients.get(uuid);
        State.clients.set(uuid, {...oldState, ...newState});
    }
}

module.exports = {
    getClientState,
    updateClientState
}