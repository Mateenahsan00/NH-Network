/**
 * server.js
 * Main entry point for the NH Network backend server.
 * This file handles database connections, API routing, email notifications,
 * SMS integration, and static file serving.
 */

console.log("✅ server.js file executed");

// Load environment variables from .env file
require('dotenv').config();

// Core dependencies
const express = require('express');
const mysql = require('mysql2/promise'); // Promise-based MySQL client
const bcrypt = require('bcryptjs'); // For password hashing and verification
const cors = require('cors'); // Enable Cross-Origin Resource Sharing
const axios = require('axios'); // For making HTTP requests to external APIs (e.g., CoinGecko)
const path = require('path'); // Utility for handling file and directory paths
const fs = require('fs'); // File system module for directory/file operations
const multer = require('multer'); // Middleware for handling multipart/form-data (file uploads)
const nodemailer = require('nodemailer'); // For sending emails via SMTP
const archiver = require('archiver'); // For creating ZIP archives (used in admin downloads)

// Custom utility functions for SMS and phone normalization
const { sendSMS } = require('./utils/sms');
const { normalizePhoneNumber } = require('./utils/phone');

// Initialize Express application
const app = express();

// Middleware configuration
app.use(cors()); // Allow requests from different origins (frontend/mobile)
app.use(express.json()); // Parse incoming JSON request bodies

// Server connection settings
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

// Static file serving for the frontend application
app.use(express.static(path.join(__dirname, 'public')));

// Ensure the 'uploads' directory exists and serve it as a static folder
try {
  const uploadDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  app.use('/uploads', express.static(uploadDir));
} catch (_) {
  console.error("Failed to initialize uploads directory");
}

// ==========================================
//   DATABASE CONNECTION (MySQL)
// ==========================================
// Create a connection pool to manage multiple database connections efficiently
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10 // Maximum number of concurrent connections
});

// CoinGecko API Configuration for fetching cryptocurrency market data
const COINGECKO_API_BASE = 'https://api.coingecko.com/api/v3';
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || process.env.CG_DEMO_API_KEY || '';

// ==========================================
//   SMTP / EMAIL CONFIGURATION
// ==========================================
// Initialize the mail transport using environment variables
const mailTransport = (() => {
  const service = process.env.SMTP_SERVICE || '';
  // If a known service like 'gmail' is provided, use it
  if (service) {
    return nodemailer.createTransport({
      service,
      pool: true,
      auth: (process.env.SMTP_USER && process.env.SMTP_PASS) ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
    });
  }
  // Otherwise, use custom SMTP host settings
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    pool: true,
    auth: (process.env.SMTP_USER && process.env.SMTP_PASS) ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
})();

/**
 * Utility function to send an email with retry logic.
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject line
 * @param {string} html - HTML body of the email
 * @returns {Promise<Object>} - Object indicating success or failure
 */
async function sendEmail(to, subject, html) {
  const from = process.env.FROM_EMAIL || 'NH Network <devolper.expert@gmail.com>';
  const maxAttempts = 3;
  // Attempt to send email with exponential backoff on failure
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (!to) throw new Error('Missing recipient');
      await mailTransport.sendMail({ from, to, subject, html });
      console.log(`[mail] Email sent: to=${to} subject=${subject}`);
      return { ok: true };
    } catch (err) {
      const details = {
        message: err && err.message ? err.message : String(err),
        code: err && err.code ? err.code : undefined,
        response: err && err.response ? err.response : undefined,
        responseCode: err && err.responseCode ? err.responseCode : undefined
      };
      console.error(`[mail] Email send attempt ${attempt} failed:`, details);
      // Wait before next attempt (0.5s, 1s)
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, attempt * 500));
        continue;
      }
      return { ok: false, error: 'Email delivery failed' };
    }
  }
}

// SMS and phone normalization functions moved to utils/sms.js and utils/phone.js


// Verify mail transport on startup for proactive diagnostics
(async () => {
  try {
    await mailTransport.verify();
    console.log('[mail] SMTP transport verified and ready');
  } catch (err) {
    console.error('[mail] SMTP transport verification failed:', err && err.message ? err.message : err);
    console.error('[mail] Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE, FROM_EMAIL in .env');
  }
})();

/**
 * Initializes the database by creating all necessary tables if they don't exist.
 * This ensures the application can run on a fresh database setup.
 * It also handles schema migrations by adding or dropping columns as needed.
 */
