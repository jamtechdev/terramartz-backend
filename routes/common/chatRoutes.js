import express from "express";
import * as chatController from "../../controllers/common/chatController.js";
// import { protect } from "../../controllers/authController.js";

const router = express.Router();

// router.use(protect);

router.post("/conversations", chatController.startConversation);
router.post("/conversation", chatController.startConversation);

router.get("/conversations", chatController.getMyConversations);
router.get("/conversation", chatController.getMyConversations);

router.get("/conversations/:conversationId/messages", chatController.getMessages);
router.get("/conversation/:conversationId/messages", chatController.getMessages);

router.delete("/conversations/:conversationId", chatController.deleteConversation);
router.delete("/conversation/:conversationId", chatController.deleteConversation);

router.post("/online-status", chatController.getOnlineStatus);

export default router;
