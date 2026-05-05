const WebSocket = require("ws");
const wss = new WebSocket.Server({ port: 8080 });

let waiting = null;

wss.on("connection", (ws) => {
    console.log("Player connected");

    if(waiting){
        const p1 = waiting;
        const p2 = ws;

        p1.send(JSON.stringify({type:"start", side:0}));
        p2.send(JSON.stringify({type:"start", side:1}));

        waiting = null;
    } else {
        waiting = ws;
        ws.send(JSON.stringify({type:"waiting"}));
    }

    ws.on("message", (msg) => {
        console.log("Message:", msg.toString());
    });

    ws.on("close", () => {
        console.log("Disconnected");
    });
});

console.log("Server running on ws://localhost:8080");
