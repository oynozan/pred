import { Router } from "express";

/* Routes */
import Ping from "./ping";
import Markets from "./markets";
import Contracts from "./contracts";
import Recovery from "./recovery";

const router = Router();

router.use("/ping", Ping);
router.use("/markets", Markets);
router.use("/contracts", Contracts);
router.use("/recovery", Recovery);

export default router;
