/**
 * Calculates the settlement date based on the user's "7 days holds" logic.
 * Every Wednesday, the previous week's (Monday to Sunday) orders are settled.
 * It does not count the current week's Monday and Tuesday (they go to the next Wednesday).
 *
 * Example:
 * Order date: Feb 2 (Mon) -> Sunday is Feb 8 -> Settlement is Feb 11 (Wed)
 * Order date: Feb 8 (Sun) -> Sunday is Feb 8 -> Settlement is Feb 11 (Wed)
 * Order date: Feb 9 (Mon) -> Sunday is Feb 15 -> Settlement is Feb 18 (Wed)
 *
 * @param {Date} date - The date of the order
 * @returns {Date} - The scheduled settlement date (Wednesday)
 */
export const calculateSettlementDate = (date) => {
  const d = new Date(date);
  // 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, ...
  const day = d.getDay();

  // Calculate days until next Wednesday (3)
  // If today is Wednesday (3), we want next Wednesday (+7 days)
  // If today is Tuesday (2), we want tomorrow (+1 day)
  let daysUntilWednesday = 3 - day;
  if (daysUntilWednesday <= 0) {
    daysUntilWednesday += 7;
  }

  d.setDate(d.getDate() + daysUntilWednesday);
  d.setHours(0, 0, 0, 0); // Reset time to midnight
  return d;
};
