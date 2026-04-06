import cron from "node-cron";
import { runDueSettlementPayouts } from "../utils/runSettlementPayouts.js";

export const processSettlementsJob = async () => {
  try {
    const now = new Date();
    console.log(
      `⏰ [Cron] Starting settlement process at ${now.toISOString()}`,
    );
    await runDueSettlementPayouts({ asOf: now, logger: console });
  } catch (err) {
    console.error("⏰ [Cron] ❌ Critical error in settlement job:", err);
  }
};

export const startSettlementJob = () => {
  // Run every Wednesday at 00:01 AM
  const cronExpression = "1 0 * * 3";
  // const cronExpression = "* * * * *";
  console.log("⏰ Settlement job scheduled: Every Wednesday at 00:01 AM");

  cron.schedule(cronExpression, async () => {
    await processSettlementsJob();
  });
};
