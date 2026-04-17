// public/navbar.js
/**
 * Self-invoking function to encapsulate the global navigation bar logic.
 * This module dynamically renders a standardized header across the application,
 * handling authentication states, navigation links, and theme-consistent styling.
 */
(function() {
    /**
     * Generates and returns a string of CSS rules for the navigation bar.
     * Uses template literals to define styles that are injected into the header.
     * @returns {string} HTML string containing <style> block.
     */
    function getCssClasses() {
        return `
            <style>
                /* Global header container with sticky positioning and glassmorphism effect */
                #global-header {
                    width: 100%; padding: 1rem 5%; display: flex; justify-content: space-between; align-items: center;
                    background: rgba(15, 20, 25, 0.85); backdrop-filter: blur(20px); border-bottom: 1px solid rgba(59, 130, 246, 0.15);
                    position: sticky; top: 0; z-index: 1000; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
                }
                /* Brand logo and text styles with hover transitions */
                #global-header .brand { display: inline-flex; align-items: center; gap: 1rem; cursor: pointer; transition: all 0.3s ease; text-decoration: none; }
                #global-header .brand:hover { transform: scale(1.02); }
                /* Logo icon with a primary-to-accent gradient background */
                #global-header .logo-icon { width: 44px; height: 44px; border-radius: 12px; background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 18px; color: #ffffff; box-shadow: 0 8px 24px rgba(59, 130, 246, 0.3); position: relative; overflow: hidden; }
                /* Gradient text for the brand name */
                #global-header .logo-text { font-size: 14px; font-weight: 700; letter-spacing: 1px; background: linear-gradient(135deg, #3b82f6, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
                
                /* Navigation links container */
                #global-header .nav-links { display: flex; gap: 2rem; align-items: center; margin: 0 2rem; }
                /* Individual navigation link styles with active state indicators */
                #global-header .nav-link { 
                    color: #cbd5e0; font-weight: 600; font-size: 14px; transition: all 0.3s ease; text-decoration: none; 
                    position: relative; padding: 0.5rem 0;
                }
                #global-header .nav-link:hover { color: #ffffff; }
                #global-header .nav-link.active { color: #3b82f6; }
                /* Animated underline for the active navigation link */
                #global-header .nav-link.active::after {
                    content: ""; position: absolute; bottom: 0; left: 0; width: 100%; height: 2px;
                    background: linear-gradient(90deg, #3b82f6, #8b5cf6); border-radius: 2px;
                }

                /* Action buttons container (Login, Signup, Logout) */
                #global-header .buttons { display: flex; gap: 1rem; align-items: center; }
                
                /* Standardized Button Styles matching the main application theme */
                #global-header .btn {
                    padding: 0.7rem 1.8rem; border: none; border-radius: 10px; cursor: pointer;
                    font-size: 14px; font-weight: 600; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    display: inline-flex; align-items: center; gap: 8px; position: relative; overflow: hidden;
                    text-decoration: none; font-family: "Inter", sans-serif;
                }
                /* Primary button with gradient and shadow for emphasis */
                #global-header .btn-primary {
                    background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); color: #ffffff;
                    box-shadow: 0 4px 15px rgba(59, 130, 246, 0.4);
                }
                #global-header .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(59, 130, 246, 0.5); }
                
                /* Outline button for secondary actions with subtle backdrop blur */
                #global-header .btn-outline {
                    background: rgba(139, 92, 246, 0.1); color: #e0e7ff; border: 1.5px solid rgba(139, 92, 246, 0.3);
                    backdrop-filter: blur(10px);
                }
                #global-header .btn-outline:hover {
                    background: rgba(139, 92, 246, 0.2); border-color: rgba(139, 92, 246, 0.5);
                    transform: translateY(-2px); box-shadow: 0 8px 20px rgba(139, 92, 246, 0.2);
                }

                /* Responsive adjustments for tablet and mobile devices */
                @media (max-width: 1024px) {
                    #global-header .nav-links { gap: 1rem; margin: 0 1rem; }
                }
                @media (max-width: 768px) {
                    #global-header { padding: 1rem 3%; flex-direction: column; gap: 1rem; text-align: center; }
                    #global-header .nav-links { margin: 0.5rem 0; }
                }
            </style>
        `;
    }

    /**
     * Main function to render the navigation bar content dynamically.
     * Evaluates authentication state and current path to determine which links and buttons to display.
     */
    function renderNavbar() {
        // Target the standard header element or fallback to any header tag
        const header = document.getElementById("global-header") || document.querySelector("header");
        if (!header) return;
        if (header.id !== 'global-header') header.id = 'global-header';

        // Retrieve authentication status from localStorage
        const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
        // Define home URL based on whether the user is authenticated
        const homeUrl = isLoggedIn ? 'dashboard.html' : 'index.html';
        const path = window.location.pathname;

        // Determine the active state of navigation links based on the current URL
        const isHome = path === '/' || path.endsWith('index.html') || path.endsWith('dashboard.html');
        const isFAQ = path.endsWith('faq.html');
        const isContact = path.endsWith('contact.html');

        // Dynamically generate action buttons based on login state and current page
        let buttonsHtml = '';
        if (isLoggedIn) {
            // Display logout button for authenticated users
            buttonsHtml = `<button class="btn btn-outline" id="globalLogoutBtn">Logout</button>`;
        } else {
            // Check if on the landing page to use modal triggers instead of direct navigation
            const isOnIndex = path === '/' || path.endsWith('index.html');
            if (isOnIndex) {
                buttonsHtml = `
                    <button class="btn btn-outline" onclick="openModal('loginModal')">Sign In</button>
                    <button class="btn btn-primary" onclick="openModal('signupModal')">Get Started</button>
                `;
            } else {
                // For other pages, provide links back to the landing page with anchors
                buttonsHtml = `
                    <a href="index.html#login" class="btn btn-outline">Sign In</a>
                    <a href="index.html#signup" class="btn btn-primary">Get Started</a>
                `;
            }
        }

        // Inject the generated HTML and styles into the header element
        header.innerHTML = `
            ${getCssClasses()}
            <a href="${homeUrl}" class="brand">
                <div class="logo-icon">NH</div>
                <div class="logo-text">NETWORK</div>
            </a>
            <div class="nav-links">
                <a href="${homeUrl}" class="nav-link ${isHome ? 'active' : ''}">Home</a>
                <a href="contact.html" class="nav-link ${isContact ? 'active' : ''}">Contact Support</a>
                <a href="faq.html" class="nav-link ${isFAQ ? 'active' : ''}">FAQ</a>
            </div>
            <div class="buttons" id="navButtonsContainer">
                ${buttonsHtml}
            </div>
        `;

        // Attach event listeners for authenticated user actions
        if (isLoggedIn) {
            const logoutBtn = document.getElementById("globalLogoutBtn");
            if (logoutBtn) {
                logoutBtn.addEventListener("click", () => {
                    // Clear user session data from localStorage upon logout
                    localStorage.removeItem("isLoggedIn");
                    localStorage.removeItem("userName");
                    localStorage.removeItem("userId");
                    // Redirect to the landing page
                    window.location.href = "index.html";
                });
            }
            
            /**
             * Initializes the notification system if the user is logged in.
             * Integrates with the NHNotifications module to show alerts in the navbar.
             */
            const initNotifications = () => {
                if (window.NHNotifications && typeof window.NHNotifications.init === 'function') {
                    // Clean up any existing notification wrappers before re-initializing
                    const existingWrapper = document.querySelector('.nh-notify-wrapper');
                    if (existingWrapper) existingWrapper.remove();
                    
                    // Delay initialization slightly to ensure the DOM is ready
                    setTimeout(() => {
                        window.NHNotifications.init({ hostSelector: '#navButtonsContainer' });
                    }, 100);
                }
            };

            // Dynamically load notifications.js if it hasn't been included yet
            if (!window.NHNotifications) {
                const script = document.createElement('script');
                script.src = 'notifications.js';
                script.onload = initNotifications;
                document.body.appendChild(script);
            } else {
                // If already loaded, proceed directly to initialization
                initNotifications();
            }
        }
    }

    // Execute the rendering logic immediately upon script execution
    renderNavbar();
})();

