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
export const calculateSettlementDate = (date = new Date()) => {
  const d = new Date(date);
  const day = d.getDay(); // 0 is Sunday, 1 is Monday...

  // Calculate days until the Sunday of this week
  // If it's Sunday (0), it's 0 days away.
  // If it's Monday (1), it's 6 days away.
  const daysUntilSunday = day === 0 ? 0 : 7 - day;

  const sundayOfPeriod = new Date(d);
  sundayOfPeriod.setDate(d.getDate() + daysUntilSunday);

  // Settlement is the Wednesday (3 days) after that Sunday
  const settlementDate = new Date(sundayOfPeriod);
  settlementDate.setDate(sundayOfPeriod.getDate() + 3);

  // Reset time to midnight for consistency
  settlementDate.setHours(0, 0, 0, 0);

  return settlementDate;
};
