/**
 * SMS Utility Module
 * Handles automated SMS dispatching using the Twilio programmable messaging API.
 * Includes built-in retry logic with exponential backoff for high reliability.
 */

// Load environment variables from .env file
require('dotenv').config();
const twilio = require('twilio');

/**
 * Twilio credentials and configuration sourced from environment variables.
 * @constant {string} TWILIO_ACCOUNT_SID - Unique identifier for the Twilio account.
 * @constant {string} TWILIO_AUTH_TOKEN - Secret token for API authentication.
 * @constant {string} TWILIO_PHONE_NUMBER - The verified Twilio number used as the 'From' address.
 */
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

/**
 * Singleton Twilio client instance. 
 * Initialized once at startup to optimize connection reuse.
 */
let twilioClient = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  try {
    twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  } catch (err) {
    // Fail gracefully if initialization fails (e.g., invalid SID format)
    console.error('[sms] Failed to initialize Twilio client:', err.message);
  }
} else {
  // Warn if configuration is missing, which will cause sendSMS to return errors
  console.warn('[sms] Twilio credentials not found in environment variables');
}

/**
 * Sends an SMS message to a specific recipient with retry logic.
 * 
 * @param {string} to - Recipient's phone number in international format (e.g., +923001234567).
 * @param {string} message - The text content of the SMS.
 * @returns {Promise<{ok: boolean, sid?: string, error?: string}>} - Result object indicating success or failure.
 */
async function sendSMS(to, message) {
  // Maximum number of attempts to send the message before giving up
  const maxAttempts = 3;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Step 1: Validate input parameters
      if (!to || !message) {
        console.error('[sms] Missing required parameters: to or message');
        return { ok: false, error: 'Missing to/message' };
      }

      // Step 2: Ensure the Twilio client is ready
      if (!twilioClient) {
        console.error('[sms] Twilio client not initialized. Check TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in .env');
        return { ok: false, error: 'Twilio not configured' };
      }

      // Step 3: Validate the sender number
      if (!TWILIO_PHONE_NUMBER) {
        console.error('[sms] TWILIO_PHONE_NUMBER not set in environment variables');
        return { ok: false, error: 'Twilio phone number not configured' };
      }

      // Step 4: Dispatch the message via Twilio SDK
      console.log(`[sms] Attempt ${attempt}/${maxAttempts}: Sending SMS to ${to}`);
      
      const result = await twilioClient.messages.create({
        body: message,
        from: TWILIO_PHONE_NUMBER,
        to: to
      });

      // Step 5: Validate and return success
      if (result && result.sid) {
        console.log(`[sms] SMS sent successfully. SID: ${result.sid}`);
        return { ok: true, sid: result.sid };
      } else {
        throw new Error('Twilio returned invalid response');
      }
    } catch (err) {
      // Log the error for this specific attempt
      const errorMessage = err.message || String(err);
      console.error(`[sms] Attempt ${attempt}/${maxAttempts} failed:`, errorMessage);
      
      // If we've reached the maximum number of retries, return the final error
      if (attempt >= maxAttempts) {
        return { ok: false, error: errorMessage };
      }
      
      // Exponential Backoff: Wait before retrying to allow transient network issues to resolve.
      // Delays: 1st retry = 500ms, 2nd retry = 1000ms.
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  
  // Safety fallback
  return { ok: false, error: 'Failed after all attempts' };
}

/**
 * Module exports for application-wide SMS capabilities.
 */
module.exports = {
  sendSMS
};

