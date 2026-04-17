/**
 * GLOBAL FOOTER INJECTION SCRIPT
 * ------------------------------
 * This script dynamically generates and injects a standardized footer across the platform.
 * It ensures visual consistency, handles dependency loading (CSS/Icons), and performs
 * cleanup of legacy footer elements to prevent layout conflicts.
 */
document.addEventListener("DOMContentLoaded", function() {
    
    /**
     * 1. STYLESHEET INJECTION
     * Automatically loads the footer's specific CSS if it hasn't been included in the HTML head.
     * This makes the footer a self-contained module that can be dropped into any page.
     */
    if (!document.querySelector('link[href*="footer.css"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'footer.css'; // Path relative to the 'public' directory
        document.head.appendChild(link);
    }

    /**
     * 2. ICON DEPENDENCY LOADING
     * Injects Font Awesome 6.4.0 for social media and utility icons.
     * Checks for existing installations to prevent redundant network requests.
     */
    if (!document.querySelector('link[href*="font-awesome"]') && !document.querySelector('link[href*="fontawesome"]')) {
        const fa = document.createElement('link');
        fa.rel = 'stylesheet';
        fa.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
        document.head.appendChild(fa);
    }

    /**
     * 3. LEGACY CLEANUP
     * Scans for any hardcoded <footer> elements that are NOT our dynamic '.site-footer'.
     * Hides them to maintain a clean, single-footer layout while marking them for audit.
     */
    const existingFooters = document.querySelectorAll('footer:not(.site-footer)');
    existingFooters.forEach(f => {
        f.style.display = 'none';
        f.classList.add('hidden-by-footer-js'); // Internal marker for debugging
    });

    /**
     * 4. FOOTER TEMPLATE DEFINITION
     * Contains the structural HTML for the footer including links, social icons, and copyright.
     */
    const footerHTML = `
        <div class="footer-container">
            <!-- Primary Navigation Links -->
            <div class="footer-links">
                <a href="faq.html">FAQ</a>
                <a href="contact.html">Contact / Support</a>
                <a href="privacy.html">Privacy Policy</a>
                <a href="terms.html">Terms of Service</a>
            </div>
            
            <!-- Social Media Connectivity -->
            <div class="footer-social">
                <a href="https://www.instagram.com/nh_network1" class="social-icon" aria-label="Instagram" target="_blank" rel="noopener"><i class="fab fa-instagram"></i></a>
                <a href="https://discordapp.com/users/1483736493733314610" class="social-icon" aria-label="Discord" target="_blank" rel="noopener"><i class="fab fa-discord"></i></a>
                <a href="https://whatsapp.com/channel/0029VbBrhOSKWEKrIEIaWI2P" class="social-icon" aria-label="WhatsApp" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i></a>
                
                <!-- X (Twitter) Icon: Uses custom SVG for modern branding -->
                <a href="https://x.com/NH_Network1" class="social-icon" aria-label="Twitter" target="_blank" rel="noopener">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="16" height="16" fill="currentColor">
                        <path d="M389.2 48h70.6L305.6 224.2 487 464H345L233.6 318.6 106.5 464H35.8L200.7 275.5 26.8 48H172.4L272.9 180.9 389.2 48zM364.4 421.8h39.1L151.1 88h-42L364.4 421.8z"/>
                    </svg>
                </a>
            </div>
            
            <!-- Legal & Copyright Information -->
            <div class="footer-copyright">
                &copy; 2026 All Rights Reserved
            </div>
        </div>
    `;
    
    /**
     * 5. FINAL INJECTION
     * Creates the footer element and appends it to the end of the document body.
     * Includes a guard clause to prevent duplicate footers if the script is re-run.
     */
    if (!document.querySelector('footer.site-footer')) {
        const newFooter = document.createElement('footer');
        newFooter.className = 'site-footer';
        newFooter.innerHTML = footerHTML;
        document.body.appendChild(newFooter);
    }
});
