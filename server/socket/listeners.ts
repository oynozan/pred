import { SocketAuthentication } from "./index";
import type { Socket, Server } from "socket.io";

// Listener imports
import { SocketPing } from "./socket-ping";

export class SocketListeners {
    private io: Server;

    constructor(io: Server) {
        this.io = io;

        this.protectedListeners();
        this.publicListeners();
    }

    protectedListeners() {
        const protectedIO = this.io.of("/protected");
        SocketAuthentication.serverOnlyAuthenticationMiddleware(protectedIO);

        // On-connection listeners
        protectedIO.on("connection", (socket: Socket) => {
            new SocketPing(protectedIO, socket).listen();
        });
    }

    publicListeners() {
        const publicIO = SocketAuthentication.authenticationMiddleware(this.io);

        // On-connection listeners
        publicIO.on("connection", (socket: Socket) => {
            new SocketPing(this.io, socket).listen();
        });
    }
}
