// notifications.js
/**
 * Shared notification UI module for authenticated users.
 * This script manages the fetching, rendering, and state of user-specific notifications.
 * It interacts with the /api/notifications/* backend endpoints and requires a valid userId in localStorage.
 */

(function () {
  /** @type {string} Base path for notification-related API endpoints */
  const API_BASE = '/api';

  /**
   * Safely parses a value into a positive integer.
   * @param {*} v - The value to parse.
   * @returns {number|null} The parsed integer or null if invalid.
   */
  function safeParseInt(v) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  /**
   * Retrieves the current user's ID from local storage.
   * @returns {number|null} The user ID or null if not found/invalid.
   */
  function getUserId() {
    try {
      const stored = localStorage.getItem('userId');
      return safeParseInt(stored);
    } catch (_) {
      return null;
    }
  }

  /**
   * Formats a timestamp into a localized, human-readable date and time string.
   * Specifically configured for the Asia/Karachi timezone.
   * @param {Date|string|number} ts - The timestamp to format.
   * @returns {string} Formatted date string.
   */
  function formatTimeAgo(ts) {
    try {
      const d = ts instanceof Date ? ts : new Date(ts);
      return d.toLocaleString('en-PK', {
        timeZone: 'Asia/Karachi',
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    } catch (_) {
      return String(ts || '');
    }
  }

  /**
   * Injects the required CSS styles for the notification UI into the document head.
   * Ensures styles are only added once.
   */
  function ensureStyles() {
    if (document.getElementById('nhNotificationStyles')) return;
    const style = document.createElement('style');
    style.id = 'nhNotificationStyles';
    style.textContent = `
      /* Root wrapper for the notification button and panel */
      .nh-notify-wrapper {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        margin-left: 0.5rem;
      }
      /* Circular notification trigger button with glassmorphism and hover effects */
      .nh-notify-btn {
        position: relative;
        width: 36px;
        height: 36px;
        border-radius: 999px;
        border: none;
        cursor: pointer;
        background: rgba(15, 23, 42, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #e5e7eb;
        box-shadow: 0 0 0 1px rgba(59,130,246,0.35);
        transition: background 0.2s ease, transform 0.15s ease, box-shadow 0.2s ease;
      }
      .nh-notify-btn:hover {
        background: rgba(30, 64, 175, 0.9);
        box-shadow: 0 10px 25px rgba(37,99,235,0.45);
        transform: translateY(-1px);
      }
      .nh-notify-btn:active {
        transform: translateY(0);
        box-shadow: 0 4px 15px rgba(37,99,235,0.3);
      }
      /* Icon inside the trigger button */
      .nh-notify-icon {
        width: 18px;
        height: 18px;
        display: block;
      }
      /* Red numeric badge indicating the unread notification count */
      .nh-notify-badge {
        position: absolute;
        top: -4px;
        right: -4px;
        min-width: 18px;
        height: 18px;
        padding: 0 4px;
        border-radius: 999px;
        background: #ef4444;
        color: #ffffff;
        font-size: 11px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 0 0 2px rgba(15,23,42,0.9);
      }
      .nh-notify-badge.hidden {
        display: none;
      }
      /* Main notification dropdown panel with heavy blur and dark theme */
      .nh-notify-panel {
        position: absolute;
        top: 115%;
        right: 0;
        width: min(360px, 86vw);
        max-height: 420px;
        background: rgba(15,23,42,0.98);
        border-radius: 16px;
        box-shadow:
          0 18px 45px rgba(15,23,42,0.85),
          0 0 0 1px rgba(55,65,81,0.6);
        border: 1px solid rgba(59,130,246,0.45);
        backdrop-filter: blur(22px);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        z-index: 40;
      }
      .nh-notify-panel[hidden] {
        display: none;
      }
      /* Header section of the notification panel */
      .nh-notify-header {
        padding: 0.75rem 1rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid rgba(31,41,55,0.95);
        background: radial-gradient(circle at top left, rgba(59,130,246,0.24), transparent);
      }
      .nh-notify-title {
        font-size: 0.9rem;
        font-weight: 600;
        color: #e5e7eb;
      }
      .nh-notify-sub {
        font-size: 0.7rem;
        color: #9ca3af;
      }
      /* 'Mark all read' action button in the header */
      .nh-notify-markall {
        border: none;
        background: transparent;
        color: #60a5fa;
        font-size: 0.75rem;
        font-weight: 500;
        cursor: pointer;
        padding: 0.1rem 0.25rem;
      }
      /* Scrollable list of notification items */
      .nh-notify-list {
        padding: 0.4rem 0;
        overflow-y: auto;
      }
      /* Empty state message styles */
      .nh-notify-empty {
        padding: 1.25rem 1rem 1.5rem;
        font-size: 0.85rem;
        color: #9ca3af;
        text-align: center;
      }
      /* Individual notification item container */
      .nh-notify-item {
        display: flex;
        gap: 0.75rem;
        padding: 0.55rem 0.85rem;
        cursor: pointer;
        align-items: flex-start;
        transition: background 0.16s ease, box-shadow 0.16s ease;
      }
      .nh-notify-item:hover {
        background: rgba(31,41,55,0.95);
      }
      /* Special styling for unread notification items */
      .nh-notify-item-unread {
        background: radial-gradient(circle at left, rgba(37,99,235,0.22), rgba(17,24,39,0.98));
      }
      /* Status dot indicating if an item is unread */
      .nh-notify-dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        margin-top: 0.35rem;
        background: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59,130,246,0.35);
        flex-shrink: 0;
      }
      .nh-notify-dot.read {
        background: #4b5563;
        box-shadow: none;
      }
      .nh-notify-main {
        flex: 1 1 auto;
        min-width: 0;
      }
      /* Small pill label for the activity type */
      .nh-notify-type {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #6b7280;
        margin-bottom: 0.1rem;
      }
      .nh-notify-type-pill {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.1rem 0.45rem;
        border-radius: 999px;
        border: 1px solid rgba(59,130,246,0.45);
        background: rgba(15,23,42,0.9);
        color: #bfdbfe;
        font-weight: 600;
      }
      /* Notification message content */
      .nh-notify-message {
        font-size: 0.8rem;
        color: #e5e7eb;
        line-height: 1.45;
        word-wrap: break-word;
      }
      .nh-notify-message-muted {
        color: #9ca3af;
      }
      /* Timestamp and metadata footer for each notification */
      .nh-notify-meta {
        margin-top: 0.15rem;
        font-size: 0.72rem;
        color: #6b7280;
      }
      /* Adjust panel positioning for small mobile screens */
      @media (max-width: 640px) {
        .nh-notify-panel {
          right: -16px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Maps raw activity type strings from the backend to user-friendly display labels.
   * @param {string} type - Raw activity type string.
   * @returns {string} User-friendly label.
   */
  function mapActivityTypeLabel(type) {
    const t = String(type || '').toLowerCase();
    if (t === 'sign_in' || t === 'signin') return 'Sign in';
    if (t === 'signup') return 'Welcome';
    if (t === 'profile_update') return 'Profile updated';
    if (t === 'contact_form') return 'Support';
    if (t === 'password_reset') return 'Security';
    if (t === 'deposit') return 'Deposit';
    if (t === 'withdraw') return 'Withdraw';
    if (t === 'investment_buy') return 'Investment buy';
    if (t === 'certificate_request') return 'Certificate';
    if (t === 'certificate_approved') return 'Certificate Approved';
    if (t === 'certificate_rejected') return 'Certificate Rejected';
    if (t === 'form_submitted') return 'Form submitted';
    if (t === 'form_approved' || t === 'approved') return 'Form approved';
    if (t === 'form_not_approved' || t === 'not_approved') return 'Form not approved';
    if (t === 'investor_form_submitted') return 'Investor form submitted';
    if (t === 'investor_form_approved') return 'Investor form approved';
    if (t === 'investor_form_not_approved') return 'Investor form not approved';
    if (t === 'course_started') return 'Learning';
    if (t === 'video_completed') return 'Lesson';
    if (t === 'quiz_passed') return 'Quiz';
    if (t === 'final_test_passed') return 'Final Test';
    if (t === 'course_completed') return 'Achievement';
    if (t === 'avatar_upload') return 'Avatar';
    if (t === 'kyc_upload') return 'KYC';
    return type || 'Activity';
  }

  /**
   * Fetches the current unread notification count for a user.
   * @param {number} userId - The user ID.
   * @returns {Promise<number>} Number of unread notifications.
   */
  async function fetchCount(userId) {
    const res = await fetch(`${API_BASE}/notifications/count?userId=${encodeURIComponent(userId)}`);
    const data = await res.json();
    if (!res.ok || !data.success) return 0;
    return Number(data.count || 0);
  }

  /**
   * Fetches a list of notifications for a user.
   * @param {number} userId - The user ID.
   * @param {number} [limit=50] - Maximum number of notifications to retrieve.
   * @returns {Promise<Array>} Array of notification objects.
   */
  async function fetchList(userId, limit) {
    const res = await fetch(`${API_BASE}/notifications/list?userId=${encodeURIComponent(userId)}&limit=${encodeURIComponent(limit || 50)}`);
    const data = await res.json();
    if (!res.ok || !data.success) return [];
    return Array.isArray(data.notifications) ? data.notifications : [];
  }

  /**
   * Marks a single notification as read in the backend.
   * @param {number} id - The notification ID.
   * @param {number} userId - The user ID.
   */
  async function markOneRead(id, userId) {
    try {
      await fetch(`${API_BASE}/notifications/mark-read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, userId })
      });
    } catch (_) {}
  }

  /**
   * Marks all notifications as read for a specific user in the backend.
   * @param {number} userId - The user ID.
   */
  async function markAllRead(userId) {
    try {
      await fetch(`${API_BASE}/notifications/mark-all-read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
    } catch (_) {}
  }

  /**
   * Constructs the base DOM structure for the notification UI components.
   * Includes the trigger button, unread badge, and the dropdown panel.
   * @param {HTMLElement} container - The host element where the UI should be appended.
   * @returns {Object} References to the created DOM elements.
   */
  function buildNotificationUI(container) {
    // Ensure the necessary CSS styles are present in the document
    ensureStyles();

    // Main wrapper for the notification component
    const wrapper = document.createElement('div');
    wrapper.className = 'nh-notify-wrapper';

    // The circular trigger button
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nh-notify-btn';
    btn.setAttribute('aria-label', 'Notifications');

    // SVG Bell Icon for the notification button
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('class', 'nh-notify-icon');
    icon.innerHTML = '<path fill="currentColor" d="M12 2a6 6 0 0 0-6 6v2.52c0 .6-.26 1.18-.71 1.58L4.1 14.16C3.12 15.03 3.74 16.6 5 16.6h14c1.26 0 1.88-1.57.9-2.44l-1.19-1.06a2.1 2.1 0 0 1-.71-1.58V8a6 6 0 0 0-6-6Zm0 20a3 3 0 0 0 2.83-2h-5.66A3 3 0 0 0 12 22Z"/>';

    // Unread count badge (hidden by default)
    const badge = document.createElement('span');
    badge.className = 'nh-notify-badge hidden';
    badge.textContent = '0';

    // The dropdown panel containing the list of notifications
    const panel = document.createElement('div');
    panel.className = 'nh-notify-panel';
    panel.setAttribute('hidden', 'hidden');

    // Header section of the panel with title and subtitle
    const header = document.createElement('div');
    header.className = 'nh-notify-header';
    header.innerHTML = '<div><div class="nh-notify-title">Notifications</div><div class="nh-notify-sub">Activity on your account</div></div>';

    // Button to mark all current notifications as read
    const markAllBtn = document.createElement('button');
    markAllBtn.type = 'button';
    markAllBtn.className = 'nh-notify-markall';
    markAllBtn.textContent = 'Mark all read';

    // Container for the dynamic list of notification items
    const list = document.createElement('div');
    list.className = 'nh-notify-list';

    // Assemble the panel structure
    header.appendChild(markAllBtn);
    panel.appendChild(header);
    panel.appendChild(list);
    btn.appendChild(icon);
    btn.appendChild(badge);
    wrapper.appendChild(btn);
    wrapper.appendChild(panel);

    // Strategically place the UI within the provided container or fallback to document body
    if (container && container.firstChild) {
      container.appendChild(wrapper);
    } else if (container) {
      container.appendChild(wrapper);
    } else {
      document.body.appendChild(wrapper);
    }

    return { wrapper, btn, badge, panel, list, markAllBtn };
  }

  /** @type {Object|null} Reference to the currently active controller instance */
  let activeController = null;

  /**
   * Factory function to create and manage the notification UI and logic.
   * Handles polling, panel toggling, and user interaction.
   * @param {Object} opts - Configuration options.
   * @param {string} [opts.hostSelector] - CSS selector for the host element.
   * @returns {Object|null} The controller instance or null if initialization fails.
   */
  function createNotificationController(opts) {
    const { hostSelector } = opts || {};
    const userId = getUserId();
    // Exit if no user is authenticated
    if (!userId) return null;

    let host = null;
    if (hostSelector) {
      host = document.querySelector(hostSelector);
    }
    // Fallback to common header/topbar locations if hostSelector is not provided or not found
    if (!host) {
      host =
        document.querySelector('.topbar-right') ||
        document.querySelector('header .buttons') ||
        document.querySelector('header nav') ||
        document.querySelector('header');
    }
    if (!host) return null;

    // Build the UI elements and destructure references
    const { badge, panel, list, btn, markAllBtn } = buildNotificationUI(host);
    let open = false;
    let pollingTimer = null;
    let currentCount = 0;

    /**
     * Updates the unread badge UI with the latest count.
     * @param {number} count - The current number of unread notifications.
     */
    function setBadge(count) {
      currentCount = count;
      if (!badge) return;
      if (!count || count <= 0) {
        badge.classList.add('hidden');
        badge.textContent = '0';
      } else {
        badge.classList.remove('hidden');
        badge.textContent = count > 99 ? '99+' : String(count);
      }
    }

    /**
     * Renders the list of notification items into the dropdown panel.
     * @param {Array} items - Array of notification objects from the API.
     */
    function renderList(items) {
      if (!list) return;
      if (!items || !items.length) {
        list.innerHTML = '<div class="nh-notify-empty">You have no notifications yet.</div>';
        return;
      }
      list.innerHTML = items
        .map((n) => {
          const unread = !Number(n.is_read);
          const cls = 'nh-notify-item' + (unread ? ' nh-notify-item-unread' : '');
          const ts = formatTimeAgo(n.timestamp);
          const typeLabel = mapActivityTypeLabel(n.activity_type);
          const msg = n.message || '';
          const msgClass = msg ? 'nh-notify-message' : 'nh-notify-message nh-notify-message-muted';
          const msgText = msg || 'No additional details provided.';
          // Escape HTML content to prevent XSS while allowing specific labels
          return `
            <div class="${cls}" data-id="${String(n.id)}" data-unread="${unread ? '1' : '0'}">
              <div class="nh-notify-dot${unread ? '' : ' read'}"></div>
              <div class="nh-notify-main">
                <div class="nh-notify-type">
                  <span class="nh-notify-type-pill">${typeLabel}</span>
                </div>
                <div class="${msgClass}">${msgText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                <div class="nh-notify-meta">${ts}</div>
              </div>
            </div>
          `;
        })
        .join('');
    }

    /**
     * Triggers a fetch for the unread count and updates the badge.
     */
    async function refreshCount() {
      try {
        const c = await fetchCount(userId);
        setBadge(c);
      } catch (_) {}
    }

    /**
     * Triggers a fetch for the detailed notification list and renders it.
     */
    async function refreshList() {
      try {
        const items = await fetchList(userId, 50);
        renderList(items);
      } catch (_) {
        if (list) {
          list.innerHTML = '<div class="nh-notify-empty">Unable to load notifications.</div>';
        }
      }
    }

    /**
     * Toggles the visibility of the notification panel.
     */
    function togglePanel() {
      open = !open;
      if (open) {
        panel.removeAttribute('hidden');
        refreshList();
      } else {
        panel.setAttribute('hidden', 'hidden');
      }
    }

    /**
     * Closes the notification panel if it is currently open.
     */
    function closePanel() {
      if (!open) return;
      open = false;
      panel.setAttribute('hidden', 'hidden');
    }

    // --- Event Listeners ---

    // Toggle panel on button click
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePanel();
    });

    // Close panel when clicking outside the wrapper
    document.addEventListener('click', (e) => {
      if (!open) return;
      if (!panel.contains(e.target) && !btn.contains(e.target)) {
        closePanel();
      }
    });

    // Handle individual notification clicks (marking as read)
    list.addEventListener('click', async (e) => {
      const item = e.target.closest('.nh-notify-item');
      if (!item) return;
      const id = parseInt(item.getAttribute('data-id'), 10);
      const wasUnread = item.getAttribute('data-unread') === '1';
      if (!id || !wasUnread) return;
      
      // Optimistically update UI
      item.setAttribute('data-unread', '0');
      item.classList.remove('nh-notify-item-unread');
      const dot = item.querySelector('.nh-notify-dot');
      if (dot) dot.classList.add('read');
      
      const nextCount = Math.max(0, (currentCount || 0) - 1);
      setBadge(nextCount);
      
      // Persist the read state to the backend
      markOneRead(id, userId);
    });

    // Handle 'Mark all read' button click
    markAllBtn.addEventListener('click', async () => {
      await markAllRead(userId);
      setBadge(0);
      if (list) {
        // Update all visible items in the list
        list.querySelectorAll('.nh-notify-item').forEach((item) => {
          item.setAttribute('data-unread', '0');
          item.classList.remove('nh-notify-item-unread');
          const dot = item.querySelector('.nh-notify-dot');
          if (dot) dot.classList.add('read');
        });
      }
    });

    // Initial fetch and start polling every 25 seconds
    refreshCount();
    pollingTimer = setInterval(refreshCount, 25000);

    // Cleanup timer on page unload
    window.addEventListener('beforeunload', () => {
      if (pollingTimer) clearInterval(pollingTimer);
    });

    const controller = {
      refreshCount,
      refreshList,
      destroy() {
        if (pollingTimer) clearInterval(pollingTimer);
      }
    };
    activeController = { setBadge, refreshCount, refreshList };
    return controller;
  }

  /**
   * Utility function to programmatically push a new notification to the backend.
   * Also triggers an immediate refresh of the UI if a controller is active.
   * @param {Object} payload - Notification data.
   * @param {number} payload.userId - Target user ID.
   * @param {string} payload.activityType - Type of activity.
   * @param {string} payload.message - Notification message content.
   */
  async function pushNotification({ userId, activityType, message }) {
    try {
      await fetch(`${API_BASE}/notifications/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, activityType, message })
      });
      // If the UI is currently active, refresh it to show the new notification immediately
      if (activeController && typeof activeController.refreshCount === 'function') {
        activeController.refreshCount();
        activeController.refreshList();
      }
    } catch (_) {}
  }

  // Export the notification system to the global window object
  window.NHNotifications = {
    /**
     * Initializes the notification controller.
     * @type {Function}
     */
    init: createNotificationController,
    /**
     * Pushes a new notification to the server.
     * @type {Function}
     */
    push: pushNotification
  };
})();


