import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";

import UserDB from "../models/Users";
import { getKey } from "../lib/utils";

/**
 * Server-to-server token verification middleware
 */
export const verifyServerToken = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(401).json({ error: "Missing or invalid token" });
        return;
    }

    const token = authHeader.split(" ")[1];

    jwt.verify(
        token,
        getKey(),
        {
            algorithms: ["ES256"],
            issuer: process.env.JWT_ISSUER!,
        },
        err => {
            if (err) {
                return res.status(403).json({ error: "Invalid or expired token" });
            }
            next();
        },
    );
};

/**
 * User token verification middleware
 * Used to identify the user making the request
 */
export const userToken = (req: Request, res: Response, next: NextFunction): void => {
    // Get user cookie
    const rawJWT = req.cookies.auth;

    if (rawJWT) {
        jwt.verify(rawJWT, process.env.JWT_SECRET!, async (err: any, decoded: any) => {
            if (err) {
                res.status(403).json({ error: "Invalid or expired token" });
                return;
            }

            if (!decoded) return next();

            // Get user object
            const user = await UserDB.findOne({ username: decoded.username });
            if (!user) {
                res.status(404).json({ error: "User not found" });
                return;
            }

            // Attach decoded user data to request object for use in route handlers
            req.user = user;
            next();
        });
    } else next();
};

export const authRequired = (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }
    next();
};
