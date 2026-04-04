import { Router } from "express";

/* Routes */
import Ping from "./ping";
import Health from "./health";

const router = Router();

router.use("/ping", Ping);
router.use("/health", Health);

export default router;
