import { Router } from "express";

import Sync from "./sync";

const router = Router();

router.use("/sync", Sync);

export default router;