async function initDatabase() {
  try {
    // Create 'users' table - stores basic authentication information
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        full_name VARCHAR(120) NOT NULL,
        email VARCHAR(160) NOT NULL UNIQUE,
        username VARCHAR(80) UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci;
    `);

    // Schema Migration for 'users'
    // Ensure 'status' column exists
    const [c_status] = await pool.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'users' AND COLUMN_NAME = 'status' AND TABLE_SCHEMA = DATABASE()"
    );
    if (c_status.length === 0) {
      await pool.query("ALTER TABLE users ADD COLUMN status ENUM('active', 'disabled') NOT NULL DEFAULT 'active' AFTER password_hash");
    }

    // Create 'user_profiles' table - stores extended user details and verification status
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_profiles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL UNIQUE,
        phone VARCHAR(32),
        cnic VARCHAR(32),
        address VARCHAR(255),
        account_type VARCHAR(32),
        verification_status VARCHAR(32) DEFAULT 'unverified',
        payment_password_hash VARCHAR(255),
        payment_password_plain VARCHAR(255) DEFAULT '123456',
        avatar_url VARCHAR(255),
        kyc_status VARCHAR(32),
        kyc_document_url VARCHAR(255),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci;
    `);

    // Schema Migrations for 'user_profiles'
    // Ensure 'payment_password_plain' exists
    const [c_plain] = await pool.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'user_profiles' AND COLUMN_NAME = 'payment_password_plain' AND TABLE_SCHEMA = DATABASE()"
    );
    if (c_plain.length === 0) {
      await pool.query("ALTER TABLE user_profiles ADD COLUMN payment_password_plain VARCHAR(255) DEFAULT '123456' AFTER payment_password_hash");
    }

    // Initialize default payment passwords for users who don't have one
    const salt = await bcrypt.genSalt(10);
    const defaultHash = await bcrypt.hash('123456', salt);
    await pool.query(
      "UPDATE user_profiles SET payment_password_hash = ?, payment_password_plain = '123456' WHERE payment_password_hash IS NULL",
      [defaultHash]
    );

    // Ensure 'avatar_url' column exists
    const [c_avatar] = await pool.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'user_profiles' AND COLUMN_NAME = 'avatar_url' AND TABLE_SCHEMA = DATABASE()"
    );
    if (c_avatar.length === 0) {
      await pool.query("ALTER TABLE user_profiles ADD COLUMN avatar_url VARCHAR(255)");
    }

    // Remove legacy 2FA columns if they exist (handling migrations)
    const [c_twofa_secret] = await pool.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'user_profiles' AND COLUMN_NAME = 'twofa_secret' AND TABLE_SCHEMA = DATABASE()"
    );
    if (c_twofa_secret.length > 0) {
      await pool.query("ALTER TABLE user_profiles DROP COLUMN twofa_secret");
    }
    const [c_twofa_enabled] = await pool.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'user_profiles' AND COLUMN_NAME = 'twofa_enabled' AND TABLE_SCHEMA = DATABASE()"
    );
    if (c_twofa_enabled.length > 0) {
      await pool.query("ALTER TABLE user_profiles DROP COLUMN twofa_enabled");
    }

    // Ensure 'kyc_status' and 'kyc_document_url' columns exist for identity verification
    const [c_kyc_status] = await pool.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'user_profiles' AND COLUMN_NAME = 'kyc_status' AND TABLE_SCHEMA = DATABASE()"
    );
    if (c_kyc_status.length === 0) {
      await pool.query("ALTER TABLE user_profiles ADD COLUMN kyc_status VARCHAR(32)");
    }
    const [c_kyc_doc] = await pool.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'user_profiles' AND COLUMN_NAME = 'kyc_document_url' AND TABLE_SCHEMA = DATABASE()"
    );
    if (c_kyc_doc.length === 0) {
      await pool.query("ALTER TABLE user_profiles ADD COLUMN kyc_document_url VARCHAR(255)");
    }

    // Create 'wallet' table - tracks user balances and totals
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wallet (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        available_balance DECIMAL(18,2) NOT NULL DEFAULT 0,
        total_deposited DECIMAL(18,2) NOT NULL DEFAULT 0,
        total_withdrawn DECIMAL(18,2) NOT NULL DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_wallet_user FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci;
    `);

    // Create 'transactions' table - audit log of all financial activities
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        type ENUM('deposit','withdraw','investment_buy','investment_sell','adjustment') NOT NULL,
        amount DECIMAL(18,2) NOT NULL,
        fee DECIMAL(18,2) NOT NULL DEFAULT 0,
        description VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_transactions_user FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci;
    `);

    // Create 'investments' table - tracks user's cryptocurrency holdings
    await pool.query(`
      CREATE TABLE IF NOT EXISTS investments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        coin_id VARCHAR(100) NOT NULL,
        coin_symbol VARCHAR(20) NOT NULL,
        coin_name VARCHAR(100) NOT NULL,
        units DECIMAL(36,18) NOT NULL DEFAULT 0,
        avg_buy_price DECIMAL(18,8) NOT NULL DEFAULT 0,
        invested_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
        duration INT DEFAULT 30,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_user_coin (user_id, coin_id),
        CONSTRAINT fk_investments_user FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci;
    `);

    // Ensure 'duration' column exists for investments
    try {
      const [invCols] = await pool.query("SHOW COLUMNS FROM investments LIKE 'duration'");
      if (invCols.length === 0) {
        console.log('Adding duration column to investments table...');
        await pool.query("ALTER TABLE investments ADD COLUMN duration INT DEFAULT 30 AFTER invested_amount");
        console.log('Duration column added successfully.');
      }
    } catch (e) {
      console.error('Critical Error adding duration column:', e.message || e);
    }

    // Create 'market_prices' table - caches latest coin prices from API
    await pool.query(`
      CREATE TABLE IF NOT EXISTS market_prices (
        id INT AUTO_INCREMENT PRIMARY KEY,
        coin_id VARCHAR(100) NOT NULL,
        coin_symbol VARCHAR(20) NOT NULL,
        coin_name VARCHAR(100) NOT NULL,
        price_usd DECIMAL(18,8) NOT NULL,
        price_change_percentage_24h DECIMAL(10,4),
        market_cap BIGINT,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_coin (coin_id)
      ) ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci;
    `);

    // Create 'learner_requests' table - tracks applications to become a learner
    await pool.query(`
      CREATE TABLE IF NOT EXISTS learner_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        name VARCHAR(120) NOT NULL,
        email VARCHAR(160) NOT NULL,
        username VARCHAR(80),
        phone VARCHAR(32),
        country_code VARCHAR(10) DEFAULT '+92',
        course VARCHAR(120) NOT NULL,
        education_level VARCHAR(80) NOT NULL,
        image_url VARCHAR(255),
        status ENUM('pending','accepted','rejected','approved','not_approved') NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_lr_user FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci;
    `);
    
    // Schema Migrations for 'learner_requests'
    // Ensure 'country_code' exists
    try {
      const [cols] = await pool.query("SHOW COLUMNS FROM learner_requests LIKE 'country_code'");
      if (cols.length === 0) {
        await pool.query("ALTER TABLE learner_requests ADD COLUMN country_code VARCHAR(10) DEFAULT '+92' AFTER phone");
      }
    } catch (e) {
      console.warn('Country code column check/alter warning:', e.message || e);
    }

    // Ensure 'status' enum has all required values
    try {
      const [statusCol] = await pool.query("SHOW COLUMNS FROM learner_requests LIKE 'status'");
      const typeStr = (statusCol[0] && statusCol[0].Type) || '';
      if (!/approved/.test(typeStr) || !/not_approved/.test(typeStr)) {
        await pool.query("ALTER TABLE learner_requests MODIFY COLUMN status ENUM('pending','accepted','rejected','approved','not_approved') NOT NULL DEFAULT 'pending'");
      }
    } catch (e) {
      console.warn('Status enum check/alter warning:', e.message || e);
    }

    // Create 'learner_messages' table - admin communication with learners
    await pool.query(`
      CREATE TABLE IF NOT EXISTS learner_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        request_id INT,
        type ENUM('approved','not_approved') NOT NULL,
        message TEXT NOT NULL,
        read_flag TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_lm_user FOREIGN KEY (user_id) REFERENCES users(id),
        CONSTRAINT fk_lm_request FOREIGN KEY (request_id) REFERENCES learner_requests(id)
      ) ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci;
    `);

    // Create 'user_notifications' table - in-app activity notifications
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        activity_type VARCHAR(64) NOT NULL,
        message TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_read TINYINT(1) NOT NULL DEFAULT 0,
        INDEX idx_un_user (user_id),
        INDEX idx_un_user_unread (user_id, is_read),
        INDEX idx_un_time (timestamp),
        CONSTRAINT fk_un_user FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci;
    `);

    // Create 'user_learning_state' table - tracks course progress as JSON
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_learning_state (
        user_id INT NOT NULL PRIMARY KEY,
        state_json JSON NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_uls_user FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci;
    `);

    // Create 'investor_requests' table - tracks applications for investor status
    await pool.query(`
      CREATE TABLE IF NOT EXISTS investor_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        full_name VARCHAR(120) NOT NULL,
        email VARCHAR(160) NOT NULL,
        username VARCHAR(80),
        phone VARCHAR(32),
        country_code VARCHAR(10) DEFAULT '+92',
        cnic VARCHAR(32),
        dob DATE,
        address VARCHAR(255),
        avatar_url VARCHAR(255),
        cnic_front_url VARCHAR(255),
        cnic_back_url VARCHAR(255),
        selfie_url VARCHAR(255),
        video_url VARCHAR(255),
        status ENUM('pending','approved','not_approved') NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_ir_user FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci;
    `);

    // Schema Migrations for 'investor_requests'
    // Ensure 'username' exists
    try {
      const [usernameCol] = await pool.query("SHOW COLUMNS FROM investor_requests LIKE 'username'");
      if (usernameCol.length === 0) {
        await pool.query("ALTER TABLE investor_requests ADD COLUMN username VARCHAR(80) AFTER email");
      }
    } catch (e) {
      console.warn('Username column check/alter warning:', e.message || e);
    }

    // Ensure 'video_url' exists for verification videos
    try {
      const [videoCol] = await pool.query("SHOW COLUMNS FROM investor_requests LIKE 'video_url'");
      if (videoCol.length === 0) {
        await pool.query("ALTER TABLE investor_requests ADD COLUMN video_url VARCHAR(255) AFTER selfie_url");
      }
    } catch (e) {
      console.warn('Video URL column check/alter warning:', e.message || e);
    }

    // Create 'investor_messages' table - admin communication with investors
    await pool.query(`
      CREATE TABLE IF NOT EXISTS investor_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        request_id INT,
        type ENUM('approved','not_approved') NOT NULL,
        message TEXT NOT NULL,
        read_flag TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_im_user FOREIGN KEY (user_id) REFERENCES users(id),
        CONSTRAINT fk_im_request FOREIGN KEY (request_id) REFERENCES investor_requests(id)
      ) ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci;
    `);

    // Create 'password_reset_tokens' table - handles OTP-based password resets
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(160) NOT NULL,
        otp VARCHAR(10) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_email (email),
        INDEX idx_expires (expires_at)
      ) ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci;
    `);

    // Create 'course_reviews' table - user ratings for courses
    await pool.query(`
      CREATE TABLE IF NOT EXISTS course_reviews (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        course_id VARCHAR(100) NOT NULL,
        rating TINYINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
        text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_cr_user FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Create 'lesson_comments' table - user comments on specific lessons
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lesson_comments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        course_id VARCHAR(100) NOT NULL,
        lesson_id VARCHAR(100) NOT NULL,
        text TEXT NOT NULL,
        parent_comment_id INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_lc_user FOREIGN KEY (user_id) REFERENCES users(id),
        CONSTRAINT fk_lc_parent FOREIGN KEY (parent_comment_id) REFERENCES lesson_comments(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Create 'certificate_requests' table - tracks course completion certificate requests
    await pool.query(`
      CREATE TABLE IF NOT EXISTS certificate_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        course_id VARCHAR(100) NOT NULL,
        status ENUM('Pending', 'Approved', 'Rejected') DEFAULT 'Pending',
        request_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_cert_user FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Create 'manual_deposits' table - tracks user-submitted deposit requests
    await pool.query(`
      CREATE TABLE IF NOT EXISTS manual_deposits (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        amount DECIMAL(18,2) NOT NULL,
        method VARCHAR(50) NOT NULL,
        sender_name VARCHAR(120) NOT NULL,
        sender_account VARCHAR(120) NOT NULL,
        screenshot_url VARCHAR(255) NOT NULL,
        status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_md_user FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Create 'manual_withdrawals' table - tracks user-submitted withdrawal requests
    await pool.query(`
      CREATE TABLE IF NOT EXISTS manual_withdrawals (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        amount DECIMAL(18,2) NOT NULL,
        fee DECIMAL(18,2) NOT NULL DEFAULT 0,
        net_amount DECIMAL(18,2) NOT NULL,
        method VARCHAR(50) NOT NULL,
        account_name VARCHAR(120) NOT NULL,
        account_address VARCHAR(120) NOT NULL,
        status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_mw_user FOREIGN KEY (user_id) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Schema Migrations for 'transactions'
    // Ensure 'status' exists for transactions to track pending manual deposits
    try {
      const [statusCol] = await pool.query("SHOW COLUMNS FROM transactions LIKE 'status'");
      if (statusCol.length === 0) {
        await pool.query("ALTER TABLE transactions ADD COLUMN status VARCHAR(20) DEFAULT 'completed' AFTER type");
      }
    } catch (e) {
      console.warn('Status column check/alter warning:', e.message || e);
    }

  } catch (err) {
    console.error('Error initializing database tables:', err);
  }
}

// Call the database initialization function
initDatabase();

/**
 * Adds an in-app notification for a specific user.
 * @param {number|string} userId - ID of the user to notify
 * @param {string} activityType - Category of activity (e.g., 'deposit', 'signup')
 * @param {string} message - Descriptive notification message
 */
async function addNotification(userId, activityType, message) {
  try {
    const uid = parseInt(userId, 10);
    if (!uid || !activityType) return;
    await pool.query('INSERT INTO user_notifications (user_id, activity_type, message) VALUES (?, ?, ?)', [uid, String(activityType), message || null]);
  } catch (_) {}
}

/**
 * Retrieves a user's email address by their ID.
 * @param {number} userId
 * @returns {Promise<string|null>}
 */
async function getUserEmail(userId) {
  try {
    const [rows] = await pool.query('SELECT email, full_name FROM users WHERE id = ? LIMIT 1', [userId]);
    if (!rows.length) return null;
    return rows[0].email || null;
  } catch (_) { return null; }
}

/**
 * Builds HTML for the 'Account Created' email.
 * @param {string} name - User's full name
 * @param {string} loginUrl - URL to the login page
 * @returns {string} - HTML content
 */
function buildAccountCreatedEmailHTML(name, loginUrl) {
  const year = new Date().getFullYear();
  const safeName = name || 'Investor';
  return `
    <div style="font-family: Inter, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; line-height:1.7; color:#0f1419;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:20px 24px;"><div style="font-weight:800;letter-spacing:0.5px;color:#111827;">NH Network</div></td></tr>
        <tr>
          <td style="padding:0 24px 8px 24px;">
            <p style="margin:0 0 8px 0;color:#111827;">Dear ${safeName},</p>
            <p style="margin:0 0 12px 0;color:#374151;">Welcome to NH Network. Your account has been successfully created.</p>
            <p style="margin:0 0 14px 0;color:#374151;">Sign in to access your dashboard, manage your profile, and explore learning resources.</p>
            <div style="margin:24px 0;">
              <a href="${loginUrl}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#3b82f6;color:#ffffff;text-decoration:none;font-weight:600;box-shadow:0 6px 20px rgba(59,130,246,0.4);">Sign In</a>
            </div>
            <p style="margin:0 0 10px 0;color:#6b7280;font-size:12px;">If the button doesn't work, copy and paste this link into your browser:</p>
            <p style="margin:0;color:#3b82f6;word-break:break-all;font-size:12px;">${loginUrl}</p>
            <p style="margin:16px 0 0 0;color:#6b7280;font-size:12px;">For assistance, contact <a href="mailto:devolper.expert@gmail.com" style="color:#3b82f6;text-decoration:none;">devolper.expert@gmail.com</a>.</p>
          </td>
        </tr>
        <tr><td style="padding:16px 24px;color:#6b7280;font-size:12px;border-top:1px solid #f3f4f6;">© ${year} NH Network — This is an official communication.</td></tr>
      </table>
    </div>`;
}

/**
 * Builds HTML for the 'Welcome' email with a more promotional/friendly style.
 * @param {string} name - User's full name
 * @param {string} loginUrl - URL to the login page
 * @returns {string} - HTML content
 */
function buildWelcomeEmailHTML(name, loginUrl) {
  const year = new Date().getFullYear();
  const safeName = name || 'Member';
  return `
    <div style="font-family: Inter, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; line-height:1.7; color:#0f1419;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <tr>
          <td style="padding:28px 24px 20px 24px; background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);">
            <div style="font-weight:800;letter-spacing:0.5px;color:#ffffff; font-size: 20px;">NH Network</div>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 24px 24px 24px;">
            <h2 style="margin:0 0 16px 0;color:#111827;font-size:24px;font-weight:700;">Welcome to NH Network! 🎉</h2>
            <p style="margin:0 0 16px 0;color:#374151;font-size:16px;">Hi ${safeName},</p>
            <p style="margin:0 0 16px 0;color:#374151;font-size:15px;">We're thrilled to have you join our community! Your account has been successfully created and you are now a valued member of NH Network.</p>
            <p style="margin:0 0 20px 0;color:#374151;font-size:15px;">At NH Network, we combine structured education, advanced trading tools, and real-time market data to help you become a smarter, more confident investor.</p>
            
            <div style="background:#f8fafc;border-radius:10px;padding:20px;margin:24px 0;">
              <h3 style="margin:0 0 12px 0;color:#111827;font-size:16px;font-weight:600;">Here's what you can do now:</h3>
              <ul style="margin:0;padding-left:20px;color:#4b5563;font-size:14px;line-height:1.8;">
                <li>Access your personalized dashboard</li>
                <li>Explore learning resources and courses</li>
                <li>Track investments and market data</li>
                <li>Connect with our community of investors</li>
              </ul>
            </div>
            
            <div style="margin:28px 0;text-align:center;">
              <a href="${loginUrl}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 28px;border-radius:10px;background:linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;box-shadow:0 6px 20px rgba(59,130,246,0.4);">Get Started</a>
            </div>
            
            <p style="margin:20px 0 12px 0;color:#6b7280;font-size:13px;">If the button doesn't work, copy and paste this link into your browser:</p>
            <p style="margin:0 0 20px 0;color:#3b82f6;word-break:break-all;font-size:12px;">${loginUrl}</p>
            
            <p style="margin:0 0 8px 0;color:#374151;font-size:14px;">Need help getting started? Our support team is here for you.</p>
            <p style="margin:0;color:#6b7280;font-size:13px;">Contact us at <a href="mailto:devolper.expert@gmail.com" style="color:#3b82f6;text-decoration:none;">devolper.expert@gmail.com</a></p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 24px;color:#6b7280;font-size:12px;border-top:1px solid #f3f4f6;background:#f9fafb;">
            <p style="margin:0 0 4px 0;">Welcome aboard!</p>
            <p style="margin:0;">© ${year} NH Network — All rights reserved.</p>
          </td>
        </tr>
      </table>
    </div>`;
}

/**
 * Helper to generate the login URL based on environment or request headers.
 * @param {Object} req - Express request object
 * @returns {string} - Full login URL
 */
function getLoginUrl(req) {
  try {
    const base = process.env.PUBLIC_BASE_URL || `${(req.headers['x-forwarded-proto'] || req.protocol)}://${req.get('host')}`;
    return `${base}/index.html#login`;
  } catch (_) {
    const port = process.env.PORT || 5000;
    return `http://localhost:${port}/index.html#login`;
  }
}

/**
 * Helper to generate the learning page URL.
 */
function getLearningUrl(req) {
  try {
    const base = process.env.PUBLIC_BASE_URL || `${(req.headers['x-forwarded-proto'] || req.protocol)}://${req.get('host')}`;
    return `${base}/learning.html`;
  } catch (_) {
    const port = process.env.PORT || 5000;
    return `http://localhost:${port}/learning.html`;
  }
}

/**
 * Helper to generate the investment page URL.
 */
function getInvestmentUrl(req) {
  try {
    const base = process.env.PUBLIC_BASE_URL || `${(req.headers['x-forwarded-proto'] || req.protocol)}://${req.get('host')}`;
    return `${base}/investment.html`;
  } catch (_) {
    const port = process.env.PORT || 5000;
    return `http://localhost:${port}/investment.html`;
  }
}

/**
 * Retrieves a user's wallet from the database or creates one if it doesn't exist.
 * @param {number} userId - The ID of the user
 * @returns {Promise<Object>} - The wallet database row
 */
async function getOrCreateWallet(userId) {
  const [rows] = await pool.query(
    'SELECT * FROM wallet WHERE user_id = ? LIMIT 1',
    [userId]
  );
  if (rows.length > 0) return rows[0];

  // If wallet doesn't exist, initialize it with zero balances
  await pool.query(
    'INSERT INTO wallet (user_id) VALUES (?)',
    [userId]
  );
  const [rowsAfterInsert] = await pool.query(
    'SELECT * FROM wallet WHERE user_id = ? LIMIT 1',
    [userId]
  );
  return rowsAfterInsert[0];
}

/**
 * Maps wallet database row to API response format.
 * Converts decimal strings from database to numbers for frontend consumption.
 * @param {Object} walletRow - Wallet row from database
 * @returns {Object} - Formatted wallet object
 */
function mapWalletResponse(walletRow) {
  return {
    availableBalance: Number(walletRow.available_balance || 0),
    totalDeposited: Number(walletRow.total_deposited || 0),
    totalWithdrawn: Number(walletRow.total_withdrawn || 0)
  };
}

/**
 * Fetches current market data for specific coins from the CoinGecko API.
 * @param {Object} params - Query parameters for the API request
 * @returns {Promise<Array>} - Array of coin market data
 */
async function fetchCoinMarkets(params) {
  const url = `${COINGECKO_API_BASE}/coins/markets`;
  const headers = {};
  if (COINGECKO_API_KEY) {
    headers['x-cg-demo-api-key'] = COINGECKO_API_KEY;
  }
  const response = await axios.get(url, {
    params: {
      vs_currency: 'usd',
      order: 'market_cap_desc',
      sparkline: false,
      price_change_percentage: '24h',
      ...params
    },
    headers
  });
  return Array.isArray(response.data) ? response.data : [];
}

/**
 * Updates or inserts market prices into the local database cache.
 * This reduces the number of external API calls for frequently accessed data.
 * @param {Array} coins - Array of coin data from fetchCoinMarkets
 */
async function upsertMarketPricesFromCoins(coins) {
  try {
    for (const coin of coins) {
      await pool.query(
        `
        INSERT INTO market_prices (coin_id, coin_symbol, coin_name, price_usd, price_change_percentage_24h, market_cap, last_updated)
        VALUES (?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          coin_symbol = VALUES(coin_symbol),
          coin_name = VALUES(coin_name),
          price_usd = VALUES(price_usd),
          price_change_percentage_24h = VALUES(price_change_percentage_24h),
          market_cap = VALUES(market_cap),
          last_updated = VALUES(last_updated)
        `,
        [
          coin.id,
          coin.symbol,
          coin.name,
          coin.current_price ?? 0,
          coin.price_change_percentage_24h ?? null,
          coin.market_cap ?? null
        ]
      );
    }
  } catch (err) {
    console.error('Error upserting market prices:', err);
  }
}

/**
 * Calculates a user's investment portfolio summary, including current value and profit/loss.
 * Fetches live market data to ensure accurate valuations.
 * @param {number} userId - The ID of the user
 * @returns {Promise<Object>} - Portfolio summary object
 */
async function buildInvestmentSummary(userId) {
  const [rows] = await pool.query(
    'SELECT * FROM investments WHERE user_id = ?',
    [userId]
  );

  // Return empty summary if no investments found
  if (!rows.length) {
    return {
      investedTotal: 0,
      currentTotal: 0,
      profitAmount: 0,
      profitPercent: 0,
      positions: []
    };
  }

  // Get unique coin IDs to fetch market data in one go
  const ids = Array.from(new Set(rows.map(r => r.coin_id)));
  let marketMap = {};
  try {
    const coins = await fetchCoinMarkets({ ids: ids.join(','), per_page: ids.length || 50 });
    marketMap = coins.reduce((acc, c) => {
      acc[c.id] = {
        price: c.current_price ?? 0,
        priceChange24h: c.price_change_percentage_24h ?? null,
        marketCap: c.market_cap ?? null
      };
      return acc;
    }, {});
    // Cache the fetched prices
    await upsertMarketPricesFromCoins(coins);
  } catch (err) {
    console.error('Error fetching market data for investments:', err);
  }

  let investedTotal = 0;
  let currentTotal = 0;

  // Calculate metrics for each individual position
  const positions = rows.map((inv) => {
    const investedAmount = Number(inv.invested_amount || 0);
    const units = Number(inv.units || 0);
    const avgBuyPrice = Number(inv.avg_buy_price || 0);
    const market = marketMap[inv.coin_id] || {};
    const currentPrice = market.price || avgBuyPrice || 0;
    const currentValue = units * currentPrice;
    const profitAmount = currentValue - investedAmount;
    const profitPercent = investedAmount > 0 ? (profitAmount / investedAmount) * 100 : 0;

    investedTotal += investedAmount;
    currentTotal += currentValue;

    return {
      id: inv.id,
      coinId: inv.coin_id,
      coinSymbol: inv.coin_symbol,
      coinName: inv.coin_name,
      units,
      avgBuyPrice,
      investedAmount,
      currentPrice,
      currentValue,
      profitAmount,
      profitPercent,
      duration: inv.duration,
      createdAt: inv.created_at,
      priceChange24h: market.priceChange24h ?? null,
      marketCap: market.marketCap ?? null
    };
  });

  // Calculate aggregate portfolio metrics
  const profitAmountTotal = currentTotal - investedTotal;
  const profitPercentTotal = investedTotal > 0 ? (profitAmountTotal / investedTotal) * 100 : 0;

  return {
    investedTotal,
    currentTotal,
    profitAmount: profitAmountTotal,
    profitPercent: profitPercentTotal,
    positions
  };
}

// ==========================================
//   AUTHENTICATION HELPERS & ROUTES
// ==========================================

/**
 * Validates password strength based on several criteria.
 * Criteria: min 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char.
 * @param {string} password - The password to validate
 * @returns {Object} - Validation result and specific errors
 */
function validatePasswordStrength(password) {
  const minLength = 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
  
  return {
    valid: password.length >= minLength && hasUppercase && hasLowercase && hasNumber && hasSpecial,
    errors: {
      length: password.length < minLength,
      uppercase: !hasUppercase,
      lowercase: !hasLowercase,
      number: !hasNumber,
      special: !hasSpecial
    }
  };
}

/**
 * Handles user registration (signup).
 * Validates input, hashes password, and creates a new user record.
 */
async function handleSignup(req, res) {
  try {
    const { fullName, email, password, username } = req.body || {};

    // Basic required field validation
    if (!fullName || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Enforce strong passwords for security
    const passwordCheck = validatePasswordStrength(password);
    if (!passwordCheck.valid) {
      return res.status(400).json({ 
        error: 'Password must contain at least 8 characters, one uppercase letter, one lowercase letter, one number, and one special symbol.' 
      });
    }

    // Check for duplicate emails to prevent multiple accounts for one user
    const [existing] = await pool.query(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email already exists' });
    }

    // Hash password before storing it in the database
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // Insert user into 'users' table
    const [result] = await pool.query(
      'INSERT INTO users (full_name, email, username, password_hash) VALUES (?, ?, ?, ?)',
      [fullName, email, username || null, password_hash]
    );

    const loginUrl = getLoginUrl(req);
    
    // Create an initial welcome notification for the user
    try { await addNotification(result.insertId, 'signup', 'Welcome to our platform!'); } catch (_) {}
    
    // Send a welcome email asynchronously
    const welcomeSubject = 'Welcome to NH Network! 🎉';
    const welcomeHtml = buildWelcomeEmailHTML(fullName, loginUrl);
    Promise.resolve().then(() => sendEmail(email, welcomeSubject, welcomeHtml)).then((r) => {
      if (!r || !r.ok) console.error('[mail] Welcome email failed for', email);
      else console.log('[mail] Welcome email sent successfully to', email);
    }).catch((err) => {
      console.error('[mail] Welcome email error:', err && err.message ? err.message : err);
    });

    return res.json({ success: true, message: 'Signup successful' });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

/**
 * Handles user authentication (login).
 * Supports both email and username for login.
 */
async function handleLogin(req, res) {
  try {
    const { emailOrUsername, password } = req.body || {};

    if (!emailOrUsername || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Look up user by email OR username
    const [rows] = await pool.query(
      'SELECT * FROM users WHERE email = ? OR username = ? LIMIT 1',
      [emailOrUsername, emailOrUsername]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = rows[0];

    // Compare provided password with stored hash
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Check if account is disabled
    if (user.status === 'disabled') {
      return res.status(403).json({ error: 'Your account has been disabled by Admin. Please contact support.' });
    }

    // Add login notification
    try { await addNotification(user.id, 'sign_in', `Welcome back, ${user.full_name}!`); } catch (_) {}
    
    // Return basic user info on successful login
    return res.json({ success: true, message: 'Login successful', user: { id: user.id, name: user.full_name, email: user.email } });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}

// Authentication endpoints
app.post('/api/signup', handleSignup);
app.post('/api/login', handleLogin);

// ==========================================
//   CONTACT SUPPORT ROUTE
// ==========================================
/**
 * Processes messages from the 'Contact Us' form.
 * Sends an email to the support address and notifies the user if they are logged in.
 */
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, message } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ success: false, error: 'All fields are required' });
    }

    const subject = `New Contact Form Inquiry from ${name}`;
    const html = `
      <div style="font-family: sans-serif; padding: 20px;">
        <h2>New Support Message</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <hr style="border: 1px solid #ddd;" />
        <p><strong>Message:</strong></p>
        <p style="white-space: pre-wrap;">${message}</p>
      </div>
    `;

    // Retrieve the target email address for receiving support inquiries
    const receiver = process.env.SMTP_USER || process.env.FROM_EMAIL || 'devolper.expert@gmail.com';
    const result = await sendEmail(receiver, subject, html);
    
    // Trigger an in-app notification if the user is currently logged in
    const userId = req.body && req.body.userId;
    if (userId) {
      try { await addNotification(userId, 'contact_form', 'Your message has been sent to support. We will get back to you soon!'); } catch (_) {}
    }
    
    return res.json({ success: true, message: 'Message sent successfully' });
  } catch (err) {
    console.error('Contact endpoint error:', err);
    return res.status(500).json({ success: false, error: 'Server error occurred while sending message' });
  }
});

// ==========================================
//   FORGOT PASSWORD ROUTES (OTP-BASED)
// ==========================================

/**
 * Generates a random 6-digit One-Time Password (OTP).
 * @returns {string} - 6-digit numeric string
 */
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Endpoint to initiate password reset by sending an OTP to the user's email.
 */
app.post('/api/forgot-password/send-otp', async (req, res) => {
  try {
    const { email } = req.body || {};
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    // Validate basic email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }
    
    // Verify if the user exists in our system
    const [users] = await pool.query('SELECT id, full_name FROM users WHERE email = ? LIMIT 1', [email]);
    if (users.length === 0) {
      // For security, don't explicitly say the email doesn't exist to prevent enumeration
      return res.json({ success: true, message: 'If this email is registered, you will receive an OTP shortly.' });
    }
    
    const user = users[0];
    
    // Generate a fresh OTP
    const otp = generateOTP();
    
    // OTP will be valid for 10 minutes
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    
    // Invalidate any previously sent, unused OTPs for this email to prevent reuse
    await pool.query('UPDATE password_reset_tokens SET used = 1 WHERE email = ? AND used = 0', [email]);
    
    // Store the new OTP in the database
    await pool.query(
      'INSERT INTO password_reset_tokens (email, otp, expires_at) VALUES (?, ?, ?)',
      [email, otp, expiresAt]
    );

    // Add activity notification
    try { await addNotification(user.id, 'password_reset', 'Password reset link sent to your email.'); } catch (_) {}
    
    // Prepare and send the OTP email
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8f9fa;">
        <div style="background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <h2 style="color: #3b82f6; margin-bottom: 20px;">Password Reset Request</h2>
          <p style="color: #333; font-size: 16px; line-height: 1.6;">Hello ${user.full_name || 'User'},</p>
          <p style="color: #555; font-size: 15px; line-height: 1.6;">You recently requested to reset your password for your NH Network account. Use the OTP below to complete the process:</p>
          <div style="background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); color: white; font-size: 32px; font-weight: bold; text-align: center; padding: 20px; border-radius: 8px; margin: 25px 0; letter-spacing: 8px;">
            ${otp}
          </div>
          <p style="color: #555; font-size: 14px; line-height: 1.6;">This OTP will expire in <strong>10 minutes</strong>.</p>
          <p style="color: #777; font-size: 13px; line-height: 1.6; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">If you did not request a password reset, please ignore this email or contact support if you have concerns.</p>
          <p style="color: #999; font-size: 12px; margin-top: 20px;">NH Network Team</p>
        </div>
      </div>
    `;
    
    const emailResult = await sendEmail(email, 'NH Network - Password Reset OTP', emailHtml);
    
    if (!emailResult.ok) {
      console.error('[forgot-password] Failed to send OTP email:', emailResult.error);
      return res.status(500).json({ error: 'Failed to send OTP. Please try again later.' });
    }
    
    console.log(`[forgot-password] OTP sent to ${email}`);
    return res.json({ success: true, message: 'An OTP has been sent to your email.' });
    
  } catch (err) {
    console.error('Send OTP error:', err);
    return res.status(500).json({ error: 'Server error. Please try again later.' });
  }
});

/**
 * Endpoint to verify if a provided OTP is valid and not expired.
 */
app.post('/api/forgot-password/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body || {};
    
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }
    
    // Search for a matching token that hasn't been used and hasn't expired
    const [tokens] = await pool.query(
      'SELECT * FROM password_reset_tokens WHERE email = ? AND otp = ? AND used = 0 AND expires_at > NOW() LIMIT 1',
      [email, otp]
    );
    
    if (tokens.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired OTP. Please request a new one.' });
    }
    
    return res.json({ success: true, message: 'OTP verified successfully' });
    
  } catch (err) {
    console.error('Verify OTP error:', err);
    return res.status(500).json({ error: 'Server error. Please try again later.' });
  }
});

/**
 * Endpoint to finalize password reset using the verified OTP.
 */
app.post('/api/forgot-password/reset', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body || {};
    
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    // Final check for password strength
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }
    
    // Re-verify the token one last time before making changes
    const [tokens] = await pool.query(
      'SELECT * FROM password_reset_tokens WHERE email = ? AND otp = ? AND used = 0 AND expires_at > NOW() LIMIT 1',
      [email, otp]
    );
    
    if (tokens.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired OTP. Please request a new one.' });
    }
    
    const token = tokens[0];
    
    // Find the user associated with this email
    const [users] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const userId = users[0].id;
    
    // Hash the new password securely
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);
    
    // Update the user's password in the database
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
    
    // Mark the token as used so it cannot be reused
    await pool.query('UPDATE password_reset_tokens SET used = 1 WHERE id = ?', [token.id]);
    
    // Send a confirmation email for security monitoring
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8f9fa;">
        <div style="background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <h2 style="color: #22c55e; margin-bottom: 20px;">Password Updated Successfully</h2>
          <p style="color: #333; font-size: 16px; line-height: 1.6;">Hello,</p>
          <p style="color: #555; font-size: 15px; line-height: 1.6;">Your NH Network account password has been successfully updated.</p>
          <p style="color: #555; font-size: 15px; line-height: 1.6;">You can now log in using your new password.</p>
          <p style="color: #777; font-size: 13px; line-height: 1.6; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">If you did not make this change, please contact our support team immediately.</p>
          <p style="color: #999; font-size: 12px; margin-top: 20px;">NH Network Team</p>
        </div>
      </div>
    `;
    
    await sendEmail(email, 'NH Network - Password Changed', emailHtml);
    
    console.log(`[forgot-password] Password reset successful for ${email}`);
    return res.json({ success: true, message: 'Your password has been updated successfully.' });
    
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ error: 'Server error. Please try again later.' });
  }
});

