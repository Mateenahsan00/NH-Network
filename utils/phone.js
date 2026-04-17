/**
 * Phone Number Normalization Utility
 * Provides functions to sanitize and convert raw phone number inputs into a standardized
 * international format (E.164-like), ensuring compatibility with SMS gateways like Twilio.
 * Example: Converts "03001234567" to "+923001234567" for Pakistan.
 */

/**
 * Normalizes a raw phone number string to a standardized international format.
 * The function handles various input patterns including leading zeros, missing country codes,
 * and non-digit characters.
 * 
 * @param {string} raw - The raw phone number input from the user or database.
 * @returns {string} - The normalized phone number string starting with '+'.
 */
function normalizePhoneNumber(raw) {
  try {
    // Return empty string for null/undefined inputs
    if (!raw) return '';
    
    // Convert to string and trim surrounding whitespace
    let s = String(raw).trim();
    
    // Sanitize the string by removing all characters except digits and the plus sign.
    // Regular expression [^\d+] matches any character that is NOT a digit (\d) or '+'.
    s = s.replace(/[^\d+]/g, '');
    
    // Case 1: The input already starts with a '+' (International format)
    if (s.startsWith('+')) {
      // Validate length to ensure it falls within standard international bounds (10-15 digits)
      if (s.length >= 10 && s.length <= 15) return s;
    }
    
    // Case 2: Input starts with '0' (Common local format in many countries, especially Pakistan)
    if (s.startsWith('0')) {
      // Remove the leading zero and prepend the default country code for Pakistan (+92)
      s = s.substring(1);
      return '+92' + s;
    }
    
    // Case 3: Input starts with '92' but is missing the '+' prefix
    if (s.startsWith('92') && s.length >= 11) {
      return '+' + s;
    }
    
    // Case 4: General fallback using environment-defined default country code.
    // Defaults to Pakistan (+92) if SMS_DEFAULT_COUNTRY_CODE is not set in .env.
    const cc = process.env.SMS_DEFAULT_COUNTRY_CODE || '+92';
    
    // Extract only digits for the final construction
    const digits = s.replace(/\D/g, '');
    
    // If we have at least 10 digits, assume it's a valid local number and prepend the country code
    if (digits.length >= 10) {
      // Ensure the country code prefix always starts with '+'
      return (cc.startsWith('+') ? cc : '+' + cc) + digits;
    }
    
    // Return the sanitized string as-is if no specific rules matched
    return s;
  } catch (err) {
    // Log normalization errors for debugging while preventing application crashes
    console.error('[phone] Normalization error:', err);
    return raw || '';
  }
}

/**
 * Module exports for application-wide phone normalization.
 */
module.exports = {
  normalizePhoneNumber
};

