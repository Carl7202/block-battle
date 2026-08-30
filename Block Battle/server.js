const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*"
    }
});

const PORT =
    process.env.PORT || 3000;

const rooms = new Map();

app.use(
    express.static(__dirname)
);

app.get("/health",(req,res)=>{
    res.json({
        online:true,
        rooms:rooms.size
    });
});


function makeCode(){

    const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code="";

    do{

        code="";

        for(let i=0;i<6;i++){

            code+=
                chars[
                    Math.floor(
                        Math.random()*
                        chars.length
                    )
                ];

        }

    }while(rooms.has(code));

    return code;
}


function randomColor(){

    const colors=[
        0xff5555,
        0x5588ff,
        0xffcc33,
        0x55dd88,
        0xaa66ff,
        0xff66bb,
        0x44cccc,
        0xff8844
    ];

    return colors[
        Math.floor(
            Math.random()*
            colors.length
        )
    ];
}


function roomPlayers(room){

    return [
        ...room.players.values()
    ].map(p=>({

        id:p.id,
        name:p.name,
        host:p.host,
        ready:p.ready,
        color:p.color,
        x:p.x,
        y:p.y,
        z:p.z,
        rotation:p.rotation

    }));

}


function sendLobby(code){

    const room=
        rooms.get(code);

    if(!room)
        return;

    io.to(code).emit(
        "lobby",
        {
            players:roomPlayers(room),
            host:room.host
        }
    );

}


function removeFromRoom(socket){

    const code=
        socket.room;

    if(!code)
        return;

    const room=
        rooms.get(code);

    if(!room)
        return;

    room.players.delete(
        socket.id
    );

    socket.leave(code);

    socket.room=null;

    if(
        room.host===
        socket.id
    ){

        const next=
            room.players.values().next().value;

        if(next){

            next.host=true;

            room.host=next.id;

        }

    }

    if(
        room.players.size===0
    ){

        rooms.delete(code);

    }else{

        sendLobby(code);

        io.to(code).emit(
            "playersCount",
            room.players.size
        );

        io.to(code).emit(
            "playerLeft",
            socket.id
        );

    }

}


