import "socket.io";
import type { IUser } from "../models/Users";

declare module "socket.io" {
    interface Socket {
        user?: IUser
    }
}
