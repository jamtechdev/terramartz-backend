/**
 * Payout run day: cron pays out due rows on **Wednesday** (`jobs/settlementJob.js`).
 *
 * This helper returns the **next calendar Wednesday strictly after** the given `date`
 * (midnight UTC-local via Date semantics). If `date` is already Wednesday, it advances
 * to the **following** Wednesday — so it is *not* "same-week batching".
 *
 * Order flow: checkout adds a **3-day buffer** (`maturityDate = orderDate + 3`), then
 * `scheduledSettlementDate = calculateSettlementDate(maturityDate)`. So sellers are paid
 * on the first Wednesday after (order + 3 days), not "3 days after order" exactly.
 *
 * @param {Date} date - Typically `orderDate + 3 days` (buffer applied in stripeController)
 * @returns {Date} - Midnight on the next Wednesday after `date`
 */
export const calculateSettlementDate = (date) => {
  const d = new Date(date);
  const day = d.getDay();

  let daysUntilWednesday = 3 - day;
  if (daysUntilWednesday <= 0) {
    daysUntilWednesday += 7;
  }

  d.setDate(d.getDate() + daysUntilWednesday);
  d.setHours(0, 0, 0, 0);
  return d;
};
