/**
 * Validate digit string (no "+") for SMS / Twilio "To" field.
 * Twilio 21211 often happens when NANP numbers are the wrong length (e.g. +1 + 9 digits).
 * @param {string} digitsOnly — digits only, including country code (e.g. "16195551234", "919876543210")
 * @returns {string|null} error message or null if OK
 */
export function getSmsPhoneValidationError(digitsOnly) {
  const d = String(digitsOnly || "").replace(/\D/g, "");
  if (!d) return "Phone number is required";

  if (d.length < 10 || d.length > 15) {
    return "Phone number has invalid length for international format.";
  }

  if (d.startsWith("91")) {
    if (d.length !== 12) {
      return "India (+91) numbers must have 10 digits after the country code.";
    }
    return null;
  }

  if (d.startsWith("1")) {
    if (d.length !== 11) {
      return "US/Canada (+1) numbers need area code + 10-digit local number (11 digits total including country code 1).";
    }
    return null;
  }

  return null;
}
