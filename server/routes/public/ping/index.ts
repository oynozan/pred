import { Router } from "express";
import { userToken } from "../../middleware";

const router = Router();

router.get("/", userToken, async (req, res) => {
    console.log("req.user", req.user);
    res.json({ message: "Pong!" });
});

export default router;
