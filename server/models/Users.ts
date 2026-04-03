import mongoose, { Schema, type Model, type Document, Types } from "mongoose";

export interface IUser {
    username: string;
}

export interface IUserDocument extends IUser, Document {
    _id: Types.ObjectId;
    createdAt: Date;
}

const UserSchema = new Schema<IUserDocument>(
    {
        username: { type: String, required: true, unique: true },
        createdAt: { type: Date, default: Date.now },
    },
    { versionKey: false },
);

export const User: Model<IUserDocument> =
    mongoose.models.User || mongoose.model<IUserDocument>("User", UserSchema);

export default User;
