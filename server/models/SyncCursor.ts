import mongoose, { Schema, type Model, type Document } from "mongoose";

export interface ISyncCursor {
    key: string;
    offset: number;
}

export interface ISyncCursorDocument extends ISyncCursor, Document {}

const SyncCursorSchema = new Schema<ISyncCursorDocument>(
    {
        key: { type: String, required: true, unique: true },
        offset: { type: Number, required: true, default: 0 },
    },
    { timestamps: true, versionKey: false },
);

export const SyncCursor: Model<ISyncCursorDocument> =
    mongoose.models.SyncCursor || mongoose.model<ISyncCursorDocument>("SyncCursor", SyncCursorSchema);

export default SyncCursor;