// ==========================================
//   REVIEWS & COMMENTS ROUTES
// ==========================================

/**
 * Fetches all reviews for a specific course.
 */
app.get('/api/courses/:courseId/reviews', async (req, res) => {
  try {
    const { courseId } = req.params;
    const [rows] = await pool.query(
      `SELECT r.*, u.full_name as user_name 
       FROM course_reviews r 
       JOIN users u ON r.user_id = u.id 
       WHERE r.course_id = ? 
       ORDER BY r.created_at DESC`,
      [courseId]
    );
    return res.json({ success: true, reviews: rows });
  } catch (err) {
    console.error('Fetch reviews error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Submits a new review for a course.
 */
app.post('/api/courses/:courseId/reviews', async (req, res) => {
  try {
    const { courseId } = req.params;
    const { userId, rating, text } = req.body;
    if (!userId || !rating || !text) {
      return res.status(400).json({ error: 'userId, rating, and text are required' });
    }
    await pool.query(
      'INSERT INTO course_reviews (user_id, course_id, rating, text) VALUES (?, ?, ?, ?)',
      [userId, courseId, rating, text]
    );
    return res.json({ success: true, message: 'Review submitted successfully' });
  } catch (err) {
    console.error('Submit review error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Fetches all comments for a specific lesson within a course.
 */
app.get('/api/courses/:courseId/lessons/:lessonId/comments', async (req, res) => {
  try {
    const { courseId, lessonId } = req.params;
    const [rows] = await pool.query(
      `SELECT c.*, u.full_name as user_name 
       FROM lesson_comments c 
       JOIN users u ON c.user_id = u.id 
       WHERE c.course_id = ? AND c.lesson_id = ? 
       ORDER BY c.created_at ASC`,
      [courseId, lessonId]
    );
    return res.json({ success: true, comments: rows });
  } catch (err) {
    console.error('Fetch comments error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Posts a new comment or reply for a lesson.
 */
app.post('/api/courses/:courseId/lessons/:lessonId/comments', async (req, res) => {
  try {
    const { courseId, lessonId } = req.params;
    const { userId, text, parentCommentId } = req.body;
    if (!userId || !text) {
      return res.status(400).json({ error: 'userId and text are required' });
    }
    await pool.query(
      'INSERT INTO lesson_comments (user_id, course_id, lesson_id, text, parent_comment_id) VALUES (?, ?, ?, ?, ?)',
      [userId, courseId, lessonId, text, parentCommentId || null]
    );
    return res.json({ success: true, message: 'Comment posted successfully' });
  } catch (err) {
    console.error('Post comment error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Dummy endpoint for session validation (can be expanded with JWT/Sessions).
 */
app.get('/api/auth/me', async (req, res) => {
  try {
    return res.json({ success: true, user: null });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// ==========================================
//   ADMIN LOGIN (STATIC CREDENTIALS)
// ==========================================
/**
 * Handles admin authentication using hardcoded credentials.
 * NOTE: For production, this should use a database-backed admin table.
 */
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }
    const okUser = String(username).trim() === 'nhnetwork';
    const okPass = String(password) === '12345678';
    if (!okUser || !okPass) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }
    console.log('[admin] login success for', username);
    return res.json({ success: true });
  } catch (err) {
    console.error('[admin] login error:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ==========================================
//   USER PROFILE ROUTES
// ==========================================

/**
 * Retrieves a user's combined profile data from 'users' and 'user_profiles' tables.
 */
app.get('/api/user/profile', async (req, res) => {
  try {
    const userId = parseInt(req.query.userId, 10);
    // Return a default empty profile if no userId is provided (fallback)
    if (!userId) return res.json({ success: true, profile: { id: 0, fullName: 'Investor', email: '' } });
    
    // Fetch base user account info
    const [usersRows] = await pool.query('SELECT id, full_name, email, username FROM users WHERE id = ? LIMIT 1', [userId]);
    const user = usersRows.length ? usersRows[0] : { id: userId, full_name: 'Investor', email: '', username: null };
    
    // Fetch extended profile info
    const [profileRows] = await pool.query('SELECT phone, cnic, address, account_type, verification_status, avatar_url, kyc_status, payment_password_plain FROM user_profiles WHERE user_id = ? LIMIT 1', [userId]);
    const profile = profileRows.length ? profileRows[0] : {};
    
    return res.json({ success: true, profile: {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      username: user.username || null,
      phone: profile.phone || null,
      cnic: profile.cnic || null,
      address: profile.address || null,
      accountType: profile.account_type || 'standard',
      verificationStatus: profile.verification_status || 'unverified',
      avatarUrl: profile.avatar_url || null, 
      kycStatus: profile.kyc_status || null,
      paymentPassword: profile.payment_password_plain || '123456'
    }});
  } catch (err) {
    console.error('Get profile error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Updates a user's profile information.
 * Handles updates to both 'users' and 'user_profiles' tables.
 * Can also update the payment password if provided.
 */
app.post('/api/user/profile', async (req, res) => {
  try {
    const { userId, fullName, phone, cnic, address, accountType, verificationStatus, paymentPassword } = req.body || {};
    const parsedUserId = parseInt(userId, 10);
    if (!parsedUserId) return res.status(400).json({ error: 'userId is required' });

    // Update name in the main 'users' table if provided
    if (fullName) {
      await pool.query('UPDATE users SET full_name = ? WHERE id = ?', [fullName, parsedUserId]);
    }

    // Securely hash the payment password if it's being updated
    let payment_password_hash = null;
    let payment_password_plain = null;
    if (paymentPassword && String(paymentPassword).length >= 4) {
      payment_password_plain = String(paymentPassword);
      const salt = await bcrypt.genSalt(10);
      payment_password_hash = await bcrypt.hash(payment_password_plain, salt);
    }

    // Upsert (Insert or Update) profile details
    await pool.query(
      `INSERT INTO user_profiles (user_id, phone, cnic, address, account_type, verification_status, payment_password_hash, payment_password_plain)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         phone = VALUES(phone),
         cnic = VALUES(cnic),
         address = VALUES(address),
         account_type = VALUES(account_type),
         verification_status = VALUES(verification_status),
         payment_password_hash = COALESCE(VALUES(payment_password_hash), payment_password_hash),
         payment_password_plain = COALESCE(VALUES(payment_password_plain), payment_password_plain)
      `,
      [parsedUserId, phone || null, cnic || null, address || null, accountType || null, verificationStatus || null, payment_password_hash, payment_password_plain]
    );

    try { await addNotification(parsedUserId, 'profile_update', 'Profile updated'); } catch (_) {}
    return res.json({ success: true });
  } catch (err) {
    console.error('Update profile error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ==========================================
//   WALLET ROUTES
// ==========================================

/**
 * Retrieves the current wallet status for a user.
 */
app.get('/api/wallet', async (req, res) => {
  try {
    const userId = parseInt(req.query.userId, 10);
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const wallet = await getOrCreateWallet(userId);
    return res.json({ success: true, wallet: mapWalletResponse(wallet) });
  } catch (err) {
    console.error('Get wallet error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Processes a deposit into the user's wallet.
 * Requires verification of the payment password for security.
 */
app.post('/api/wallet/deposit', async (req, res) => {
  try {
    const { userId, amount, paymentMethod, paymentPassword, details } = req.body || {};
    const parsedUserId = parseInt(userId, 10);
    const numericAmount = Number(amount);
    
    // Validation: amount must be a positive number
    if (!parsedUserId || !numericAmount || numericAmount <= 0) {
      return res.status(400).json({ error: 'Valid userId and positive amount are required' });
    }

    if (!paymentPassword) {
      return res.status(400).json({ error: 'paymentPassword is required' });
    }

    // Verify payment password before processing transaction
    const [rowsProfile] = await pool.query('SELECT payment_password_hash FROM user_profiles WHERE user_id = ? LIMIT 1', [parsedUserId]);
    const hash = rowsProfile.length ? rowsProfile[0].payment_password_hash : null;
    if (!hash) {
      return res.status(400).json({ error: 'No payment password set. Please set it in profile.' });
    }
    const ok = await bcrypt.compare(String(paymentPassword), String(hash));
    if (!ok) {
      return res.status(401).json({ error: 'Invalid payment password' });
    }

    await getOrCreateWallet(parsedUserId);

    // Update wallet balance and aggregate totals
    await pool.query(
      'UPDATE wallet SET available_balance = available_balance + ?, total_deposited = total_deposited + ? WHERE user_id = ?',
      [numericAmount, numericAmount, parsedUserId]
    );

    // Record the transaction in the audit log
    await pool.query(
      'INSERT INTO transactions (user_id, type, amount, fee, description) VALUES (?, ?, ?, ?, ?)',
      [parsedUserId, 'deposit', numericAmount, 0, `${paymentMethod || 'deposit'} | ${JSON.stringify(details || {})}`]
    );

    const updatedWallet = await getOrCreateWallet(parsedUserId);
    try { await addNotification(parsedUserId, 'deposit', `Deposit of $${numericAmount.toFixed(2)}`); } catch (_) {}
    try {
      const email = await getUserEmail(parsedUserId);
      if (email) {
        const subject = 'Deposit Received';
        const html = `
          <div style="font-family: Inter, Arial, sans-serif; line-height:1.6;">
            <h2 style="color:#111827;">Deposit Confirmation</h2>
            <p>We have credited <strong>$${numericAmount.toFixed(2)}</strong> to your wallet.</p>
            <p>Method: <strong>${(paymentMethod || 'deposit').toUpperCase()}</strong></p>
            <p style="color:#6b7280;font-size:12px;margin-top:16px;">This is an automated confirmation from NH Network.</p>
          </div>`;
        Promise.resolve().then(() => sendEmail(email, subject, html));
      }
    } catch (e) { console.error('[mail] deposit email failed:', e && e.message ? e.message : e); }
    
    return res.json({ success: true, wallet: mapWalletResponse(updatedWallet) });
  } catch (err) {
    console.error('Deposit error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Processes a withdrawal request from the user's wallet.
 * Checks for sufficient balance and applies a 1% transaction fee.
 */
app.post('/api/wallet/withdraw', async (req, res) => {
  try {
    const { userId, amount, paymentMethod, paymentPassword, details } = req.body || {};
    const parsedUserId = parseInt(userId, 10);
    const numericAmount = Number(amount);
    
    if (!parsedUserId || !numericAmount || numericAmount <= 0) {
      return res.status(400).json({ error: 'Valid userId and positive amount are required' });
    }

    if (!paymentPassword) {
      return res.status(400).json({ error: 'paymentPassword is required' });
    }

    // Verify payment password
    const [rowsProfile] = await pool.query('SELECT payment_password_hash FROM user_profiles WHERE user_id = ? LIMIT 1', [parsedUserId]);
    const hash = rowsProfile.length ? rowsProfile[0].payment_password_hash : null;
    if (!hash) {
      return res.status(400).json({ error: 'No payment password set. Please set it in profile.' });
    }
    const ok = await bcrypt.compare(String(paymentPassword), String(hash));
    if (!ok) {
      return res.status(401).json({ error: 'Invalid payment password' });
    }

    // Check if user has enough funds
    const wallet = await getOrCreateWallet(parsedUserId);
    const available = Number(wallet.available_balance || 0);
    if (available < numericAmount) {
      return res.status(400).json({ error: 'Insufficient wallet balance' });
    }

    // Calculate 1% fee
    const feeRaw = numericAmount * 0.01;
    const fee = Math.round(feeRaw * 100) / 100;
    const netAmount = numericAmount - fee;

    // Deduct balance and update totals
    await pool.query(
      'UPDATE wallet SET available_balance = available_balance - ?, total_withdrawn = total_withdrawn + ? WHERE user_id = ?',
      [numericAmount, numericAmount, parsedUserId]
    );

    // Record withdrawal transaction
    await pool.query(
      'INSERT INTO transactions (user_id, type, amount, fee, description) VALUES (?, ?, ?, ?, ?)',
      [parsedUserId, 'withdraw', numericAmount, fee, `${paymentMethod || 'withdraw'} | ${JSON.stringify(details || {})}`]
    );

    const updatedWallet = await getOrCreateWallet(parsedUserId);
    try { await addNotification(parsedUserId, 'withdraw', `Withdrawal of $${numericAmount.toFixed(2)} (fee $${fee.toFixed(2)})`); } catch (_) {}
    
    return res.json({
      success: true,
      wallet: mapWalletResponse(updatedWallet),
      withdrawnAmount: numericAmount,
      fee,
      netAmount
    });
  } catch (err) {
    console.error('Withdraw error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ==========================================
//   WALLET TRANSACTION HISTORY
// ==========================================

/**
 * Fetches the transaction history for a specific user.
 */
app.get('/api/wallet/transactions', async (req, res) => {
  try {
    const userId = parseInt(req.query.userId, 10);
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const [rows] = await pool.query('SELECT type, status, amount, fee, description, created_at FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [userId, limit]);
    return res.json({ success: true, transactions: rows });
  } catch (err) {
    console.error('Transactions list error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ==========================================
//   MARKET DATA ROUTES
// ==========================================

/**
 * Fetches the top cryptocurrencies by market cap.
 * Also caches the results in the local database.
 */
app.get('/api/market/top', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const coins = await fetchCoinMarkets({
      per_page: limit,
      page: 1
    });
    // Cache the fetched prices locally
    await upsertMarketPricesFromCoins(coins);
    
    const mapped = coins.map((c) => ({
      id: c.id,
      symbol: c.symbol,
      name: c.name,
      price: c.current_price,
      priceChange24h: c.price_change_percentage_24h,
      marketCap: c.market_cap
    }));
    return res.json({ success: true, coins: mapped });
  } catch (err) {
    console.error('Market top error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ==========================================
//   MARKET LIST & SEARCH ROUTES
// ==========================================

// Simple server-side cache for market data to reduce API calls and latency
const marketDataCache = {
  data: null,
  timestamp: 0,
  ttl: 60000 // 1 minute
};

/**
 * Endpoint: /api/user/verify-payment-password
 * Verifies the user's payment password.
 */
app.post('/api/user/verify-payment-password', async (req, res) => {
  try {
    const { userId, paymentPassword } = req.body || {};
    const uid = parseInt(userId, 10);
    if (!uid || !paymentPassword) return res.status(400).json({ error: 'Missing data' });

    const [rows] = await pool.query('SELECT payment_password_hash FROM user_profiles WHERE user_id = ? LIMIT 1', [uid]);
    if (!rows.length) return res.status(400).json({ error: 'No password set' });

    const ok = await bcrypt.compare(String(paymentPassword), String(rows[0].payment_password_hash));
    return res.json({ success: ok });
  } catch (err) {
    console.error('Verify payment password error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Endpoint: /api/wallet/manual-deposit
 * Submits a manual deposit request with screenshot.
 */
app.post('/api/wallet/manual-deposit', multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
    filename: (req, file, cb) => cb(null, `deposit_${Date.now()}_${file.originalname}`)
  })
}).single('screenshot'), async (req, res) => {
  try {
    const { userId, amount, method, senderName, senderAccount } = req.body || {};
    const screenshot = req.file;
    if (!userId || !amount || !method || !senderName || !senderAccount || !screenshot) {
      return res.status(400).json({ error: 'All fields and screenshot are required' });
    }

    const screenshotUrl = `/uploads/${screenshot.filename}`;
    const [result] = await pool.query(
      'INSERT INTO manual_deposits (user_id, amount, method, sender_name, sender_account, screenshot_url, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [userId, amount, method, senderName, senderAccount, screenshotUrl, 'pending']
    );

    // Also log as a pending transaction
    await pool.query(
      'INSERT INTO transactions (user_id, type, status, amount, fee, description) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, 'deposit', 'pending', amount, 0, `Manual Deposit via ${method.toUpperCase()}`]
    );

    try { await addNotification(userId, 'deposit_request', `Submitted deposit request of $${Number(amount).toFixed(2)}`); } catch (_) {}
    try {
      const email = await getUserEmail(userId);
      if (email) {
        const subject = 'Deposit Request Submitted';
        const html = `
          <div style="font-family: Inter, Arial, sans-serif; line-height:1.6;">
            <h2 style="color:#111827;">Deposit Request Received</h2>
            <p>Your deposit request of <strong>$${Number(amount).toFixed(2)}</strong> has been submitted and is pending review.</p>
            <p>Method: <strong>${method.toUpperCase()}</strong></p>
            <p style="color:#6b7280;font-size:12px;margin-top:16px;">You will receive an email after review.</p>
          </div>`;
        Promise.resolve().then(() => sendEmail(email, subject, html));
      }
    } catch (e) { console.error('[mail] deposit submit email failed:', e && e.message ? e.message : e); }

    return res.json({ success: true, depositId: result.insertId });
  } catch (err) {
    console.error('Manual deposit submission error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Endpoint: /api/wallet/manual-withdrawal
 * Processes a manual withdrawal request.
 */
app.post('/api/wallet/manual-withdrawal', async (req, res) => {
  try {
    const { userId, amount, method, accountName, accountAddress } = req.body;
    const parsedUserId = parseInt(userId, 10);
    const numericAmount = parseFloat(amount);

    if (!parsedUserId || !numericAmount || numericAmount <= 0 || !method || !accountName || !accountAddress) {
      return res.status(400).json({ error: 'All fields are required and amount must be positive' });
    }

    // Check if user has sufficient funds
    const wallet = await getOrCreateWallet(parsedUserId);
    if (Number(wallet.available_balance) < numericAmount) {
      return res.status(400).json({ error: 'Insufficient wallet balance' });
    }

    const fee = numericAmount * 0.01;
    const netAmount = numericAmount - fee;

    // Create withdrawal request
    const [result] = await pool.query(
      `INSERT INTO manual_withdrawals (user_id, amount, fee, net_amount, method, account_name, account_address, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [parsedUserId, numericAmount, fee, netAmount, method, accountName, accountAddress]
    );

    // Log as a pending transaction
    await pool.query(
      'INSERT INTO transactions (user_id, type, status, amount, fee, description) VALUES (?, ?, ?, ?, ?, ?)',
      [parsedUserId, 'withdraw', 'pending', numericAmount, fee, `Withdrawal via ${method.toUpperCase()}`]
    );

    try { await addNotification(parsedUserId, 'withdrawal_request', `Submitted withdrawal request of $${numericAmount.toFixed(2)}`); } catch (_) {}
    try {
      const email = await getUserEmail(parsedUserId);
      if (email) {
        const subject = 'Withdrawal Request Submitted';
        const html = `
          <div style="font-family: Inter, Arial, sans-serif; line-height:1.6;">
            <h2 style="color:#111827;">Withdrawal Request Received</h2>
            <p>Your withdrawal request of <strong>$${numericAmount.toFixed(2)}</strong> has been submitted and is pending review.</p>
            <p>Method: <strong>${method.toUpperCase()}</strong></p>
            <p style="color:#6b7280;font-size:12px;margin-top:16px;">You will receive an email once it is approved or rejected.</p>
          </div>`;
        Promise.resolve().then(() => sendEmail(email, subject, html));
      }
    } catch (e) { console.error('[mail] withdrawal submit email failed:', e && e.message ? e.message : e); }

    return res.json({ success: true, withdrawalId: result.insertId });
  } catch (err) {
    console.error('Manual withdrawal submission error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Endpoint: /api/admin/withdrawals
 * Admin: Fetches all manual withdrawal requests.
 */
app.get('/api/admin/withdrawals', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT mw.*, u.full_name as userName 
      FROM manual_withdrawals mw 
      JOIN users u ON mw.user_id = u.id 
      ORDER BY mw.created_at DESC
    `);
    return res.json({ success: true, requests: rows });
  } catch (err) {
    console.error('Fetch withdrawals error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Endpoint: /api/admin/withdrawals/:id/:action
 * Admin: Approves or Rejects a manual withdrawal.
 */
app.post('/api/admin/withdrawals/:id/:action', async (req, res) => {
  try {
    const { id, action } = req.params;
    const withdrawId = parseInt(id, 10);
    if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Invalid action' });

    const [rows] = await pool.query('SELECT * FROM manual_withdrawals WHERE id = ? LIMIT 1', [withdrawId]);
    if (!rows.length) return res.status(404).json({ error: 'Request not found' });
    const mw = rows[0];
    if (mw.status !== 'pending') return res.status(400).json({ error: 'Already processed' });

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    
    if (action === 'approve') {
      // Re-verify balance just in case
      const wallet = await getOrCreateWallet(mw.user_id);
      if (Number(wallet.available_balance) < Number(mw.amount)) {
        return res.status(400).json({ error: 'User no longer has sufficient balance' });
      }

      // Deduct funds from user wallet
      await pool.query(
        'UPDATE wallet SET available_balance = available_balance - ?, total_withdrawn = total_withdrawn + ? WHERE user_id = ?',
        [mw.amount, mw.amount, mw.user_id]
      );

      await pool.query('UPDATE manual_withdrawals SET status = ? WHERE id = ?', ['approved', withdrawId]);
      
      // Update transaction status
      await pool.query(
        "UPDATE transactions SET status = 'approved' WHERE user_id = ? AND type = 'withdraw' AND amount = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
        [mw.user_id, mw.amount]
      );

      try { await addNotification(mw.user_id, 'withdrawal_approved', `Withdrawal of $${Number(mw.amount).toFixed(2)} approved!`); } catch (_) {}
      try {
        const email = await getUserEmail(mw.user_id);
        if (email) {
          const subject = 'Withdrawal Approved';
          const html = `
            <div style="font-family: Inter, Arial, sans-serif; line-height:1.6;">
              <h2 style="color:#111827;">Withdrawal Approved</h2>
              <p>Your withdrawal of <strong>$${Number(mw.amount).toFixed(2)}</strong> has been approved.</p>
              <p>Net Sent: <strong>$${Number(mw.net_amount).toFixed(2)}</strong> | Fee: <strong>$${Number(mw.fee).toFixed(2)}</strong></p>
            </div>`;
          Promise.resolve().then(() => sendEmail(email, subject, html));
        }
      } catch (e) { console.error('[mail] withdrawal approved email failed:', e && e.message ? e.message : e); }
    } else {
      await pool.query('UPDATE manual_withdrawals SET status = ? WHERE id = ?', ['rejected', withdrawId]);
      
      // Update transaction status
      await pool.query(
        "UPDATE transactions SET status = 'rejected' WHERE user_id = ? AND type = 'withdraw' AND amount = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
        [mw.user_id, mw.amount]
      );

      try { await addNotification(mw.user_id, 'withdrawal_rejected', `Withdrawal of $${Number(mw.amount).toFixed(2)} rejected.`); } catch (_) {}
      try {
        const email = await getUserEmail(mw.user_id);
        if (email) {
          const subject = 'Withdrawal Rejected';
          const html = `
            <div style="font-family: Inter, Arial, sans-serif; line-height:1.6;">
              <h2 style="color:#111827;">Withdrawal Rejected</h2>
              <p>Your withdrawal of <strong>$${Number(mw.amount).toFixed(2)}</strong> has been rejected.</p>
              <p style="color:#6b7280;font-size:12px;margin-top:16px;">Please contact support if you need more details.</p>
            </div>`;
          Promise.resolve().then(() => sendEmail(email, subject, html));
        }
      } catch (e) { console.error('[mail] withdrawal rejected email failed:', e && e.message ? e.message : e); }
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('Process withdrawal error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Endpoint: /api/admin/deposits
 * Admin: Fetches all manual deposit requests.
 */
app.get('/api/admin/deposits', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM manual_deposits ORDER BY created_at DESC');
    return res.json({ success: true, requests: rows });
  } catch (err) {
    console.error('Fetch deposits error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Endpoint: /api/admin/deposits/:id/:action
 * Admin: Approves or Rejects a manual deposit.
 */
app.post('/api/admin/deposits/:id/:action', async (req, res) => {
  try {
    const { id, action } = req.params;
    const depId = parseInt(id, 10);
    if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Invalid action' });

    const [rows] = await pool.query('SELECT * FROM manual_deposits WHERE id = ? LIMIT 1', [depId]);
    if (!rows.length) return res.status(404).json({ error: 'Request not found' });
    const dep = rows[0];
    if (dep.status !== 'pending') return res.status(400).json({ error: 'Already processed' });

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    await pool.query('UPDATE manual_deposits SET status = ? WHERE id = ?', [newStatus, depId]);

    // Update corresponding transaction status
    await pool.query(
      "UPDATE transactions SET status = ? WHERE user_id = ? AND type = 'deposit' AND amount = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
      [newStatus === 'approved' ? 'approved' : 'rejected', dep.user_id, dep.amount]
    );

    if (newStatus === 'approved') {
      // Add funds to user wallet
      await pool.query(
        'UPDATE wallet SET available_balance = available_balance + ?, total_deposited = total_deposited + ? WHERE user_id = ?',
        [dep.amount, dep.amount, dep.user_id]
      );
      try { await addNotification(dep.user_id, 'deposit_approved', `Deposit of $${Number(dep.amount).toFixed(2)} approved!`); } catch (_) {}
    } else {
      try { await addNotification(dep.user_id, 'deposit_rejected', `Deposit of $${Number(dep.amount).toFixed(2)} rejected.`); } catch (_) {}
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('Process deposit error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Provides a paginated list of all supported cryptocurrencies.
 * Optimized with server-side caching to improve response speed.
 */
app.get('/api/market/list', async (req, res) => {
  try {
    const vs = (req.query.vs_currency || 'usd').toLowerCase();
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const per = Math.min(Math.max(parseInt(req.query.per_page, 10) || 100, 1), 250);
    const now = Date.now();
    
    // Check if cached data is fresh and matches the request parameters
    const cacheKey = `${vs}_${page}_${per}`;
    if (marketDataCache.data && marketDataCache.timestamp && (now - marketDataCache.timestamp < marketDataCache.ttl) && marketDataCache.key === cacheKey) {
      console.log('[market] Serving from server-side cache');
      return res.json({ success: true, coins: marketDataCache.data, page, per_page: per });
    }

    const coins = await fetchCoinMarkets({ vs_currency: vs, per_page: per, page });
    await upsertMarketPricesFromCoins(coins);
    const mapped = coins.map((c) => ({
      id: c.id, symbol: c.symbol, name: c.name,
      price: c.current_price, priceChange24h: c.price_change_percentage_24h,
      marketCap: c.market_cap, image: c.image
    }));

    // Update the server-side cache
    marketDataCache.data = mapped;
    marketDataCache.timestamp = now;
    marketDataCache.key = cacheKey;

    return res.json({ success: true, coins: mapped, page, per_page: per });
  } catch (err) {
    console.error('Market list error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Searches for cryptocurrencies by name or symbol.
 */
app.get('/api/market/search', async (req, res) => {
  try {
    const vs = (req.query.vs_currency || 'usd').toLowerCase();
    const q = (req.query.query || '').toLowerCase();
    const per = Math.min(Math.max(parseInt(req.query.per_page, 10) || 100, 1), 250);
    const coins = await fetchCoinMarkets({ vs_currency: vs, per_page: per, page: 1 });
    // Filter results locally to support partial matches
    const filtered = q ? coins.filter(c => (
      (c.name || '').toLowerCase().includes(q) ||
      (c.symbol || '').toLowerCase().includes(q) ||
      (c.id || '').toLowerCase().includes(q)
    )) : coins;
    await upsertMarketPricesFromCoins(filtered);
    const mapped = filtered.map((c) => ({
      id: c.id, symbol: c.symbol, name: c.name,
      price: c.current_price, priceChange24h: c.price_change_percentage_24h,
      marketCap: c.market_cap
    }));
    return res.json({ success: true, coins: mapped });
  } catch (err) {
    console.error('Market search error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ==========================================
//   SYSTEM METRICS ROUTES
// ==========================================

/**
 * Aggregates high-level platform statistics for the dashboard.
 * Includes counts for learners, investors, total assets, and system uptime.
 */
app.get('/api/metrics/overview', async (req, res) => {
  try {
    // Count approved learners
    const [learnerRows] = await pool.query('SELECT COUNT(*) AS count FROM learner_requests WHERE status = ?', ['approved']);
    const approvedLearners = Number((learnerRows[0] && learnerRows[0].count) || 0);

    // Sum total invested amount across all users
    const [assetRows] = await pool.query('SELECT COALESCE(SUM(invested_amount),0) AS totalUsd, COUNT(DISTINCT coin_id) AS assetCount FROM investments');
    const assetsTrackedUsd = Number((assetRows[0] && assetRows[0].totalUsd) || 0);
    const assetCount = Number((assetRows[0] && assetRows[0].assetCount) || 0);

    // Count unique active investors
    const [investorRows] = await pool.query('SELECT COUNT(DISTINCT user_id) AS investors FROM investments');
    const activeInvestors = Number((investorRows[0] && investorRows[0].investors) || 0);

    // Check freshness of cached market data (stale if > 5 minutes old)
    const [marketRows] = await pool.query('SELECT MAX(last_updated) AS lastUpdated FROM market_prices');
    const lastUpdatedRaw = marketRows[0] && marketRows[0].lastUpdated;
    const lastUpdated = lastUpdatedRaw ? new Date(lastUpdatedRaw) : null;
    const marketFresh = lastUpdated ? (Date.now() - lastUpdated.getTime()) < 5 * 60 * 1000 : false;
    const marketStatus = marketFresh ? 'Real-time' : 'Stale';

    const uptimeSeconds = process.uptime();
    const uptimePercent = 99.9; // Hardcoded for demo purposes

    return res.json({
      success: true,
      metrics: {
        approvedLearners,
        activeInvestors,
        assetsTrackedUsd,
        assetCount,
        uptimeSeconds,
        uptimePercent,
        marketFresh,
        marketStatus
      }
    });
  } catch (err) {
    console.error('Metrics overview error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ==========================================
//   INVESTMENT ROUTES
// ==========================================

/**
 * Retrieves the investment summary for a user.
 */
app.get('/api/investments/summary', async (req, res) => {
  try {
    const userId = parseInt(req.query.userId, 10);
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const summary = await buildInvestmentSummary(userId);
    return res.json({ success: true, summary });
  } catch (err) {
    console.error('Investment summary error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Processes a new investment purchase.
 * Deducts funds from the user's wallet and updates their portfolio.
 */
app.post('/api/investments', async (req, res) => {
  try {
    const { userId, coinId, coinSymbol, coinName, amountUsd, duration } = req.body || {};
    const parsedUserId = parseInt(userId, 10);
    const numericAmount = parseFloat(amountUsd);
    const numericDuration = parseInt(duration, 10) || 30;
    
    if (!parsedUserId || !coinId || !coinSymbol || !coinName || isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: 'Valid userId, coinId, coinSymbol, coinName and positive amountUsd are required' });
    }

    console.log(`Processing investment: User ${parsedUserId}, Coin ${coinId}, Amount ${numericAmount}, Duration ${numericDuration}`);

    // Check if user has sufficient funds in their wallet
    const wallet = await getOrCreateWallet(parsedUserId);
    const available = Number(wallet.available_balance || 0);
    if (available < numericAmount) {
      return res.status(400).json({ error: 'Insufficient wallet balance' });
    }

    // Fetch the latest price (try API first, then fallback to cache)
    let livePrice = 0;
    try {
      const coins = await fetchCoinMarkets({ ids: coinId, per_page: 1, page: 1 });
      if (coins.length && coins[0].current_price) {
        livePrice = Number(coins[0].current_price);
        // Cache the price
        await upsertMarketPricesFromCoins(coins);
      }
    } catch (e) {
      console.warn('Live price fetch failed, trying cache:', e.message);
    }

    if (livePrice <= 0) {
      const [cacheRows] = await pool.query('SELECT price_usd FROM market_prices WHERE coin_id = ? LIMIT 1', [coinId]);
      if (cacheRows.length) {
        livePrice = Number(cacheRows[0].price_usd);
      }
    }

    if (livePrice <= 0) {
      return res.status(400).json({ error: 'Unable to determine price for selected coin. Please try again later.' });
    }

    const unitsToAdd = numericAmount / livePrice;

    try {
      // Update existing investment position or create a new one
      const [existingRows] = await pool.query(
        'SELECT * FROM investments WHERE user_id = ? AND coin_id = ? LIMIT 1',
        [parsedUserId, coinId]
      );

      if (!existingRows.length) {
        // New position
        await pool.query(
          'INSERT INTO investments (user_id, coin_id, coin_symbol, coin_name, units, avg_buy_price, invested_amount, duration) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [parsedUserId, coinId, coinSymbol, coinName, unitsToAdd, livePrice, numericAmount, numericDuration]
        );
      } else {
        // Update existing position (DCA - Dollar Cost Averaging)
        const inv = existingRows[0];
        const currentUnits = Number(inv.units || 0);
        const currentInvested = Number(inv.invested_amount || 0);
        const newUnits = currentUnits + unitsToAdd;
        const newInvested = currentInvested + numericAmount;
        const newAvgPrice = newUnits > 0 ? newInvested / newUnits : livePrice;

        await pool.query(
          'UPDATE investments SET units = ?, invested_amount = ?, avg_buy_price = ?, duration = ? WHERE id = ?',
          [newUnits, newInvested, newAvgPrice, numericDuration, inv.id]
        );
      }

      // Deduct the investment amount from the wallet
      await pool.query(
        'UPDATE wallet SET available_balance = available_balance - ? WHERE user_id = ?',
        [numericAmount, parsedUserId]
      );

      // Log the purchase as a transaction
      await pool.query(
        'INSERT INTO transactions (user_id, type, amount, fee, description) VALUES (?, ?, ?, ?, ?)',
        [parsedUserId, 'investment_buy', numericAmount, 0, `Buy ${coinSymbol.toUpperCase()}`]
      );
    } catch (dbErr) {
      console.error('Database Error in Investment Process:', dbErr);
      return res.status(500).json({ error: 'Database processing error. Please contact support.' });
    }

    const updatedWallet = await getOrCreateWallet(parsedUserId);
    const summary = await buildInvestmentSummary(parsedUserId);
    try { await addNotification(parsedUserId, 'investment_buy', `Purchased ${coinSymbol.toUpperCase()} for $${numericAmount.toFixed(2)}`); } catch (_) {}
    try {
      const email = await getUserEmail(parsedUserId);
      if (email) {
        const subject = `Investment Executed — ${coinSymbol.toUpperCase()}`;
        const html = `
          <div style="font-family: Inter, Arial, sans-serif; line-height:1.6;">
            <h2 style="color:#111827;">Investment Confirmation</h2>
            <p>You have successfully purchased <strong>${coinName}</strong> worth <strong>$${numericAmount.toFixed(2)}</strong>.</p>
            <p>Average Buy Price: <strong>$${livePrice.toFixed(4)}</strong></p>
            <p>Duration: <strong>${numericDuration} days</strong></p>
            <p style="color:#6b7280;font-size:12px;margin-top:16px;">This is an automated confirmation from NH Network.</p>
          </div>`;
        Promise.resolve().then(() => sendEmail(email, subject, html));
      }
    } catch (e) { console.error('[mail] investment email failed:', e && e.message ? e.message : e); }
    
    return res.json({
      success: true,
      wallet: mapWalletResponse(updatedWallet),
      summary
    });
  } catch (err) {
    console.error('Investment buy error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Endpoint: /api/investments/emergency-withdraw
 * Allows users to forcefully stop an investment early.
 * Deducts a 2% penalty fee from the current valuation.
 */
app.post('/api/investments/emergency-withdraw', async (req, res) => {
  try {
    const { userId, investmentId } = req.body || {};
    const parsedUserId = parseInt(userId, 10);
    const parsedInvId = parseInt(investmentId, 10);

    if (!parsedUserId || !parsedInvId) {
      return res.status(400).json({ error: 'Valid userId and investmentId are required' });
    }

    // 1. Fetch the investment details
    const [invRows] = await pool.query(
      'SELECT * FROM investments WHERE id = ? AND user_id = ? LIMIT 1',
      [parsedInvId, parsedUserId]
    );

    if (!invRows.length) {
      return res.status(404).json({ error: 'Active investment position not found' });
    }

    const inv = invRows[0];
    const units = Number(inv.units || 0);
    const coinId = inv.coin_id;

    // 2. Determine current market value
    let livePrice = 0;
    try {
      const coins = await fetchCoinMarkets({ ids: coinId, per_page: 1, page: 1 });
      if (coins.length && coins[0].current_price) {
        livePrice = Number(coins[0].current_price);
        await upsertMarketPricesFromCoins(coins);
      }
    } catch (e) {
      console.warn('Live price fetch failed for emergency withdraw, trying cache:', e.message);
    }

    if (livePrice <= 0) {
      const [cacheRows] = await pool.query('SELECT price_usd FROM market_prices WHERE coin_id = ? LIMIT 1', [coinId]);
      if (cacheRows.length) {
        livePrice = Number(cacheRows[0].price_usd);
      }
    }

    if (livePrice <= 0) {
      return res.status(400).json({ error: 'Unable to determine market price. Please try again later.' });
    }

    const currentValue = units * livePrice;
    
    // 3. Apply 2% penalty fee
    const penaltyFee = currentValue * 0.02;
    const netReturn = currentValue - penaltyFee;

    // 4. Transactional DB Updates
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // Return net amount to user wallet
      await connection.query(
        'UPDATE wallet SET available_balance = available_balance + ? WHERE user_id = ?',
        [netReturn, parsedUserId]
      );

      // Log as a transaction
      await connection.query(
        'INSERT INTO transactions (user_id, type, amount, fee, description) VALUES (?, ?, ?, ?, ?)',
        [parsedUserId, 'investment_sell', netReturn, penaltyFee, `Emergency Force Stop: ${inv.coin_name} (${inv.coin_symbol.toUpperCase()}) | Penalty: $${penaltyFee.toFixed(2)}`]
      );

      // Delete the investment position
      await connection.query(
        'DELETE FROM investments WHERE id = ?',
        [parsedInvId]
      );

      await connection.commit();
    } catch (dbErr) {
      await connection.rollback();
      throw dbErr;
    } finally {
      connection.release();
    }

    // 5. Finalize response
    try { await addNotification(parsedUserId, 'investment_sell', `Emergency Stop: ${inv.coin_name} closed. $${netReturn.toFixed(2)} returned to wallet.`); } catch (_) {}
    
    const updatedWallet = await getOrCreateWallet(parsedUserId);
    const summary = await buildInvestmentSummary(parsedUserId);

    return res.json({
      success: true,
      message: 'Investment forcefully stopped successfully',
      wallet: mapWalletResponse(updatedWallet),
      summary,
      returnedAmount: netReturn,
      penalty: penaltyFee
    });

  } catch (err) {
    console.error('Emergency withdraw error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ==========================================
//   STATIC PAGE ROUTES
// ==========================================
// These routes serve the corresponding HTML files from the public directory.

app.get(['/', '/index.html'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/learning.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'learning.html'));
});

app.get('/investment.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'investment.html'));
});

app.get('/dashboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/become-learner.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'become-learner.html'));
});

app.get('/become-investor.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'become-investor.html'));
});

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Friendly route for admin without .html extension
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Backward compatibility for old admin path
app.get('/admin-learner.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ==========================================
//   CERTIFICATE REQUEST ROUTES
// ==========================================

/**
 * Endpoint for users to apply for a course completion certificate.
 * Checks for existing requests to prevent duplicates unless previously rejected.
 */
app.post('/api/certificate/request', async (req, res) => {
  try {
    const { userId, courseId } = req.body;
    if (!userId || !courseId) {
      return res.status(400).json({ error: 'User ID and Course ID are required' });
    }

    // Check if a request already exists for this user and course
    const [existing] = await pool.query(
      'SELECT id, status FROM certificate_requests WHERE user_id = ? AND course_id = ?',
      [userId, courseId]
    );

    if (existing.length > 0) {
      // If the previous request was rejected, allow the user to resubmit it
      if (existing[0].status === 'Rejected') {
        await pool.query(
          'UPDATE certificate_requests SET status = "Pending", request_date = CURRENT_TIMESTAMP WHERE id = ?',
          [existing[0].id]
        );
        try { await addNotification(userId, 'certificate_request', `Your certificate request for ${courseId} has been sent for admin review.`); } catch (_) {}
        return res.json({ success: true, message: 'Your certificate request has been resubmitted.' });
      }
      return res.status(400).json({ error: 'Certificate request already submitted for this course.' });
    }

    // Insert a new certificate request
    await pool.query(
      'INSERT INTO certificate_requests (user_id, course_id) VALUES (?, ?)',
      [userId, courseId]
    );

    try { await addNotification(userId, 'certificate_request', `Your certificate request for ${courseId} has been sent for admin review.`); } catch (_) {}
    
    return res.json({ success: true, message: 'Your certificate request has been sent to admin for approval.' });
  } catch (err) {
    console.error('Certificate request error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Retrieves all certificate request statuses for a specific user.
 */
app.get('/api/certificate/status', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const [requests] = await pool.query(
      'SELECT course_id, status FROM certificate_requests WHERE user_id = ?',
      [userId]
    );
    return res.json({ success: true, requests });
  } catch (err) {
    console.error('Fetch certificate status error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Admin endpoint to fetch all pending and processed certificate requests.
 */
app.get('/api/admin/certificate-requests', async (req, res) => {
  try {
    const [requests] = await pool.query(`
      SELECT cr.*, u.full_name as userName, u.email as userEmail
      FROM certificate_requests cr
      JOIN users u ON cr.user_id = u.id
      ORDER BY cr.request_date DESC
    `);
    return res.json({ success: true, requests });
  } catch (err) {
    console.error('Fetch certificate requests error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Admin endpoint to approve a certificate request.
 */
app.post('/api/admin/certificate-requests/:requestId/approve', async (req, res) => {
  try {
    const { requestId } = req.params;
    const [request] = await pool.query('SELECT user_id, course_id FROM certificate_requests WHERE id = ?', [requestId]);
    
    if (request.length === 0) return res.status(404).json({ error: 'Request not found' });

    await pool.query('UPDATE certificate_requests SET status = "Approved" WHERE id = ?', [requestId]);
    
    try { 
      await addNotification(request[0].user_id, 'certificate_approved', `Great news! Your certificate for ${request[0].course_id} has been approved.`); 
    } catch (_) {}

    return res.json({ success: true, message: 'Request approved' });
  } catch (err) {
    console.error('Approve certificate error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Admin endpoint to reject a certificate request.
 */
app.post('/api/admin/certificate-requests/:requestId/reject', async (req, res) => {
  try {
    const { requestId } = req.params;
    const [request] = await pool.query('SELECT user_id, course_id FROM certificate_requests WHERE id = ?', [requestId]);

    if (request.length === 0) return res.status(404).json({ error: 'Request not found' });

    await pool.query('UPDATE certificate_requests SET status = "Rejected" WHERE id = ?', [requestId]);

    try { 
      await addNotification(request[0].user_id, 'certificate_rejected', `Your certificate request for ${request[0].course_id} was not approved. Please check your email for details.`); 
    } catch (_) {}

    return res.json({ success: true, message: 'Request rejected' });
  } catch (err) {
    console.error('Reject certificate error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Admin endpoint to permanently delete a certificate request.
 */
app.delete('/api/admin/certificate-requests/:requestId', async (req, res) => {
  try {
    const { requestId } = req.params;
    await pool.query('DELETE FROM certificate_requests WHERE id = ?', [requestId]);
    return res.json({ success: true, message: 'Certificate request deleted' });
  } catch (err) {
    console.error('Delete certificate request error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Admin endpoint to view detailed learning progress for a specific user.
 * Parses the JSON learning state to provide a human-readable summary.
 */
app.get('/api/admin/users/:userId/learning', async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get basic user identification
    const [userRows] = await pool.query('SELECT id, full_name, email FROM users WHERE id = ?', [userId]);
    if (userRows.length === 0) return res.status(404).json({ error: 'User not found' });

    // Retrieve the user's stored learning state (JSON)
    const [stateRows] = await pool.query('SELECT state_json FROM user_learning_state WHERE user_id = ?', [userId]);
    
    const learningData = {
      user: userRows[0],
      courses: []
    };

    if (stateRows.length > 0) {
      let state = {};
      const raw = stateRows[0].state_json;
      // Handle potential double-stringification or object formats
      if (typeof raw === 'string') {
        try { state = JSON.parse(raw); } catch (_) {}
      } else {
        state = raw || {};
      }

      // Map course progress from JSON state into a structured array
      if (state.courses) {
        learningData.courses = Object.keys(state.courses).map(courseId => {
          const c = state.courses[courseId];
          return {
            courseId,
            progress: c.progress || 0,
            status: c.completed ? 'Completed' : 'In-Progress',
            enrolledAt: c.enrolledAt
          };
        });
      }
    }

    return res.json({ success: true, learningData });
  } catch (err) {
    console.error('Fetch user learning error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ==========================================
//   FILE UPLOAD CONFIGURATION (Multer)
// ==========================================

/**
 * Configure storage for uploaded files.
 * Files are stored in the 'uploads' directory with a unique timestamped filename.
 */
const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, path.join(__dirname, 'uploads')); },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname || '');
    // Clean filename of special characters
    const base = path.basename(file.originalname || 'upload', ext).replace(/[^a-zA-Z0-9_-]/g, '') || 'file';
    cb(null, `${Date.now()}_${base}${ext}`);
  }
});
const upload = multer({ storage });

/**
 * Handles profile avatar uploads.
 */
app.post('/api/user/profile/avatar', upload.single('avatar'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    const url = `/uploads/${file.filename}`;
    const userId = parseInt(req.query.userId, 10);
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    
    // Update the user's avatar URL in the profile table
    await pool.query('UPDATE user_profiles SET avatar_url = ? WHERE user_id = ?', [url, userId]);
    try { await addNotification(userId, 'avatar_upload', 'Avatar uploaded'); } catch (_) {}
    
    return res.json({ success: true, avatarUrl: url });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Handles KYC document uploads for identity verification.
 */
app.post('/api/user/kyc/upload', upload.single('kycDoc'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    const url = `/uploads/${file.filename}`;
    const userId = parseInt(req.query.userId, 10);
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    
    // Update KYC document URL and set status to 'pending'
    await pool.query('UPDATE user_profiles SET kyc_document_url = ?, kyc_status = ? WHERE user_id = ?', [url, 'pending', userId]);
    try { await addNotification(userId, 'kyc_upload', 'KYC document uploaded'); } catch (_) {}
    
    return res.json({ success: true, kycStatus: 'pending', documentUrl: url });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// ==========================================
//   LEARNER REQUEST ROUTES
// ==========================================

/**
 * Checks the status of the user's latest learner request.
 */
app.get('/api/learner/request/status', async (req, res) => {
  try {
    const userId = parseInt(req.query.userId, 10);
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const [rows] = await pool.query(
      'SELECT * FROM learner_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
      [userId]
    );
    if (!rows.length) return res.json({ success: true, status: null, request: null });
    
    const reqRow = rows[0];
    const raw = String(reqRow.status || 'pending');
    // Normalize legacy status names
    const normalized = raw === 'accepted' ? 'approved' : (raw === 'rejected' ? 'not_approved' : raw);
    
    return res.json({ success: true, status: normalized, request: { ...reqRow, status: normalized } });
  } catch (err) {
    console.error('Learner status error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ==========================================
//   INVESTOR REQUEST ROUTES
// ==========================================

/**
 * Checks the status of the user's latest investor request.
 * Also retrieves any feedback messages from the admin.
 */
app.get('/api/investor/request/status', async (req, res) => {
  try {
    const userId = parseInt(req.query.userId, 10);
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const [rows] = await pool.query('SELECT * FROM investor_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [userId]);
    if (!rows.length) return res.json({ success: true, status: null, request: null });
    
    const reqRow = rows[0];
    const normalized = String(reqRow.status || 'pending');
    
    // Fetch the latest admin message if the request was processed
    let adminMessage = null;
    if (normalized === 'approved' || normalized === 'not_approved') {
      const [msgRows] = await pool.query(
        'SELECT message FROM investor_messages WHERE user_id = ? AND request_id = ? AND type = ? ORDER BY created_at DESC LIMIT 1',
        [userId, reqRow.id, normalized]
      );
      if (msgRows.length) {
        adminMessage = msgRows[0].message;
      }
    }
    
    return res.json({ success: true, status: normalized, request: reqRow, message: adminMessage });
  } catch (err) {
    console.error('Investor status error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Utility to save a base64 encoded image to the 'uploads' directory.
 * @param {string} dataUrl - Base64 data URL
 * @returns {string|null} - The relative URL of the saved file or null on failure
 */
function saveBase64Image(dataUrl) {
  try {
    const match = String(dataUrl || '').match(/^data:(image\/(png|jpeg|jpg));base64,(.+)$/);
    if (!match) return null;
    const ext = match[2] === 'jpeg' || match[2] === 'jpg' ? '.jpg' : '.png';
    const buffer = Buffer.from(match[3], 'base64');
    const filename = `${Date.now()}_selfie${ext}`;
    const fullPath = path.join(__dirname, 'uploads', filename);
    fs.writeFileSync(fullPath, buffer);
    return `/uploads/${filename}`;
  } catch (_) {
    return null;
  }
}

/**
 * Processes a new investor request.
 * Handles multiple file uploads (avatar, CNIC front/back, verification video).
 * Also supports a base64 selfie image from a webcam.
 */
app.post('/api/investor/request', upload.fields([
  { name: 'avatar', maxCount: 1 },
  { name: 'cnicFront', maxCount: 1 },
  { name: 'cnicBack', maxCount: 1 },
  { name: 'verificationVideo', maxCount: 1 }
]), async (req, res) => {
  try {
    const userId = parseInt((req.body.userId || req.query.userId), 10);
    const fullName = (req.body.fullName || '').trim();
    const email = (req.body.email || '').trim();
    const phone = (req.body.phone || '').trim() || null;
    const countryCode = (req.body.countryCode || '').trim() || '+92';
    const cnic = (req.body.cnic || '').trim() || null;
    const dobStr = (req.body.dob || '').trim() || null;
    const address = (req.body.address || '').trim() || null;
    const selfieBase64 = req.body.selfieBase64 || null;

    if (!userId || !fullName || !email || !cnic || !dobStr || !address) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Normalize and validate phone number
    let normalizedPhone = null;
    if (phone) {
      if (!/^\d+$/.test(phone.replace(/\s|-/g, ''))) {
        return res.status(400).json({ error: 'Invalid phone format' });
      }
      normalizedPhone = normalizePhoneNumber(countryCode + phone);
    }

    // Validate date of birth
    let dob = null;
    try { dob = new Date(dobStr); if (isNaN(dob.getTime())) dob = null; } catch (_) {}
    if (!dob) return res.status(400).json({ error: 'Invalid date of birth' });

    // Prevent submitting multiple requests if one is already pending or approved
    const [existing] = await pool.query(
      "SELECT id, status FROM investor_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
      [userId]
    );
    if (existing.length && (existing[0].status === 'pending' || existing[0].status === 'approved')) {
      return res.status(409).json({ error: 'Existing investor request in progress or already approved' });
    }

    // Get username to create a dedicated folder for the investor's documents
    const [userRows] = await pool.query('SELECT username FROM users WHERE id = ? LIMIT 1', [userId]);
    const username = (userRows.length && userRows[0].username) ? userRows[0].username : `user_${userId}`;

    // Create a user-specific folder for security and organization
    const userFolder = path.join(__dirname, 'uploads', 'investors', username);
    if (!fs.existsSync(userFolder)) {
      fs.mkdirSync(userFolder, { recursive: true });
    }

    // Move uploaded files from the temporary 'uploads' folder to the user-specific folder
    const files = req.files || {};
    let avatarUrl = null;
    let cnicFrontUrl = null;
    let cnicBackUrl = null;
    let videoUrl = null;

    if (files.avatar && files.avatar[0]) {
      const oldPath = files.avatar[0].path;
      const newPath = path.join(userFolder, 'avatar_' + files.avatar[0].filename);
      fs.renameSync(oldPath, newPath);
      avatarUrl = `/uploads/investors/${username}/avatar_${files.avatar[0].filename}`;
    }

    if (files.cnicFront && files.cnicFront[0]) {
      const oldPath = files.cnicFront[0].path;
      const newPath = path.join(userFolder, 'id_front_' + files.cnicFront[0].filename);
      fs.renameSync(oldPath, newPath);
      cnicFrontUrl = `/uploads/investors/${username}/id_front_${files.cnicFront[0].filename}`;
    }

    if (files.cnicBack && files.cnicBack[0]) {
      const oldPath = files.cnicBack[0].path;
      const newPath = path.join(userFolder, 'id_back_' + files.cnicBack[0].filename);
      fs.renameSync(oldPath, newPath);
      cnicBackUrl = `/uploads/investors/${username}/id_back_${files.cnicBack[0].filename}`;
    }

    if (files.verificationVideo && files.verificationVideo[0]) {
      const oldPath = files.verificationVideo[0].path;
      const newPath = path.join(userFolder, 'verification_' + files.verificationVideo[0].filename);
      fs.renameSync(oldPath, newPath);
      videoUrl = `/uploads/investors/${username}/verification_${files.verificationVideo[0].filename}`;
    }

    // Save selfie from base64 if provided (webcam capture)
    let selfieUrl = null;
    if (selfieBase64) {
      try {
        const match = String(selfieBase64 || '').match(/^data:(image\/(png|jpeg|jpg));base64,(.+)$/);
        if (match) {
          const ext = match[2] === 'jpeg' || match[2] === 'jpg' ? '.jpg' : '.png';
          const buffer = Buffer.from(match[3], 'base64');
          const filename = `selfie_${Date.now()}${ext}`;
          const filePath = path.join(userFolder, filename);
          fs.writeFileSync(filePath, buffer);
          selfieUrl = `/uploads/investors/${username}/${filename}`;
        }
      } catch (_) {}
    }

    // Synchronize the name and email into the main 'users' table
    await pool.query('UPDATE users SET full_name = ?, email = ? WHERE id = ?', [fullName, email, userId]);

    // Create the investor request record
    await pool.query(
      `INSERT INTO investor_requests (user_id, full_name, email, username, phone, country_code, cnic, dob, address, avatar_url, cnic_front_url, cnic_back_url, selfie_url, video_url, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [userId, fullName, email, username, normalizedPhone, countryCode, cnic, dobStr, address, avatarUrl, cnicFrontUrl, cnicBackUrl, selfieUrl, videoUrl]
    );

    // Notify the user that their request has been received
    try { await addNotification(userId, 'investor_form_submitted', 'Your investor application has been submitted for review.'); } catch (_) {}

    // Send a confirmation email
    try {
      if (email) {
        const subject = 'NH Network — Your Investor Request Has Been Received';
        const html = `
          <div style="font-family: Inter, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; line-height:1.7; color:#0f1419;">
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
              <tr><td style="padding:20px 24px;"><div style="font-weight:800;letter-spacing:0.5px;color:#111827;">NH Network</div></td></tr>
              <tr>
                <td style="padding:0 24px 16px 24px;">
                  <p style="margin:0 0 8px 0;color:#111827;">Dear ${fullName || 'Investor'},</p>
                  <p style="margin:0 0 12px 0;color:#374151;">We have received your investor verification request.</p>
                  <p style="margin:0 0 12px 0;color:#374151;">Our team will review your submission shortly and notify you once approved or if more information is needed.</p>
                </td>
              </tr>
            </table>
          </div>`;
        Promise.resolve().then(() => sendEmail(email, subject, html));
      }
    } catch (_) {}

    // Send a confirmation SMS
    if (normalizedPhone) {
      const smsText = 'NH Network: We received your investor request. We will notify you upon review.';
      Promise.resolve().then(() => sendSMS(normalizedPhone, smsText)).catch(() => {});
    }

    return res.json({ success: true, message: 'Investor request submitted' });
  } catch (err) {
    console.error('Investor request submit error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Retrieves the latest admin message for an investor request.
 */
app.get('/api/investor/message', async (req, res) => {
  try {
    const userId = parseInt(req.query.userId, 10);
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const [reqRows] = await pool.query('SELECT id FROM investor_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [userId]);
    const currentRequestId = reqRows.length ? reqRows[0].id : null;
    if (!currentRequestId) return res.json({ success: true, message: null });
    const [rows] = await pool.query('SELECT * FROM investor_messages WHERE user_id = ? AND request_id = ? AND read_flag = 0 ORDER BY created_at DESC LIMIT 1', [userId, currentRequestId]);
    if (!rows.length) return res.json({ success: true, message: null });
    const m = rows[0];
    return res.json({ success: true, message: { id: m.id, type: m.type, text: m.message, requestId: m.request_id, createdAt: m.created_at } });
  } catch (err) {
    console.error('Investor message fetch error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Marks an investor feedback message as read.
 */
app.post('/api/investor/message/read', async (req, res) => {
  try {
    const id = parseInt(req.body && req.body.id, 10);
    const userId = parseInt(req.body && req.body.userId, 10);
    if (!id || !userId) return res.status(400).json({ error: 'id and userId are required' });
    await pool.query('UPDATE investor_messages SET read_flag = 1 WHERE id = ? AND user_id = ?', [id, userId]);
    return res.json({ success: true });
  } catch (err) {
    console.error('Investor message read error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ==========================================
//   ADMIN: INVESTOR REQUEST MANAGEMENT
// ==========================================

/**
 * Admin endpoint to list all investor requests.
 * Supports filtering by status, name, email, phone, and CNIC.
 */
app.get('/api/admin/investor/requests', async (req, res) => {
  try {
    const status = String(req.query.status || '').trim();
    const filterBy = String(req.query.filterBy || '').trim();
    const q = String(req.query.q || '').trim();
    let sql = 'SELECT ir.*, u.username FROM investor_requests ir JOIN users u ON u.id = ir.user_id';
    const params = [];
    const where = [];
    
    // Filter by status (pending, approved, not_approved)
    if (status) {
      if (['approved','not_approved','pending'].includes(status)) {
        where.push('ir.status = ?');
        params.push(status);
      }
    }
    
    // Search by specific fields
    if (q && filterBy) {
      const map = { name: 'ir.full_name', email: 'ir.email', phone: 'ir.phone', cnic: 'ir.cnic' };
      const col = map[filterBy] || null;
      if (col) { where.push(`${col} LIKE ?`); params.push(`%${q}%`); }
    }
    
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY ir.created_at DESC';
    
    const [rows] = await pool.query(sql, params);
    return res.json({ success: true, requests: rows });
  } catch (err) {
    console.error('Investor requests list error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Admin endpoint to approve an investor request.
 * Updates the status, sends an approval message, notification, email, and SMS.
 */
app.post('/api/admin/investor/requests/:id/approve', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const message = (req.body && req.body.message) ? String(req.body.message) : '';
    if (!id) return res.status(400).json({ error: 'id is required' });
    
    const [rows] = await pool.query('SELECT user_id, full_name, email, phone FROM investor_requests WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Request not found' });
    
    const userId = rows[0].user_id;
    const name = rows[0].full_name || 'Investor';
    const email = rows[0].email || '';
    const phone = rows[0].phone || '';
    
    // Update request status
    await pool.query('UPDATE investor_requests SET status = ? WHERE id = ?', ['approved', id]);
    // Clear old messages and insert a new approval message
    await pool.query('UPDATE investor_messages SET read_flag = 1 WHERE user_id = ? AND request_id = ?', [userId, id]);
    await pool.query('INSERT INTO investor_messages (user_id, request_id, type, message) VALUES (?, ?, ?, ?)', [userId, id, 'approved', message || 'Your investor request has been approved.']);
    
    try { await addNotification(userId, 'investor_form_approved', message || 'Congratulations! Your investor application has been approved.'); } catch (_) {}
    
    let emailSent = false; let smsSent = false;
    // Send approval email
    if (email) {
      const subject = 'NH Network — Your Investor Access Has Been Approved';
      const html = `
        <div style="font-family: Inter, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; line-height:1.7; color:#0f1419;">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
            <tr><td style="padding:20px 24px;"><div style="font-weight:800;letter-spacing:0.5px;color:#111827;">NH Network</div></td></tr>
            <tr>
              <td style="padding:0 24px 16px 24px;">
                <p style="margin:0 0 8px 0;color:#111827;">Dear ${name},</p>
                <p style="margin:0 0 12px 0;color:#374151;">Your investor access request has been approved.</p>
                <p style="margin:12px 0 8px 0;color:#374151;">Message from Admin:</p>
                <blockquote style="border-left:4px solid #3b82f6; padding-left:12px; color:#333; margin:0 0 16px 0;">${message || 'You can now start investing.'}</blockquote>
                <div style="margin:24px 0;">
                  <a href="${getInvestmentUrl(req)}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#3b82f6;color:#ffffff;text-decoration:none;font-weight:600;box-shadow:0 6px 20px rgba(59,130,246,0.4);">Open Investment</a>
                </div>
              </td>
            </tr>
          </table>
        </div>`;
      const result = await sendEmail(email, subject, html); emailSent = result.ok;
    }
    // Send approval SMS
    if (phone) {
      const smsText = `NH Network: Your investor access is approved. ${message || 'You can now start investing.'} Start here: ${getInvestmentUrl(req)}`;
      Promise.resolve().then(() => sendSMS(phone, smsText)).then((r) => { if (r && r.ok) smsSent = true; }).catch(() => {});
    }
    return res.json({ success: true, emailSent, smsSent });
  } catch (err) {
    console.error('Investor approve error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Admin endpoint to reject an investor request.
 */
app.post('/api/admin/investor/requests/:id/not-approve', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const message = (req.body && req.body.message) ? String(req.body.message) : '';
    if (!id) return res.status(400).json({ error: 'id is required' });
    
    const [rows] = await pool.query('SELECT user_id, full_name, email, phone FROM investor_requests WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Request not found' });
    
    const userId = rows[0].user_id; const name = rows[0].full_name || 'Investor'; const email = rows[0].email || ''; const phone = rows[0].phone || '';
    
    await pool.query('UPDATE investor_requests SET status = ? WHERE id = ?', ['not_approved', id]);
    await pool.query('UPDATE investor_messages SET read_flag = 1 WHERE user_id = ? AND request_id = ?', [userId, id]);
    await pool.query('INSERT INTO investor_messages (user_id, request_id, type, message) VALUES (?, ?, ?, ?)', [userId, id, 'not_approved', message || 'Your investor request was not approved.']);
    
    try { await addNotification(userId, 'investor_form_not_approved', message || 'Your investor application was not approved. Please check your email for details.'); } catch (_) {}
    
    let emailSent = false; let smsSent = false;
    // Send rejection email
    if (email) {
      const subject = 'NH Network — Update on Your Investor Access Request';
      const html = `
        <div style="font-family: Inter, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; line-height:1.7; color:#0f1419;">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
            <tr><td style="padding:20px 24px;"><div style="font-weight:800;letter-spacing:0.5px;color:#111827;">NH Network</div></td></tr>
            <tr>
              <td style="padding:0 24px 16px 24px;">
                <p style="margin:0 0 8px 0;color:#111827;">Dear ${name},</p>
                <p style="margin:0 0 12px 0;color:#374151;">After review, your investor access request was not approved at this time.</p>
                <p style="margin:12px 0 8px 0;color:#374151;">Message from Admin:</p>
                <blockquote style="border-left:4px solid #ef4444; padding-left:12px; color:#333; margin:0 0 16px 0;">${message || 'You may reapply in the future.'}</blockquote>
              </td>
            </tr>
          </table>
        </div>`;
      const result = await sendEmail(email, subject, html); emailSent = result.ok;
    }
    // Send rejection SMS
    if (phone) {
      const smsText = `NH Network: Your investor request was not approved. ${message || ''}`;
      Promise.resolve().then(() => sendSMS(phone, smsText)).then((r) => { if (r && r.ok) smsSent = true; }).catch(() => {});
    }
    return res.json({ success: true, emailSent, smsSent });
  } catch (err) {
    console.error('Investor not-approve error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Admin endpoint to delete an investor request and all associated messages and notifications.
 */
app.delete('/api/admin/investor/requests/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) { conn.release(); return res.status(400).json({ error: 'id is required' }); }
    
    // Use a transaction to ensure atomic deletion of the request and its related data
    await conn.beginTransaction();
    const [reqRows] = await conn.query('SELECT user_id FROM investor_requests WHERE id = ? LIMIT 1', [id]);
    const userId = reqRows.length ? reqRows[0].user_id : null;
    
    await conn.query('DELETE FROM investor_messages WHERE request_id = ?', [id]);
    if (userId) {
      await conn.query('DELETE FROM user_notifications WHERE user_id = ? AND activity_type IN (?, ?, ?)', [userId, 'investor_form_submitted', 'investor_form_approved', 'investor_form_not_approved']);
    }
    await conn.query('DELETE FROM investor_requests WHERE id = ?', [id]);
    
    await conn.commit();
    conn.release();
    return res.json({ success: true });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    conn.release();
    console.error('Investor request delete error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Admin endpoint to download all verification documents for an investor as a ZIP file.
 */
app.get('/api/admin/investor/requests/:id/download-zip', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'id is required' });
    
    const [rows] = await pool.query('SELECT * FROM investor_requests WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Request not found' });
    
    const investor = rows[0];
    const username = investor.username || `user_${investor.user_id}`;
    const userFolder = path.join(__dirname, 'uploads', 'investors', username);
    
    if (!fs.existsSync(userFolder)) {
      return res.status(404).json({ error: 'User folder not found' });
    }
    
    // Set response headers for direct download
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${username}_investor_data.zip"`);
    
    // Create the ZIP archive
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);
    
    // Add user metadata as a JSON file inside the ZIP
    const userInfo = {
      fullName: investor.full_name,
      email: investor.email,
      username: investor.username,
      phone: investor.phone,
      countryCode: investor.country_code,
      cnic: investor.cnic,
      dob: investor.dob,
      address: investor.address,
      status: investor.status,
      createdAt: investor.created_at,
      updatedAt: investor.updated_at
    };
    archive.append(JSON.stringify(userInfo, null, 2), { name: 'user_info.json' });
    
    // Add all verification files from the user's dedicated folder
    archive.directory(userFolder, false);
    
    // Finalize the archive and send it
    await archive.finalize();
  } catch (err) {
    console.error('Download ZIP error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Handles temporary image uploads for learner requests.
 */
app.post('/api/learner/request/image-temp', upload.single('image'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({ error: 'Invalid image format. Please upload JPG, JPEG, or PNG files only.' });
    }
    if (file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'Image size must be less than 5MB.' });
    }
    const url = `/uploads/${file.filename}`;
    return res.json({ success: true, tempImageUrl: url });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Processes a new learner request.
 * Synchronizes user profile data and notifies the user upon submission.
 */
app.post('/api/learner/request', upload.single('image'), async (req, res) => {
  try {
    const userId = parseInt((req.body.userId || req.query.userId), 10);
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim();
    const username = (req.body.username || '').trim() || null;
    const phone = (req.body.phone || '').trim() || null;
    const countryCode = (req.body.countryCode || '').trim() || '+92';
    const course = (req.body.course || '').trim();
    const education = (req.body.educationLevel || '').trim();
    const imageUrlInput = (req.body.imageUrl || req.query.imageUrl || '').trim() || null;

    if (!userId || !name || !email || !course || !education) {
      return res.status(400).json({ error: 'userId, name, email, course and educationLevel are required' });
    }

    // Validate phone number format
    if (phone && !/^\d+$/.test(phone.replace(/\s|-/g, ''))) {
      return res.status(400).json({ error: 'Invalid phone number format. Please enter digits only.' });
    }

    const file = req.file || null;
    if (file) {
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png'];
      if (!allowedTypes.includes(file.mimetype)) {
        return res.status(400).json({ error: 'Invalid image format. Please upload JPG, JPEG, or PNG files only.' });
      }
      if (file.size > 5 * 1024 * 1024) {
        return res.status(400).json({ error: 'Image size must be less than 5MB.' });
      }
    }

    // Check for existing pending or approved requests
    const [existing] = await pool.query(
      "SELECT id, status FROM learner_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
      [userId]
    );
    if (existing.length && (existing[0].status === 'pending' || existing[0].status === 'accepted' || existing[0].status === 'approved')) {
      return res.status(409).json({ error: 'Existing request in progress or already approved' });
    }

    let imageUrl = null;
    if (file) {
      imageUrl = `/uploads/${file.filename}`;
    } else if (imageUrlInput) {
      if (!imageUrlInput.startsWith('/uploads/')) {
        return res.status(400).json({ error: 'Invalid imageUrl' });
      }
      imageUrl = imageUrlInput;
    }

    // Synchronize basic user info
    if (name) { await pool.query('UPDATE users SET full_name = ? WHERE id = ?', [name, userId]); }
    if (email) { await pool.query('UPDATE users SET email = ? WHERE id = ?', [email, userId]); }
    if (username) { await pool.query('UPDATE users SET username = ? WHERE id = ?', [username, userId]); }

    // Normalize phone number for consistent storage
    const fullPhone = phone ? normalizePhoneNumber(countryCode + phone) : null;

    // Insert learner request record
    await pool.query(
      `INSERT INTO learner_requests (user_id, name, email, username, phone, country_code, course, education_level, image_url, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [userId, name, email, username, fullPhone, countryCode, course, education, imageUrl]
    );

    // Sync phone number into 'user_profiles'
    if (fullPhone) {
      await pool.query(
        'INSERT INTO user_profiles (user_id, phone) VALUES (?, ?) ON DUPLICATE KEY UPDATE phone = VALUES(phone)',
        [userId, fullPhone]
      );
    }

    try { await addNotification(userId, 'form_submitted', 'Your learner application has been submitted for review.'); } catch (_) {}

    // Send confirmation email
    try {
      if (email) {
        const subject = 'NH Network — Your Learner Request Has Been Received';
        const html = `
          <div style="font-family: Inter, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; line-height:1.7; color:#0f1419;">
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
              <tr><td style="padding:20px 24px;"><div style="font-weight:800;letter-spacing:0.5px;color:#111827;">NH Network</div></td></tr>
              <tr>
                <td style="padding:0 24px 16px 24px;">
                  <p style="margin:0 0 8px 0;color:#111827;">Dear ${name || 'Learner'},</p>
                  <p style="margin:0 0 12px 0;color:#374151;">We have received your request for learner access.</p>
                  <p style="margin:0 0 12px 0;color:#374151;">Our team will review your submission shortly. You will be notified by email and SMS as soon as a decision is made.</p>
                  <p style="margin:0 0 12px 0;color:#374151;">Thank you for choosing NH Network to support your learning journey.</p>
                  <p style="margin:16px 0 0 0;color:#6b7280;font-size:12px;">For assistance, contact <a href="mailto:devolper.expert@gmail.com" style="color:#3b82f6;text-decoration:none;">devolper.expert@gmail.com</a>. This is an official communication from NH Network.</p>
                </td>
              </tr>
            </table>
          </div>`;
        Promise.resolve().then(() => sendEmail(email, subject, html)).then((r) => {
          if (!r || !r.ok) console.error('[mail] Learner submit email failed for', email);
        }).catch((err) => {
          console.error('[mail] Learner submit email error:', err && err.message ? err.message : err);
        });
      }
    } catch (_) {}

    // Send confirmation SMS
    if (fullPhone) {
      const smsText = `NH Network: We received your learner access request. Our team will review it shortly and notify you of the decision. Questions? Email devolper.expert@gmail.com.`;
      Promise.resolve().then(() => sendSMS(fullPhone, smsText)).then((r) => {
        if (!r || !r.ok) console.error('[sms] Learner submit SMS failed:', r && r.error ? r.error : 'Unknown error');
      }).catch((err) => {
        console.error('[sms] Learner submit SMS error:', err && err.message ? err.message : err);
      });
    }

    return res.json({ success: true, message: 'Request submitted' });
  } catch (err) {
    console.error('Learner request submit error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Admin endpoint to list all learner requests with filtering.
 */
app.get('/api/admin/learner/requests', async (req, res) => {
  try {
    const status = String(req.query.status || '').trim();
    const filterBy = String(req.query.filterBy || '').trim();
    const q = String(req.query.q || '').trim();
    let sql = 'SELECT lr.*, u.full_name AS user_full_name FROM learner_requests lr JOIN users u ON u.id = lr.user_id';
    const params = [];
    const where = [];
    
    // Filter by status
    if (status) {
      if (['approved','not_approved','pending'].includes(status)) {
        where.push('lr.status = ?');
        params.push(status === 'approved' ? 'approved' : (status === 'not_approved' ? 'not_approved' : 'pending'));
      }
    }
    
    // Search by name, email, or username
    if (q && filterBy) {
      const map = { name: 'lr.name', email: 'lr.email', username: 'lr.username' };
      const col = map[filterBy] || null;
      if (col) {
        where.push(`${col} LIKE ?`);
        params.push(`%${q}%`);
      }
    }
    
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY lr.created_at DESC';
    const [rows] = await pool.query(sql, params);
    return res.json({ success: true, requests: rows });
  } catch (err) {
    console.error('Learner requests list error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Admin endpoint to get details of a specific learner request.
 */
app.get('/api/admin/learner/requests/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'id is required' });
    const [rows] = await pool.query('SELECT lr.*, u.full_name AS user_full_name FROM learner_requests lr JOIN users u ON u.id = lr.user_id WHERE lr.id = ? LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    return res.json({ success: true, request: rows[0] });
  } catch (err) {
    console.error('Learner request detail error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Admin endpoint to approve a learner request.
 * Updates status, sends approval message, notification, email, and SMS.
 */
app.post('/api/admin/learner/requests/:id/approve', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const message = (req.body && req.body.message) ? String(req.body.message) : '';
    if (!id) return res.status(400).json({ error: 'id is required' });
    
    const [rows] = await pool.query('SELECT user_id, name, email, phone, country_code FROM learner_requests WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Request not found' });
    
    const userId = rows[0].user_id;
    const name = rows[0].name || 'Learner';
    const email = rows[0].email || '';
    const phone = rows[0].phone || '';
    
    await pool.query('UPDATE learner_requests SET status = ? WHERE id = ?', ['approved', id]);
    // Mark previous feedback messages as read and add a new approval message
    await pool.query('UPDATE learner_messages SET read_flag = 1 WHERE user_id = ? AND request_id = ?', [userId, id]);
    await pool.query('INSERT INTO learner_messages (user_id, request_id, type, message) VALUES (?, ?, ?, ?)', [userId, id, 'approved', message || 'Your learner request has been approved successfully.']);
    
    try { await addNotification(userId, 'form_approved', message || 'Great news! Your learner application has been approved.'); } catch (_) {}
    
    let emailSent = false;
    let smsSent = false;
    // Send approval email
    if (email) {
      const subject = 'NH Network — Your Learner Access Has Been Approved';
      const html = `
        <div style="font-family: Inter, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; line-height:1.7; color:#0f1419;">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
            <tr><td style="padding:20px 24px;"><div style="font-weight:800;letter-spacing:0.5px;color:#111827;">NH Network</div></td></tr>
            <tr>
              <td style="padding:0 24px 16px 24px;">
                <p style="margin:0 0 8px 0;color:#111827;">Dear ${name},</p>
                <p style="margin:0 0 12px 0;color:#374151;">We are pleased to inform you that your learner access request has been approved.</p>
                <p style="margin:0 0 12px 0;color:#374151;">You can now sign in and begin your learning journey on NH Network.</p>
                <p style="margin:12px 0 8px 0;color:#374151;">Message from Admin:</p>
                <blockquote style="border-left:4px solid #3b82f6; padding-left:12px; color:#333; margin:0 0 16px 0;">${message || 'Your learner request has been approved successfully.'}</blockquote>
                <div style="margin:24px 0;">
                  <a href="${getLearningUrl(req)}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#3b82f6;color:#ffffff;text-decoration:none;font-weight:600;box-shadow:0 6px 20px rgba(59,130,246,0.4);">Start Learning</a>
                </div>
                <p style="margin:16px 0 0 0;color:#6b7280;font-size:12px;">For assistance, contact <a href="mailto:devolper.expert@gmail.com" style="color:#3b82f6;text-decoration:none;">devolper.expert@gmail.com</a>. This is an official communication from NH Network.</p>
              </td>
            </tr>
          </table>
        </div>`;
      const result = await sendEmail(email, subject, html);
      if (!result.ok) console.error('[mail] Approve email failed');
      emailSent = result.ok;
    }
    // Send approval SMS
    if (phone) {
      const smsText = `NH Network: Your learner access is approved. ${message || 'You can now begin your learning journey.'} Start here: ${getLearningUrl(req)}`;
      Promise.resolve().then(() => sendSMS(phone, smsText)).then((r) => {
        if (!r || !r.ok) {
          console.error('[sms] Approve SMS failed:', r && r.error ? r.error : 'Unknown error');
        } else {
          smsSent = true;
        }
      }).catch((err) => {
        console.error('[sms] Approve SMS error:', err && err.message ? err.message : err);
      });
    }
    return res.json({ success: true, emailSent, smsSent });
  } catch (err) {
    console.error('Learner request approve error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Admin endpoint to reject a learner request.
 */
app.post('/api/admin/learner/requests/:id/not-approve', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const message = (req.body && req.body.message) ? String(req.body.message) : '';
    if (!id) return res.status(400).json({ error: 'id is required' });
    
    const [rows] = await pool.query('SELECT user_id, name, email, phone, country_code FROM learner_requests WHERE id = ? LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Request not found' });
    
    const userId = rows[0].user_id;
    const name = rows[0].name || 'Learner';
    const email = rows[0].email || '';
    const phone = rows[0].phone || '';
    
    await pool.query('UPDATE learner_requests SET status = ? WHERE id = ?', ['not_approved', id]);
    await pool.query('UPDATE learner_messages SET read_flag = 1 WHERE user_id = ? AND request_id = ?', [userId, id]);
    await pool.query('INSERT INTO learner_messages (user_id, request_id, type, message) VALUES (?, ?, ?, ?)', [userId, id, 'not_approved', message || 'Your request was not approved.']);
    
    try { await addNotification(userId, 'form_not_approved', message || 'Your learner application was not approved. Please check your email for details.'); } catch (_) {}
    
    let emailSent = false;
    let smsSent = false;
    // Send rejection email
    if (email) {
      const subject = 'NH Network — Update on Your Learner Access Request';
      const html = `
        <div style="font-family: Inter, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; line-height:1.7; color:#0f1419;">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
            <tr><td style="padding:20px 24px;"><div style="font-weight:800;letter-spacing:0.5px;color:#111827;">NH Network</div></td></tr>
            <tr>
              <td style="padding:0 24px 16px 24px;">
                <p style="margin:0 0 8px 0;color:#111827;">Dear ${name},</p>
                <p style="margin:0 0 12px 0;color:#374151;">Thank you for your interest in NH Network. After careful review, your learner access request was not approved at this time.</p>
                <p style="margin:12px 0 8px 0;color:#374151;">Message from Admin:</p>
                <blockquote style="border-left:4px solid #ef4444; padding-left:12px; color:#333; margin:0 0 16px 0;">${message || 'You are welcome to reapply in the future.'}</blockquote>
                <p style="margin:0 0 12px 0;color:#374151;">We encourage you to refine your application and reapply. Our support team is available if you need guidance.</p>
                <p style="margin:16px 0 0 0;color:#6b7280;font-size:12px;">For assistance, contact <a href="mailto:devolper.expert@gmail.com" style="color:#3b82f6;text-decoration:none;">devolper.expert@gmail.com</a>. This is an official communication from NH Network.</p>
              </td>
            </tr>
          </table>
        </div>`;
      const result = await sendEmail(email, subject, html);
      if (!result.ok) console.error('[mail] Not-approve email failed');
      emailSent = result.ok;
    }
    // Send rejection SMS
    if (phone) {
      const smsText = `NH Network: Your learner request was not approved at this time. ${message || 'You may reapply in the future.'} Need help? Email devolper.expert@gmail.com.`;
      Promise.resolve().then(() => sendSMS(phone, smsText)).then((r) => {
        if (!r || !r.ok) {
          console.error('[sms] Not-approve SMS failed:', r && r.error ? r.error : 'Unknown error');
        } else {
          smsSent = true;
        }
      }).catch((err) => {
        console.error('[sms] Not-approve SMS error:', err && err.message ? err.message : err);
      });
    }
    return res.json({ success: true, emailSent, smsSent });
  } catch (err) {
    console.error('Learner request not_approve error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ==========================================
//   USER NOTIFICATION ROUTES
// ==========================================

/**
 * Retrieves the count of unread notifications for a user.
 */
app.get('/api/notifications/count', async (req, res) => {
  try {
    const userId = parseInt(req.query.userId, 10);
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const [rows] = await pool.query('SELECT COUNT(*) AS cnt FROM user_notifications WHERE user_id = ? AND is_read = 0', [userId]);
    const count = Number((rows[0] && rows[0].cnt) || 0);
    return res.json({ success: true, count });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Retrieves a list of recent notifications for a user.
 */
app.get('/api/notifications/list', async (req, res) => {
  try {
    const userId = parseInt(req.query.userId, 10);
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const [rows] = await pool.query('SELECT id, activity_type, message, timestamp, is_read FROM user_notifications WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?', [userId, limit]);
    return res.json({ success: true, notifications: rows });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Manually adds a notification for a user.
 */
app.post('/api/notifications/add', async (req, res) => {
  try {
    const userId = parseInt(req.body && req.body.userId, 10);
    const activityType = String((req.body && req.body.activityType) || '').trim();
    const message = String((req.body && req.body.message) || '').trim() || null;
    if (!userId || !activityType) return res.status(400).json({ error: 'userId and activityType are required' });
    await addNotification(userId, activityType, message);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Marks a specific notification as read.
 */
app.post('/api/notifications/mark-read', async (req, res) => {
  try {
    const id = parseInt(req.body && req.body.id, 10);
    const userId = parseInt(req.body && req.body.userId, 10);
    if (!id || !userId) return res.status(400).json({ error: 'id and userId are required' });
    await pool.query('UPDATE user_notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [id, userId]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Marks all notifications for a user as read.
 */
app.post('/api/notifications/mark-all-read', async (req, res) => {
  try {
    const userId = parseInt(req.body && req.body.userId, 10);
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    await pool.query('UPDATE user_notifications SET is_read = 1 WHERE user_id = ?', [userId]);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// ==========================================
//   LEARNING STATE ROUTES
// ==========================================

/**
 * Retrieves the current learning progress (JSON state) for a user.
 */
app.get('/api/learning/state', async (req, res) => {
  try {
    const userId = parseInt(req.query.userId, 10);
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const [rows] = await pool.query('SELECT state_json FROM user_learning_state WHERE user_id = ? LIMIT 1', [userId]);
    if (!rows.length) return res.json({ success: true, state: null });
    const raw = rows[0].state_json;
    let parsed = null;
    try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { parsed = null; }
    return res.json({ success: true, state: parsed });
  } catch (err) {
    console.error('Learning state get error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Saves or updates the user's learning progress (JSON state).
 */
app.post('/api/learning/state', async (req, res) => {
  try {
    const userId = parseInt(req.body && req.body.userId, 10);
    const state = req.body && req.body.state;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    if (!state || typeof state !== 'object') return res.status(400).json({ error: 'state object is required' });
    const jsonStr = JSON.stringify(state);
    // Use MySQL CAST AS JSON to ensure data integrity
    await pool.query(
      `INSERT INTO user_learning_state (user_id, state_json)
       VALUES (?, CAST(? AS JSON))
       ON DUPLICATE KEY UPDATE state_json = CAST(? AS JSON), updated_at = CURRENT_TIMESTAMP`,
      [userId, jsonStr, jsonStr]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error('Learning state save error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Admin endpoint to delete a learner request and all related data.
 */
app.delete('/api/admin/learner/requests/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) { conn.release(); return res.status(400).json({ error: 'id is required' }); }
    
    await conn.beginTransaction();
    const [reqRows] = await conn.query('SELECT user_id FROM learner_requests WHERE id = ? LIMIT 1', [id]);
    const userId = reqRows.length ? reqRows[0].user_id : null;
    
    await conn.query('DELETE FROM learner_messages WHERE request_id = ?', [id]);
    if (userId) {
      await conn.query('DELETE FROM user_notifications WHERE user_id = ? AND activity_type IN (?, ?, ?)', [userId, 'form_submitted', 'form_approved', 'form_not_approved']);
    }
    await conn.query('DELETE FROM learner_requests WHERE id = ?', [id]);
    
    await conn.commit();
    conn.release();
    return res.json({ success: true });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    conn.release();
    console.error('Learner request delete error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Retrieves the latest unread feedback message for a learner.
 */
app.get('/api/learner/message', async (req, res) => {
  try {
    const userId = parseInt(req.query.userId, 10);
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    
    // Ensure we only get the message for the most recent request
    const [reqRows] = await pool.query('SELECT id FROM learner_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', [userId]);
    const currentRequestId = reqRows.length ? reqRows[0].id : null;
    
    if (!currentRequestId) {
      return res.json({ success: true, message: null });
    }
    
    const [rows] = await pool.query('SELECT * FROM learner_messages WHERE user_id = ? AND request_id = ? AND read_flag = 0 ORDER BY created_at DESC LIMIT 1', [userId, currentRequestId]);
    if (!rows.length) return res.json({ success: true, message: null });
    
    const m = rows[0];
    return res.json({ success: true, message: { id: m.id, type: m.type, text: m.message, requestId: m.request_id, createdAt: m.created_at } });
  } catch (err) {
    console.error('Learner message fetch error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Marks a learner feedback message as read.
 */
app.post('/api/learner/message/read', async (req, res) => {
  try {
    const id = parseInt(req.body && req.body.id, 10);
    const userId = parseInt(req.body && req.body.userId, 10);
    if (!id || !userId) return res.status(400).json({ error: 'id and userId are required' });
    await pool.query('UPDATE learner_messages SET read_flag = 1 WHERE id = ? AND user_id = ?', [id, userId]);
    return res.json({ success: true });
  } catch (err) {
    console.error('Learner message read error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ==========================================
//   ADMIN: USER MANAGEMENT ROUTES
// ==========================================

/**
 * Admin endpoint to list all users with basic profile info and filtering.
 * Includes dynamic account type detection based on activity.
 */
app.get('/api/admin/users', async (req, res) => {
  try {
    const filterBy = String(req.query.filterBy || '').trim();
    const q = String(req.query.q || '').trim();
    let sql = `SELECT u.id, u.full_name, u.username, u.email, u.password_hash, u.status, u.created_at, p.phone, p.verification_status,
               (SELECT COUNT(*) FROM learner_requests WHERE user_id = u.id AND status = 'approved') as is_learner,
               (SELECT COUNT(*) FROM investments WHERE user_id = u.id) as is_investor
               FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id`;
    const params = [];
    
    // Search by name, email, username, or phone
    if (q && filterBy) {
      const map = { name: 'u.full_name', email: 'u.email', username: 'u.username', phone: 'p.phone' };
      const col = map[filterBy] || null;
      if (col) {
        sql += ` WHERE ${col} LIKE ?`;
        params.push(`%${q}%`);
      }
    }
    sql += ' ORDER BY u.created_at DESC';
    const [rows] = await pool.query(sql, params);
    
    // Return a cleaned user list without sensitive data like password hashes
    return res.json({ success: true, users: rows.map(r => {
      let accountType = 'Standard';
      const learner = r.is_learner > 0;
      const investor = r.is_investor > 0;
      if (learner && investor) accountType = 'Learner + Investor';
      else if (learner) accountType = 'Learner';
      else if (investor) accountType = 'Investor';

      return {
        id: r.id,
        fullName: r.full_name,
        username: r.username,
        email: r.email,
        phone: r.phone || null,
        status: r.status || 'active',
        accountStatus: r.verification_status || 'unverified',
        accountType: accountType,
        registeredAt: r.created_at
      };
    }) });
  } catch (err) {
    console.error('Admin users list error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Admin endpoint to toggle a user's account status (active/disabled).
 */
app.post('/api/admin/users/:id/status', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body || {};

    if (!id || !['active', 'disabled'].includes(status)) {
      return res.status(400).json({ error: 'Valid id and status (active/disabled) are required' });
    }

    await pool.query('UPDATE users SET status = ? WHERE id = ?', [status, id]);
    
    try { 
      const message = status === 'active' 
        ? 'Your account has been re-enabled. You can now access your account.' 
        : 'Your account has been disabled by admin.';
      await addNotification(id, 'account_status_change', message); 
    } catch (_) {}

    return res.json({ success: true, message: `User account ${status === 'active' ? 'enabled' : 'disabled'} successfully.` });
  } catch (err) {
    console.error('Admin user status toggle error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Admin endpoint to permanently delete a user and ALL their associated data.
 * NOTE: This feature is now deprecated in favor of the Enable/Disable system.
 */
// app.delete('/api/admin/users/:id', async (req, res) => { ... });

// ==========================================
//   SERVER STARTUP
// ==========================================
/**
 * Starts the Express server on the specified PORT and HOST.
 */
app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
