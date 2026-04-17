/**
 * Country Code Utility Module
 * This module provides a centralized data structure and utility functions for handling
 * international phone number country codes, names, and flag emojis. It is primarily used
 * for phone number selection in registration and profile update forms.
 */

/**
 * A comprehensive list of supported country codes, including their dial codes,
 * country names, and corresponding flag emojis for UI display.
 * @constant {Array<Object>}
 */
const COUNTRY_CODES = [
  { code: '+1', country: 'US/CA', flag: '🇺🇸' },
  { code: '+44', country: 'UK', flag: '🇬🇧' },
  { code: '+92', country: 'Pakistan', flag: '🇵🇰' },
  { code: '+91', country: 'India', flag: '🇮🇳' },
  { code: '+86', country: 'China', flag: '🇨🇳' },
  { code: '+81', country: 'Japan', flag: '🇯🇵' },
  { code: '+49', country: 'Germany', flag: '🇩🇪' },
  { code: '+33', country: 'France', flag: '🇫🇷' },
  { code: '+39', country: 'Italy', flag: '🇮🇹' },
  { code: '+34', country: 'Spain', flag: '🇪🇸' },
  { code: '+61', country: 'Australia', flag: '🇦🇺' },
  { code: '+971', country: 'UAE', flag: '🇦🇪' },
  { code: '+966', country: 'Saudi Arabia', flag: '🇸🇦' },
  { code: '+27', country: 'South Africa', flag: '🇿🇦' },
  { code: '+55', country: 'Brazil', flag: '🇧🇷' },
  { code: '+52', country: 'Mexico', flag: '🇲🇽' },
  { code: '+7', country: 'Russia', flag: '🇷🇺' },
  { code: '+82', country: 'South Korea', flag: '🇰🇷' },
  { code: '+65', country: 'Singapore', flag: '🇸🇬' },
  { code: '+60', country: 'Malaysia', flag: '🇲🇾' },
  { code: '+62', country: 'Indonesia', flag: '🇮🇩' },
  { code: '+84', country: 'Vietnam', flag: '🇻🇳' },
  { code: '+66', country: 'Thailand', flag: '🇹🇭' },
  { code: '+63', country: 'Philippines', flag: '🇵🇭' },
  { code: '+880', country: 'Bangladesh', flag: '🇧🇩' },
  { code: '+94', country: 'Sri Lanka', flag: '🇱🇰' },
  { code: '+20', country: 'Egypt', flag: '🇪🇬' },
  { code: '+90', country: 'Turkey', flag: '🇹🇷' },
  { code: '+31', country: 'Netherlands', flag: '🇳🇱' },
  { code: '+32', country: 'Belgium', flag: '🇧🇪' },
  { code: '+41', country: 'Switzerland', flag: '🇨🇭' },
  { code: '+46', country: 'Sweden', flag: '🇸🇪' },
  { code: '+47', country: 'Norway', flag: '🇳🇴' },
  { code: '+45', country: 'Denmark', flag: '🇩🇰' },
  { code: '+358', country: 'Finland', flag: '🇫🇮' },
  { code: '+48', country: 'Poland', flag: '🇵🇱' },
  { code: '+351', country: 'Portugal', flag: '🇵🇹' },
  { code: '+30', country: 'Greece', flag: '🇬🇷' },
  { code: '+64', country: 'New Zealand', flag: '🇳🇿' },
  { code: '+1', country: 'Canada', flag: '🇨🇦' }
];

/**
 * Retrieves a specific country code object from the COUNTRY_CODES list
 * based on the provided dial code string.
 * @param {string} code - The country dial code to search for (e.g., '+92').
 * @returns {Object|null} - Returns the matching country object if found, otherwise null.
 */
function getCountryByCode(code) {
  return COUNTRY_CODES.find(c => c.code === code) || null;
}

/**
 * Provides the default country dial code for the application.
 * Currently defaults to Pakistan ('+92').
 * @returns {string} - The default country dial code string.
 */
function getDefaultCountryCode() {
  return '+92';
}

/**
 * Normalizes a raw phone number by removing all non-digit characters
 * and prepending the specified country dial code.
 * @param {string} phone - The raw phone number input (e.g., '300-1234567').
 * @param {string} [countryCode] - Optional country dial code. Defaults to the system default if not provided.
 * @returns {string} - The fully normalized E.164-like phone number (e.g., '+923001234567'), or an empty string if input is invalid.
 */
function normalizePhoneWithCountryCode(phone, countryCode) {
  if (!phone) return '';
  // Utilize a regular expression to strip away any characters that are not numeric digits
  const digits = phone.replace(/\D/g, '');
  if (!digits) return '';
  // Combine the selected or default country code with the sanitized digit string
  const code = countryCode || getDefaultCountryCode();
  return code + digits;
}

/**
 * Module exports for application-wide utility usage.
 */
module.exports = {
  COUNTRY_CODES,
  getCountryByCode,
  getDefaultCountryCode,
  normalizePhoneWithCountryCode
};

