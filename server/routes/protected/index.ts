import { Router } from "express";

/* Routes */
import Ping from "./ping";
import Markets from "./markets";

const router = Router();

router.use("/ping", Ping);
router.use("/markets", Markets);

export default router;
