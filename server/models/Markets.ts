import mongoose, { Schema, type Model, type Document, Types } from "mongoose";

export interface ITokenSide {
    tokenId: string;
    price: number;
}

export interface ITokens {
    Yes: ITokenSide;
    No: ITokenSide;
}

export interface IMarket {
    conditionId: string;
    question: string;
    slug: string;
    endDate: Date;
    tokens: ITokens;
    syncedAt: Date;
}

export interface IMarketDocument extends IMarket, Document {
    _id: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const TokenSideSchema = new Schema<ITokenSide>(
    {
        tokenId: { type: String, required: true },
        price: { type: Number, required: true },
    },
    { _id: false },
);

const MarketSchema = new Schema<IMarketDocument>(
    {
        conditionId: { type: String, required: true, unique: true },
        question: { type: String, required: true },
        slug: { type: String, required: true },
        endDate: { type: Date, required: true },
        tokens: {
            type: { Yes: TokenSideSchema, No: TokenSideSchema },
            required: true,
        },
        syncedAt: { type: Date, required: true },
    },
    { timestamps: true, versionKey: false },
);

export const Market: Model<IMarketDocument> =
    mongoose.models.Market || mongoose.model<IMarketDocument>("Market", MarketSchema);

export default Market;