io.on("connection",socket=>{

    console.log(
        "Connected:",
        socket.id
    );


    socket.on(
        "createRoom",
        data=>{

            removeFromRoom(socket);

            const code=
                makeCode();

            const player={

                id:socket.id,

                name:
                    String(data.name||"Player")
                    .slice(0,16),

                host:true,

                ready:false,

                color:
                    randomColor(),

                x:0,

                y:0,

                z:0,

                rotation:0

            };

            rooms.set(
                code,
                {
                    host:socket.id,
                    started:false,
                    players:
                        new Map([
                            [socket.id,player]
                        ])
                }
            );

            socket.room=code;

            socket.join(code);

            socket.emit(
                "roomCreated",
                {
                    room:code
                }
            );

            sendLobby(code);

        }
    );


    socket.on(
        "joinRoom",
        data=>{

            const code=
                String(
                    data.room||""
                )
                .toUpperCase();

            const room=
                rooms.get(code);

            if(!room){

                socket.emit(
                    "errorMessage",
                    "That lobby doesn't exist."
                );

                return;

            }

            if(room.started){

                socket.emit(
                    "errorMessage",
                    "That game has already started."
                );

                return;

            }

            if(
                room.players.size>=8
            ){

                socket.emit(
                    "errorMessage",
                    "That lobby is full."
                );

                return;

            }

            const player={

                id:socket.id,

                name:
                    String(data.name||"Player")
                    .slice(0,16),

                host:false,

                ready:false,

                color:
                    randomColor(),

                x:0,

                y:0,

                z:0,

                rotation:0

            };

            room.players.set(
                socket.id,
                player
            );

            socket.room=code;

            socket.join(code);

            socket.emit(
                "roomJoined",
                {
                    room:code
                }
            );

            socket.to(code).emit(
                "playerJoined",
                player
            );

            sendLobby(code);

        }
    );


    socket.on(
        "ready",
        data=>{

            const room=
                rooms.get(
                    socket.room
                );

            if(!room)
                return;

            const p=
                room.players.get(
                    socket.id
                );

            if(!p)
                return;

            p.ready=!p.ready;

            sendLobby(
                socket.room
            );

        }
    );


    socket.on(
        "startGame",
        data=>{

            const room=
                rooms.get(
                    socket.room
                );

            if(!room)
                return;

            if(
                room.host!==
                socket.id
            )
                return;

            if(room.started)
                return;

            room.started=true;

            io.to(
                socket.room
            ).emit(
                "gameStart",
                {
                    players:
                        roomPlayers(room)
                }
            );

        }
    );


    socket.on(
        "state",
        data=>{

            const room=
                rooms.get(
                    socket.room
                );

            if(!room || !room.started)
                return;

            const p=
                room.players.get(
                    socket.id
                );

            if(!p)
                return;

            p.x=
                Number(data.x)||0;

            p.y=
                Number(data.y)||0;

            p.z=
                Number(data.z)||0;

            p.rotation=
                Number(data.rotation)||0;

            socket.to(
                socket.room
            ).emit(
                "playerState",
                {
                    id:socket.id,
                    x:p.x,
                    y:p.y,
                    z:p.z,
                    rotation:p.rotation
                }
            );

        }
    );


    socket.on(
        "shoot",
        data=>{

            const room=
                rooms.get(
                    socket.room
                );

            if(!room || !room.started)
                return;

            /*
             * This prototype uses server-side
             * hit validation based on player
             * distance.
             */

            const shooter=
                room.players.get(
                    socket.id
                );

            if(!shooter)
                return;

            let damage=0;

            if(data.weapon===1)
                damage=25;

            if(data.weapon===2)
                damage=9;

            if(data.weapon===3)
                damage=40;

            for(
                const target of room.players.values()
            ){

                if(
                    target.id===
                    socket.id
                )
                    continue;

                const dx=
                    target.x-
                    shooter.x;

                const dz=
                    target.z-
                    shooter.z;

                const distance=
                    Math.hypot(dx,dz);

                if(distance>12)
                    continue;

                const angle=
                    Math.atan2(
                        dx,
                        dz
                    );

                let difference=
                    Number(data.rotation||0)-
                    angle;

                difference=
                    Math.atan2(
                        Math.sin(difference),
                        Math.cos(difference)
                    );

                if(
                    Math.abs(difference)<.18 ||
                    data.weapon===3 &&
                    Math.abs(difference)<.35
                ){

                    io.to(
                        target.id
                    ).emit(
                        "damage",
                        {
                            target:target.id,
                            amount:damage
                        }
                    );

                    if(
                        data.weapon!==3
                    ){

                        io.to(
                            socket.id
                        ).emit(
                            "score",
                            {
                                id:socket.id,
                                score:1
                            }
                        );

                    }

                    break;

                }

            }

        }
    );


    socket.on(
        "chat",
        data=>{

            const room=
                rooms.get(
                    socket.room
                );

            if(!room)
                return;

            const p=
                room.players.get(
                    socket.id
                );

            if(!p)
                return;

            const message=
                String(
                    data.message||""
                )
                .slice(0,100)
                .trim();

            if(!message)
                return;

            io.to(
                socket.room
            ).emit(
                "chat",
                {
                    name:p.name,
                    message
                }
            );

        }
    );


    socket.on(
        "respawn",
        data=>{

            const room=
                rooms.get(
                    socket.room
                );

            if(!room)
                return;

            const p=
                room.players.get(
                    socket.id
                );

            if(!p)
                return;

            p.x=0;
            p.y=0;
            p.z=0;

            io.to(
                socket.room
            ).emit(
                "playerState",
                {
                    id:socket.id,
                    x:0,
                    y:0,
                    z:0,
                    rotation:0
                }
            );

        }
    );


    socket.on(
        "leaveRoom",
        ()=>{
            removeFromRoom(socket);
        }
    );


    socket.on(
        "disconnect",
        ()=>{

            console.log(
                "Disconnected:",
                socket.id
            );

            removeFromRoom(socket);

        }
    );

});


server.listen(
    PORT,
    "0.0.0.0",
    ()=>{
        console.log(
            `Block Battle running on port ${PORT}`
        );
    }
);
