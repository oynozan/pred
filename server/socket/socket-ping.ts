import { SocketListener } from "../socket";

export class SocketPing extends SocketListener {
    listen() {
        this.socket.on("ping", () => {
            this.socket.emit("pong", { message: "Pong!" });
        });
    }
}
