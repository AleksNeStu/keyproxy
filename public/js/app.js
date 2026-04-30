        // XSS protection — escape user-controlled data before injecting into HTML
        function escapeHtml(str) {
            if (str == null) return '';
            const s = String(str);
            return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }
        // Sanitize error messages to prevent internal detail leakage
        function sanitizeError(err) {
            const raw = err?.message || err?.error || String(err || '');
            const msg = raw.substring(0, 200);
            return msg
                .replace(/[A-Z]:\[^\s]*/g, '[path]')
                .replace(/\/[a-z]+\/[^\s]*/g, '[path]')
                .replace(/\/home\/[^\s]*/g, '[path]')
                .replace(/\/var\/[^\s]*/g, '[path]')
                .replace(/\/etc\/[^\s]*/g, '[path]')
                .replace(/\/usr\/[^\s]*/g, '[path]')
                .replace(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, '[ip]');
        }

        // Escape for use inside onclick="func('...')" — HTML attr + JS string literal
        function safeJsAttr(str) {
            if (str == null) return '';
            return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        let envVars = {};
        let defaultStatusCodes = '429';

        // Provider categories
        const PROVIDER_CATEGORIES = {
            ai: ['gemini', 'groq', 'mistral', 'zhipuai', 'siliconflow', 'openai'],
            mcp: ['brave', 'exa', 'jina', 'firecrawl', 'context7', 'onref', 'tavily', 'searchapi']
        };
        let _activeCategory = null; // null = show all

        function getProviderCategory(name) {
            for (const [cat, names] of Object.entries(PROVIDER_CATEGORIES)) {
                if (names.includes(name.toLowerCase())) return cat;
            }
            return null;
        }

        // Unified copy to clipboard function that works without SSL
        async function copyToClipboard(text, successMessage) {
            try {
                // Try modern clipboard API first
                await navigator.clipboard.writeText(text);
                showSuccessToast(successMessage || 'Copied to clipboard!');
                return true;
            } catch (error) {
                // Fallback for non-HTTPS or older browsers
                const textArea = document.createElement('textarea');
                textArea.value = text;
                textArea.style.position = 'fixed';
                textArea.style.left = '-999999px';
                textArea.style.top = '-999999px';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();

                try {
                    const successful = document.execCommand('copy');
                    document.body.removeChild(textArea);
                    if (successful) {
                        showSuccessToast(successMessage || 'Copied to clipboard!');
                        return true;
                    } else {
                        showErrorToast('Failed to copy to clipboard');
                        return false;
                    }
                } catch (err) {
                    document.body.removeChild(textArea);
                    showErrorToast('Failed to copy to clipboard');
                    return false;
                }
            }
        }

        // Header-integrated notification system
        let activeNotifications = [];
        let notificationId = 0;
        const MAX_NOTIFICATIONS = 20;
        let notificationTimeouts = new Map();
        
        function showToast(message, type = 'info', duration = 4000) {
            // Sanitize error messages to prevent internal detail leakage
            message = sanitizeError(message);
            const timestamp = new Date();
            const id = ++notificationId;
            
            // Define notification styles and icons based on type
            let bgColor, textColor, iconSvg;
            switch (type) {
                case 'success':
                    bgColor = 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
                    textColor = 'text-green-800 dark:text-green-200';
                    iconSvg = `<svg class="w-4 h-4 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>`;
                    break;
                case 'error':
                    bgColor = 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
                    textColor = 'text-red-800 dark:text-red-200';
                    iconSvg = `<svg class="w-4 h-4 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>`;
                    break;
                case 'warning':
                    bgColor = 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800';
                    textColor = 'text-yellow-800 dark:text-yellow-200';
                    iconSvg = `<svg class="w-4 h-4 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"></path>
                    </svg>`;
                    break;
                case 'info':
                default:
                    bgColor = 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800';
                    textColor = 'text-blue-800 dark:text-blue-200';
                    iconSvg = `<svg class="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>`;
                    break;
            }
            
            // Create notification object
            const notification = {
                id: id,
                message: message,
                type: type,
                timestamp: timestamp,
                bgColor: bgColor,
                textColor: textColor,
                iconSvg: iconSvg,
                duration: duration
            };
            
            // Add to active notifications
            activeNotifications.push(notification);
            
            // Limit notifications
            if (activeNotifications.length > MAX_NOTIFICATIONS) {
                // Remove oldest notification
                const oldestId = activeNotifications.shift().id;
                hideNotification(oldestId);
            }
            
            // Show immediately
            updateNotificationDisplay();
            
            // Auto-hide after duration
            if (duration > 0) {
                const timeout = setTimeout(() => {
                    hideNotification(id);
                }, duration);
                notificationTimeouts.set(id, timeout);
            }
            
            return id;
        }
        
        function updateNotificationDisplay() {
            // Show single notification or count
            const singleNotification = document.getElementById('singleNotification');
            const singleIcon = document.getElementById('singleIcon');
            const singleMessage = document.getElementById('singleMessage');
            const notificationCount = document.getElementById('notificationCount');
            
            if (activeNotifications.length === 0) {
                singleNotification.classList.add('hidden');
                return;
            }
            
            // Show the latest notification
            const latest = activeNotifications[activeNotifications.length - 1];
            singleIcon.innerHTML = latest.iconSvg;
            singleMessage.textContent = latest.message;
            
            // Apply styles
            const container = singleNotification.querySelector('div');
            container.className = `flex items-center space-x-3 px-4 py-3 ${latest.bgColor} ${latest.textColor}`;
            
            // Show count if there are multiple
            if (activeNotifications.length > 1) {
                notificationCount.textContent = `+${activeNotifications.length - 1}`;
                notificationCount.classList.remove('hidden');
            } else {
                notificationCount.classList.add('hidden');
            }
            
            // Position and show
            positionNotifications();
            singleNotification.classList.remove('hidden');
            
            // Update expanded view
            updateExpandedNotifications();
        }
        
        function hideNotification(id) {
            // Remove from active notifications
            activeNotifications = activeNotifications.filter(n => n.id !== id);
            
            // Clear timeout
            if (notificationTimeouts.has(id)) {
                clearTimeout(notificationTimeouts.get(id));
                notificationTimeouts.delete(id);
            }
            
            // Update display
            updateNotificationDisplay();
        }
        
        function positionNotifications() {
            // Notifications are now fixed positioned relative to the sticky header
            // They stay in the same spot in the viewport regardless of scroll
            const singleNotification = document.getElementById('singleNotification');
            const expandedNotifications = document.getElementById('expandedNotifications');
            
            if (!singleNotification || !expandedNotifications) return;
            
            // Fixed position below the sticky header (header ~72px + nav ~68px = ~140px)
            const topPosition = '140px';
            const rightPosition = '20px';
            
            singleNotification.style.top = topPosition;
            singleNotification.style.right = rightPosition;
            
            expandedNotifications.style.top = topPosition;
            expandedNotifications.style.right = rightPosition;
        }
        

        
        function updateExpandedNotifications() {
            const allNotificationsList = document.getElementById('allNotificationsList');
            const queueStatus = document.getElementById('queueStatus');
            
            if (!allNotificationsList) return;
            
            // Clear existing content
            allNotificationsList.innerHTML = '';
            
            // Add all active notifications (newest first)
            const reversedNotifications = [...activeNotifications].reverse();
            reversedNotifications.forEach((notification, index) => {
                const div = document.createElement('div');
                div.className = `flex items-center space-x-3 text-sm px-3 py-2 rounded border ${notification.bgColor} ${notification.textColor}`;
                
                // Add dismiss button for each notification
                div.innerHTML = `
                    ${notification.iconSvg}
                    <span class="flex-1">${escapeHtml(notification.message)}</span>
                    <span class="text-xs opacity-75">${new Date(notification.timestamp).toLocaleTimeString()}</span>
                    <button onclick="hideNotification(${notification.id})" class="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors p-1" title="Dismiss">
                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                        </svg>
                    </button>
                `;
                allNotificationsList.appendChild(div);
            });
            
            // Update status
            if (queueStatus) {
                if (activeNotifications.length === 0) {
                    queueStatus.textContent = 'No notifications';
                } else if (activeNotifications.length === 1) {
                    queueStatus.textContent = '1 active notification';
                } else {
                    queueStatus.textContent = `${activeNotifications.length} active notifications`;
                }
            }
        }
        
        function clearCurrentNotification() {
            if (activeNotifications.length > 0) {
                // Remove the latest notification
                const latest = activeNotifications[activeNotifications.length - 1];
                hideNotification(latest.id);
            }
        }
        
        function clearAllNotifications() {
            // Clear all timeouts
            notificationTimeouts.forEach(timeout => clearTimeout(timeout));
            notificationTimeouts.clear();
            
            // Clear all notifications
            activeNotifications = [];
            
            // Update display
            updateNotificationDisplay();
        }
        
        // Legacy function for compatibility
        function hideToast(id) {
            // Remove from array
            notifications = notifications.filter(n => n.id !== id);
            
            // Hide if it's the current one
            if (currentNotification && currentNotification.id === id) {
                hideLatestNotification();
            }
        }
        
        // Convenience functions
        function showSuccessToast(message, duration = 3000) {
            return showToast(message, 'success', duration);
        }
        
        function showErrorToast(message, duration = 5000) {
            return showToast(message, 'error', duration);
        }
        
        function showWarningToast(message, duration = 4000) {
            return showToast(message, 'warning', duration);
        }
        
        function showInfoToast(message, duration = 3000) {
            return showToast(message, 'info', duration);
        }

        // ============================================
        // GLOBAL ERROR HANDLERS
        // ============================================

        /**
         * Global unhandled error handler
         */
        window.onerror = function(message, source, lineno, colno, error) {
            console.error('[GLOBAL ERROR]', {
                message,
                source,
                lineno,
                colno,
                error
            });

            let type = 'error';
            let userMessage = 'An unexpected error occurred';
            let duration = 6000;

            const msgStr = String(message).toLowerCase();

            if (msgStr.includes('networkerror') || msgStr.includes('fetch') || msgStr.includes('network')) {
                type = 'warning';
                userMessage = 'Network connection issue - some features may be unavailable';
            } else if (msgStr.includes('syntaxerror')) {
                userMessage = 'Data format error - please refresh the page';
            } else if (msgStr.includes('typeerror')) {
                userMessage = 'Application error - please refresh the page';
            }

            const refId = Date.now().toString(36).toUpperCase();
            showToast(`${userMessage} (Ref: ${refId})`, type, duration);

            return false;
        };

        /**
         * Global unhandled promise rejection handler
         */
        window.addEventListener('unhandledrejection', function(event) {
            console.error('[UNHANDLED PROMISE]', event.reason);

            let userMessage = 'Async operation failed';
            let type = 'error';
            let duration = 5000;

            if (event.reason?.message) {
                const msg = event.reason.message.toLowerCase();

                if (msg.includes('network') || msg.includes('fetch')) {
                    type = 'warning';
                    userMessage = 'Network error during background operation';
                } else if (msg.includes('timeout')) {
                    type = 'warning';
                    userMessage = 'Operation timed out - please try again';
                } else if (msg.includes('unauthorized') || msg.includes('401')) {
                    userMessage = 'Session expired - please refresh';
                    duration = 8000;
                } else if (msg.includes('429') || msg.includes('too many')) {
                    type = 'warning';
                    userMessage = 'Too many requests - please wait a moment';
                } else if (msg.includes('abort')) {
                    type = 'warning';
                    userMessage = 'Operation was cancelled';
                }
            } else if (event.reason?.status) {
                const status = event.reason.status;
                if (status === 401 || status === 403) {
                    userMessage = 'Authentication required';
                    duration = 8000;
                } else if (status === 429) {
                    type = 'warning';
                    userMessage = 'Rate limit exceeded - please wait';
                } else if (status >= 500) {
                    userMessage = 'Server error - please try again later';
                }
            }

            const refId = `PROM-${Date.now().toString(36).toUpperCase()}`;
            showToast(`${userMessage} (Ref: ${refId})`, type, duration);

            event.preventDefault();
        });

        /**
         * Enhanced fetch with timeout and error categorization
         */
        async function fetchWithErrorHandling(url, options = {}, timeout = 10000) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            try {
                const response = await fetch(url, {
                    ...options,
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errorCategory = categorizeHttpError(response.status);
                    console.debug(`[FETCH] ${options.method || 'GET'} ${url} -> ${response.status} (${errorCategory})`);
                }

                return response;

            } catch (error) {
                clearTimeout(timeoutId);

                let errorType = 'unknown';
                let userMessage = error.message || 'Request failed';

                if (error.name === 'AbortError') {
                    errorType = 'timeout';
                    userMessage = 'Request timed out';
                    console.warn(`[FETCH TIMEOUT] ${options.method || 'GET'} ${url} after ${timeout}ms`);
                } else if (userMessage.toLowerCase().includes('network') || userMessage.toLowerCase().includes('fetch')) {
                    errorType = 'network';
                    userMessage = 'Network error';
                    console.warn(`[FETCH NETWORK] ${options.method || 'GET'} ${url}`);
                } else {
                    console.error(`[FETCH ERROR] ${options.method || 'GET'} ${url}:`, error);
                }

                const enrichedError = new Error(userMessage);
                enrichedError._errorType = errorType;
                enrichedError._url = url;
                enrichedError._method = options.method || 'GET';
                enrichedError._originalError = error;

                throw enrichedError;
            }
        }

        /**
         * Categorize HTTP status codes
         */
        function categorizeHttpError(status) {
            if (status === 401 || status === 403) return 'auth';
            if (status === 429) return 'rate_limit';
            if (status >= 400 && status < 500) return 'client_error';
            if (status >= 500) return 'server_error';
            return 'unknown';
        }

        /**
         * Show user-friendly error message with debugging context
         */
        function showErrorWithContext(error, operation = 'Operation', context = {}) {
            console.error(`[ERROR] ${operation}:`, error, context);

            let userMessage = `${operation} failed`;
            let type = 'error';
            const debugInfo = [];

            if (typeof error === 'object' && error !== null) {
                if (error.status && error.statusText) {
                    if (error.status === 401 || error.status === 403) {
                        userMessage = 'Authentication required';
                        debugInfo.push('Type: auth');
                    } else if (error.status === 429) {
                        type = 'warning';
                        userMessage = 'Too many requests';
                        debugInfo.push('Type: rate_limit');
                    } else if (error.status >= 500) {
                        userMessage = 'Server error';
                        debugInfo.push('Type: server_error');
                    }

                    if (error.json) {
                        error.json().then(data => {
                            if (data.error) {
                                const enhancedMsg = `${data.error} (Ref: ${context.requestId || 'N/A'})`;
                                showToast(enhancedMsg, type, 6000);
                            }
                        }).catch(() => {});
                    }
                } else if (error._errorType) {
                    if (error._errorType === 'timeout') {
                        type = 'warning';
                        userMessage = 'Request timed out';
                    } else if (error._errorType === 'network') {
                        type = 'warning';
                        userMessage = 'Network error';
                    }
                    debugInfo.push(`Type: ${error._errorType}`);
                } else if (error.message) {
                    const msg = error.message.toLowerCase();

                    if (msg.includes('network') || msg.includes('fetch')) {
                        type = 'warning';
                        userMessage = 'Network connection issue';
                        debugInfo.push('Type: network');
                    } else if (msg.includes('timeout')) {
                        type = 'warning';
                        userMessage = 'Request timed out';
                        debugInfo.push('Type: timeout');
                    } else if (msg.includes('unauthorized') || msg.includes('401')) {
                        userMessage = 'Authentication required';
                        debugInfo.push('Type: auth');
                    } else if (msg.includes('429')) {
                        type = 'warning';
                        userMessage = 'Too many requests';
                        debugInfo.push('Type: rate_limit');
                    }
                }
            } else if (typeof error === 'string') {
                userMessage = error;
            }

            if (context.endpoint) debugInfo.push(`Endpoint: ${context.endpoint}`);
            if (context.requestId) debugInfo.push(`ID: ${context.requestId}`);

            const ref = `ERR-${Date.now().toString(36).toUpperCase()}`;
            const fullMessage = debugInfo.length > 0
                ? `${userMessage} (${ref}) [${debugInfo.join(', ')}]`
                : `${userMessage} (${ref})`;

            showToast(fullMessage, type, 6000);

            return ref;
        }

        /**
         * Show error from fetch Response with automatic message extraction
         */
        function showToastFromResponse(response, defaultMessage = 'Operation failed') {
            response.json().then(data => {
                let message = defaultMessage;
                let type = 'error';
                let duration = 5000;

                if (data.error) {
                    message = data.error;

                    if (response.status === 401 || response.status === 403) {
                        message = 'Authentication required - please refresh';
                        duration = 8000;
                    } else if (response.status === 429) {
                        type = 'warning';
                        message = data.error + (data.retryAfter ? ` (Retry in ${data.retryAfter}s)` : '');
                    } else if (response.status >= 500) {
                        message = 'Server error - please try again later';
                    }
                }

                if (data.requestId) {
                    message += ` [ID: ${data.requestId}]`;
                } else {
                    message += ` [ERR-${Date.now().toString(36).toUpperCase()}]`;
                }

                showToast(message, type, duration);
            }).catch(() => {
                const ref = `ERR-${Date.now().toString(36).toUpperCase()}`;
                showToast(`${defaultMessage} (${ref})`, 'error', 5000);
            });
        }

        // Dark mode functionality
        function toggleTheme() {
            const body = document.getElementById('mainBody');
            const themeToggle = document.getElementById('themeToggle');
            
            if (body.classList.contains('dark')) {
                body.classList.remove('dark');
                themeToggle.classList.remove('dark');
                themeToggle.setAttribute('aria-checked', 'false');
                localStorage.setItem('theme', 'light');
            } else {
                body.classList.add('dark');
                themeToggle.classList.add('dark');
                themeToggle.setAttribute('aria-checked', 'true');
                localStorage.setItem('theme', 'dark');
            }
        }

        // Initialize theme from localStorage
        function initializeTheme() {
            const savedTheme = localStorage.getItem('theme');
            const body = document.getElementById('mainBody');
            const themeToggle = document.getElementById('themeToggle');
            
            // Default to dark mode if no preference is saved
            if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                body.classList.add('dark');
                if (themeToggle) {
                    themeToggle.classList.add('dark');
                    themeToggle.setAttribute('aria-checked', 'true');
                }
            }
        }
        
        // Login functionality
        async function login() {
            const password = document.getElementById('password').value;
            const errorDiv = document.getElementById('loginError');

            try {
                const response = await fetch('/admin/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password }),
                    credentials: 'include' // Required to send/receive cookies
                });

                const data = await response.json();

                if (response.ok) {
                    // Store CSRF token from login response
                    if (data.csrfToken) {
                        csrfToken = data.csrfToken;
                    }

                    document.body.classList.add('authenticated');
                    document.body.classList.remove('not-authenticated');
                    if (data.passwordUpgradeAvailable) {
                        sessionStorage.setItem('loginResponse', JSON.stringify(data));
                    }
                    loadEnvVars();
                    // Fix header positioning after panel is shown
                    setTimeout(adjustStickyHeaderPositioning, 100);
                } else if (response.status === 429) {
                    // Rate limited - show countdown timer UI
                    const passwordInput = document.getElementById('password');
                    const loginButton = document.getElementById('loginButton');
                    passwordInput.disabled = true;
                    loginButton.disabled = true;

                    // Start countdown timer (this will hide inputs and show timer)
                    if (data.remainingSeconds) {
                        startLoginCountdown(data.remainingSeconds, passwordInput, loginButton, errorDiv);
                    }
                } else {
                    // Show error with attempts remaining if available
                    errorDiv.textContent = data.error || 'Invalid password';
                    if (data.attemptsRemaining !== undefined) {
                        errorDiv.textContent += ` (${data.attemptsRemaining} attempt(s) remaining)`;
                    }
                    errorDiv.classList.remove('hidden');
                }
            } catch (error) {
                errorDiv.textContent = 'Login failed: ' + sanitizeError(error);
                errorDiv.classList.remove('hidden');
            }
        }

        function startLoginCountdown(seconds, passwordInput, loginButton, errorDiv) {
            let remaining = seconds;
            const countdownTimer = document.getElementById('countdownTimer');
            const loginInputs = document.getElementById('loginInputs');
            const rateLimitMessage = document.getElementById('rateLimitMessage');

            // Hide login inputs and show rate limit message
            if (loginInputs) loginInputs.classList.add('hidden');
            if (rateLimitMessage) rateLimitMessage.classList.remove('hidden');
            if (errorDiv) errorDiv.classList.add('hidden');

            const updateCountdown = () => {
                if (remaining <= 0) {
                    // Re-enable login
                    if (passwordInput) passwordInput.disabled = false;
                    if (loginButton) loginButton.disabled = false;
                    if (loginInputs) loginInputs.classList.remove('hidden');
                    if (rateLimitMessage) rateLimitMessage.classList.add('hidden');
                    if (errorDiv) errorDiv.classList.add('hidden');
                    return;
                }

                // Update timer display (MM:SS format)
                const minutes = Math.floor(remaining / 60);
                const secs = remaining % 60;
                if (countdownTimer) {
                    countdownTimer.textContent = `${minutes}:${secs.toString().padStart(2, '0')}`;
                }

                remaining--;
                setTimeout(updateCountdown, 1000);
            };

            updateCountdown();
        }
        
        async function logout() {
            try {
                await fetch('/admin/logout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
            } catch (error) {
                console.log('Logout request failed, but continuing with local logout');
            }

            // Clear CSRF token on logout
            clearCsrfToken();

            document.body.classList.add('not-authenticated');
            document.body.classList.remove('authenticated');
            document.getElementById('password').value = '';
        }
        
        // Reload configuration
        async function reloadConfig(button) {
            const svg = button.querySelector('svg');
            const label = button.childNodes[button.childNodes.length - 1];
            const origText = label.textContent;
            button.disabled = true;
            svg.classList.add('animate-spin');
            label.textContent = 'Reloading...';
            try {
                const res = await fetch('/admin/api/reload', { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    label.textContent = `Done (${data.providers.length} providers)`;
                    svg.classList.remove('animate-spin');
                    svg.style.color = '#16a34a';
                    showSuccess('reloadSuccess', `Config reloaded: ${data.providers.length} providers active`);
                    await loadEnvVars().catch(() => {});
                } else {
                    label.textContent = 'Failed';
                    svg.style.color = '#dc2626';
                    showSuccess('reloadSuccess', 'Failed to reload: ' + (data.error || 'Unknown error'));
                }
            } catch (e) {
                label.textContent = 'Error';
                svg.style.color = '#dc2626';
                showSuccess('reloadSuccess', 'Reload failed: ' + e.message);
            } finally {
                setTimeout(() => {
                    button.disabled = false;
                    svg.classList.remove('animate-spin');
                    svg.style.color = '';
                    label.textContent = origText;
                }, 2000);
            }
        }

        // Check All Keys — test every key and update verification status
        async function checkAllKeys(button) {
            const svg = button.querySelector('svg');
            const label = button.childNodes[button.childNodes.length - 1];
            const origText = label.textContent;
            button.disabled = true;
            svg.classList.add('animate-spin');
            label.textContent = 'Checking...';
            try {
                const res = await fetch('/admin/api/test-all-keys', {
                    method: 'POST',
                    headers: { ...authHeaders(), 'Content-Type': 'application/json' }
                });
                const data = await res.json();
                if (data.success) {
                    const s = data.summary;
                    label.textContent = `${s.verified}/${s.total} OK`;
                    svg.style.color = '#16a34a';
                    showSuccessToast(`Key check: ${s.verified}/${s.total} verified, ${s.failed} failed`);
                    // Reload key data and re-render UI
                    try {
                        const usageRes = await fetch('/admin/api/key-usage');
                        if (usageRes.ok) keyUsageData = await usageRes.json();
                    } catch (_) {}
                    try {
                        const histRes = await fetch('/admin/api/key-history');
                        if (histRes.ok) keyHistoryData = await histRes.json();
                    } catch (_) {}
                    renderProviders();
                    if (typeof loadUnifiedStatus === 'function') loadUnifiedStatus();
                } else {
                    label.textContent = 'Failed';
                    svg.style.color = '#dc2626';
                    showErrorToast('Key check failed: ' + (data.error || 'Unknown error'));
                }
            } catch (e) {
                label.textContent = 'Error';
                svg.style.color = '#dc2626';
                showErrorToast('Key check error: ' + e.message);
            } finally {
                setTimeout(() => {
                    button.disabled = false;
                    svg.classList.remove('animate-spin');
                    svg.style.color = '';
                    label.textContent = origText;
                }, 10000);
            }
        }

        // Retry config
        async function loadRetryConfig() {
            try {
                const res = await fetch('/admin/api/retry-config');
                const data = await res.json();
                if (data.global) {
                    // Populate Settings tab and (hidden) API Keys tab global fields
                    document.getElementById('globalMaxRetries').value = data.global.maxRetries;
                    document.getElementById('globalRetryDelay').value = data.global.retryDelayMs;
                    document.getElementById('globalRetryBackoff').value = data.global.retryBackoff;
                }
                const container = document.getElementById('retryPerProvider');
                container.innerHTML = '';
                if (data.perProvider) {
                    for (const [name, config] of Object.entries(data.perProvider)) {
                        const isOverride = config.maxRetries !== data.global.maxRetries || config.retryDelayMs !== data.global.retryDelayMs || config.retryBackoff !== data.global.retryBackoff;
                        const indicator = isOverride 
                            ? '<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">custom</span>'
                            : '<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">using global</span>';
                        const _rn = escapeHtml(name);
                        container.innerHTML += `
                            <div class="grid grid-cols-4 gap-2 items-center ${isOverride ? 'bg-blue-50 dark:bg-blue-900/10 rounded px-2 py-1.5' : 'px-2 py-1'}">
                                <div class="flex items-center gap-1.5">
                                    <span class="text-xs font-mono font-medium text-foreground truncate">${_rn}</span>
                                    ${indicator}
                                </div>
                                <input type="number" min="1" max="20" placeholder="${data.global.maxRetries}" value="${isOverride ? config.maxRetries : ''}" class="retry-prov-input px-2 py-1 text-xs border border-border rounded bg-background text-foreground" data-provider="${_rn}" data-field="maxRetries" title="Leave empty to use global: ${data.global.maxRetries}">
                                <input type="number" min="100" max="30000" step="100" placeholder="${data.global.retryDelayMs}" value="${isOverride ? config.retryDelayMs : ''}" class="retry-prov-input px-2 py-1 text-xs border border-border rounded bg-background text-foreground" data-provider="${_rn}" data-field="retryDelayMs" title="Leave empty to use global: ${data.global.retryDelayMs}ms">
                                <input type="number" min="1" max="10" step="0.5" placeholder="${data.global.retryBackoff}" value="${isOverride ? config.retryBackoff : ''}" class="retry-prov-input px-2 py-1 text-xs border border-border rounded bg-background text-foreground" data-provider="${_rn}" data-field="retryBackoff" title="Leave empty to use global: ${data.global.retryBackoff}">
                            </div>`;
                    }
                }
            } catch (e) { console.error('Failed to load retry config:', e); }
        }

        // ─── General / Performance / Logging Settings ────────────
        async function loadGeneralSettings() {
            try {
                const res = await fetch('/admin/api/general-settings', { headers: authHeaders() });
                const s = await res.json();
                document.getElementById('settingTimeoutMs').value = s.defaultTimeoutMs || 60000;
                document.getElementById('settingCorsOrigin').value = s.corsOrigin || '*';
                document.getElementById('settingRateLimitWindow').value = s.rateLimitWindowMs || 60000;
                document.getElementById('settingRateLimitMax').value = s.rateLimitMax || 100;
                document.getElementById('settingCacheEnabled').checked = s.cacheEnabled !== false;
                document.getElementById('settingCacheTtl').value = s.cacheTtlSec || 300;
                document.getElementById('settingCacheMax').value = s.cacheMaxEntries || 1000;
                document.getElementById('settingCbThreshold').value = s.cbThreshold || 5;
                document.getElementById('settingCbTimeout').value = s.cbTimeoutSec || 30;
                document.getElementById('settingRecoveryEnabled').checked = s.recoveryEnabled !== false;
                document.getElementById('settingRecoveryCooldown').value = s.recoveryCooldownSec || 300;
                document.getElementById('settingAutoCheckKeys').checked = s.autoCheckKeys === true;
                document.getElementById('settingLogLevel').value = s.logLevel || 'info';
                document.getElementById('settingLogBufferMax').value = s.logBufferMax || 200;
            } catch (e) { console.error('Failed to load general settings:', e); }
        }

        // Unified auto-save for all settings (General + Performance + Logging)
        let _autoSaveTimer = null;
        function autoSaveSettings() {
            if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
            _autoSaveTimer = setTimeout(async () => {
                try {
                    const data = {
                        defaultTimeoutMs: parseInt(document.getElementById('settingTimeoutMs').value),
                        corsOrigin: document.getElementById('settingCorsOrigin').value,
                        rateLimitWindowMs: parseInt(document.getElementById('settingRateLimitWindow').value),
                        rateLimitMax: parseInt(document.getElementById('settingRateLimitMax').value),
                        cacheEnabled: document.getElementById('settingCacheEnabled').checked,
                        cacheTtlSec: parseInt(document.getElementById('settingCacheTtl').value),
                        cacheMaxEntries: parseInt(document.getElementById('settingCacheMax').value),
                        cbThreshold: parseInt(document.getElementById('settingCbThreshold').value),
                        cbTimeoutSec: parseInt(document.getElementById('settingCbTimeout').value),
                        recoveryEnabled: document.getElementById('settingRecoveryEnabled').checked,
                        recoveryCooldownSec: parseInt(document.getElementById('settingRecoveryCooldown').value),
                        autoCheckKeys: document.getElementById('settingAutoCheckKeys').checked,
                        logLevel: document.getElementById('settingLogLevel').value,
                        logBufferMax: parseInt(document.getElementById('settingLogBufferMax').value)
                    };
                    const res = await fetch('/admin/api/general-settings', {
                        method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                    const r = await res.json();
                    if (r.success) showSuccessToast('Settings saved');
                } catch (e) { console.error('Auto-save failed:', e); }
            }, 500);
        }

        let _retryAutoSaveTimer = null;
        function autoSaveRetrySettings() {
            if (_retryAutoSaveTimer) clearTimeout(_retryAutoSaveTimer);
            _retryAutoSaveTimer = setTimeout(async () => {
                try {
                    const global = {
                        maxRetries: parseInt(document.getElementById('globalMaxRetries').value),
                        retryDelayMs: parseInt(document.getElementById('globalRetryDelay').value),
                        retryBackoff: parseFloat(document.getElementById('globalRetryBackoff').value)
                    };
                    const res = await fetch('/admin/api/retry-config', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ global, perProvider: {} })
                    });
                    const data = await res.json();
                    if (data.success) { showSuccessToast('Retry settings saved'); await loadRetryConfig(); }
                } catch (e) { console.error('Retry auto-save failed:', e); }
            }, 500);
        }

        // Attach auto-save handlers to all settings inputs after loading
        function attachSettingsAutoSave() {
            const generalIds = ['settingTimeoutMs', 'settingCorsOrigin', 'settingRateLimitWindow', 'settingRateLimitMax',
                'settingCacheEnabled', 'settingCacheTtl', 'settingCacheMax', 'settingCbThreshold', 'settingCbTimeout',
                'settingRecoveryEnabled', 'settingRecoveryCooldown', 'settingAutoCheckKeys', 'settingLogLevel', 'settingLogBufferMax'];
            for (const id of generalIds) {
                const el = document.getElementById(id);
                if (el) el.addEventListener('change', autoSaveSettings);
            }
            const retryIds = ['globalMaxRetries', 'globalRetryDelay', 'globalRetryBackoff'];
            for (const id of retryIds) {
                const el = document.getElementById(id);
                if (el) el.addEventListener('change', autoSaveRetrySettings);
            }
        }

        // Save per-provider retry overrides from API Keys tab
        async function saveRetryConfig(button) {
            button.disabled = true;
            try {
                // Get current global settings (don't modify them)
                const globalRes = await fetch('/admin/api/retry-config');
                const globalData = await globalRes.json();
                
                const perProvider = {};
                document.querySelectorAll('.retry-prov-input').forEach(input => {
                    const provider = input.dataset.provider;
                    const field = input.dataset.field;
                    const val = input.value.trim();
                    if (val === '') return;
                    if (!perProvider[provider]) perProvider[provider] = {};
                    perProvider[provider][field] = field === 'retryBackoff' ? parseFloat(val) : parseInt(val);
                });
                
                const res = await fetch('/admin/api/retry-config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ global: globalData.global, perProvider })
                });
                
                const data = await res.json();
                if (data.success) {
                    showSuccess('retrySuccess', 'Per-provider overrides saved successfully');
                    await loadRetryConfig();
                } else {
                    alert('Failed: ' + (data.error || 'Unknown'));
                }
            } catch (e) {
                alert('Save failed: ' + e.message);
            } finally {
                button.disabled = false;
            }
        }

        // Environment variables functionality
        async function loadEnvVars() {
            // Show loading state
            const loadingIndicator = document.getElementById('loadingIndicator');
            if (loadingIndicator) {
                loadingIndicator.classList.remove('hidden');
            }
            
            try {
                const [envResponse, usageResponse, settingsResponse, historyResponse] = await Promise.all([
                    fetch('/admin/api/env'),
                    fetch('/admin/api/key-usage').catch(() => ({ ok: false })),
                    fetch('/admin/api/telegram').catch(() => ({ ok: false })),
                    fetch('/admin/api/key-history').catch(() => ({ ok: false }))
                ]);

                // Fetch active keys from vault for all providers
                try {
                    const activeRes = await fetch('/admin/api/vault/active-keys');
                    if (activeRes.ok) {
                        window._activeKeyMap = await activeRes.json();
                    }
                } catch (_) {}
                
                if (!envResponse.ok) {
                    throw new Error(`Failed to load environment: ${envResponse.status} ${envResponse.statusText}`);
                }
                
                const envData = await envResponse.json();
                envVars = envData.vars || envData; // Compatibility with both old and new server versions
                const envPath = envData.envPath || 'Not configured';
                // Store key source map from env response
                window._keySourceMap = envData.keySourceMap || {};
                
                const pathDisplay = document.getElementById('resolvedEnvPathDisplay');
                if (pathDisplay) {
                    pathDisplay.textContent = envPath;
                    pathDisplay.title = envPath;
                }
                const extPathInput = document.getElementById('externalEnvPath');
                if (extPathInput) {
                    extPathInput.value = envVars.EXTERNAL_ENV_PATH || '';
                }
                
                if (usageResponse.ok) {
                    keyUsageData = await usageResponse.json();
                }
                if (historyResponse.ok) {
                    keyHistoryData = await historyResponse.json();
                }
                if (settingsResponse.ok) {
                    const settings = await settingsResponse.json();
                    defaultStatusCodes = settings.defaultStatusCodes || '429';
                }
                renderEnvVars();
                updateProviderPreview();
                
                // Load unified status after environment is loaded
                loadUnifiedStatus();
                // Load vault banned/deleted key sections
                loadVaultKeySections();
            } catch (error) {
                console.error('[LOAD] Failed to load environment:', error);
                showError('envError', 'Failed to load environment variables: ' + error.message);
            } finally {
                // Hide loading state
                if (loadingIndicator) {
                    loadingIndicator.classList.add('hidden');
                }
            }
        }
        
        async function saveGlobalSettings() {
            const externalEnvPath = document.getElementById('externalEnvPath').value;
            const btn = document.querySelector('button[onclick="saveGlobalSettings()"]');
            const originalText = btn?.textContent || 'Save';
            if(btn) btn.textContent = 'Saving...';
            try {
                const response = await fetch('/admin/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ EXTERNAL_ENV_PATH: externalEnvPath })
                });
                if (response.ok) {
                    showToast('Global settings saved! KeyProxy has applied the new path.');
                    loadEnvVars();
                } else {
                    const data = await response.json();
                    showToast(data.error || 'Failed to save global settings.', 'error');
                }
            } catch (error) {
                showToast('Network error while saving settings.', 'error');
            } finally {
                if(btn) btn.textContent = originalText;
            }
        }
        
        async function selectEnvFile() {
            const pathInput = document.getElementById('newEnvPath');
            openFsBrowser(pathInput ? pathInput.value : '');
        }

        let currentActiveEnv = '';

        function updateEnvBadge(activeName, totalFiles) {
            const badge = document.getElementById('envBadge');
            const badgeName = document.getElementById('envBadgeName');
            if (!badge || !badgeName) return;
            if (totalFiles <= 1 || !activeName) {
                badge.classList.add('hidden');
                badge.classList.remove('flex');
                return;
            }
            badgeName.textContent = activeName;
            badge.classList.remove('hidden');
            badge.classList.add('flex');
        }

        function updateApiKeysEnvBadge(activeName, totalFiles) {
            const badge = document.getElementById('apiKeysEnvBadge');
            const nameEl = document.getElementById('apiKeysEnvName');
            if (!badge || !nameEl) return;
            if (totalFiles <= 1 || !activeName) {
                badge.classList.add('hidden');
                badge.classList.remove('inline-flex');
                return;
            }
            nameEl.textContent = activeName;
            badge.classList.remove('hidden');
            badge.classList.add('inline-flex');
        }

        // loadEnvFiles removed — use loadConfiguration() instead

        async function switchEnv() {
            const select = document.getElementById('envFileSelect');
            const spinner = document.getElementById('envSwitchSpinner');
            const name = select.value;
            if (!name || name === 'legacy') return;

            if (name === currentActiveEnv) return;

            if (!confirm(`Switch environment to "${name}"? Active proxy connections may be interrupted briefly.`)) {
                select.value = currentActiveEnv;
                return;
            }

            select.disabled = true;
            if (spinner) spinner.classList.remove('hidden');

            try {
                const res = await fetch('/admin/api/switch-env', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name })
                });
                if (res.ok) {
                    currentActiveEnv = name;
                    showSuccessToast(`Switched to ${name}`);
                    loadEnvVars();
                    loadConfiguration();
                } else {
                    const data = await res.json().catch(() => ({}));
                    showErrorToast('Failed to switch: ' + (data.error || 'Unknown error'));
                    select.value = currentActiveEnv;
                }
            } catch (err) {
                showErrorToast('Failed to switch env: ' + err.message);
                select.value = currentActiveEnv;
            } finally {
                select.disabled = false;
                if (spinner) spinner.classList.add('hidden');
            }
        }

        async function addEnvFile() {
            const name = document.getElementById('newEnvName').value.trim();
            const filePath = document.getElementById('newEnvPath').value.trim();
            if (!name || !filePath) return;
            try {
                const res = await fetch('/admin/api/env-files', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, path: filePath })
                });
                if (res.ok) {
                    document.getElementById('newEnvName').value = '';
                    document.getElementById('newEnvPath').value = '';
                    showSuccessToast(`Added env "${name}"`);
                    loadConfiguration();
                } else {
                    const data = await res.json().catch(() => ({}));
                    showErrorToast('Failed to add: ' + (data.error || 'Unknown error'));
                }
            } catch (err) {
                showErrorToast('Failed to add env file: ' + err.message);
            }
        }

        async function removeEnvFile(name) {
            if (!confirm(`Remove "${name}" from env list?`)) return;
            try {
                const res = await fetch('/admin/api/env-files', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name })
                });
                if (res.ok) {
                    showSuccessToast(`Removed env "${name}"`);
                    loadConfiguration();
                }
            } catch (err) {
                showErrorToast('Failed to remove env file: ' + err.message);
            }
        }

        let draggedEnvItem = null;

        function envDragStart(e) {
            draggedEnvItem = e.target.closest('[data-env-name]');
            if (!draggedEnvItem) return;
            draggedEnvItem.classList.add('env-item-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', draggedEnvItem.dataset.envName);
        }

        function envDragOver(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const target = e.target.closest('[data-env-name]');
            if (target && target !== draggedEnvItem) {
                target.classList.add('env-item-drag-over');
            }
        }

        function envDragLeave(e) {
            const target = e.target.closest('[data-env-name]');
            if (target) target.classList.remove('env-item-drag-over');
        }

        function envDrop(e) {
            e.preventDefault();
            const target = e.target.closest('[data-env-name]');
            if (!target || !draggedEnvItem || target === draggedEnvItem) return;
            target.classList.remove('env-item-drag-over');

            const list = document.getElementById('envFileList');
            const items = [...list.querySelectorAll('[data-env-name]')];
            const draggedIdx = items.indexOf(draggedEnvItem);
            const targetIdx = items.indexOf(target);

            if (draggedIdx < targetIdx) {
                list.insertBefore(draggedEnvItem, target.nextSibling);
            } else {
                list.insertBefore(draggedEnvItem, target);
            }

            const newOrder = [...list.querySelectorAll('[data-env-name]')].map(el => el.dataset.envName);
            persistEnvOrder(newOrder);
        }

        function envDragEnd(e) {
            if (draggedEnvItem) draggedEnvItem.classList.remove('env-item-dragging');
            document.querySelectorAll('.env-item-drag-over').forEach(el => el.classList.remove('env-item-drag-over'));
            draggedEnvItem = null;
        }

        async function persistEnvOrder(names) {
            try {
                const res = await fetch('/admin/api/reorder-env-files', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ names })
                });
                const data = await res.json();
                if (data.success) {
                    showSuccessToast('Env order updated');
                    loadConfiguration();
                } else {
                    showErrorToast('Failed to update env order');
                }
            } catch (err) {
                showErrorToast('Failed to update env order: ' + err.message);
            }
        }

        // Configuration Tab Functions
        let configEnvFiles = [];

        async function loadConfiguration() {
            try {
                const res = await fetch('/admin/api/env-files');
                const data = await res.json();
                configEnvFiles = data.files || [];

                // Update env badges (header + API Keys tab)
                const activeName = data.active || '';
                const totalFiles = configEnvFiles.length;
                updateEnvBadge(activeName, totalFiles);
                updateApiKeysEnvBadge(activeName, totalFiles);
            } catch (err) {
                console.error('Failed to load configuration:', err);
            }
        }

        // ─── Exclusion Patterns ────

        let exclusionPatterns = [];

        async function loadExclusions() {
            try {
                const res = await fetch('/admin/api/exclusions');
                const data = await res.json();
                exclusionPatterns = data.patterns || [];
                renderExclusionsTable();
            } catch (err) {
                const list = document.getElementById('exclusionPatternsList');
                if (list) list.innerHTML = '<div class="text-center text-muted-foreground text-sm py-4">Failed to load exclusions</div>';
            }
        }

        function renderExclusionsTable() {
            const list = document.getElementById('exclusionPatternsList');
            if (!list) return;

            if (exclusionPatterns.length === 0) {
                list.innerHTML = '<div class="text-center text-muted-foreground text-sm py-4">No exclusion patterns configured</div>';
                return;
            }

            list.innerHTML = exclusionPatterns.map(p => {
                const typeBadge = p.type === 'regex'
                    ? '<span class="px-1.5 py-0.5 text-[10px] bg-purple-500/20 text-purple-400 rounded">regex</span>'
                    : '<span class="px-1.5 py-0.5 text-[10px] bg-blue-500/20 text-blue-400 rounded">glob</span>';
                const enabledBadge = p.enabled
                    ? '<span class="px-1.5 py-0.5 text-[10px] bg-green-500/20 text-green-400 rounded">active</span>'
                    : '<span class="px-1.5 py-0.5 text-[10px] bg-red-500/20 text-red-400 rounded">disabled</span>';

                return `
                    <div class="flex items-center gap-3 p-2 rounded ${p.enabled ? 'bg-card' : 'bg-card opacity-60'}">
                        <code class="text-sm font-mono flex-1 text-foreground">${escapeHtml(p.pattern)}</code>
                        ${typeBadge}
                        ${enabledBadge}
                        ${p.description ? `<span class="text-[11px] text-muted-foreground truncate max-w-[200px]">${escapeHtml(p.description)}</span>` : ''}
                        <button onclick="toggleExclusion('${p.id}')" class="p-1 text-muted-foreground hover:text-foreground" title="${p.enabled ? 'Disable' : 'Enable'}">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${p.enabled ? 'M18.364 18.364A9 9 0 015.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636' : 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'}"/></svg>
                        </button>
                        <button onclick="removeExclusion('${p.id}')" class="p-1 text-muted-foreground hover:text-red-500" title="Remove">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                        </button>
                    </div>
                `;
            }).join('');
        }

        async function addExclusion() {
            const patternInput = document.getElementById('exclusionPatternInput');
            const typeSelect = document.getElementById('exclusionTypeSelect');
            const descInput = document.getElementById('exclusionDescInput');

            const pattern = patternInput.value.trim();
            if (!pattern) {
                showErrorToast('Enter a pattern');
                return;
            }

            try {
                const body = { pattern };
                if (typeSelect.value !== 'auto') body.type = typeSelect.value;
                if (descInput.value.trim()) body.description = descInput.value.trim();

                const res = await fetch('/admin/api/exclusions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const data = await res.json();
                if (data.success) {
                    patternInput.value = '';
                    descInput.value = '';
                    typeSelect.value = 'auto';
                    showSuccessToast(`Pattern "${pattern}" added`);
                    loadExclusions();
                } else {
                    showErrorToast(data.error || 'Failed to add pattern');
                }
            } catch (err) {
                showErrorToast('Failed to add: ' + err.message);
            }
        }

        async function removeExclusion(id) {
            try {
                const res = await fetch('/admin/api/exclusions', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id })
                });
                const data = await res.json();
                if (data.success) {
                    showSuccessToast('Pattern removed');
                    loadExclusions();
                } else {
                    showErrorToast(data.error || 'Failed to remove');
                }
            } catch (err) {
                showErrorToast('Failed to remove: ' + err.message);
            }
        }

        async function toggleExclusion(id) {
            try {
                const res = await fetch('/admin/api/exclusions/toggle', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id })
                });
                const data = await res.json();
                if (data.success) {
                    showSuccessToast(`Pattern ${data.pattern.enabled ? 'enabled' : 'disabled'}`);
                    loadExclusions();
                } else {
                    showErrorToast(data.error || 'Failed to toggle');
                }
            } catch (err) {
                showErrorToast('Failed to toggle: ' + err.message);
            }
        }

        async function testExclusion() {
            const input = document.getElementById('exclusionTestInput');
            const result = document.getElementById('exclusionTestResult');
            const name = input.value.trim();
            if (!name) {
                result.textContent = '';
                return;
            }

            try {
                const res = await fetch('/admin/api/exclusions/test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name })
                });
                const data = await res.json();
                if (data.excluded) {
                    result.innerHTML = '<span class="text-red-400 font-medium">BLOCKED</span> <span class="text-muted-foreground">by ' + escapeHtml(data.matchedBy) + '</span>';
                } else {
                    result.innerHTML = '<span class="text-green-400 font-medium">ALLOWED</span>';
                }
            } catch (err) {
                result.textContent = 'Error: ' + sanitizeError(err);
            }
        }

        // escapeHtml moved to top of script block


        let originalValues = {};
        let keyUsageData = {};
        let keyHistoryData = {};
        
        function renderEnvVars() {

            // Render providers
            renderProviders();
            // Load unified status (RPM + Expiry) after render
            loadUnifiedStatus();
            // Restore collapse state
            loadCollapseState();
        }

        function isProviderSyncOn(provider) {
            const envKey = `${provider.apiType.toUpperCase()}_${provider.name.toUpperCase()}_SYNC_ENV`;
            const perProvider = envVars[envKey]?.toLowerCase();
            if (perProvider === 'true') return true;
            if (perProvider === 'false') return false;
            return envVars['SYNC_TO_OS_ENV']?.toLowerCase() === 'true';
        }

        function renderProviders() {
            const providersContainer = document.getElementById('providersContainer');
            providersContainer.innerHTML = '';

            // Group environment variables by provider
            const providers = {};
            
            for (const [key, value] of Object.entries(envVars)) {
                if (key.endsWith('_API_KEYS') && value) {
                    // First try to match the pattern APITYPE_PROVIDERNAME_API_KEYS
                    // We need to split only on the FIRST underscore to preserve provider names with underscores
                    const keyWithoutSuffix = key.replace('_API_KEYS', '');
                    const firstUnderscoreIndex = keyWithoutSuffix.indexOf('_');

                    if (firstUnderscoreIndex > 0) {
                        const apiType = keyWithoutSuffix.substring(0, firstUnderscoreIndex).toLowerCase();
                        const providerName = keyWithoutSuffix.substring(firstUnderscoreIndex + 1).toLowerCase();
                        const providerKey = `${apiType}_${providerName}`;

                        if (!providers[providerKey]) {
                            providers[providerKey] = {
                                name: providerName,
                                apiType: apiType,
                                keys: [],
                                baseUrl: '',
                                accessKey: '',
                                defaultModel: '',
                                modelHistory: [],
                                allowedModels: [],
                                envVarName: key
                            };
                        }
                        const rawKeys = value.split(',').map(k => k.trim()).filter(k => k);
                        providers[providerKey].keys = rawKeys.map(k => {
                            if (k.startsWith('~')) {
                                return { key: k.substring(1), disabled: true };
                            }
                            return { key: k, disabled: false };
                        });
                    }
                } else if (key.endsWith('_ALLOWED_MODELS') && value) {
                    const keyWithoutSuffix = key.replace('_ALLOWED_MODELS', '');
                    const firstUnderscoreIndex = keyWithoutSuffix.indexOf('_');
                    if (firstUnderscoreIndex > 0) {
                        const apiType = keyWithoutSuffix.substring(0, firstUnderscoreIndex).toLowerCase();
                        const providerName = keyWithoutSuffix.substring(firstUnderscoreIndex + 1).toLowerCase();
                        const providerKey = `${apiType}_${providerName}`;
                        if (!providers[providerKey]) {
                            providers[providerKey] = {
                                name: providerName,
                                apiType: apiType,
                                keys: [],
                                baseUrl: '',
                                accessKey: '',
                                defaultModel: '',
                                modelHistory: [],
                                allowedModels: []
                            };
                        }
                        providers[providerKey].allowedModels = value.split(',').map(m => m.trim()).filter(m => m);
                    }
                } else if (key.endsWith('_DISABLED') && value) {
                    const keyWithoutSuffix = key.replace('_DISABLED', '');
                    const firstUnderscoreIndex = keyWithoutSuffix.indexOf('_');
                    if (firstUnderscoreIndex > 0) {
                        const apiType = keyWithoutSuffix.substring(0, firstUnderscoreIndex).toLowerCase();
                        const providerName = keyWithoutSuffix.substring(firstUnderscoreIndex + 1).toLowerCase();
                        const providerKey = `${apiType}_${providerName}`;
                        if (!providers[providerKey]) {
                            providers[providerKey] = { name: providerName, apiType: apiType, keys: [], baseUrl: '', accessKey: '', defaultModel: '', modelHistory: [], allowedModels: [] };
                        }
                        providers[providerKey].disabled = (value.trim().toLowerCase() === 'true');
                    }
                } else if (key.endsWith('_SYNC_ENV') && value) {
                    const keyWithoutSuffix = key.replace('_SYNC_ENV', '');
                    const firstUnderscoreIndex = keyWithoutSuffix.indexOf('_');
                    if (firstUnderscoreIndex > 0) {
                        const apiType = keyWithoutSuffix.substring(0, firstUnderscoreIndex).toLowerCase();
                        const providerName = keyWithoutSuffix.substring(firstUnderscoreIndex + 1).toLowerCase();
                        const providerKey = `${apiType}_${providerName}`;
                        if (!providers[providerKey]) {
                            providers[providerKey] = { name: providerName, apiType: apiType, keys: [], baseUrl: '', accessKey: '', defaultModel: '', modelHistory: [], allowedModels: [] };
                        }
                        providers[providerKey].syncEnv = (value.trim().toLowerCase() === 'true');
                    }
                } else if (key.endsWith('_BASE_URL') && value) {
                    const match = key.match(/^(.+)_(.+)_BASE_URL$/);
                    if (match && match.length >= 3) {
                        const apiType = match[1].toLowerCase();
                        const providerName = match[2].toLowerCase();
                        const providerKey = `${apiType}_${providerName}`;
                        
                        if (!providers[providerKey]) {
                            providers[providerKey] = {
                                name: providerName,
                                apiType: apiType,
                                keys: [],
                                baseUrl: '',
                                accessKey: '',
                                defaultModel: '',
                                modelHistory: [],
                                allowedModels: []
                            };
                        }
                        providers[providerKey].baseUrl = value;
                    }
                } else if (key.endsWith('_ACCESS_KEY') && value) {
                    const match = key.match(/^(.+)_(.+)_ACCESS_KEY$/);
                    if (match && match.length >= 3) {
                        const apiType = match[1].toLowerCase();
                        const providerName = match[2].toLowerCase();
                        const providerKey = `${apiType}_${providerName}`;

                        if (!providers[providerKey]) {
                            providers[providerKey] = {
                                name: providerName,
                                apiType: apiType,
                                keys: [],
                                baseUrl: '',
                                accessKey: '',
                                defaultModel: '',
                                modelHistory: [],
                                allowedModels: []
                            };
                        }
                        providers[providerKey].accessKey = value;
                    }
                } else if (key.endsWith('_DEFAULT_MODEL') && value) {
                    // Extract API_TYPE and PROVIDER from key
                    const parts = key.replace('_DEFAULT_MODEL', '').split('_');
                    if (parts.length < 2) continue;

                    const apiType = parts[0].toLowerCase();
                    const providerName = parts.slice(1).join('_').toLowerCase();
                    const providerKey = `${apiType}_${providerName}`;

                    if (!providers[providerKey]) {
                        providers[providerKey] = {
                            name: providerName,
                            apiType: apiType,
                            keys: [],
                            baseUrl: '',
                            accessKey: '',
                            defaultModel: '',
                            modelHistory: [],
                            allowedModels: []
                        };
                    }
                    providers[providerKey].defaultModel = value;
                } else if (key.endsWith('_MODEL_HISTORY') && value) {
                    // Extract API_TYPE and PROVIDER from key
                    const parts = key.replace('_MODEL_HISTORY', '').split('_');
                    if (parts.length < 2) continue;

                    const apiType = parts[0].toLowerCase();
                    const providerName = parts.slice(1).join('_').toLowerCase();
                    const providerKey = `${apiType}_${providerName}`;

                    if (!providers[providerKey]) {
                        providers[providerKey] = {
                            name: providerName,
                            apiType: apiType,
                            keys: [],
                            baseUrl: '',
                            accessKey: '',
                            defaultModel: '',
                            modelHistory: [],
                            allowedModels: []
                        };
                    }
                    providers[providerKey].modelHistory = value.split(',').map(m => m.trim()).filter(m => m);
                }
            }

            // Add current default model to each provider's history if it exists
            Object.values(providers).forEach(provider => {
                // If provider has a default model, ensure it's in the history
                if (provider.defaultModel && provider.defaultModel.trim()) {
                    const currentModel = provider.defaultModel.trim();

                    // Remove if already exists (to re-add at front)
                    const filteredHistory = provider.modelHistory.filter(m => m !== currentModel);

                    // Add current model at the front (no limit - keep all models)
                    provider.modelHistory = [currentModel, ...filteredHistory];
                }
            });

            // Display each provider (disabled providers at the end)
            const sortedProviders = Object.values(providers).sort((a, b) => (a.disabled ? 1 : 0) - (b.disabled ? 1 : 0));
            sortedProviders.forEach((provider, index) => {
                const providerDiv = document.createElement('div');
                providerDiv.className = 'key-row';
                providerDiv.id = `provider-section-${provider.apiType}-${provider.name}`;
                providerDiv.dataset.providerName = provider.name;

                // Determine initial button state for access key
                let accessKeyButtonHtml, accessKeyAction, accessKeyClass, accessKeyStyle, accessKeyTitle;

                if (provider.accessKey) {
                    // Has value - show delete icon
                    accessKeyButtonHtml = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                       </svg>`;
                    accessKeyAction = `deleteAccessKey('${provider.apiType}', '${provider.name}')`;
                    accessKeyClass = 'text-muted-foreground hover:text-foreground p-1';
                    accessKeyStyle = '';
                    accessKeyTitle = 'Delete';
                } else {
                    // Empty - show disabled save icon
                    accessKeyButtonHtml = `<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M7 19V13H17V19H19V7.828L16.172 5H15V9H9V5H5V19H7ZM17 5V7H15V5H17ZM19 3L21 5V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H19Z"></path>
                       </svg>`;
                    accessKeyAction = '';  // No action when disabled
                    accessKeyClass = 'cursor-not-allowed p-1';
                    accessKeyStyle = 'pointer-events: none; opacity: 0.3;';
                    accessKeyTitle = 'Nothing to save';
                }

                // Determine initial button state for default model
                let defaultModelButtonHtml, defaultModelAction, defaultModelClass, defaultModelStyle, defaultModelTitle;

                if (provider.defaultModel) {
                    // Has value - show delete icon
                    defaultModelButtonHtml = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                       </svg>`;
                    defaultModelAction = `deleteDefaultModel('${provider.apiType}', '${provider.name}')`;
                    defaultModelClass = 'absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1';
                    defaultModelStyle = '';
                    defaultModelTitle = 'Delete';
                } else {
                    // Empty - show disabled save icon
                    defaultModelButtonHtml = `<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M7 19V13H17V19H19V7.828L16.172 5H15V9H9V5H5V19H7ZM17 5V7H15V5H17ZM19 3L21 5V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H19Z"></path>
                       </svg>`;
                    defaultModelAction = '';  // No action when disabled
                    defaultModelClass = 'absolute right-2 top-1/2 -translate-y-1/2 cursor-not-allowed p-1';
                    defaultModelStyle = 'pointer-events: none; opacity: 0.3;';
                    defaultModelTitle = 'Nothing to save';
                }

                const enabledKeyCount = provider.keys.filter(k => !k.disabled).length;
                const totalKeyCount = provider.keys.length;
                const isProviderDisabled = provider.disabled || false;

                const providerCollapseId = `${provider.apiType}_${provider.name}`;
                const providerCategory = getProviderCategory(provider.name);
                const categoryBadgeHtml = providerCategory ? `<span class="text-[10px] font-semibold px-1.5 py-0.5 rounded category-badge-${providerCategory}">${providerCategory.toUpperCase()}</span> ` : '';
                // Pre-computed safe values for XSS prevention
                const _pn = escapeHtml(provider.name);
                const _pa = escapeHtml(provider.apiType);
                const _jn = safeJsAttr(provider.name);
                const _ja = safeJsAttr(provider.apiType);
                const _pc = escapeHtml(providerCollapseId);
                const _jc = safeJsAttr(providerCollapseId);

                providerDiv.innerHTML = `
                    <div class="space-y-4${isProviderDisabled ? ' opacity-60' : ''}">
                        <!-- Header with provider name and actions -->
                        <div class="flex items-center justify-between cursor-pointer select-none provider-header" onclick="toggleProviderCollapse('${_jc}')">
                            <div class="flex items-center space-x-3">
                                <svg id="provider-chevron-${providerCollapseId}" class="w-4 h-4 text-muted-foreground transition-transform duration-200 provider-chevron" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
                                <label class="toggle-switch" title="${isProviderDisabled ? 'Enable provider' : 'Disable provider'}" onclick="event.stopPropagation()">
                                    <input type="checkbox" ${!isProviderDisabled ? 'checked' : ''} onchange="toggleProvider('${_ja}', '${_jn}', !this.checked)">
                                    <span class="toggle-slider"></span>
                                </label>
                                <div id="provider-name-${_pa}-${_pn}" class="flex items-center gap-1.5">
                                    <h4 class="text-sm font-medium text-foreground">${_pn} ${categoryBadgeHtml}${isProviderDisabled ? '<span class="text-xs text-destructive font-normal">(disabled)</span>' : ''}</h4>
                                    <button onclick="event.stopPropagation(); startRenameProvider('${_ja}', '${_jn}')" class="transition-colors p-0.5 text-muted-foreground hover:text-foreground" title="Rename provider">
                                        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
                                    </button>
                                </div>
                                <p class="text-xs text-muted-foreground">${enabledKeyCount}/${totalKeyCount} keys active</p>
                            </div>
                            <div class="flex items-center space-x-1.5" onclick="event.stopPropagation()">
                                <button
                                    onclick="copyAgentContext('${_ja}', '${_jn}')"
                                    class="btn btn-secondary px-2 py-1 text-xs font-medium"
                                    title="Copy agent context"
                                >
                                    <svg class="w-3.5 h-3.5 inline mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>Agent
                                </button>
                                <button
                                    onclick="copyActiveKey('${_ja}', '${_jn}')"
                                    class="btn btn-secondary px-2 py-1 text-xs font-medium"
                                    title="Copy active API key (raw value)"
                                >Key</button>
                                <button
                                    onclick="copyProviderCurl('${_ja}', '${_jn}', 'completions')"
                                    class="btn btn-secondary px-2 py-1 text-xs font-medium"
                                    title="Copy cURL command"
                                >cURL</button>
                                <button
                                    onclick="copyProviderEnvVar('${_ja}', '${_jn}')"
                                    class="btn btn-secondary px-2 py-1 text-xs font-medium"
                                    title="Copy .env variables"
                                >.env</button>
                                <button
                                    id="syncBtn_${_pa}_${_pn}"
                                    onclick="toggleSyncEnv('${_ja}', '${_jn}')"
                                    class="transition-colors p-1 ${isProviderSyncOn(provider) ? 'text-green-500' : 'text-muted-foreground hover:text-foreground'}"
                                    title="${isProviderSyncOn(provider) ? 'Sync ON — click to disable' : 'Sync OFF — click to enable'}"
                                >
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                                </button>
                                <button
                                    onclick="showDeleteProviderConfirmation('${_ja}', '${_jn}')"
                                    class="text-destructive hover:text-destructive/80 transition-colors p-1"
                                    title="Delete Provider"
                                >
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <!-- Collapsible content container -->
                        <div class="provider-keys-container" id="provider-keys-${providerCollapseId}" style="display: none;">


                            <!-- Default Model Row -->
                            <div class="mb-3">
                                <label class="block text-xs text-muted-foreground mb-1.5 font-medium">Default Model (Optional)</label>
                                <div class="relative max-w-md">
                                    <input
                                        type="text"
                                        id="defaultModel_${_pa}_${_pn}"
                                        value="${provider.defaultModel || ''}"
                                        data-original="${provider.defaultModel || ''}"
                                        class="input-field w-full px-3 py-2 pr-20 text-xs rounded transition-colors"
                                        placeholder="${provider.apiType === 'openai' ? 'e.g., gpt-4o-mini' : 'e.g., gemini-1.5-flash'}"
                                        oninput="checkForChanges('defaultModel', '${_ja}', '${_jn}')"
                                        onkeypress="if(event.key === 'Enter') saveDefaultModel('${_ja}', '${_jn}')"
                                        autocomplete="off"
                                    >
                                    <button
                                        id="historyBtn_defaultModel_${_pa}_${_pn}"
                                        onclick="toggleModelHistory('${_ja}', '${_jn}')"
                                        class="absolute right-12 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 transition-colors"
                                        title="Model History"
                                        ${(!provider.modelHistory || provider.modelHistory.length === 0) ? 'disabled style="opacity: 0.3; cursor: not-allowed; pointer-events: none;"' : ''}
                                    >
                                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                                        </svg>
                                    </button>
                                    <button
                                        id="saveBtn_defaultModel_${_pa}_${_pn}"
                                        ${defaultModelAction ? `onclick="${defaultModelAction}"` : ''}
                                        class="${defaultModelClass}"
                                        style="${defaultModelStyle}"
                                        title="${defaultModelTitle}"
                                    >
                                        ${defaultModelButtonHtml}
                                    </button>
                                    <div id="modelHistory_${_pa}_${_pn}" class="hidden absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded shadow-lg z-10 max-h-48 overflow-y-auto">
                                        ${(provider.modelHistory && provider.modelHistory.length > 0) ? provider.modelHistory.map(model => `
                                            <div class="flex items-center justify-between px-3 py-2 text-xs hover:bg-secondary transition-colors group">
                                                <button
                                                    onclick="selectModelFromHistory('${_ja}', '${_jn}', '${model.replace(/'/g, "&apos;")}')"
                                                    class="flex-1 text-left"
                                                >
                                                    ${model}
                                                </button>
                                                <button
                                                    onclick="showDeleteModelConfirmation(event, '${_ja}', '${_jn}', '${model.replace(/'/g, "&apos;")}')"
                                                    class="ml-2 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                                                    title="Remove from history"
                                                >
                                                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                                                    </svg>
                                                </button>
                                            </div>
                                        `).join('') : ''}
                                    </div>
                                </div>
                            </div>

                        <!-- Model Access Control (only for AI providers) -->
                        ${(() => {
                            // MCP providers don't have models concept
                            const mcpProviders = ['brave', 'tavily', 'tavily_mcp', 'exa', 'firecrawl', 'context7', 'onref', 'searchapi', 'jina'];
                            const isMcpProvider = mcpProviders.includes(provider.name.toLowerCase());
                            
                            if (isMcpProvider) {
                                return `<div class="bg-muted/30 rounded-lg p-3">
                                    <div class="text-xs text-muted-foreground text-center py-2">
                                        <svg class="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        Model selection not applicable for this provider type
                                    </div>
                                </div>`;
                            }
                            
                            return `
                        <div class="bg-muted/30 rounded-lg p-3 space-y-3" id="modelAccess_${_pa}_${_pn}">
                            <div class="flex items-center justify-between">
                                <div class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Model Access</div>
                                <div class="flex items-center space-x-2">
                                    ${provider.allowedModels && provider.allowedModels.length > 0 ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">${provider.allowedModels.length} allowed</span>` : `<span class="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">All models</span>`}
                                    <button
                                        onclick="clearAllowedModels('${_ja}', '${_jn}')"
                                        class="text-[10px] px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground border border-border hover:border-foreground/20 transition-colors"
                                        title="Remove all model restrictions"
                                    >Clear</button>
                                </div>
                            </div>
                            <div class="flex items-center space-x-2">
                                <button
                                    onclick="fetchProviderModels('${_ja}', '${_jn}')"
                                    id="fetchModelsBtn_${_pa}_${_pn}"
                                    class="btn btn-secondary px-2.5 py-1.5 text-xs font-medium"
                                    title="Query provider API to discover available models"
                                >
                                    <svg class="w-3.5 h-3.5 inline mr-1 animate-spin hidden" id="fetchModelsSpinner_${_pa}_${_pn}" fill="none" viewBox="0 0 24 24">
                                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    <span id="fetchModelsBtnText_${_pa}_${_pn}">Fetch Models</span>
                                </button>
                                <input
                                    type="text"
                                    id="modelSearch_${_pa}_${_pn}"
                                    placeholder="Filter models..."
                                    class="input-field flex-1 px-2 py-1.5 text-xs rounded transition-colors"
                                    oninput="filterModelList('${_ja}', '${_jn}')"
                                >
                            </div>
                            <div id="modelListContainer_${_pa}_${_pn}" class="hidden">
                                <div class="flex items-center justify-between mb-2">
                                    <span class="text-[10px] text-muted-foreground" id="modelCount_${_pa}_${_pn}"></span>
                                    <div class="flex items-center space-x-2">
                                        <button onclick="selectAllModels('${_ja}', '${_jn}')" class="text-[10px] text-primary hover:underline">Select All</button>
                                        <button onclick="deselectAllModels('${_ja}', '${_jn}')" class="text-[10px] text-muted-foreground hover:underline">Deselect All</button>
                                    </div>
                                </div>
                                <div id="modelList_${_pa}_${_pn}" class="max-h-48 overflow-y-auto space-y-0.5 border border-border rounded bg-background"></div>
                                <div class="mt-2 flex items-center justify-between">
                                    <span class="text-[10px] text-muted-foreground" id="selectedModelCount_${_pa}_${_pn}">0 selected</span>
                                    <button
                                        onclick="saveAllowedModels('${_ja}', '${_jn}')"
                                        class="btn btn-primary px-3 py-1.5 text-xs font-medium"
                                    >Save Selection</button>
                                </div>
                            </div>
                            ${provider.allowedModels && provider.allowedModels.length > 0 ? `
                            <div class="flex flex-wrap gap-1" id="allowedModelsTags_${_pa}_${_pn}">
                                ${provider.allowedModels.map(m => `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono bg-primary/10 text-primary border border-primary/20">${escapeHtml(m)}</span>`).join('')}
                            </div>` : ''}
                        </div>`;
                        })()}

                        ${(() => {
                            const port = window.location.port || '8990';
                            const mcpMap = {
                                tavily_mcp: {
                                    label: 'search-tavily',
                                    transport: 'stdio',
                                    command: 'npx',
                                    args: ['mcp-remote', `http://localhost:${port}/tavily_mcp/?tavilyApiKey=YOUR_ACCESS_KEY`],
                                    note: 'Uses mcp-remote to proxy MCP protocol. Replace YOUR_ACCESS_KEY with the provider access key, or remove the query param if no access key.'
                                },
                                firecrawl: {
                                    label: 'doc-firecrawl',
                                    transport: 'stdio',
                                    command: 'npx',
                                    args: ['-y', 'firecrawl-mcp'],
                                    env: { FIRECRAWL_API_URL: `http://localhost:${port}/firecrawl` },
                                    note: 'Set FIRECRAWL_API_URL to the proxy endpoint. The proxy injects the real API key.'
                                },
                                context7: {
                                    label: 'doc-context7',
                                    transport: 'stdio',
                                    command: 'npx',
                                    args: ['-y', '@upstreamapi/context7-mcp'],
                                    env: { CONTEXT7_API_URL: `http://localhost:${port}/context7` },
                                    note: 'Override the API URL to route through the proxy.'
                                },
                                exa: {
                                    label: 'search-exa',
                                    transport: 'stdio',
                                    command: 'npx',
                                    args: ['-y', 'exa-mcp-server'],
                                    env: { EXA_API_URL: `http://localhost:${port}/exa` },
                                    note: 'Override the API URL to route through the proxy.'
                                },
                                jina: {
                                    label: 'search-jina-reader',
                                    transport: 'stdio',
                                    command: 'npx',
                                    args: ['-y', '@jina/reader-mcp'],
                                    env: { JINA_API_URL: `http://localhost:${port}/jina` },
                                    note: 'Override the API URL to route through the proxy.'
                                }
                            };
                            const mcp = mcpMap[provider.name];
                            if (!mcp) return '';
                            const configJson = JSON.stringify({
                                [mcp.label]: {
                                    type: mcp.transport,
                                    command: mcp.command,
                                    args: mcp.args,
                                    ...(mcp.env ? { env: mcp.env } : {})
                                }
                            }, null, 2);
                            return `
                            <div class="mt-3 border border-blue-500/20 rounded-lg overflow-hidden">
                                <button onclick="this.nextElementSibling.classList.toggle('hidden');this.querySelector('.chevron').classList.toggle('rotate-180')"
                                    class="w-full flex items-center justify-between px-3 py-2 bg-blue-500/5 hover:bg-blue-500/10 transition-colors text-left">
                                    <div class="flex items-center space-x-2">
                                        <span class="text-xs font-semibold text-blue-400">MCP Configuration</span>
                                        <span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">.claude.json</span>
                                    </div>
                                    <svg class="w-4 h-4 text-blue-400 chevron transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
                                </button>
                                <div class="hidden px-3 py-3 space-y-2 bg-blue-500/5">
                                    <pre class="bg-black/30 text-green-400 text-[11px] font-mono p-3 rounded overflow-x-auto leading-relaxed"><code>${'$'}{configJson.replace(/</g, '&lt;')}</code></pre>
                                    <div class="flex items-center justify-between">
                                        <span class="text-[10px] text-muted-foreground">${'$'}{mcp.note}</span>
                                        <button onclick="navigator.clipboard.writeText(this.closest('.space-y-2').querySelector('code').textContent);this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',2000)"
                                            class="text-xs px-2 py-1 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 hover:bg-blue-500/20 transition-colors">Copy</button>
                                    </div>
                                </div>
                            </div>`;
                        })()}
                        <div>
                            <div class="flex items-center justify-between cursor-pointer select-none mb-1" onclick="toggleSection('keys-${providerCollapseId}')">
                                <label class="text-muted-foreground text-xs font-medium cursor-pointer">API Keys</label>
                                <svg class="w-3 h-3 text-muted-foreground transition-transform" id="section-chevron-keys-${providerCollapseId}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
                            </div>
                            <div id="section-keys-${providerCollapseId}">
                            <div class="space-y-1">
                                ${provider.keys.map((keyObj, keyIndex) => {
                                    const keyVal = keyObj.key;
                                    const isKeyDisabled = keyObj.disabled;
                                    const maskedKey = keyVal.length > 16 ? keyVal.substring(0, 8) + '...' + keyVal.slice(-4) : keyVal;
                                    const usageEntry = (keyUsageData[provider.name] || []).find(u => u.fullKey === keyVal);
                                    const usageDisplay = usageEntry ? usageEntry.usageCount : 0;
                                    // Key history status (map 'fresh' to 'unverified' for backward compat)
                                    let keyStatus = usageEntry?.status || 'unverified';
                                    if (keyStatus === 'fresh') keyStatus = 'unverified';
                                    const rotationReason = usageEntry?.rotationReason || null;
                                    const rotationCount = usageEntry?.rotationCount || 0;
                                    const lastCheckTime = usageEntry?.lastCheckTime || null;
                                    const statusClass = `key-${keyStatus}`;
                                    const dotClass = `dot-${keyStatus}`;

                                    // Status color mapping
                                    const statusColors = { active: '#3b82f6', exhausted: '#6b7280', unverified: '#f59e0b', verified: '#22c55e', failed: '#ef4444', frozen: '#8b5cf6' };
                                    const borderColor = statusColors[keyStatus] || '#6b7280';

                                    // Badge HTML for each status
                                    let badgeHtml;
                                    if (keyStatus === 'active') {
                                        badgeHtml = '<span class="key-badge badge-active">ACTIVE</span>';
                                    } else if (keyStatus === 'exhausted') {
                                        badgeHtml = `<span class="key-badge badge-exhausted">EXHAUSTED${rotationReason ? ' ' + rotationReason : ''}</span>
                                               <span class="recovery-countdown text-xs text-amber-400" data-provider="${_pn}" data-fullkey="${keyVal}" title="Recovery status">...</span>`;
                                    } else if (keyStatus === 'verified') {
                                        badgeHtml = '<span class="key-badge badge-verified">VERIFIED</span>';
                                    } else if (keyStatus === 'failed') {
                                        badgeHtml = '<span class="key-badge badge-failed">FAILED</span>';
                                    } else if (keyStatus === 'frozen') {
                                        const freezeReason = usageEntry?.freezeReason || rotationReason || 'balance_exhausted';
                                        badgeHtml = `<span class="key-badge badge-frozen" title="Frozen permanently: ${freezeReason}">FROZEN</span>
                                               <span class="text-xs text-purple-400">${freezeReason}</span>`;
                                    } else {
                                        badgeHtml = '<span class="key-badge badge-unverified">UNVERIFIED</span>';
                                    }

                                    // Env var source label
                                    const envSourceMap = window._keySourceMap || {};
                                    const envSourceName = envSourceMap[provider.name + ':' + keyVal] || '';

                                    // Check if this is the currently active key in rotation
                                    const activeKeyForProvider = (window._activeKeyMap || {})[provider.name];
                                    const isInUse = activeKeyForProvider && activeKeyForProvider === keyVal;

                                    // Last check time display
                                    let lastCheckDisplay = '';
                                    if (lastCheckTime) {
                                        const ago = Math.round((Date.now() - new Date(lastCheckTime).getTime()) / 60000);
                                        lastCheckDisplay = ago < 1 ? 'just now' : ago < 60 ? ago + 'm ago' : ago < 1440 ? Math.round(ago / 60) + 'h ago' : Math.round(ago / 1440) + 'd ago';
                                    } else {
                                        lastCheckDisplay = 'Never tested';
                                    }

                                    return `
                                    <div class="flex items-center space-x-2${isKeyDisabled ? ' opacity-50' : ''} ${statusClass}" style="border-left:3px solid ${borderColor}; padding-left:8px; border-radius:4px;${keyStatus === 'exhausted' ? ' opacity:0.5;' : ''}${keyStatus === 'frozen' ? ' opacity:0.4;' : ''}">
                                        <!-- Status dot -->
                                        <span class="key-status-dot ${dotClass}" title="${keyStatus}"></span>
                                        ${badgeHtml}
                                        ${isInUse ? '<span class="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" title="Currently in-use by KeyRotator"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>IN USE</span>' : ''}
                                        <!-- Reorder arrows -->
                                        <div class="flex flex-col">
                                            <button onclick="moveKey('${_ja}', '${_jn}', ${keyIndex}, 'up')"
                                                class="text-muted-foreground hover:text-foreground p-0 leading-none${keyIndex === 0 ? ' invisible' : ''}" title="Move up">
                                                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>
                                            </button>
                                            <button onclick="moveKey('${_ja}', '${_jn}', ${keyIndex}, 'down')"
                                                class="text-muted-foreground hover:text-foreground p-0 leading-none${keyIndex === provider.keys.length - 1 ? ' invisible' : ''}" title="Move down">
                                                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
                                            </button>
                                        </div>
                                        <!-- Toggle key -->
                                        <label class="toggle-switch toggle-sm" title="${isKeyDisabled ? 'Enable key' : 'Disable key'}">
                                            <input type="checkbox" ${!isKeyDisabled ? 'checked' : ''} onchange="toggleKey('${_ja}', '${_jn}', ${keyIndex}, !this.checked)">
                                            <span class="toggle-slider"></span>
                                        </label>
                                        <!-- Key value -->
                                        <div class="flex-1 font-mono text-xs text-foreground bg-muted px-2 py-1 rounded cursor-pointer hover:bg-muted/70${isKeyDisabled ? ' line-through' : ''}" onclick="copyToClipboard('${keyVal.replace(/'/g, "\\'")}', 'Key copied!')" title="Click to copy key">
                                            ${maskedKey}
                                        </div>
                                        ${envSourceName ? `<span class="text-[10px] text-muted-foreground font-mono" title="Source: ${envSourceName}">${envSourceName.length > 25 ? envSourceName.substring(0, 22) + '...' : envSourceName}</span>` : ''}
                                        <span class="text-[10px] text-muted-foreground whitespace-nowrap" title="Last checked">${lastCheckDisplay}</span>
                                        <!-- Copy as ENV_VAR=key button -->
                                        <button onclick="copyToClipboard('${(envSourceName || (provider.apiType.toUpperCase() + '_' + provider.name.toUpperCase() + '_API_KEYS')).replace(/'/g, "\\'")}=${keyVal.replace(/'/g, "\\'")}', 'Env var copied')" class="text-muted-foreground hover:text-foreground p-1" title="Copy as ENV_VAR=value">
                                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>
                                        </button>
                                        <!-- Usage count + rotation count + RPM + Expiry -->
                                        <span class="text-xs text-muted-foreground whitespace-nowrap" title="Times used${rotationCount > 0 ? ' / Rotations: ' + rotationCount : ''}">${usageDisplay} uses${rotationCount > 0 ? ' / ' + rotationCount + ' rot' : ''}</span>
                                        <span class="rpm-badge text-xs px-1.5 py-0.5 rounded" data-key="${maskedKey}" data-provider="${_pa}" title="Requests per minute">--rpm</span>
                                        <span class="expiry-badge expiry-none expiry-slot" data-key="${maskedKey}" data-maskedkey="${keyVal.length >= 8 ? keyVal.substring(0, 4) + '...' + keyVal.slice(-4) : keyVal}" data-provider="${_pn}" data-fullkey="${keyVal}" title="Key TTL">${usageEntry?.expiry ? formatExpiry(usageEntry.expiry) : '—'}</span>
                                        ${usageEntry?.expiry ? `<button onclick="extendKeyTtl('${_jn}', this)" class="btn btn-extend px-2 py-1 text-xs font-medium" data-provider="${_pn}" data-fullkey="${keyVal}" title="Reset key TTL timer">Extend</button>` : ''}
                                        ${keyStatus === 'frozen'
                                            ? `<button onclick="unfreezeKey('${_jn}', '${keyVal}')" class="btn px-2 py-1 text-xs font-medium" style="background:rgba(139,92,246,0.15);color:#8b5cf6;border:1px solid rgba(139,92,246,0.3)" title="Manually unfreeze this key">Unfreeze</button>
                                               <button onclick="testProviderKey('${_ja}', '${_jn}', '${keyVal}', ${keyIndex})" class="btn btn-secondary px-2 py-1 text-xs font-medium">Test</button>`
                                            : keyStatus === 'exhausted'
                                            ? `<button onclick="testAndRecoverKey('${_jn}', '${keyVal}')" class="btn px-2 py-1 text-xs font-medium" style="background:rgba(234,179,8,0.15);color:#eab308;border:1px solid rgba(234,179,8,0.3)">Test & Reset</button>
                                               <button onclick="forceProbeKey('${_jn}', '${keyVal}', this)" class="btn px-2 py-1 text-xs font-medium" style="background:rgba(59,130,246,0.15);color:#3b82f6;border:1px solid rgba(59,130,246,0.3)" title="Force immediate recovery probe">Force Probe</button>`
                                            : `<button onclick="testProviderKey('${_ja}', '${_jn}', '${keyVal}', ${keyIndex})" class="btn btn-secondary px-2 py-1 text-xs font-medium">Test</button>`
                                        }
                                        <button
                                            onclick="showDeleteKeyConfirmation('${_ja}', '${_jn}', ${keyIndex})"
                                            class="btn btn-destructive px-2 py-1 text-xs font-medium"
                                            title="Delete Key"
                                        >
                                            Delete
                                        </button>
                                    </div>`;
                                }).join('')}
                                <div class="flex items-center space-x-2 mt-2 pt-2 border-t border-border">
                                    <input 
                                        type="text" 
                                        id="newKey_${_pa}_${_pn}" 
                                        class="input-field flex-1 px-2 py-1 text-xs rounded transition-colors" 
                                        placeholder="Enter new API key"
                                    >
                                    <button 
                                        onclick="testProviderNewKey('${_ja}', '${_jn}')" 
                                        class="btn btn-secondary px-2 py-1 text-xs font-medium"
                                    >
                                        Test
                                    </button>
                                    <button 
                                        onclick="saveProviderKey('${_ja}', '${_jn}')" 
                                        class="btn btn-primary px-2 py-1 text-xs font-medium"
                                    >
                                        Test & Save
                                    </button>
                                </div>
                                <div id="newKeyResult_${_pa}_${_pn}" class="mt-2"></div>
                                <!-- Reset History Button -->
                                <div class="flex justify-end mt-1">
                                    <button onclick="resetKeyHistory('${_jn}')" class="text-xs text-muted-foreground hover:text-foreground underline" title="Clear rotation history for this provider">Reset History</button>
                                </div>
                            </div>
                            </div>
                        </div>
                        </div>
                    </div>
                `;
                providersContainer.appendChild(providerDiv);
            });

            // Key counts summary
            const summaryEl = document.getElementById('keyCountsSummary');
            if (summaryEl) {
                let total = 0, verified = 0, active = 0, failed = 0, unverified = 0, exhausted = 0, frozenCount = 0;
                for (const provider of Object.values(providers)) {
                    for (const keyObj of provider.keys) {
                        total++;
                        const usageEntry = (keyUsageData[provider.name] || []).find(u => u.fullKey === keyObj.key);
                        let status = usageEntry?.status || 'unverified';
                        if (status === 'fresh') status = 'unverified';
                        if (status === 'verified') verified++;
                        else if (status === 'active') active++;
                        else if (status === 'failed') failed++;
                        else if (status === 'exhausted') exhausted++;
                        else if (status === 'frozen') frozenCount++;
                        else unverified++;
                    }
                }
                if (total > 0) {
                    summaryEl.innerHTML = `
                        <span>Total: <strong>${total}</strong></span>
                        <span class="text-green-500">Verified: <strong>${verified}</strong></span>
                        <span class="text-blue-500">Active: <strong>${active}</strong></span>
                        <span class="text-amber-500">Unverified: <strong>${unverified}</strong></span>
                        <span class="text-red-500">Failed: <strong>${failed}</strong></span>
                        ${exhausted > 0 ? `<span class="text-gray-400">Exhausted: <strong>${exhausted}</strong></span>` : ''}
                        ${frozenCount > 0 ? `<span class="text-purple-400">Frozen: <strong>${frozenCount}</strong></span>` : ''}
                    `;
                } else {
                    summaryEl.innerHTML = '';
                }
            }

            if (Object.keys(providers).length === 0) {
                providersContainer.innerHTML = '<div class="text-muted-foreground text-sm text-center py-4">No providers configured yet. Add one below.</div>';
            }
            applyProviderFilter();
        }

        // --- Provider search filter ---
        let _providerFilterQuery = '';

        function filterProviders(query) {
            _providerFilterQuery = query.trim().toLowerCase();
            const clearBtn = document.getElementById('providerSearchClear');
            if (clearBtn) clearBtn.classList.toggle('hidden', !_providerFilterQuery);
            applyProviderFilter();
        }

        function clearProviderSearch() {
            const input = document.getElementById('providerSearchInput');
            if (input) input.value = '';
            _providerFilterQuery = '';
            const clearBtn = document.getElementById('providerSearchClear');
            if (clearBtn) clearBtn.classList.add('hidden');
            applyProviderFilter();
        }

        // ── Vault banned & deleted keys UI ──────────────────────────

        async function loadVaultKeySections() {
            try {
                const vaultRes = await fetch('/admin/api/vault/keys');
                if (!vaultRes.ok) return;
                const allKeys = await vaultRes.json();

                const banned = allKeys.filter(k => k.status === 'banned');
                const bannedSection = document.getElementById('bannedKeysSection');
                const bannedContainer = document.getElementById('bannedKeysContainer');
                const bannedCount = document.getElementById('bannedKeysCount');
                if (banned.length > 0 && bannedSection && bannedContainer) {
                    bannedSection.style.display = '';
                    bannedCount.textContent = `(${banned.length})`;
                    bannedContainer.innerHTML = banned.map(k => {
                        const masked = k.keyValue.length > 16 ? k.keyValue.substring(0, 8) + '...' + k.keyValue.slice(-4) : k.keyValue;
                        const banDate = k.bannedAt ? new Date(k.bannedAt).toLocaleString() : 'unknown';
                        return `<div class="flex items-center space-x-2" style="border-left:3px solid #ef4444;padding-left:8px;border-radius:4px;opacity:0.7">
                            <span class="key-badge badge-failed">BANNED</span>
                            <span class="text-xs text-muted-foreground">${escapeHtml(k.providerName)}</span>
                            <code class="text-xs font-mono bg-muted px-2 py-0.5 rounded">${escapeHtml(masked)}</code>
                            <span class="text-[10px] text-muted-foreground">${escapeHtml(k.banReason || '')} &middot; ${banDate}</span>
                            <button onclick="vaultUnbanKey('${escapeHtml(k.id)}')" class="btn btn-secondary px-2 py-1 text-xs font-medium">Unban</button>
                        </div>`;
                    }).join('');
                } else if (bannedSection) {
                    bannedSection.style.display = 'none';
                }

                const deletedRes = await fetch('/admin/api/vault/deleted');
                const deleted = deletedRes.ok ? await deletedRes.json() : [];
                const deletedSection = document.getElementById('deletedKeysSection');
                const deletedContainer = document.getElementById('deletedKeysContainer');
                const deletedCount = document.getElementById('deletedKeysCount');
                if (deleted.length > 0 && deletedSection && deletedContainer) {
                    deletedSection.style.display = '';
                    deletedCount.textContent = `(${deleted.length})`;
                    deletedContainer.innerHTML = deleted.map(k => {
                        const masked = k.keyValue.length > 16 ? k.keyValue.substring(0, 8) + '...' + k.keyValue.slice(-4) : k.keyValue;
                        const delDate = k.deletedAt ? new Date(k.deletedAt).toLocaleString() : 'unknown';
                        return `<div class="flex items-center space-x-2" style="border-left:3px solid #6b7280;padding-left:8px;border-radius:4px;opacity:0.5">
                            <span class="key-badge" style="background:rgba(107,114,128,0.15);color:#9ca3af;border:1px solid rgba(107,114,128,0.3)">DELETED</span>
                            <span class="text-xs text-muted-foreground">${escapeHtml(k.providerName)}</span>
                            <code class="text-xs font-mono bg-muted px-2 py-0.5 rounded">${escapeHtml(masked)}</code>
                            <span class="text-[10px] text-muted-foreground">${delDate}</span>
                            <button onclick="vaultRestoreKey('${escapeHtml(k.id)}')" class="btn btn-secondary px-2 py-1 text-xs font-medium">Restore</button>
                            <button onclick="vaultPermaDeleteKey('${escapeHtml(k.id)}')" class="btn btn-destructive px-2 py-1 text-xs font-medium">Permanent Delete</button>
                        </div>`;
                    }).join('');
                } else if (deletedSection) {
                    deletedSection.style.display = 'none';
                }
            } catch (e) {
                console.error('[VAULT] Failed to load key sections:', e);
            }
        }

        async function vaultUnbanKey(keyId) {
            try {
                const res = await fetch(`/admin/api/vault/keys/${keyId}/unban`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
                const data = await res.json();
                if (data.success) {
                    showSuccessToast('Key unbanned successfully');
                    loadVaultKeySections();
                } else {
                    showErrorToast(data.error || 'Failed to unban key');
                }
            } catch (e) { showErrorToast('Unban failed: ' + e.message); }
        }

        async function vaultRestoreKey(keyId) {
            try {
                const res = await fetch(`/admin/api/vault/keys/${keyId}/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
                const data = await res.json();
                if (data.success) {
                    showSuccessToast('Key restored successfully');
                    loadVaultKeySections();
                    loadEnvVars();
                } else {
                    showErrorToast(data.error || 'Failed to restore key');
                }
            } catch (e) { showErrorToast('Restore failed: ' + e.message); }
        }

        async function vaultPermaDeleteKey(keyId) {
            if (!confirm('Permanently delete this key? This cannot be undone.')) return;
            try {
                const res = await fetch(`/admin/api/vault/keys/${keyId}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
                const data = await res.json();
                if (data.success) {
                    showSuccessToast('Key permanently deleted');
                    loadVaultKeySections();
                } else {
                    showErrorToast(data.error || 'Failed to delete key');
                }
            } catch (e) { showErrorToast('Delete failed: ' + e.message); }
        }

        function filterByCategory(cat) {
            _activeCategory = cat;
            document.querySelectorAll('.category-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.cat === (cat || 'all'));
            });
            applyProviderFilter();
        }

        function applyProviderFilter() {
            const container = document.getElementById('providersContainer');
            if (!container) return;
            Array.from(container.children).forEach(card => {
                let visible = true;
                // Category filter
                if (_activeCategory) {
                    const name = card.dataset.providerName || '';
                    visible = getProviderCategory(name) === _activeCategory;
                }
                // Text search filter
                if (visible && _providerFilterQuery) {
                    const text = card.textContent.toLowerCase();
                    visible = text.includes(_providerFilterQuery);
                }
                card.classList.toggle('hidden', !visible);
            });
        }

        // --- Collapsible provider sections ---
        function toggleProviderCollapse(name) {
            const container = document.getElementById(`provider-keys-${name}`);
            const chevron = document.getElementById(`provider-chevron-${name}`);
            if (!container) return;
            const isExpanded = container.style.display !== 'none';
            container.style.display = isExpanded ? 'none' : 'block';
            if (chevron) chevron.classList.toggle('rotate-90', !isExpanded);
            saveCollapseState();
        }

        function toggleSection(sectionId) {
            const container = document.getElementById(`section-${sectionId}`);
            const chevron = document.getElementById(`section-chevron-${sectionId}`);
            if (!container) return;
            const isExpanded = container.style.display !== 'none';
            container.style.display = isExpanded ? 'none' : 'block';
            if (chevron) chevron.classList.toggle('rotate-90', !isExpanded);
        }

        function saveCollapseState() {
            const state = {};
            document.querySelectorAll('.provider-keys-container').forEach(el => {
                const name = el.id.replace('provider-keys-', '');
                state[name] = el.style.display !== 'none';
            });
            localStorage.setItem('keyproxy_provider_collapse_state', JSON.stringify(state));
        }

        function loadCollapseState() {
            try {
                const saved = JSON.parse(localStorage.getItem('keyproxy_provider_collapse_state'));
                if (!saved) return; // default: all collapsed
                Object.entries(saved).forEach(([name, expanded]) => {
                    const container = document.getElementById(`provider-keys-${name}`);
                    const chevron = document.getElementById(`provider-chevron-${name}`);
                    if (container) container.style.display = expanded ? 'block' : 'none';
                    if (chevron) chevron.classList.toggle('rotate-90', expanded);
                });
            } catch {}
        }

        function expandAllProviders() {
            document.querySelectorAll('.key-row:not(.hidden) .provider-keys-container').forEach(el => el.style.display = 'block');
            document.querySelectorAll('.key-row:not(.hidden) .provider-chevron').forEach(el => el.classList.add('rotate-90'));
            saveCollapseState();
        }

        function collapseAllProviders() {
            document.querySelectorAll('.key-row:not(.hidden) .provider-keys-container').forEach(el => el.style.display = 'none');
            document.querySelectorAll('.key-row:not(.hidden) .provider-chevron').forEach(el => el.classList.remove('rotate-90'));
            saveCollapseState();
        }

        // Removed legacy key rendering - now everything is managed as providers
        
        function updateEnvVar(key, value) {
            envVars[key] = value;
        }

        async function toggleKey(apiType, providerName, keyIndex, disabled) {
            try {
                const response = await fetch('/admin/api/toggle-key', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ apiType, providerName, keyIndex, disabled })
                });
                const result = await response.json();
                if (result.success) {
                    showSuccessToast(disabled ? 'Key disabled' : 'Key enabled');
                    await loadEnvVars();
                } else {
                    showErrorToast('Failed to toggle key');
                }
            } catch (error) {
                showErrorToast('Failed to toggle key: ' + error.message);
            }
        }

        async function resetKeyHistory(providerName) {
            if (!confirm('Reset rotation history for ' + providerName + '?')) return;
            try {
                const response = await fetch('/admin/api/key-history/reset/' + providerName, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                const result = await response.json();
                if (result.success) {
                    showSuccessToast('History reset for ' + providerName);
                    await loadEnvVars();
                } else {
                    showErrorToast('Failed to reset history');
                }
            } catch (error) {
                showErrorToast('Error: ' + error.message);
            }
        }

        async function toggleProvider(apiType, providerName, disabled) {
            try {
                const response = await fetch('/admin/api/toggle-provider', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ apiType, providerName, disabled })
                });
                const result = await response.json();
                if (result.success) {
                    showSuccessToast(disabled ? 'Provider disabled' : 'Provider enabled');
                    await loadEnvVars();
                } else {
                    showErrorToast('Failed to toggle provider');
                }
            } catch (error) {
                showErrorToast('Failed to toggle provider: ' + error.message);
            }
        }

        async function toggleSyncEnv(apiType, providerName) {
            try {
                const envKey = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_SYNC_ENV`;
                const currentState = envVars[envKey]?.toLowerCase() === 'true';
                const enabled = !currentState;

                const res = await fetch('/admin/api/toggle-sync-env', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ apiType, providerName, enabled })
                });
                const data = await res.json();
                if (data.success) {
                    envVars[envKey] = enabled ? 'true' : 'false';
                    showSuccessToast(enabled ? `Sync ON: ${providerName} → setx ${providerName.toUpperCase()}_API_KEY` : `Sync OFF for ${providerName}`);
                    renderProviders();
                } else {
                    showErrorToast('Failed: ' + (data.error || 'Unknown'));
                }
            } catch (error) {
                showErrorToast('Failed to toggle sync: ' + error.message);
            }
        }

        async function toggleGlobalSync() {
            try {
                const currentState = envVars['SYNC_TO_OS_ENV']?.toLowerCase() === 'true';
                const enabled = !currentState;

                const res = await fetch('/admin/api/toggle-global-sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled })
                });
                const data = await res.json();
                if (data.success) {
                    envVars['SYNC_TO_OS_ENV'] = enabled ? 'true' : 'false';
                    updateGlobalSyncUI();
                    showSuccessToast(enabled ? 'Global Sync ON — active keys will be written to OS env' : 'Global Sync OFF');
                    renderProviders();
                } else {
                    showErrorToast('Failed: ' + (data.error || 'Unknown'));
                }
            } catch (error) {
                showErrorToast('Failed to toggle global sync: ' + error.message);
            }
        }

        function updateGlobalSyncUI() {
            const enabled = envVars['SYNC_TO_OS_ENV']?.toLowerCase() === 'true';
            const toggle = document.getElementById('globalSyncToggle');
            const dot = document.getElementById('globalSyncDot');
            const status = document.getElementById('globalSyncStatus');
            const info = document.getElementById('globalSyncInfo');

            if (enabled) {
                toggle.className = 'relative w-10 h-5 rounded-full transition-colors bg-green-500 cursor-pointer';
                dot.className = 'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform translate-x-5';
                status.textContent = 'Enabled';
                status.className = 'ml-2 text-xs text-green-500 font-medium';
                info.classList.remove('hidden');
            } else {
                toggle.className = 'relative w-10 h-5 rounded-full transition-colors bg-muted cursor-pointer';
                dot.className = 'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-muted-foreground transition-transform';
                status.textContent = 'Disabled';
                status.className = 'ml-2 text-xs text-muted-foreground';
                info.classList.add('hidden');
            }
        }

        let syncExclusiveProviders = [];

        async function loadSyncExclusiveProviders() {
            try {
                const res = await fetch('/admin/api/sync-exclusive', { headers: authHeaders() });
                if (!res.ok) return;
                const data = await res.json();
                syncExclusiveProviders = data.exclusiveProviders || [];
                renderSyncExclusive(data.allProviders || []);
            } catch (err) {
                console.error('Failed to load sync exclusive:', err);
            }
        }

        function renderSyncExclusive(allProviders) {
            const list = document.getElementById('syncExclusiveList');
            if (!list) return;

            if (allProviders.length === 0) {
                list.innerHTML = '<div class="text-center text-muted-foreground text-xs py-2">No providers configured</div>';
                return;
            }

            list.innerHTML = allProviders.map(p => {
                const isExcluded = syncExclusiveProviders.includes(p.name.toLowerCase());
                return `
                <label class="flex items-center gap-2 p-1.5 rounded hover:bg-muted/50 cursor-pointer">
                    <input type="checkbox" ${isExcluded ? 'checked' : ''}
                           onchange="toggleSyncExclusive('${escapeHtml(p.name)}', this.checked)"
                           class="rounded border-border text-red-500 focus:ring-red-500">
                    <span class="text-sm text-foreground">${escapeHtml(p.name)}</span>
                    <span class="text-xs text-muted-foreground">${escapeHtml(p.apiType)}</span>
                    ${isExcluded ? '<span class="ml-auto text-xs text-red-400">Excluded</span>' : ''}
                </label>`;
            }).join('');
        }

        async function toggleSyncExclusive(providerName, exclusive) {
            try {
                const res = await fetch('/admin/api/sync-exclusive', {
                    method: 'POST',
                    headers: { ...authHeaders(), 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                    body: JSON.stringify({ providerName, exclusive })
                });
                const data = await res.json();
                if (data.success) {
                    syncExclusiveProviders = data.exclusiveProviders || [];
                    showSuccessToast(exclusive ? `${providerName} excluded from sync` : `${providerName} sync restored`);
                    loadSyncExclusiveProviders();
                }
            } catch (err) {
                showErrorToast('Failed to toggle sync exclusive');
            }
        }

        async function moveKey(apiType, providerName, keyIndex, direction) {
            // Read current key order from env
            const envKey = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_API_KEYS`;
            const currentValue = envVars[envKey] || '';
            const rawKeys = currentValue.split(',').map(k => k.trim()).filter(k => k);

            const newIndex = direction === 'up' ? keyIndex - 1 : keyIndex + 1;
            if (newIndex < 0 || newIndex >= rawKeys.length) return;

            // Swap keys (keeping ~ prefix intact)
            [rawKeys[keyIndex], rawKeys[newIndex]] = [rawKeys[newIndex], rawKeys[keyIndex]];

            // Extract clean keys (without ~ prefix) for the reorder API
            const cleanKeys = rawKeys.map(k => k.startsWith('~') ? k.substring(1) : k);

            try {
                const response = await fetch('/admin/api/reorder-keys', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ apiType, providerName, keys: cleanKeys })
                });
                const result = await response.json();
                if (result.success) {
                    await loadEnvVars();
                } else {
                    showErrorToast('Failed to reorder keys');
                }
            } catch (error) {
                showErrorToast('Failed to reorder keys: ' + error.message);
            }
        }

        // Removed old input change handlers - no longer needed

        // Legacy functions removed - using provider management instead

        // Moved to removeLegacyKey function
        
        // Confirmation dialog variables
        let pendingDelete = null;
        
        // Removed - using direct confirmation instead
        
        // Removed - no longer needed
        
        function cancelDelete() {
            pendingDelete = null;
            document.getElementById('confirmDialog').classList.add('hidden');
        }
        
        function confirmDelete() {
            if (pendingDelete) {
                // No pending deletes in new system
            }
            document.getElementById('confirmDialog').classList.add('hidden');
        }
        
        // Helper function to get default provider configuration
        function getDefaultProviderConfig(apiType) {
            const defaults = {
                openai: {
                    name: 'openai',
                    baseUrl: 'https://api.openai.com/v1'
                },
                gemini: {
                    name: 'gemini',
                    baseUrl: 'https://generativelanguage.googleapis.com/v1'
                }
            };
            return defaults[apiType] || null;
        }

        // Update the provider preview dynamically
        function updateProviderPreview() {
            const name = document.getElementById('newProviderName').value.trim();
            const apiType = document.getElementById('newProviderApiType').value;
            const baseUrl = document.getElementById('newProviderBaseUrl').value.trim();
            const previewElement = document.getElementById('previewText');
            const envPreview = document.getElementById('addProviderEnvPreview');
            const copyBtn = document.getElementById('copyPreviewBtn');

            if (!previewElement) return;

            const defaultConfig = getDefaultProviderConfig(apiType);
            if (!defaultConfig) {
                previewElement.textContent = 'Unknown API type';
                return;
            }

            const effectiveName = name || defaultConfig.name;
            const effectiveUrl = baseUrl || defaultConfig.baseUrl;
            const envVarName = `${apiType.toUpperCase()}_${effectiveName.toUpperCase()}_API_KEYS`;
            const prefix = `${apiType.toUpperCase()}_${effectiveName.toUpperCase()}`;

            // Update the header env preview badge
            if (envPreview) {
                envPreview.textContent = `${envVarName}=...`;
            }

            const hasName = name.length > 0;
            const hasBaseUrl = baseUrl.length > 0;

            // Check for validation errors
            if (hasName && !hasBaseUrl) {
                previewElement.innerHTML = `<span class="text-destructive">Base URL required when provider name is set</span>`;
                previewElement.parentElement.style.borderColor = 'var(--destructive)';
                if (copyBtn) copyBtn.classList.add('hidden');
                return;
            }

            if (!hasName && hasBaseUrl) {
                previewElement.innerHTML = `<span class="text-destructive">Provider name required when base URL is set</span>`;
                previewElement.parentElement.style.borderColor = 'var(--destructive)';
                if (copyBtn) copyBtn.classList.add('hidden');
                return;
            }

            // Reset preview styling
            previewElement.parentElement.style.borderColor = '';

            // Build multi-line env var preview
            const keyInputs = document.querySelectorAll('.new-provider-key');
            const keyCount = [...keyInputs].filter(i => i.value.trim()).length;
            const keyLabel = keyCount === 0 ? 'no keys yet' : `${keyCount} key${keyCount > 1 ? 's' : ''}`;

            let lines = [];
            lines.push(`<span class="text-primary font-bold">${escapeHtml(envVarName)}</span>=<span class="text-foreground">${escapeHtml(keyLabel)}</span>`);

            if (baseUrl) {
                lines.push(`<span class="text-muted-foreground">${escapeHtml(prefix)}_BASE_URL=${escapeHtml(effectiveUrl)}</span>`);
            }

            // Optional fields
            const accessKey = document.getElementById('newProviderAccessKey')?.value.trim();
            const defaultModel = document.getElementById('newProviderDefaultModel')?.value.trim();
            const syncEnv = document.getElementById('newProviderSyncEnv')?.value;

            if (accessKey) {
                lines.push(`<span class="text-muted-foreground">${escapeHtml(prefix)}_ACCESS_KEY=***</span>`);
            }
            if (defaultModel) {
                lines.push(`<span class="text-muted-foreground">${escapeHtml(prefix)}_DEFAULT_MODEL=${escapeHtml(defaultModel)}</span>`);
            }
            if (syncEnv) {
                lines.push(`<span class="text-muted-foreground">${escapeHtml(prefix)}_SYNC_ENV=${escapeHtml(syncEnv)}</span>`);
            }

            previewElement.innerHTML = lines.join('<br>');

            // Show/hide copy button
            if (copyBtn) {
                if (keyCount > 0) {
                    copyBtn.classList.remove('hidden');
                } else {
                    copyBtn.classList.add('hidden');
                }
            }
        }

        function copyEnvPreview() {
            const name = document.getElementById('newProviderName').value.trim();
            const apiType = document.getElementById('newProviderApiType').value;
            const baseUrl = document.getElementById('newProviderBaseUrl').value.trim();
            const defaultConfig = getDefaultProviderConfig(apiType);
            if (!defaultConfig) return;

            const effectiveName = name || defaultConfig.name;
            const effectiveUrl = baseUrl || defaultConfig.baseUrl;
            const prefix = `${apiType.toUpperCase()}_${effectiveName.toUpperCase()}`;

            const keyInputs = document.querySelectorAll('.new-provider-key');
            const keys = [...keyInputs].filter(i => i.value.trim()).map(i => i.value.trim());

            let lines = [`${prefix}_API_KEYS=${keys.join(',')}`];
            if (baseUrl) lines.push(`${prefix}_BASE_URL=${effectiveUrl}`);

            const accessKey = document.getElementById('newProviderAccessKey')?.value.trim();
            const defaultModel = document.getElementById('newProviderDefaultModel')?.value.trim();
            const syncEnv = document.getElementById('newProviderSyncEnv')?.value;
            if (accessKey) lines.push(`${prefix}_ACCESS_KEY=${accessKey}`);
            if (defaultModel) lines.push(`${prefix}_DEFAULT_MODEL=${defaultModel}`);
            if (syncEnv) lines.push(`${prefix}_SYNC_ENV=${syncEnv}`);

            navigator.clipboard.writeText(lines.join('\n')).then(() => {
                showSuccessToast('Env variables copied to clipboard');
            }).catch(() => {
                showErrorToast('Failed to copy to clipboard');
            });
        }

        // New provider functions
        async function addNewProvider() {
            const saveBtn = document.getElementById('addProviderSaveBtn');
            const saveText = document.getElementById('addProviderSaveText');
            const statusEl = document.getElementById('addProviderStatus');
            const checkIcon = document.getElementById('addProviderCheckIcon');
            const spinnerIcon = document.getElementById('addProviderSpinner');
            const originalText = saveText?.textContent || 'Test & Save Provider';

            // Set loading state with spinner
            if (saveBtn) saveBtn.disabled = true;
            if (saveText) saveText.textContent = 'Testing keys...';
            if (checkIcon) checkIcon.classList.add('hidden');
            if (spinnerIcon) spinnerIcon.classList.remove('hidden');
            if (statusEl) statusEl.textContent = '';
            // Set loading state
            if (saveBtn) saveBtn.disabled = true;
            if (saveText) saveText.textContent = 'Testing keys...';
            if (statusEl) statusEl.textContent = '';

            try {
            let name = document.getElementById('newProviderName').value.trim();
            const apiType = document.getElementById('newProviderApiType').value;
            let baseUrl = document.getElementById('newProviderBaseUrl').value.trim();
            const resultDiv = document.getElementById('newProviderResult');

            // Check for trailing slash in base URL
            if (baseUrl && baseUrl.endsWith('/')) {
                showErrorToast('Please remove the trailing slash from the base URL before saving');
                return;
            }
            
            // Collect all API keys
            const keyInputs = document.querySelectorAll('.new-provider-key');
            const apiKeys = [];
            for (const input of keyInputs) {
                const key = input.value.trim();
                if (key) {
                    apiKeys.push(key);
                }
            }
            
            if (apiKeys.length === 0) {
                showWarningToast('At least one API key is required');
                return;
            }

            // Check for duplicate keys within the new provider
            const uniqueKeys = new Set(apiKeys);
            if (uniqueKeys.size !== apiKeys.length) {
                showWarningToast('Duplicate keys found. Please remove duplicate entries.');
                return;
            }

            // Validate that if either name or base URL is provided, both must be provided
            const hasName = name.length > 0;
            const hasBaseUrl = baseUrl.length > 0;
            
            if (hasName && !hasBaseUrl) {
                showErrorToast('If you provide a provider name, you must also provide a base URL (or leave both empty for default)');
                return;
            }
            
            if (!hasName && hasBaseUrl) {
                showErrorToast('If you provide a base URL, you must also provide a provider name (or leave both empty for default)');
                return;
            }

            // Handle default provider creation
            const isDefaultProvider = !hasName && !hasBaseUrl;
            if (isDefaultProvider) {
                const defaultConfig = getDefaultProviderConfig(apiType);
                if (!defaultConfig) {
                    showErrorToast('Unknown API type for default provider');
                    return;
                }
                
                name = defaultConfig.name;
                baseUrl = defaultConfig.baseUrl;
                
                showInfoToast(`Creating default ${apiType.toUpperCase()} provider '${name}' with base URL: ${baseUrl}`);
            } else {
                showInfoToast(`Creating custom provider '${name}' with base URL: ${baseUrl}`);
            }
            
            // Validate provider name (alphanumeric and underscores only)
            if (!/^[a-zA-Z0-9_]+$/.test(name)) {
                showErrorToast('Provider name can only contain letters, numbers, and underscores');
                return;
            }

            // Check for duplicates against existing keys in this provider
            const existingKeysVar = `${apiType.toUpperCase()}_${name.toUpperCase()}_API_KEYS`;
            if (envVars[existingKeysVar]) {
                const existing = envVars[existingKeysVar].split(',').map(k => k.trim().replace(/^~/, ''));
                const dupes = apiKeys.filter(k => existing.includes(k));
                if (dupes.length > 0) {
                    const maskedDupes = dupes.map(k => k.length > 16 ? k.substring(0, 8) + '...' + k.slice(-4) : k);
                    showWarningToast(`Key(s) already exist in this provider: ${maskedDupes.join(', ')}`);
                    return;
                }
            }

            // Test all API keys before saving
            showInfoToast('Testing all API keys before saving...');
            let allKeysValid = true;
            const testedKeys = [];

            for (let i = 0; i < apiKeys.length; i++) {
                const apiKey = apiKeys[i];
                const maskedKey = apiKey.length > 16 ? apiKey.substring(0, 8) + '...' + apiKey.slice(-4) : apiKey;

                // Update save button with progress
                if (saveText) saveText.textContent = `Testing key ${i + 1}/${apiKeys.length}...`;
                
                try {
                    showInfoToast(`Testing API key ${i + 1}/${apiKeys.length}: ${maskedKey}...`);
                    const response = await fetch('/admin/api/test', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            apiType: apiType, 
                            apiKey: apiKey,
                            baseUrl: baseUrl 
                        })
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        testedKeys.push(apiKey);
                        showSuccessToast(`✅ API key ${maskedKey} is valid`);
                    } else {
                        showErrorToast(`❌ API key ${maskedKey} failed: ${result.error || 'Unknown error'}`);
                        allKeysValid = false;
                    }
                } catch (error) {
                    showErrorToast(`❌ Failed to test API key ${maskedKey}: ${error.message}`);
                    allKeysValid = false;
                }
            }

            if (!allKeysValid) {
                if (testedKeys.length > 0) {
                    showWarningToast(`Only ${testedKeys.length}/${apiKeys.length} API keys are valid. Please fix invalid keys and try again.`);
                } else {
                    showErrorToast('No valid API keys found. Please check your keys and try again.');
                }
                return;
            }
            
            // Create environment variable names
            const keysVar = `${apiType.toUpperCase()}_${name.toUpperCase()}_API_KEYS`;
            const baseUrlVar = `${apiType.toUpperCase()}_${name.toUpperCase()}_BASE_URL`;
            
            // Check if provider already exists
            if (envVars[keysVar]) {
                showErrorToast(`Provider '${name}' already exists`);
                return;
            }
            
            // Update envVars with tested keys only
            envVars[keysVar] = testedKeys.join(',');
            if (baseUrl) {
                envVars[baseUrlVar] = baseUrl;
            }
            
            // Add optional fields if provided
            const accessKey = document.getElementById('newProviderAccessKey')?.value.trim();
            const defaultModel = document.getElementById('newProviderDefaultModel')?.value.trim();
            
            if (accessKey) {
                const accessKeyVar = `${apiType.toUpperCase()}_${name.toUpperCase()}_ACCESS_KEY`;
                envVars[accessKeyVar] = accessKey;
            }
            
            if (defaultModel) {
                const defaultModelVar = `${apiType.toUpperCase()}_${name.toUpperCase()}_DEFAULT_MODEL`;
                envVars[defaultModelVar] = defaultModel;
            }

            const syncEnv = document.getElementById('newProviderSyncEnv')?.value;
            if (syncEnv) {
                const syncEnvVar = `${apiType.toUpperCase()}_${name.toUpperCase()}_SYNC_ENV`;
                envVars[syncEnvVar] = syncEnv;
            }
            
            try {
                const response = await fetch('/admin/api/env', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(envVars)
                });
                
                if (response.ok) {
                    // Clear form
                    document.getElementById('newProviderName').value = '';
                    document.getElementById('newProviderBaseUrl').value = '';
                    if (document.getElementById('newProviderAccessKey')) {
                        document.getElementById('newProviderAccessKey').value = '';
                    }
                    if (document.getElementById('newProviderDefaultModel')) {
                        document.getElementById('newProviderDefaultModel').value = '';
                    }
                    if (document.getElementById('newProviderSyncEnv')) {
                        document.getElementById('newProviderSyncEnv').value = '';
                    }

                    // Clear validation icons
                    ['nameValidIcon', 'urlValidIcon'].forEach(id => {
                        const el = document.getElementById(id);
                        if (el) { el.innerHTML = ''; el.classList.add('hidden'); }
                    });

                    // Clear status
                    const statusEl = document.getElementById('addProviderStatus');
                    if (statusEl) statusEl.textContent = '';

                    // Clear all key inputs
                    keyInputs.forEach(input => input.value = '');
                    
                    // Reset to single key input
                    const container = document.getElementById('newProviderKeys');
                    container.innerHTML = `
                        <div class="flex items-center space-x-2" data-key-index="0">
                            <input 
                                type="text" 
                                class="input-field flex-1 px-2 py-1.5 text-xs rounded transition-colors new-provider-key" 
                                placeholder="Enter API key"
                                data-key-index="0"
                            >
                            <button 
                                onclick="testNewProviderKey(0)" 
                                class="btn btn-secondary px-2 py-1 text-xs font-medium"
                            >
                                Test
                            </button>
                            <button 
                                onclick="removeNewProviderKey(0)" 
                                class="btn btn-destructive px-2 py-1 text-xs font-medium"
                                style="display: none;"
                            >
                                Remove
                            </button>
                        </div>
                    `;
                    newProviderKeyIndex = 1;
                    
                    renderEnvVars();

                    showSuccessToast(`Provider '${name}' created successfully with ${testedKeys.length} tested and valid API key${testedKeys.length > 1 ? 's' : ''}!`);

                    // Flash save button green
                    if (saveBtn) {
                        saveBtn.classList.add('btn-save-success');
                        if (saveText) saveText.textContent = 'Saved!';
                        setTimeout(() => {
                            saveBtn.classList.remove('btn-save-success');
                            if (saveText) saveText.textContent = originalText;
                            if (checkIcon) checkIcon.classList.remove('hidden');
                            if (spinnerIcon) spinnerIcon.classList.add('hidden');
                            saveBtn.disabled = false;
                        }, 1500);
                        return; // skip normal reset below
                    }
                } else {
                    // Revert changes
                    delete envVars[keysVar];
                    if (baseUrl) delete envVars[baseUrlVar];
                    showErrorToast('Failed to save provider');

                    // Flash save button red
                    if (saveBtn) {
                        saveBtn.classList.add('btn-save-fail');
                        if (saveText) saveText.textContent = 'Failed';
                        setTimeout(() => saveBtn.classList.remove('btn-save-fail'), 1500);
                    }
                }
            } catch (error) {
                // Revert changes
                delete envVars[keysVar];
                if (baseUrl) delete envVars[baseUrlVar];
                showErrorToast(`Failed to save provider: ${error.message}`);

                // Flash save button red
                if (saveBtn) {
                    saveBtn.classList.add('btn-save-fail');
                    if (saveText) saveText.textContent = 'Failed';
                    setTimeout(() => saveBtn.classList.remove('btn-save-fail'), 1500);
                }
            }

            // Reset button state (only reached on failure paths)
            if (saveBtn) saveBtn.disabled = false;
            if (saveText) saveText.textContent = originalText;
            if (checkIcon) checkIcon.classList.remove('hidden');
            if (spinnerIcon) spinnerIcon.classList.add('hidden');
            } catch (error) {
                showErrorToast(`Failed to add provider: ${error.message}`);
                if (saveBtn) saveBtn.disabled = false;
                if (saveText) saveText.textContent = originalText;
                if (checkIcon) checkIcon.classList.remove('hidden');
                if (spinnerIcon) spinnerIcon.classList.add('hidden');
            }
        }

        function validateNewProviderField(field) {
            const name = document.getElementById('newProviderName').value.trim();
            const apiType = document.getElementById('newProviderApiType').value;
            const baseUrl = document.getElementById('newProviderBaseUrl').value.trim();
            const nameIcon = document.getElementById('nameValidIcon');
            const urlIcon = document.getElementById('urlValidIcon');
            const nameInput = document.getElementById('newProviderName');
            const urlInput = document.getElementById('newProviderBaseUrl');
            const saveBtn = document.getElementById('addProviderSaveBtn');
            const statusEl = document.getElementById('addProviderStatus');
            const checkSvg = '<svg class="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>';
            const crossSvg = '<svg class="w-3.5 h-3.5 text-destructive" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>';

            // Validate name
            if (field === 'name' && nameIcon) {
                nameInput.classList.remove('field-valid', 'field-invalid');
                if (name.length === 0) {
                    nameIcon.innerHTML = '';
                    nameIcon.classList.add('hidden');
                } else if (/^[a-z0-9_]+$/.test(name)) {
                    nameIcon.innerHTML = checkSvg;
                    nameIcon.classList.remove('hidden');
                    nameInput.classList.add('field-valid');
                } else {
                    nameIcon.innerHTML = crossSvg;
                    nameIcon.classList.remove('hidden');
                    nameInput.classList.add('field-invalid');
                }
            }

            // Validate URL
            if (field === 'url' && urlIcon) {
                urlInput.classList.remove('field-valid', 'field-invalid');
                if (baseUrl.length === 0) {
                    urlIcon.innerHTML = '';
                    urlIcon.classList.add('hidden');
                } else if (baseUrl.startsWith('https://') && !baseUrl.endsWith('/')) {
                    urlIcon.innerHTML = checkSvg;
                    urlIcon.classList.remove('hidden');
                    urlInput.classList.add('field-valid');
                } else {
                    urlIcon.innerHTML = crossSvg;
                    urlIcon.classList.remove('hidden');
                    urlInput.classList.add('field-invalid');
                }
            }

            // Validate keys presence for save button state
            if (field === 'keys') {
                if (saveBtn) {
                    saveBtn.disabled = false; // Always enabled, validation happens on submit
                }
                // Update preview with key count
                updateProviderPreview();
            }

            // Update status hint with readiness indicator
            if (statusEl) {
                const hasName = name.length > 0;
                const hasUrl = baseUrl.length > 0;
                const keyInputs = document.querySelectorAll('.new-provider-key');
                const hasKeys = [...keyInputs].some(i => i.value.trim());
                const missing = [];
                if (!hasKeys) missing.push('API key');
                if (hasName && !hasUrl) missing.push('base URL');
                if (hasUrl && !hasName) missing.push('provider name');

                if (missing.length > 0) {
                    statusEl.textContent = `Missing: ${missing.join(', ')}`;
                    statusEl.className = 'text-[10px] form-status-missing';
                } else {
                    statusEl.textContent = 'Ready to save';
                    statusEl.className = 'text-[10px] form-status-ready';
                }
            }
        }

        let newProviderKeyIndex = 1;
        
        function addNewProviderKey() {
            const container = document.getElementById('newProviderKeys');
            const keyDiv = document.createElement('div');
            keyDiv.className = 'flex items-center space-x-2';
            keyDiv.setAttribute('data-key-index', newProviderKeyIndex);
            
            keyDiv.innerHTML = `
                <input 
                    type="text" 
                    class="input-field flex-1 px-2 py-1.5 text-xs rounded transition-colors new-provider-key" 
                    placeholder="Enter API key"
                    data-key-index="${newProviderKeyIndex}"
                >
                <button 
                    onclick="testNewProviderKey(${newProviderKeyIndex})" 
                    class="btn btn-secondary px-2 py-1 text-xs font-medium"
                >
                    Test
                </button>
                <button 
                    onclick="removeNewProviderKey(${newProviderKeyIndex})" 
                    class="btn btn-destructive px-2 py-1 text-xs font-medium"
                >
                    Remove
                </button>
            `;
            
            container.appendChild(keyDiv);
            
            // Show remove button on first key if we now have multiple keys
            const firstRemoveBtn = document.querySelector('[data-key-index="0"] button[onclick*="removeNewProviderKey"]');
            if (firstRemoveBtn) {
                firstRemoveBtn.style.display = 'inline-flex';
            }
            
            newProviderKeyIndex++;
        }
        
        function removeNewProviderKey(index) {
            const keyDiv = document.querySelector(`[data-key-index="${index}"]`);
            if (keyDiv) {
                keyDiv.remove();
            }
            
            // Hide remove button on first key if it's the only one left
            const remainingKeys = document.querySelectorAll('#newProviderKeys [data-key-index]');
            if (remainingKeys.length === 1) {
                const firstRemoveBtn = document.querySelector('[data-key-index="0"] button[onclick*="removeNewProviderKey"]');
                if (firstRemoveBtn) {
                    firstRemoveBtn.style.display = 'none';
                }
            }
        }
        
        async function testNewProviderKey(keyIndex) {
            const apiType = document.getElementById('newProviderApiType').value;
            const baseUrl = document.getElementById('newProviderBaseUrl').value.trim();
            const keyInput = document.querySelector(`[data-key-index="${keyIndex}"] input`);
            const testBtn = document.querySelector(`[data-test-btn="${keyIndex}"]`) ||
                            keyInput?.parentElement?.querySelector('button[onclick*="testNewProviderKey"]');
            const apiKey = keyInput.value.trim();

            if (!apiKey) {
                showWarningToast('Please enter an API key to test');
                return;
            }

            const maskedKey = apiKey.length > 16 ? apiKey.substring(0, 8) + '...' + apiKey.slice(-4) : apiKey;
            const originalBtnText = testBtn?.textContent || 'Test';

            // Show loading state on test button
            if (testBtn) {
                testBtn.disabled = true;
                testBtn.textContent = '...';
                testBtn.classList.remove('key-test-pass', 'key-test-fail');
            }

            try {
                const response = await fetch('/admin/api/test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        apiType: apiType,
                        apiKey: apiKey,
                        baseUrl: baseUrl
                    })
                });

                const result = await response.json();

                if (result.success) {
                    showSuccessToast(`API key ${maskedKey} is valid!`);
                    if (testBtn) {
                        testBtn.textContent = 'OK';
                        testBtn.classList.add('key-test-pass');
                    }
                } else {
                    showErrorToast(`API key ${maskedKey} failed: ${result.error || 'Unknown error'}`);
                    if (testBtn) {
                        testBtn.textContent = 'X';
                        testBtn.classList.add('key-test-fail');
                    }
                }
            } catch (error) {
                showErrorToast(`API key test failed: ${error.message}`);
                if (testBtn) {
                    testBtn.textContent = 'X';
                    testBtn.classList.add('key-test-fail');
                }
            }

            // Reset button after 2s
            if (testBtn) {
                setTimeout(() => {
                    testBtn.textContent = originalBtnText;
                    testBtn.disabled = false;
                    testBtn.classList.remove('key-test-pass', 'key-test-fail');
                }, 2000);
            }
        }
        
        function showDeleteProviderConfirmation(apiType, providerName) {
            const dialog = document.getElementById('confirmDialog');
            const message = document.getElementById('confirmMessage');

            message.innerHTML = `Delete provider '${escapeHtml(providerName)}'?<br><br><span class="text-amber-500 text-xs">This removes the provider from the running configuration. Keys will still exist in your .env file and will reappear on next Reload Config. To permanently remove them, edit your .env file manually.</span>`;
            
            // Set up the confirm button to call the actual delete function
            const confirmBtn = dialog.querySelector('button[onclick="confirmDelete()"]');
            confirmBtn.onclick = () => {
                dialog.classList.add('hidden');
                deleteProvider(apiType, providerName);
            };
            
            dialog.classList.remove('hidden');
        }

        // Copy endpoint URL for a provider
        async function copyEndpointUrl(providerName) {
            const baseUrl = `${window.location.protocol}//${window.location.host}`;
            const endpointUrl = `${baseUrl}/${providerName}`;
            await copyToClipboard(endpointUrl, `Endpoint URL copied: ${endpointUrl}`);
        }

        async function copyOriginalBaseUrl(baseUrl) {
            if (!baseUrl || baseUrl === '') {
                showToast('No base URL to copy', 'warning');
                return;
            }
            await copyToClipboard(baseUrl, `Base URL copied: ${baseUrl}`);
        }

        // Toggle the curl dropdown menu for a provider
        function toggleCurlDropdown(apiType, providerName, event) {
            event.stopPropagation();
            const dropdown = document.getElementById(`curlDropdown_${apiType}_${providerName}`);
            // Close all other open curl dropdowns first
            document.querySelectorAll('[id^="curlDropdown_"]').forEach(el => {
                if (el.id !== dropdown.id) el.classList.add('hidden');
            });
            dropdown.classList.toggle('hidden');
        }

        function closeCurlDropdown(apiType, providerName) {
            const dropdown = document.getElementById(`curlDropdown_${apiType}_${providerName}`);
            if (dropdown) dropdown.classList.add('hidden');
        }

        // Close curl dropdowns when clicking outside
        document.addEventListener('click', () => {
            document.querySelectorAll('[id^="curlDropdown_"]').forEach(el => el.classList.add('hidden'));
        });

        // Copy provider's primary key as ENV_VAR=value format
        async function copyProviderEnvVar(apiType, providerName) {
            const envKey = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_API_KEYS`;
            const keysStr = envVars[envKey] || '';
            const firstKey = keysStr.split(',').map(k => k.trim()).filter(k => k && !k.startsWith('~'))[0];
            if (!firstKey) { showErrorToast('No enabled key found for this provider'); return; }

            // Find the source env var name
            const sourceMap = window._keySourceMap || {};
            const sourceName = sourceMap[providerName + ':' + firstKey] || envKey;
            await copyToClipboard(`${sourceName}=${firstKey}`, 'Env var copied');
        }

        // Copy the active (first enabled) API key value only — no env var prefix
        async function copyActiveKey(apiType, providerName) {
            const envKey = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_API_KEYS`;
            const keysStr = envVars[envKey] || '';
            const firstKey = keysStr.split(',').map(k => k.trim()).filter(k => k && !k.startsWith('~'))[0];
            if (!firstKey) { showErrorToast('No enabled key found for this provider'); return; }
            await copyToClipboard(firstKey, `Active key for '${providerName}' copied`);
        }

        // Generate and copy cURL command for testing a provider
        // endpointType: 'completions' (default) or 'models'
        async function copyProviderCurl(apiType, providerName, endpointType = 'completions') {
            const baseUrl = `${window.location.protocol}//${window.location.host}`;
            const accessKeyVar = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_ACCESS_KEY`;
            const accessKey = envVars[accessKeyVar];
            const defaultModelVar = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_DEFAULT_MODEL`;
            const defaultModel = envVars[defaultModelVar];
            let curlCommand = '';

            if (endpointType === 'models') {
                // /models endpoint is the same for both OpenAI and Gemini compatible APIs
                let authHeader = '';
                if (apiType === 'gemini') {
                    let authContent = `[STATUS_CODES:${defaultStatusCodes}]`;
                    if (accessKey) authContent += `[ACCESS_KEY:${accessKey}]`;
                    authHeader = `  -H "x-goog-api-key: ${authContent}"`;
                } else {
                    let authContent = `[STATUS_CODES:${defaultStatusCodes}]`;
                    if (accessKey) authContent += `[ACCESS_KEY:${accessKey}]`;
                    authHeader = `  -H "Authorization: Bearer ${authContent}"`;
                }
                curlCommand = `curl -X GET "${baseUrl}/${providerName}/models" \\\n${authHeader}`;
                await copyToClipboard(curlCommand, `📋 /models cURL copied for '${providerName}'!`);
                return;
            }

            // Build auth headers based on API type
            if (apiType === 'openai') {
                // Build Authorization header for OpenAI
                let authContent = `[STATUS_CODES:${defaultStatusCodes}]`;
                if (accessKey) {
                    authContent += `[ACCESS_KEY:${accessKey}]`;
                }
                const authHeader = `  -H "Authorization: Bearer ${authContent}" \\\n`;

                // Use default model if set, otherwise use YOUR_MODEL_NAME placeholder
                const model = defaultModel || 'YOUR_MODEL_NAME';

                // OpenAI-compatible cURL command
                curlCommand = `curl -X POST "${baseUrl}/${providerName}/chat/completions" \\
${authHeader}  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model}",
    "messages": [
      {
        "role": "user",
        "content": "Hello! Please say hello back."
      }
    ]
  }'`;
            } else if (apiType === 'gemini') {
                // Build x-goog-api-key header for Gemini
                let authContent = `[STATUS_CODES:${defaultStatusCodes}]`;
                if (accessKey) {
                    authContent += `[ACCESS_KEY:${accessKey}]`;
                }
                const googApiKeyHeader = `  -H "x-goog-api-key: ${authContent}" \\\n`;

                // Use default model if set, otherwise use YOUR_MODEL_NAME placeholder
                const model = defaultModel || 'YOUR_MODEL_NAME';

                // Gemini-compatible cURL command
                curlCommand = `curl -X POST "${baseUrl}/${providerName}/models/${model}:generateContent" \\
${googApiKeyHeader}  -H "Content-Type: application/json" \\
  -d '{
    "contents": [
      {
        "parts": [
          {
            "text": "Hello! Please say hello back."
          }
        ]
      }
    ]
  }'`;
            } else {
                showErrorToast('Unknown API type for cURL generation');
                return;
            }

            await copyToClipboard(curlCommand, `📋 cURL command copied for provider '${providerName}'! Ready to test in terminal.`);
        }

        // Export configuration as environment variables
        async function exportConfiguration() {
            try {
                // Fetch the .env file content from the server
                const response = await fetch('/admin/api/env-file');
                if (!response.ok) {
                    throw new Error('Failed to fetch .env file');
                }

                let envContent = await response.text();

                // Replace ADMIN_PASSWORD value with empty string
                envContent = envContent.replace(/^ADMIN_PASSWORD=.*$/m, 'ADMIN_PASSWORD=');

                // Copy to clipboard
                await copyToClipboard(envContent, '.env configuration copied to clipboard! Ready to paste.');

            } catch (error) {
                console.error('Export error:', error);
                showErrorToast('Failed to export configuration: ' + error.message);
            }
        }

        // Copy agent configuration context for a specific provider
        async function copyAgentContext(apiType, providerName) {
            try {
                const providerKey = `${apiType}_${providerName}`;
                const response = await fetch(`/admin/api/agent-context?provider=${encodeURIComponent(providerKey)}`);
                
                if (!response.ok) {
                    throw new Error(`Failed to fetch agent context: ${response.statusText}`);
                }

                const markdown = await response.text();
                await copyToClipboard(markdown, `agent.context for '${providerName}' copied to clipboard`);
            } catch (error) {
                console.error('Copy agent context error:', error);
                showErrorToast('Failed to copy agent context: ' + error.message);
            }
        }

        // Copy agent configuration context for all providers
        async function copyAllAgentContext() {
            try {
                const response = await fetch('/admin/api/agent-context');
                
                if (!response.ok) {
                    throw new Error(`Failed to fetch agent context: ${response.statusText}`);
                }

                const markdown = await response.text();
                await copyToClipboard(markdown, 'agent.context (all providers) copied to clipboard');
            } catch (error) {
                console.error('Copy all agent context error:', error);
                showErrorToast('Failed to copy agent context: ' + error.message);
            }
        }

        async function deleteProvider(apiType, providerName) {
            const providerPrefix = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_`;

            // Snapshot keys to delete (but don't mutate envVars until API succeeds)
            const keysToDelete = [];
            for (const key in envVars) {
                if (key.startsWith(providerPrefix)) {
                    keysToDelete.push(key);
                }
            }

            // Build new envVars without the provider keys
            const newEnvVars = { ...envVars };
            keysToDelete.forEach(key => delete newEnvVars[key]);

            try {
                const response = await fetch('/admin/api/env', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(newEnvVars)
                });

                if (response.ok) {
                    envVars = newEnvVars;
                    renderEnvVars();
                    showSuccessToast(`🗑️ Provider '${providerName}' deleted successfully (${keysToDelete.length} settings removed)`);
                } else {
                    const err = await response.json().catch(() => ({}));
                    showErrorToast('Failed to delete provider: ' + (err.error || response.statusText));
                }
            } catch (error) {
                showErrorToast(`Failed to delete provider: ${error.message}`);
            }
        }

        // Check for changes in input fields and update save/delete button
        function checkForChanges(fieldType, apiType, providerName) {
            const inputId = `${fieldType}_${apiType}_${providerName}`;
            const input = document.getElementById(inputId);
            const saveBtnId = `saveBtn_${fieldType}_${apiType}_${providerName}`;
            const saveBtn = document.getElementById(saveBtnId);

            if (!input || !saveBtn) return;

            const originalValue = input.getAttribute('data-original') || '';
            const currentValue = input.value.trim();

            // Determine button position class (without transitions for smooth state changes)
            const positionClass = fieldType === 'accessKey'
                ? 'text-muted-foreground hover:text-foreground p-1'
                : 'absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1';

            if (currentValue !== originalValue) {
                // There are changes - show save icon (enabled)
                saveBtn.className = positionClass;
                saveBtn.title = 'Save changes';
                saveBtn.style.pointerEvents = '';  // Re-enable pointer events
                saveBtn.style.opacity = '1';  // Explicitly set to full opacity
                saveBtn.onclick = () => {
                    if (fieldType === 'accessKey') {
                        saveAccessKey(apiType, providerName);
                    } else {
                        saveDefaultModel(apiType, providerName);
                    }
                };
                saveBtn.innerHTML = `
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M7 19V13H17V19H19V7.828L16.172 5H15V9H9V5H5V19H7ZM17 5V7H15V5H17ZM19 3L21 5V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H19Z"></path>
                    </svg>
                `;
            } else if (originalValue && currentValue === originalValue) {
                // No changes and has existing value - show delete icon
                saveBtn.className = positionClass;
                saveBtn.title = 'Delete';
                saveBtn.style.pointerEvents = '';  // Re-enable pointer events
                saveBtn.style.opacity = '1';  // Explicitly set to full opacity
                saveBtn.onclick = () => {
                    if (fieldType === 'accessKey') {
                        deleteAccessKey(apiType, providerName);
                    } else {
                        deleteDefaultModel(apiType, providerName);
                    }
                };
                saveBtn.innerHTML = `
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                `;
            } else {
                // Empty field - show disabled save icon
                const disabledClass = fieldType === 'accessKey'
                    ? 'cursor-not-allowed p-1'
                    : 'absolute right-2 top-1/2 -translate-y-1/2 cursor-not-allowed p-1';

                saveBtn.className = disabledClass;
                saveBtn.title = 'Nothing to save';
                saveBtn.onclick = null;  // Disable click
                saveBtn.style.pointerEvents = 'none';  // Prevent hover effects
                saveBtn.style.opacity = '0.3';  // Make it very faded (only use inline style, not class)
                saveBtn.innerHTML = `
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M7 19V13H17V19H19V7.828L16.172 5H15V9H9V5H5V19H7ZM17 5V7H15V5H17ZM19 3L21 5V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H19Z"></path>
                    </svg>
                `;
            }
        }

        // ACCESS_KEY Management Functions
        function generateAccessKey(apiType, providerName) {
            // Generate a random access key
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
            let key = '';
            for (let i = 0; i < 32; i++) {
                key += chars.charAt(Math.floor(Math.random() * chars.length));
            }

            const inputId = `accessKey_${apiType}_${providerName}`;
            const input = document.getElementById(inputId);
            if (input) {
                input.value = key;
                // Trigger change detection to update button
                checkForChanges('accessKey', apiType, providerName);
                showSuccessToast('Generated new access key - click save to apply');
            }
        }

        async function copyAccessKey(apiType, providerName) {
            const inputId = `accessKey_${apiType}_${providerName}`;
            const input = document.getElementById(inputId);

            if (!input || !input.value) {
                showWarningToast('No access key to copy');
                return;
            }

            await copyToClipboard(input.value, 'Access key copied to clipboard');
        }

        async function saveDefaultModel(apiType, providerName) {
            const inputId = `defaultModel_${apiType}_${providerName}`;
            const input = document.getElementById(inputId);

            if (!input) {
                showErrorToast('Default model input not found');
                return;
            }

            const defaultModel = input.value.trim();
            const oldModel = input.getAttribute('data-original'); // Capture before any changes
            const modelVar = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_DEFAULT_MODEL`;
            const historyVar = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_MODEL_HISTORY`;

            // Get current history
            const currentHistory = envVars[historyVar] ? envVars[historyVar].split(',').map(m => m.trim()).filter(m => m) : [];

            if (defaultModel) {
                envVars[modelVar] = defaultModel;

                // First, preserve the old model in history if it exists and is different from new model
                if (oldModel && oldModel.trim() && oldModel.trim() !== defaultModel && !currentHistory.includes(oldModel.trim())) {
                    currentHistory.push(oldModel.trim());
                }

                // Add new model to history if not already there
                if (!currentHistory.includes(defaultModel)) {
                    currentHistory.push(defaultModel);
                }

                // Sort alphabetically (no limit - keep all models ever saved)
                const newHistory = currentHistory.sort((a, b) => a.localeCompare(b));
                envVars[historyVar] = newHistory.join(',');
            } else {
                // When default model is removed, add the old model to history
                if (oldModel && oldModel.trim() && !currentHistory.includes(oldModel.trim())) {
                    currentHistory.push(oldModel.trim());
                }

                // Sort alphabetically (no limit - keep all models ever saved)
                const newHistory = currentHistory.sort((a, b) => a.localeCompare(b));

                // Only set history if there are models
                if (newHistory.length > 0) {
                    envVars[historyVar] = newHistory.join(',');
                } else {
                    delete envVars[historyVar];
                }

                delete envVars[modelVar];
            }

            try {
                const response = await fetch('/admin/api/env', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(envVars)
                });

                if (response.ok) {
                    // Update the data-original attribute to the new value
                    input.setAttribute('data-original', defaultModel);
                    // Reset the save button color
                    checkForChanges('defaultModel', apiType, providerName);

                    renderEnvVars();
                    if (defaultModel) {
                        showSuccessToast(`🎯 Default model saved for provider '${providerName}': ${defaultModel}`);
                    } else {
                        showSuccessToast(`Default model removed for provider '${providerName}'`);
                    }
                } else {
                    showErrorToast('Failed to save default model');
                }
            } catch (error) {
                showErrorToast(`Failed to save default model: ${error.message}`);
            }
        }

        async function saveAccessKey(apiType, providerName) {
            const inputId = `accessKey_${apiType}_${providerName}`;
            const input = document.getElementById(inputId);

            if (!input) {
                showErrorToast('Access key input not found');
                return;
            }

            const accessKey = input.value.trim();
            const accessKeyVar = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_ACCESS_KEY`;

            if (accessKey) {
                envVars[accessKeyVar] = accessKey;
            } else {
                delete envVars[accessKeyVar];
            }

            try {
                const response = await fetch('/admin/api/env', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(envVars)
                });

                if (response.ok) {
                    // Update the data-original attribute to the new value
                    input.setAttribute('data-original', accessKey);
                    // Reset the save button color
                    checkForChanges('accessKey', apiType, providerName);

                    renderEnvVars();
                    if (accessKey) {
                        showSuccessToast(`🔐 Access key saved for provider '${providerName}'`);
                    } else {
                        showSuccessToast(`🔓 Access key removed for provider '${providerName}'`);
                    }
                } else {
                    showErrorToast('Failed to save access key');
                }
            } catch (error) {
                showErrorToast(`Failed to save access key: ${error.message}`);
            }
        }

        async function deleteAccessKey(apiType, providerName) {
            const inputId = `accessKey_${apiType}_${providerName}`;
            const input = document.getElementById(inputId);

            if (!input) return;

            // Clear the input
            input.value = '';

            const accessKeyVar = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_ACCESS_KEY`;
            delete envVars[accessKeyVar];

            try {
                const response = await fetch('/admin/api/env', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(envVars)
                });

                if (response.ok) {
                    // Update the data-original attribute
                    input.setAttribute('data-original', '');
                    // Update button
                    checkForChanges('accessKey', apiType, providerName);
                    renderEnvVars();
                    showSuccessToast(`🔓 Access key removed for provider '${providerName}'`);
                } else {
                    showErrorToast('Failed to delete access key');
                }
            } catch (error) {
                showErrorToast(`Failed to delete access key: ${error.message}`);
            }
        }

        async function deleteDefaultModel(apiType, providerName) {
            const inputId = `defaultModel_${apiType}_${providerName}`;
            const input = document.getElementById(inputId);

            if (!input) return;

            const oldModel = input.getAttribute('data-original'); // Capture before clearing
            const modelVar = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_DEFAULT_MODEL`;
            const historyVar = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_MODEL_HISTORY`;

            // Clear the input
            input.value = '';

            // Get current history
            const currentHistory = envVars[historyVar] ? envVars[historyVar].split(',').map(m => m.trim()).filter(m => m) : [];

            // Add the old model to history if it's not empty and not already there
            if (oldModel && oldModel.trim() && !currentHistory.includes(oldModel.trim())) {
                currentHistory.push(oldModel.trim());
            }

            // Sort alphabetically (no limit - keep all models ever saved)
            const newHistory = currentHistory.sort((a, b) => a.localeCompare(b));

            // Update history if there are models
            if (newHistory.length > 0) {
                envVars[historyVar] = newHistory.join(',');
            }

            delete envVars[modelVar];

            try {
                const response = await fetch('/admin/api/env', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(envVars)
                });

                if (response.ok) {
                    // Update the data-original attribute
                    input.setAttribute('data-original', '');
                    // Update button
                    checkForChanges('defaultModel', apiType, providerName);
                    renderEnvVars();
                    showSuccessToast(`Default model removed for provider '${providerName}'`);
                } else {
                    showErrorToast('Failed to delete default model');
                }
            } catch (error) {
                showErrorToast(`Failed to delete default model: ${error.message}`);
            }
        }

        function toggleModelHistory(apiType, providerName) {
            const historyId = `modelHistory_${apiType}_${providerName}`;
            const historyDiv = document.getElementById(historyId);

            if (!historyDiv) return;

            // Close all other open dropdowns
            document.querySelectorAll('[id^="modelHistory_"]').forEach(div => {
                if (div.id !== historyId) {
                    div.classList.add('hidden');
                }
            });

            // Toggle current dropdown
            historyDiv.classList.toggle('hidden');
        }

        function showDeleteModelConfirmation(event, apiType, providerName, model) {
            // Prevent the click from bubbling up to selectModelFromHistory
            event.stopPropagation();

            const dialog = document.getElementById('confirmDialog');
            const message = document.getElementById('confirmMessage');

            message.textContent = `Remove "${model}" from history?`;

            // Set up the confirm button to call the actual delete function
            const confirmBtn = dialog.querySelector('button[onclick="confirmDelete()"]');
            confirmBtn.onclick = () => {
                dialog.classList.add('hidden');
                deleteModelFromHistory(apiType, providerName, model);
            };

            dialog.classList.remove('hidden');
        }

        async function deleteModelFromHistory(apiType, providerName, model) {
            const historyVar = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_MODEL_HISTORY`;

            // Get current history
            const currentHistory = envVars[historyVar] ? envVars[historyVar].split(',').map(m => m.trim()).filter(m => m) : [];

            // Remove the model
            const newHistory = currentHistory.filter(m => m !== model);

            // Update or delete history
            if (newHistory.length > 0) {
                envVars[historyVar] = newHistory.join(',');
            } else {
                delete envVars[historyVar];
            }

            try {
                const response = await fetch('/admin/api/env', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(envVars)
                });

                if (response.ok) {
                    renderEnvVars();
                    showSuccessToast(`Removed "${model}" from history`);
                } else {
                    showErrorToast('Failed to remove model from history');
                }
            } catch (error) {
                showErrorToast(`Failed to remove model from history: ${error.message}`);
            }
        }

        function selectModelFromHistory(apiType, providerName, model) {
            const inputId = `defaultModel_${apiType}_${providerName}`;
            const input = document.getElementById(inputId);
            const historyId = `modelHistory_${apiType}_${providerName}`;
            const historyDiv = document.getElementById(historyId);

            if (input) {
                input.value = model;
                checkForChanges('defaultModel', apiType, providerName);
            }

            if (historyDiv) {
                historyDiv.classList.add('hidden');
            }

            // Auto-save the selected model
            saveDefaultModel(apiType, providerName);
        }

        // --- Model Access Control Functions ---
        const fetchedModelsCache = {};

        async function fetchProviderModels(apiType, providerName) {
            // Check if provider supports models
            const mcpProviders = ['brave', 'tavily', 'tavily_mcp', 'exa', 'firecrawl', 'context7', 'onref', 'searchapi', 'jina'];
            if (mcpProviders.includes(providerName.toLowerCase())) {
                showErrorToast('This provider does not support model selection (MCP/Search service)');
                return;
            }

            const btn = document.getElementById(`fetchModelsBtn_${apiType}_${providerName}`);
            const spinner = document.getElementById(`fetchModelsSpinner_${apiType}_${providerName}`);
            const btnText = document.getElementById(`fetchModelsBtnText_${apiType}_${providerName}`);
            const container = document.getElementById(`modelListContainer_${apiType}_${providerName}`);

            if (!btn || !container) return;

            btn.disabled = true;
            spinner.classList.remove('hidden');
            btnText.textContent = 'Fetching...';

            try {
                const response = await fetch(`/admin/api/models?apiType=${encodeURIComponent(apiType)}&provider=${encodeURIComponent(providerName)}`);

                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.error || `HTTP ${response.status}`);
                }

                const data = await response.json();

                if (data.message) {
                    showSuccessToast(data.message);
                    return;
                }

                if (!data.models || data.models.length === 0) {
                    showErrorToast('No models found for this provider');
                    return;
                }

                fetchedModelsCache[`${apiType}_${providerName}`] = data.models;

                // Get currently allowed models
                const envKey = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_ALLOWED_MODELS`;
                const currentlyAllowed = envVars[envKey] ? envVars[envKey].split(',').map(m => m.trim()).filter(Boolean) : [];

                renderModelList(apiType, providerName, data.models, currentlyAllowed);
                container.classList.remove('hidden');

                if (data.cached) {
                    showSuccessToast(`Loaded ${data.models.length} models (cached)`);
                } else {
                    showSuccessToast(`Discovered ${data.models.length} models`);
                }
            } catch (error) {
                showErrorToast(`Failed to fetch models: ${error.message}`);
            } finally {
                btn.disabled = false;
                spinner.classList.add('hidden');
                btnText.textContent = 'Fetch Models';
            }
        }

        function renderModelList(apiType, providerName, models, allowedModels, filterText = '') {
            const listEl = document.getElementById(`modelList_${apiType}_${providerName}`);
            const countEl = document.getElementById(`modelCount_${apiType}_${providerName}`);
            const selectedCountEl = document.getElementById(`selectedModelCount_${apiType}_${providerName}`);

            if (!listEl) return;

            const filtered = filterText
                ? models.filter(m => m.id.toLowerCase().includes(filterText.toLowerCase()) || (m.display_name && m.display_name.toLowerCase().includes(filterText.toLowerCase())))
                : models;

            countEl.textContent = `${filtered.length} of ${models.length} models`;

            listEl.innerHTML = filtered.map(m => {
                const checked = allowedModels.includes(m.id);
                return `
                    <label class="flex items-center justify-between px-2.5 py-1.5 hover:bg-secondary transition-colors cursor-pointer rounded">
                        <div class="flex items-center space-x-2 min-w-0">
                            <input type="checkbox" class="model-checkbox flex-shrink-0" data-model="${escapeHtml(m.id)}" ${checked ? 'checked' : ''}>
                            <span class="text-xs font-mono truncate" title="${escapeHtml(m.id)}">${escapeHtml(m.display_name || m.id)}</span>
                        </div>
                        ${m.id !== m.display_name ? `<span class="text-[10px] text-muted-foreground font-mono flex-shrink-0 ml-2">${escapeHtml(m.id)}</span>` : ''}
                    </label>`;
            }).join('');

            updateSelectedCount(apiType, providerName);
        }

        function filterModelList(apiType, providerName) {
            const searchInput = document.getElementById(`modelSearch_${apiType}_${providerName}`);
            const models = fetchedModelsCache[`${apiType}_${providerName}`];
            if (!models || !searchInput) return;

            const allowedModels = getSelectedModelIds(apiType, providerName);
            renderModelList(apiType, providerName, models, allowedModels, searchInput.value);
        }

        function getSelectedModelIds(apiType, providerName) {
            const listEl = document.getElementById(`modelList_${apiType}_${providerName}`);
            if (!listEl) return [];
            return Array.from(listEl.querySelectorAll('.model-checkbox:checked')).map(cb => cb.dataset.model);
        }

        function updateSelectedCount(apiType, providerName) {
            const selectedCountEl = document.getElementById(`selectedModelCount_${apiType}_${providerName}`);
            if (!selectedCountEl) return;
            const count = getSelectedModelIds(apiType, providerName).length;
            selectedCountEl.textContent = `${count} selected`;
        }

        function selectAllModels(apiType, providerName) {
            const listEl = document.getElementById(`modelList_${apiType}_${providerName}`);
            if (!listEl) return;
            listEl.querySelectorAll('.model-checkbox').forEach(cb => cb.checked = true);
            updateSelectedCount(apiType, providerName);
        }

        function deselectAllModels(apiType, providerName) {
            const listEl = document.getElementById(`modelList_${apiType}_${providerName}`);
            if (!listEl) return;
            listEl.querySelectorAll('.model-checkbox').forEach(cb => cb.checked = false);
            updateSelectedCount(apiType, providerName);
        }

        async function saveAllowedModels(apiType, providerName) {
            const selectedModels = getSelectedModelIds(apiType, providerName);

            try {
                const response = await fetch('/admin/api/models', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ apiType, providerName, allowedModels: selectedModels })
                });

                if (!response.ok) {
                    throw new Error('Failed to save');
                }

                // Update local envVars
                const envKey = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_ALLOWED_MODELS`;
                if (selectedModels.length > 0) {
                    envVars[envKey] = selectedModels.join(',');
                } else {
                    delete envVars[envKey];
                }

                renderEnvVars();

                if (selectedModels.length > 0) {
                    showSuccessToast(`Model access updated: ${selectedModels.length} models allowed for '${providerName}'`);
                } else {
                    showSuccessToast(`Model restriction removed for '${providerName}' — all models allowed`);
                }
            } catch (error) {
                showErrorToast(`Failed to save model selection: ${error.message}`);
            }
        }

        async function clearAllowedModels(apiType, providerName) {
            try {
                const response = await fetch('/admin/api/models', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ apiType, providerName, allowedModels: [] })
                });

                if (!response.ok) {
                    throw new Error('Failed to clear');
                }

                const envKey = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_ALLOWED_MODELS`;
                delete envVars[envKey];

                renderEnvVars();
                showSuccessToast(`Model restriction cleared for '${providerName}'`);
            } catch (error) {
                showErrorToast(`Failed to clear model restriction: ${error.message}`);
            }
        }

        // Close dropdowns when clicking outside
        document.addEventListener('click', function(event) {
            if (!event.target.closest('[id^="historyBtn_defaultModel_"]') &&
                !event.target.closest('[id^="modelHistory_"]')) {
                document.querySelectorAll('[id^="modelHistory_"]').forEach(div => {
                    div.classList.add('hidden');
                });
            }
        });

        async function testProviderKey(apiType, providerName, apiKey, keyIndex) {
            // Get provider's base URL
            const baseUrlVar = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_BASE_URL`;
            const baseUrl = envVars[baseUrlVar] || null;

            const maskedKey = apiKey.length > 16 ? apiKey.substring(0, 8) + '...' + apiKey.slice(-4) : apiKey;
            showInfoToast(`Testing API key ${maskedKey}...`);

            try {
                const response = await fetch('/admin/api/test', {
                    method: 'POST',
                    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        apiType: apiType,
                        apiKey: apiKey,
                        baseUrl: baseUrl,
                        providerName: providerName
                    })
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error || `HTTP ${response.status}`);
                }

                const result = await response.json();

                if (result.success) {
                    showSuccessToast(`API key ${maskedKey} is valid!`);
                } else {
                    showErrorToast(`API key ${maskedKey} test failed: ${result.error || 'Invalid key'}`);
                }
                // Reload key usage data to reflect updated status
                try {
                    const usageRes = await fetch('/admin/api/key-usage');
                    if (usageRes.ok) keyUsageData = await usageRes.json();
                    renderProviders();
                } catch {}
            } catch (error) {
                showErrorToast(`API key test failed: ${error.message}`);
            }
        }

        async function unfreezeKey(providerName, fullKey) {
            const maskedKey = fullKey.length > 16 ? fullKey.substring(0, 8) + '...' + fullKey.slice(-4) : fullKey;
            if (!confirm(`Unfreeze key ${maskedKey} for '${providerName}'? This will re-enable the key for rotation.`)) return;
            showInfoToast(`Unfreezing key ${maskedKey}...`);
            try {
                const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
                const response = await fetch('/admin/api/unfreeze-key', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                    body: JSON.stringify({ providerName, fullKey })
                });
                const result = await response.json();
                if (result.success) {
                    showSuccessToast(`Key ${maskedKey} unfrozen successfully!`);
                    loadProviders();
                } else {
                    showErrorToast(`Failed to unfreeze: ${result.error}`);
                }
            } catch (error) {
                showErrorToast(`Unfreeze failed: ${error.message}`);
            }
        }

        async function testAndRecoverKey(providerName, fullKey) {
            const maskedKey = fullKey.length > 16 ? fullKey.substring(0, 8) + '...' + fullKey.slice(-4) : fullKey;
            showInfoToast(`Testing & resetting recovery for ${maskedKey}...`);

            try {
                const response = await fetch('/admin/api/key-test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ providerName, fullKey })
                });

                const result = await response.json();

                if (result.recovered) {
                    showSuccessToast(`Key ${maskedKey} recovered successfully! Recovery counter reset.`);
                    loadProviders();
                } else {
                    showErrorToast(`Key ${maskedKey} still failing: ${result.error}. Counter reset — will retry with fresh backoff.`);
                }
            } catch (error) {
                showErrorToast(`Key test failed: ${error.message}`);
            }
        }

        /**
         * Force immediate probe of a single key for recovery
         * Uses the new recovery probe endpoint
         */
        async function forceProbeKey(providerName, fullKey, buttonElement) {
            const maskedKey = fullKey.length > 16 ? fullKey.substring(0, 8) + '...' + fullKey.slice(-4) : fullKey;

            // Compute SHA-256 hash of the full key (matches backend hashing)
            const keyHash = await computeKeyHash(fullKey);

            if (buttonElement) {
                const originalText = buttonElement.textContent;
                buttonElement.disabled = true;
                buttonElement.textContent = 'Probing...';
            }

            showInfoToast(`Force probing key ${maskedKey}...`);

            try {
                const response = await fetch(`/admin/api/recovery/probe/${encodeURIComponent(providerName)}/${encodeURIComponent(keyHash)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });

                const result = await response.json();

                if (result.success) {
                    showSuccessToast(`Key ${maskedKey} recovered successfully!`);
                    loadProviders();
                } else {
                    showErrorToast(`Key ${maskedKey} probe failed: ${result.error || 'Unknown error'}`);
                    loadProviders(); // Refresh to show updated recovery attempts
                }
            } catch (error) {
                showErrorToast(`Force probe failed: ${error.message}`);
            } finally {
                if (buttonElement) {
                    buttonElement.disabled = false;
                    buttonElement.textContent = 'Force Probe';
                }
            }
        }

        /**
         * Compute SHA-256 hash of a key (first 16 hex chars)
         * Matches the backend KeyHistoryManager.hashKey() method
         */
        async function computeKeyHash(key) {
            const encoder = new TextEncoder();
            const data = encoder.encode(key);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            return hashHex.substring(0, 16); // First 16 chars, matches backend
        }

        /**
         * Recovery status poller - updates countdown timers for exhausted keys
         */
        let recoveryPollerInterval = null;

        function startRecoveryPoller() {
            if (recoveryPollerInterval) return; // Already running

            // Poll every 15 seconds
            recoveryPollerInterval = setInterval(updateRecoveryCountdowns, 15000);
            updateRecoveryCountdowns(); // Initial update
        }

        function stopRecoveryPoller() {
            if (recoveryPollerInterval) {
                clearInterval(recoveryPollerInterval);
                recoveryPollerInterval = null;
            }
        }

        async function updateRecoveryCountdowns() {
            try {
                const response = await fetch('/admin/api/recovery-status');
                if (!response.ok) return;

                const data = await response.json();

                // Build a lookup map for quick access
                const recoveryMap = new Map();
                for (const key of data.keys || []) {
                    // Use provider+keyMask as the key
                    recoveryMap.set(`${key.provider}:${key.keyMask}`, key);
                }

                // Update all recovery countdown elements
                const countdownElements = document.querySelectorAll('.recovery-countdown');
                for (const el of countdownElements) {
                    const provider = el.dataset.provider;
                    const fullKey = el.dataset.fullkey;
                    // Match the backend masking format: first 8 chars + ... + last 4 chars
                    const maskedKey = fullKey && fullKey.length > 12
                        ? fullKey.substring(0, 8) + '...' + fullKey.slice(-4)
                        : fullKey || null;

                    if (!maskedKey) {
                        el.textContent = '';
                        continue;
                    }

                    const recoveryKey = `${provider}:${maskedKey}`;
                    const recoveryInfo = recoveryMap.get(recoveryKey);

                    if (!recoveryInfo) {
                        el.textContent = '';
                        continue;
                    }

                    if (recoveryInfo.status === 'maxed-out') {
                        el.textContent = 'max attempts reached';
                        el.className = 'recovery-countdown text-xs text-red-400';
                        el.title = `Key reached maximum recovery attempts (${recoveryInfo.maxAttempts}). Manual intervention required.`;
                    } else if (recoveryInfo.cooldownRemainingSec > 0) {
                        const formatted = formatCountdown(recoveryInfo.cooldownRemainingSec);
                        const attempts = recoveryInfo.recoveryAttempts || 0;
                        const maxAttempts = recoveryInfo.maxAttempts || 5;
                        el.textContent = `next probe in ${formatted} (${attempts}/${maxAttempts})`;
                        el.className = 'recovery-countdown text-xs text-amber-400';
                        el.title = `Next automatic recovery probe: ${new Date(recoveryInfo.nextProbeAt).toLocaleString()}`;
                    } else {
                        el.textContent = 'probe pending';
                        el.className = 'recovery-countdown text-xs text-yellow-300';
                    }
                }
            } catch (error) {
                console.error('Failed to update recovery countdowns:', error);
            }
        }

        function formatCountdown(seconds) {
            if (seconds < 60) {
                return `${seconds}s`;
            } else if (seconds < 3600) {
                const mins = Math.floor(seconds / 60);
                const secs = seconds % 60;
                return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
            } else {
                const hrs = Math.floor(seconds / 3600);
                const mins = Math.floor((seconds % 3600) / 60);
                return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
            }
        }

        function showDeleteKeyConfirmation(apiType, providerName, keyIndex) {
            const dialog = document.getElementById('confirmDialog');
            const message = document.getElementById('confirmMessage');

            message.innerHTML = `Remove this API key from provider '${escapeHtml(providerName)}'?<br><br><span class="text-amber-500 text-xs">This removes the key from the running configuration. The key will still exist in your .env file and will reappear on next Reload Config. To permanently remove it, edit your .env file manually.</span>`;
            
            // Set up the confirm button to call the actual delete function
            const confirmBtn = dialog.querySelector('button[onclick="confirmDelete()"]');
            confirmBtn.onclick = () => {
                dialog.classList.add('hidden');
                deleteProviderKey(apiType, providerName, keyIndex);
            };
            
            dialog.classList.remove('hidden');
        }
        
        // Rename provider functionality
        function startRenameProvider(apiType, providerName) {
            const nameDiv = document.getElementById(`provider-name-${apiType}-${providerName}`);
            if (!nameDiv) return;

            const currentName = providerName;

            // Create inline edit form
            nameDiv.innerHTML = `
                <div class="flex items-center space-x-2">
                    <input
                        type="text"
                        id="rename-input-${escapeHtml(apiType)}-${escapeHtml(providerName)}"
                        value="${escapeHtml(currentName)}"
                        data-original="${escapeHtml(currentName)}"
                        class="px-2 py-1 text-sm border border-border rounded bg-input text-foreground"
                        style="width: 150px;"
                        oninput="handleProviderNameInput(this, '${safeJsAttr(apiType)}', '${safeJsAttr(providerName)}')"
                        onkeydown="handleRenameKeyPress(event, '${safeJsAttr(apiType)}', '${safeJsAttr(providerName)}')"
                    />
                    <button
                        id="rename-save-btn-${escapeHtml(apiType)}-${escapeHtml(providerName)}"
                        onclick="confirmRenameProvider('${safeJsAttr(apiType)}', '${safeJsAttr(providerName)}')"
                        class="text-muted-foreground hover:text-foreground p-0.5"
                        title="Save name"
                    >
                        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M7 19V13H17V19H19V7.828L16.172 5H15V9H9V5H5V19H7ZM17 5V7H15V5H17ZM19 3L21 5V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H19Z"></path>
                        </svg>
                    </button>
                    <button
                        onclick="cancelRenameProvider('${apiType}', '${providerName}')"
                        class="text-muted-foreground hover:text-foreground p-0.5"
                        title="Cancel"
                    >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            `;

            // Focus the input
            setTimeout(() => {
                const input = document.getElementById(`rename-input-${apiType}-${providerName}`);
                if (input) {
                    input.focus();
                    input.select();
                }
            }, 0);
        }

        function handleProviderNameInput(input, apiType, providerName) {
            // Convert to lowercase and keep only letters and numbers
            const originalValue = input.value;
            const cleanedValue = input.value.toLowerCase().replace(/[^a-z0-9]/g, '');

            if (originalValue !== cleanedValue) {
                input.value = cleanedValue;

                // Show warning if any special characters were removed
                if (/[^a-zA-Z0-9]/.test(originalValue)) {
                    showWarningToast('Only lowercase letters and numbers are allowed in provider names');
                }
            }

            // Check for changes and update save button
            const saveBtn = document.getElementById(`rename-save-btn-${apiType}-${providerName}`);
            if (saveBtn) {
                const originalName = input.getAttribute('data-original') || '';
                const currentValue = input.value.trim();

                // Keep button always in default color (no green)
                saveBtn.className = 'text-muted-foreground hover:text-foreground p-0.5';
            }
        }

        function handleBaseUrlInput(input) {
            // Check for trailing slash and show error
            const value = input.value;
            const errorElement = input.parentElement.querySelector('.base-url-error');

            if (value.endsWith('/')) {
                // Add error styling
                input.classList.add('border-destructive', 'focus:ring-destructive');
                input.classList.remove('border-border');

                // Create or update error message
                if (!errorElement) {
                    const error = document.createElement('p');
                    error.className = 'base-url-error text-destructive text-xs mt-1';
                    error.textContent = 'Base URL should not end with a trailing slash (/)';
                    input.parentElement.appendChild(error);
                } else {
                    errorElement.textContent = 'Base URL should not end with a trailing slash (/)';
                }

                // Show error toast
                showErrorToast('Base URL cannot end with a trailing slash');
            } else {
                // Remove error styling
                input.classList.remove('border-destructive', 'focus:ring-destructive');
                input.classList.add('border-border');

                // Remove error message
                if (errorElement) {
                    errorElement.remove();
                }
            }
        }

        function handleRenameKeyPress(event, apiType, providerName) {
            if (event.key === 'Enter') {
                confirmRenameProvider(apiType, providerName);
            } else if (event.key === 'Escape') {
                cancelRenameProvider(apiType, providerName);
            }
        }

        function cancelRenameProvider(apiType, providerName) {
            // Just refresh the provider list to restore original state
            renderProviders();
            loadCollapseState();
        }

        async function confirmRenameProvider(apiType, oldName) {
            const input = document.getElementById(`rename-input-${apiType}-${oldName}`);
            if (!input) return;

            const newName = input.value.trim().toLowerCase();

            // Validation
            if (!newName) {
                showWarningToast('Provider name cannot be empty');
                return;
            }

            if (!/^[a-z][a-z0-9]*$/.test(newName)) {
                showWarningToast('Provider name must start with a letter and contain only lowercase letters and numbers');
                return;
            }

            if (newName === oldName) {
                cancelRenameProvider(apiType, oldName);
                return;
            }

            // Check if new name already exists
            const newKeysVar = `${apiType.toUpperCase()}_${newName.toUpperCase()}_API_KEYS`;
            if (envVars[newKeysVar]) {
                showErrorToast(`Provider '${newName}' already exists`);
                return;
            }

            try {
                // Get all old values with the old provider prefix
                const oldPrefix = `${apiType.toUpperCase()}_${oldName.toUpperCase()}_`;
                const newPrefix = `${apiType.toUpperCase()}_${newName.toUpperCase()}_`;

                // Find all environment variables with the old prefix
                const oldVars = {};
                for (const key in envVars) {
                    if (key.startsWith(oldPrefix)) {
                        oldVars[key] = envVars[key];
                    }
                }

                if (Object.keys(oldVars).length === 0) {
                    showErrorToast('Provider not found');
                    return;
                }

                // Create new entries with the new prefix
                for (const [oldKey, value] of Object.entries(oldVars)) {
                    const suffix = oldKey.substring(oldPrefix.length); // Get the part after the prefix (API_KEYS, BASE_URL, etc.)
                    const newKey = newPrefix + suffix;
                    envVars[newKey] = value;
                }

                // Delete all old entries
                for (const key of Object.keys(oldVars)) {
                    delete envVars[key];
                }

                // Save to server
                const response = await fetch('/admin/api/env', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(envVars)
                });

                if (response.ok) {
                    showSuccessToast(`Provider renamed from '${oldName}' to '${newName}'`);
                    await loadEnvVars();
                } else {
                    // Rollback on error - restore old entries and remove new ones
                    for (const [oldKey, value] of Object.entries(oldVars)) {
                        envVars[oldKey] = value;
                    }

                    for (const [oldKey] of Object.entries(oldVars)) {
                        const suffix = oldKey.substring(oldPrefix.length);
                        const newKey = newPrefix + suffix;
                        delete envVars[newKey];
                    }

                    showErrorToast('Failed to rename provider');
                }
            } catch (error) {
                console.error('Rename error:', error);
                showErrorToast('Failed to rename provider: ' + error.message);
            }
        }

        async function deleteProviderKey(apiType, providerName, keyIndex) {

            const keysVar = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_API_KEYS`;
            const keys = envVars[keysVar] ? envVars[keysVar].split(',') : [];

            const newKeys = [...keys];
            newKeys.splice(keyIndex, 1);

            // Build new envVars without mutating original
            const newEnvVars = { ...envVars };
            if (newKeys.length === 0) {
                // If no keys left, delete the entire provider
                const providerPrefix = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_`;
                for (const key in newEnvVars) {
                    if (key.startsWith(providerPrefix)) {
                        delete newEnvVars[key];
                    }
                }
            } else {
                newEnvVars[keysVar] = newKeys.filter(k => k.trim()).join(',');
            }

            try {
                const response = await fetch('/admin/api/env', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(newEnvVars)
                });
                
                if (response.ok) {
                    envVars = newEnvVars;
                    renderEnvVars();
                    showSuccessToast(`🗑️ API key deleted from provider '${providerName}'`);
                } else {
                    const err = await response.json().catch(() => ({}));
                    showErrorToast('Failed to delete API key: ' + (err.error || response.statusText));
                }
            } catch (error) {
                showErrorToast(`Failed to delete API key: ${error.message}`);
            }
        }
        
        async function saveProviderKey(apiType, providerName) {
            const inputId = `newKey_${apiType}_${providerName}`;
            const newKey = document.getElementById(inputId).value.trim();
            
            if (!newKey) {
                showWarningToast('Please enter an API key');
                return;
            }

            // Check for duplicate key in this provider
            const keysVarCheck = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_API_KEYS`;
            const existingKeysRaw = envVars[keysVarCheck] ? envVars[keysVarCheck].split(',').map(k => k.trim().replace(/^~/, '')) : [];
            if (existingKeysRaw.includes(newKey)) {
                showWarningToast('This key already exists in this provider');
                return;
            }

            const maskedKey = newKey.length > 16 ? newKey.substring(0, 8) + '...' + newKey.slice(-4) : newKey;

            // Get the base URL for this provider to use for testing
            const baseUrlVar = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_BASE_URL`;
            const baseUrl = envVars[baseUrlVar] || '';
            
            // Test the API key before saving
            showInfoToast(`Testing API key ${maskedKey} before saving...`);
            
            try {
                const testResponse = await fetch('/admin/api/test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        apiType: apiType, 
                        apiKey: newKey,
                        baseUrl: baseUrl 
                    })
                });
                
                const testResult = await testResponse.json();
                
                if (!testResult.success) {
                    showErrorToast(`❌ API key ${maskedKey} is invalid: ${testResult.error || 'Unknown error'}`);
                    return;
                }
                
                showSuccessToast(`✅ API key ${maskedKey} is valid! Saving...`);
            } catch (error) {
                showErrorToast(`❌ Failed to test API key ${maskedKey}: ${error.message}`);
                return;
            }
            
            // If test passes, save the key
            const keysVar = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_API_KEYS`;
            const existingKeys = envVars[keysVar] ? envVars[keysVar].split(',') : [];
            existingKeys.push(newKey);
            envVars[keysVar] = existingKeys.filter(k => k.trim()).join(',');
            
            try {
                const response = await fetch('/admin/api/env', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(envVars)
                });
                
                if (response.ok) {
                    document.getElementById(inputId).value = '';
                    renderEnvVars();
                    
                    showSuccessToast(`✅ Tested and valid API key ${maskedKey} added to provider '${providerName}'!`);
                } else {
                    showErrorToast('Failed to save API key');
                    // Revert the change
                    const revertedKeys = existingKeys.slice(0, -1);
                    envVars[keysVar] = revertedKeys.filter(k => k.trim()).join(',');
                }
            } catch (error) {
                showErrorToast(`Failed to save API key: ${error.message}`);
                // Revert the change
                const revertedKeys = existingKeys.slice(0, -1);
                envVars[keysVar] = revertedKeys.filter(k => k.trim()).join(',');
            }
        }
        
        async function testProviderNewKey(apiType, providerName) {
            const inputId = `newKey_${apiType}_${providerName}`;
            const newKey = document.getElementById(inputId).value.trim();
            
            if (!newKey) {
                showWarningToast('Please enter an API key to test');
                return;
            }
            
            // Get provider's base URL
            const keysVar = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_API_KEYS`;
            const baseUrlVar = `${apiType.toUpperCase()}_${providerName.toUpperCase()}_BASE_URL`;
            const baseUrl = envVars[baseUrlVar] || null;
            
            const maskedKey = newKey.length > 16 ? newKey.substring(0, 8) + '...' + newKey.slice(-4) : newKey;
            showInfoToast(`Testing API key ${maskedKey} for provider '${providerName}'...`);
            
            try {
                const response = await fetch('/admin/api/test', {
                    method: 'POST',
                    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        apiType: apiType,
                        apiKey: newKey,
                        baseUrl: baseUrl
                    })
                });

                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error || `HTTP ${response.status}`);
                }

                const result = await response.json();

                if (result.success) {
                    showSuccessToast(`API key ${maskedKey} is valid! Ready to add to provider '${providerName}'.`);
                } else {
                    showErrorToast(`API key ${maskedKey} is invalid: ${result.error || 'Unknown error'}`);
                }
            } catch (error) {
                showErrorToast(`API key test failed: ${error.message}`);
            }
        }
        
        // Removed legacy key functions - everything is now managed as providers
        
        // Removed old functions - replaced with provider management
        
        // Removed - no longer needed
        
        // Removed - no longer needed
        
        // Removed - no longer needed with new provider system
        
        // Removed - replaced with testNewProvider function

        // Removed legacy API key testing - everything is now provider-based
        
        async function saveEnvVars() {
            try {
                const response = await fetch('/admin/api/env', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(envVars)
                });
                
                if (response.ok) {
                    showSuccess('envSuccess', 'Environment variables saved and configuration reloaded!');
                } else {
                    showError('envError', 'Failed to save environment variables');
                }
            } catch (error) {
                showError('envError', 'Save failed: ' + error.message);
            }
        }
        
        // API Testing functionality
        async function testApiKey(apiType) {
            const keyInput = document.getElementById(`${apiType}TestKey`);
            const resultDiv = document.getElementById(`${apiType}TestResult`);
            
            if (!keyInput.value.trim()) {
                resultDiv.innerHTML = '<div class="bg-destructive/10 border border-destructive/20 text-destructive px-3 py-2 rounded-md text-sm mt-3">Please enter an API key</div>';
                return;
            }
            
            resultDiv.innerHTML = '<div class="bg-blue-50 border border-blue-200 text-blue-800 px-3 py-2 rounded-md text-sm mt-3">Testing...</div>';
            
            try {
                const response = await fetch('/admin/api/test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        apiType: apiType, 
                        apiKey: keyInput.value.trim() 
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    resultDiv.innerHTML = '<div class="bg-green-50 border border-green-200 text-green-800 px-3 py-2 rounded-md text-sm mt-3 flex items-center space-x-2"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg><span>API key is valid!</span></div>';
                } else {
                    resultDiv.innerHTML = `<div class="bg-destructive/10 border border-destructive/20 text-destructive px-3 py-2 rounded-md text-sm mt-3 flex items-center space-x-2"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg><span>${escapeHtml(result.error)}</span></div>`;
                }
            } catch (error) {
                resultDiv.innerHTML = `<div class="bg-destructive/10 border border-destructive/20 text-destructive px-3 py-2 rounded-md text-sm mt-3">Test failed: ${escapeHtml(error.message)}</div>`;
            }
        }
        
        // Logging functionality

        function populateProviderLogSelect() {
            const select = document.getElementById('providerLogSelect');
            if (!select) return;
            const current = select.value;
            const providers = new Set();
            for (const [key, value] of Object.entries(envVars)) {
                if (key.endsWith('_API_KEYS') && value) {
                    const name = key.replace('_API_KEYS', '').split('_').slice(1).join('_').toLowerCase();
                    providers.add(name);
                }
            }
            select.innerHTML = '<option value="">All Providers</option>';
            for (const p of [...providers].sort()) {
                select.innerHTML += `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`;
            }
            if (current && providers.has(current)) select.value = current;
        }

        async function loadProviderLogs() {
            const tbody = document.getElementById('providerLogsBody');
            if (!tbody) return;
            try {
                const provider = document.getElementById('providerLogSelect')?.value || '';
                const status = document.getElementById('providerLogStatus')?.value || '';
                const params = new URLSearchParams();
                if (provider) params.set('provider', provider);
                if (status) params.set('status', status);
                params.set('limit', '100');
                const res = await fetch(`/admin/api/provider-logs?${params}`);
                const data = await res.json();
                const logs = data.logs || [];
                if (logs.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted-foreground py-4">No logs found</td></tr>';
                    return;
                }
                tbody.innerHTML = logs.map(l => {
                    const time = l.timestamp ? l.timestamp.substring(11, 23) : '--';
                    const statusColor = !l.status ? '' : l.status < 300 ? 'text-green-400' : l.status < 400 ? 'text-blue-400' : l.status === 429 ? 'text-amber-400' : 'text-red-400';
                    const latency = l.responseTime ? l.responseTime + 'ms' : '--';
                    const key = l.keyUsed ? (l.keyUsed.length > 16 ? l.keyUsed.substring(0, 8) + '...' + l.keyUsed.slice(-4) : l.keyUsed) : '--';
                    return `<tr class="hover:bg-muted/30">
                        <td class="px-2 py-1.5 font-mono whitespace-nowrap">${time}</td>
                        <td class="px-2 py-1.5 whitespace-nowrap">${escapeHtml(l.provider || '--')}</td>
                        <td class="px-2 py-1.5">${l.method || '--'}</td>
                        <td class="px-2 py-1.5 font-mono truncate max-w-[200px]" title="${escapeHtml(l.endpoint || '')}">${escapeHtml((l.endpoint || '--').substring(0, 40))}</td>
                        <td class="px-2 py-1.5 font-mono ${statusColor}">${l.status || '--'}</td>
                        <td class="px-2 py-1.5 font-mono whitespace-nowrap">${latency}</td>
                        <td class="px-2 py-1.5 font-mono text-muted-foreground">${escapeHtml(key)}</td>
                        <td class="px-2 py-1.5 text-red-400 truncate max-w-[200px]" title="${escapeHtml(l.error || '')}">${escapeHtml((l.error || '').substring(0, 50))}</td>
                    </tr>`;
                }).join('');
            } catch (e) {
                tbody.innerHTML = `<tr><td colspan="8" class="text-center text-red-400 py-4">Error: ${escapeHtml(e.message)}</td></tr>`;
            }

            // Re-apply active search filter after table rebuild
            const searchInput = document.getElementById('logSearchInput');
            if (searchInput && searchInput.value) filterProviderLogs(searchInput.value);
        }

        function filterProviderLogs(query) {
            const q = query.trim().toLowerCase();
            const rows = document.querySelectorAll('#providerLogsBody tr');
            const clearBtn = document.getElementById('logSearchClear');
            if (clearBtn) clearBtn.classList.toggle('hidden', !q);
            rows.forEach(row => {
                row.style.display = (!q || row.textContent.toLowerCase().includes(q)) ? '' : 'none';
            });
        }

        function clearLogSearch() {
            const input = document.getElementById('logSearchInput');
            if (input) input.value = '';
            filterProviderLogs('');
        }

        async function handleRefreshLogs(button) {
            // Add spinning animation to reload button
            if (button) {
                const svg = button.querySelector('svg');
                if (svg) {
                    svg.style.animation = 'spin 1s linear infinite';
                }
                button.disabled = true;
            }
            
            // Call the actual refresh function
            await refreshLogs();
            
            // Remove animation after refresh
            if (button) {
                const svg = button.querySelector('svg');
                if (svg) {
                    svg.style.animation = '';
                }
                button.disabled = false;
            }
        }
        
        async function refreshLogs() {
            try {
                const response = await fetch('/admin/api/logs');
                const data = await response.json();
                
                const logsContainer = document.getElementById('logsContainer');
                if (!data.logs || data.logs.length === 0) {
                    logsContainer.textContent = 'No logs available';
                    return;
                }
                
                // Check if we're receiving the new JSON format
                const isJsonFormat = data.format === 'json' || (data.logs.length > 0 && typeof data.logs[0] === 'object');
                
                let processedLogs;
                
                if (isJsonFormat) {
                    // Deduplicate logs - keep the LAST (most complete) entry per requestId
                    const seenRequests = new Map();

                    for (const log of data.logs) {
                        let key;
                        if (typeof log === 'object' && log.requestId) {
                            key = log.requestId;
                        } else if (typeof log === 'string') {
                            const reqIdMatch = log.match(/\[([a-zA-Z0-9]+)\]/);
                            key = reqIdMatch ? reqIdMatch[1] : log;
                        } else {
                            key = JSON.stringify(log);
                        }
                        // Always overwrite - last entry wins (has status + key info)
                        seenRequests.set(key, log);
                    }
                    const uniqueLogs = [...seenRequests.values()].reverse();

                    // New JSON format - create formatted display
                    processedLogs = uniqueLogs.map((log, idx) => {
                        let content;
                        if (typeof log === 'string') {
                            // Legacy string format - display as is with view button if possible
                            const testMatch = log.match(/\[TEST-([a-zA-Z0-9]+)\]/);
                            const reqMatch = log.match(/\[REQ-([a-zA-Z0-9]+)\]/);
                            if (testMatch) {
                                const testId = testMatch[1];
                                content = log + ` <button onclick="viewResponse('${testId}')" class="ml-2 text-blue-400 hover:text-blue-300 underline cursor-pointer text-xs">View Details</button>`;
                            } else if (reqMatch) {
                                const requestId = reqMatch[1];
                                content = log + ` <button onclick="viewResponse('${requestId}')" class="ml-2 text-blue-400 hover:text-blue-300 underline cursor-pointer text-xs">View Details</button>`;
                            } else {
                                content = escapeHtml(log);
                            }
                        } else {
                            // New JSON format - create structured display
                            const timestamp = new Date(log.timestamp).toLocaleTimeString();
                            const status = log.status ? `(${log.status})` : '';
                            const responseTime = log.responseTime ? `${log.responseTime}ms` : '';
                            const error = log.error ? ` ERROR: ${escapeHtml(log.error)}` : '';

                            // Color coding based on status
                            let statusColor = 'text-green-400';
                            if (log.status >= 400) {
                                statusColor = 'text-red-400';
                            } else if (log.status >= 300) {
                                statusColor = 'text-yellow-400';
                            }

                            // Key usage info - make it more prominent
                            let keyInfoHtml = '';
                            if (log.keyUsed) {
                                keyInfoHtml += ` <span class="text-green-400 font-semibold" title="Key used successfully">✓ key:${escapeHtml(log.keyUsed)}</span>`;
                            }
                            if (log.failedKeys && log.failedKeys.length > 0) {
                                const failedList = log.failedKeys.map(fk => {
                                    const statusText = fk.status ? `HTTP ${fk.status}` : (fk.reason || 'error');
                                    return `${escapeHtml(fk.key)} (${statusText})`;
                                }).join(', ');
                                keyInfoHtml += ` <span class="text-red-400 font-semibold" title="Keys that failed before success">✗ FAILED: ${failedList}</span>`;
                            }

                            // If no successful key but we have failed keys, highlight the issue
                            if (!log.keyUsed && log.failedKeys && log.failedKeys.length > 0) {
                                keyInfoHtml = ` <span class="text-red-500 font-bold bg-red-900/30 px-2 py-1 rounded" title="All keys failed">⚠ ALL KEYS FAILED: ${log.failedKeys.map(fk => `${escapeHtml(fk.key)}(${fk.status || 'err'})`).join(', ')}</span>`;
                            }

                            content = `<span class="text-gray-400">${timestamp}</span> <span class="text-blue-400">[${escapeHtml(log.requestId || '')}]</span> <span class="text-white">${escapeHtml(log.method || '')} ${escapeHtml(log.endpoint || '')}</span> <span class="text-cyan-400">(${escapeHtml(log.provider || '')})</span> <span class="${statusColor}">${status}</span> <span class="text-gray-400">${responseTime}</span>${keyInfoHtml}<span class="text-red-400">${error}</span>`;

                            // Add view button if we have detailed response data
                            if (log.requestId && log.requestId !== 'unknown') {
                                content += ` <button onclick="viewResponse('${escapeHtml(log.requestId)}')" class="ml-2 text-blue-400 hover:text-blue-300 underline cursor-pointer text-xs">View Details</button>`;
                            }
                        }
                        return `<div class="log-line"><span class="log-line-num">${idx + 1}</span><span class="log-line-content">${content}</span></div>`;
                    }).join('');
                } else {
                    // Legacy string format - deduplicate based on request ID
                    const seenIds = new Set();
                    const uniqueLogs = [];
                    
                    for (const log of data.logs) {
                        // Extract any ID from the log string
                        const idMatch = log.match(/\[([a-zA-Z0-9]+)\]/);
                        const logId = idMatch ? idMatch[1] : log;
                        
                        if (!seenIds.has(logId)) {
                            seenIds.add(logId);
                            uniqueLogs.push(log);
                        }
                    }
                    
                    // Legacy string format - reverse so latest is first
                    uniqueLogs.reverse();
                    processedLogs = uniqueLogs.map((log, idx) => {
                        let content;
                        const testMatch = log.match(/\[TEST-([a-zA-Z0-9]+)\]/);
                        if (testMatch) {
                            const testId = testMatch[1];
                            content = escapeHtml(log) + ` <button onclick="viewResponse('${testId}')" class="ml-2 text-blue-400 hover:text-blue-300 underline cursor-pointer text-xs">View Details</button>`;
                        } else {
                            const reqMatch = log.match(/\[REQ-([a-zA-Z0-9]+)\]/);
                            if (reqMatch) {
                                const requestId = reqMatch[1];
                                content = escapeHtml(log) + ` <button onclick="viewResponse('${requestId}')" class="ml-2 text-blue-400 hover:text-blue-300 underline cursor-pointer text-xs">View Details</button>`;
                            } else {
                                content = escapeHtml(log);
                            }
                        }
                        return `<div class="log-line"><span class="log-line-num">${idx + 1}</span><span class="log-line-content">${content}</span></div>`;
                    }).join('');
                }
                
                logsContainer.innerHTML = processedLogs || 'No logs available';

                // Latest logs are already at top, scroll to top
                logsContainer.scrollTop = 0;
            } catch (error) {
                document.getElementById('logsContainer').textContent = 'Failed to load logs: ' + sanitizeError(error);
            }
        }

        function copyRawLogs() {
            const container = document.getElementById('logsContainer');
            if (!container) return;
            const text = container.innerText;
            navigator.clipboard.writeText(text).then(() => {
                const btn = document.querySelector('[onclick="copyRawLogs()"]');
                if (btn) {
                    const original = btn.innerHTML;
                    btn.innerHTML = '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Copied!';
                    setTimeout(() => { btn.innerHTML = original; }, 1500);
                }
            }).catch(() => {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;opacity:0';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            });
        }

        async function viewResponse(testId) {
            try {
                const response = await fetch(`/admin/api/response/${testId}`);
                if (!response.ok) {
                    alert('Response data not found');
                    return;
                }
                
                const data = await response.json();
                
                // Update dialog content
                document.getElementById('responseInfo').textContent = 
                    `${data.method} ${data.endpoint} (${data.apiType}) → ${data.status} ${data.statusText} | ${data.contentType}`;
                
                // Format JSON response
                let formattedResponse;
                try {
                    const jsonData = JSON.parse(data.responseData);
                    formattedResponse = JSON.stringify(jsonData, null, 2);
                } catch (e) {
                    // Not JSON, show as plain text
                    formattedResponse = data.responseData;
                }
                
                document.getElementById('responseContent').textContent = formattedResponse;
                
                // Handle request body tab
                const requestTab = document.getElementById('requestTab');
                const requestContent = document.getElementById('requestContent');
                
                if (data.requestBody && data.requestBody.trim()) {
                    // Show and enable request tab if there's a request body
                    requestTab.classList.remove('hidden');
                    requestTab.disabled = false;
                    requestTab.title = '';
                    requestTab.className = 'px-4 py-2 rounded-md text-sm font-medium btn-secondary';
                    
                    // Format request body
                    let formattedRequest;
                    try {
                        const requestJson = JSON.parse(data.requestBody);
                        formattedRequest = JSON.stringify(requestJson, null, 2);
                    } catch (e) {
                        formattedRequest = data.requestBody;
                    }
                    
                    requestContent.textContent = formattedRequest;
                } else {
                    // Show but disable request tab if no request body
                    requestTab.classList.remove('hidden');
                    requestTab.disabled = true;
                    requestTab.title = 'No request body available';
                    requestTab.className = 'px-4 py-2 rounded-md text-sm font-medium bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed opacity-50';
                    requestContent.textContent = 'No request body data available for this request.';
                }
                
                // Start with response tab active
                switchResponseTab('response');
                
                // Show dialog
                document.getElementById('responseDialog').classList.remove('hidden');
            } catch (error) {
                alert('Failed to load response: ' + sanitizeError(error));
            }
        }

        function switchResponseTab(tab) {
            const responseTab = document.getElementById('responseTab');
            const requestTab = document.getElementById('requestTab');
            const responseContent = document.getElementById('responseContent');
            const requestContent = document.getElementById('requestContent');
            
            // Don't switch if request tab is disabled and trying to switch to it
            if (tab === 'request' && requestTab.disabled) {
                return;
            }
            
            if (tab === 'response') {
                // Activate response tab
                responseTab.className = 'px-4 py-2 rounded-md text-sm font-medium btn-primary';
                // Only update request tab style if it's not disabled
                if (!requestTab.disabled) {
                    requestTab.className = 'px-4 py-2 rounded-md text-sm font-medium btn-secondary';
                }
                responseContent.classList.remove('hidden');
                requestContent.classList.add('hidden');
            } else {
                // Activate request tab (only reachable if not disabled)
                requestTab.className = 'px-4 py-2 rounded-md text-sm font-medium btn-primary';
                responseTab.className = 'px-4 py-2 rounded-md text-sm font-medium btn-secondary';
                requestContent.classList.remove('hidden');
                responseContent.classList.add('hidden');
            }
        }

        function closeResponseDialog() {
            document.getElementById('responseDialog').classList.add('hidden');
        }
        
        // Hash-based tab routing
        const TAB_HASHES = {
            environment: 'keys',
            logs: 'logs',
            management: 'health',
            analytics: 'analytics',
            virtualkeys: 'virtual-keys',
            budgets: 'budgets',
            settings: 'settings'
        };
        const HASH_TO_TAB = Object.fromEntries(Object.entries(TAB_HASHES).map(([k, v]) => [v, k]));

        function getTabFromHash() {
            const hash = location.hash.slice(1);
            return HASH_TO_TAB[hash] || null;
        }

        // Load logs when logs tab is shown
        function showTab(tabName) {
            // Update URL hash
            if (TAB_HASHES[tabName] && location.hash.slice(1) !== TAB_HASHES[tabName]) {
                history.replaceState(null, '', '#' + TAB_HASHES[tabName]);
            }

            // Hide all tabs
            document.querySelectorAll('.tab-content').forEach(tab => {
                tab.classList.add('hidden');
            });

            // Remove active state from all tab buttons
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.classList.remove('active');
                btn.classList.add('text-muted-foreground');
                btn.classList.remove('text-foreground', 'border-primary');
                btn.setAttribute('aria-selected', 'false');
            });

            // Show selected tab
            document.getElementById(tabName).classList.remove('hidden');

            // Set active state on clicked tab button
            const activeBtn = document.querySelector(`[data-tab="${tabName}"]`);
            activeBtn.classList.add('active', 'text-foreground', 'border-primary');
            activeBtn.classList.remove('text-muted-foreground');
            activeBtn.setAttribute('aria-selected', 'true');

            // Stop recovery poller when switching away from relevant tabs
            stopRecoveryPoller();

            // Load logs if logs tab is selected
            if (tabName === 'logs') {
                refreshLogs();
                populateProviderLogSelect();
                loadProviderLogs();
            }
            // Load health data if management tab is selected
            if (tabName === 'management') {
                refreshHealth();
            }
            // Start recovery poller when on environment (API Keys) tab
            if (tabName === 'environment') {
                startRecoveryPoller();
            }
            // Load analytics data if analytics tab is selected
            if (tabName === 'analytics') {
                loadAnalytics();
            }
            // Load virtual keys if virtualkeys tab is selected
            if (tabName === 'virtualkeys') {
                refreshVirtualKeys();
            }
            // Load budgets if budgets tab is selected
            if (tabName === 'budgets') {
                loadBudgets();
            }
            // Load settings if settings tab is selected
            if (tabName === 'settings') {
                loadConfiguration();
                loadImportSources();
                loadExclusions();
                loadTelegramSettings();
                checkPasswordUpgrade();
                loadNotifications();
                loadFallbacks();
                loadLbSettings();
                loadGeneralSettings();
                attachSettingsAutoSave();
                updateGlobalSyncUI();
                loadSyncExclusiveProviders();
                loadRetryConfig();
                loadProviderConfig();
            }
        }
        
        // Health monitoring
        let healthRefreshTimer = null;

        async function refreshHealth() {
            try {
                const res = await fetch('/admin/api/health');
                if (!res.ok) return;
                const data = await res.json();
                renderHealthSummary(data.summary);
                renderHealthTable(data.providers);
                if (data.summary.lastFullCheck) {
                    document.getElementById('healthLastCheck').textContent = `Last check: ${new Date(data.summary.lastFullCheck).toLocaleTimeString()}`;
                }
            } catch (err) {
                console.error('Failed to load health:', err);
            }
        }

        async function checkAllHealth() {
            try {
                const res = await fetch('/admin/api/health/check-all', { method: 'POST' });
                if (res.ok) {
                    const data = await res.json();
                    renderHealthSummary(data.summary);
                    renderHealthTable(data.providers);
                }
            } catch (err) {
                console.error('Failed to check health:', err);
            }
        }

        /**
         * Run immediate recovery scan for all exhausted keys
         */
        async function runRecoveryScan() {
            showInfoToast('Running recovery scan for all exhausted keys...');

            try {
                const res = await fetch('/admin/api/recovery/scan', { method: 'POST' });

                if (res.ok) {
                    const data = await res.json();

                    if (data.success) {
                        const { recovered, stillFailing, skipped } = data.results;

                        if (recovered > 0) {
                            showSuccessToast(`Recovery complete: ${recovered} key(s) recovered, ${stillFailing} still failing, ${skipped} skipped (cooldown)`);
                        } else if (stillFailing > 0) {
                            showInfoToast(`Recovery scan: ${stillFailing} key(s) still failing, ${skipped} skipped (cooldown). Will retry after backoff.`);
                        } else {
                            showInfoToast(`Recovery scan: ${skipped} key(s) in cooldown period. Nothing to probe yet.`);
                        }

                        // Refresh both Management and API Keys tabs
                        refreshHealth();
                        loadProviders();
                    } else {
                        showErrorToast('Recovery scan failed');
                    }
                } else if (res.status === 429) {
                    const err = await res.json();
                    showErrorToast(err.error || 'Recovery scan rate limited. Please wait.');
                } else {
                    showErrorToast('Failed to run recovery scan');
                }
            } catch (err) {
                console.error('Failed to run recovery scan:', err);
                showErrorToast('Recovery scan failed: ' + err.message);
            }
        }

        async function resetProviderHealth(provider, btn) {
            if (!btn) btn = document.getElementById('reset-btn-' + provider);
            const originalText = btn ? btn.textContent : 'Reset';
            try {
                if (btn) {
                    btn.textContent = 'Resetting...';
                    btn.disabled = true;
                    btn.classList.add('opacity-50', 'cursor-not-allowed');
                }
                const res = await fetch('/admin/api/health/reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ provider })
                });
                if (res.ok) {
                    showInfoToast('Provider "' + provider + '" reset successfully');
                    refreshHealth();
                } else {
                    const data = await res.json();
                    showErrorToast('Reset failed: ' + (data.error || 'Unknown error'));
                }
            } catch (err) {
                console.error('Failed to reset:', err);
                showErrorToast('Reset failed: ' + err.message);
            } finally {
                if (btn) {
                    btn.textContent = originalText;
                    btn.disabled = false;
                    btn.classList.remove('opacity-50', 'cursor-not-allowed');
                }
            }
        }

        function navigateToProviderKeys(apiType, providerName) {
            showTab('environment');
            const targetId = 'provider-section-' + apiType + '-' + providerName;
            const scrollToProvider = () => {
                const target = document.getElementById(targetId);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    target.classList.add('ring-2', 'ring-primary', 'ring-offset-2', 'ring-offset-background');
                    setTimeout(() => {
                        target.classList.remove('ring-2', 'ring-primary', 'ring-offset-2', 'ring-offset-background');
                    }, 3000);
                }
            };
            const existing = document.getElementById(targetId);
            setTimeout(scrollToProvider, existing ? 50 : 500);
        }

        function formatRelativeTime(isoString) {
            if (!isoString) return '-';
            const diffMs = Date.now() - new Date(isoString).getTime();
            const diffSec = Math.floor(diffMs / 1000);
            if (diffSec < 60) return 'just now';
            const diffMin = Math.floor(diffSec / 60);
            if (diffMin < 60) return diffMin + 'm ago';
            const diffHr = Math.floor(diffMin / 60);
            if (diffHr < 24) return diffHr + 'h ago';
            return new Date(isoString).toLocaleDateString();
        }

        function renderHealthSummary(summary) {
            if (!summary) return;
            document.getElementById('healthTotal').textContent = summary.total;
            document.getElementById('healthActive').textContent = summary.active;
            document.getElementById('healthDegraded').textContent = summary.degraded;
            document.getElementById('healthFailed').textContent = summary.failed + summary.disabled;
        }

        function renderHealthTable(providers) {
            const tbody = document.getElementById('healthTableBody');
            if (!tbody || !providers) return;
            tbody.innerHTML = '';

            const statusBadge = (status) => {
                const colors = {
                    active: 'bg-green-500/20 text-green-400 border-green-500/30',
                    degraded: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
                    failed: 'bg-red-500/20 text-red-400 border-red-500/30',
                    disabled: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
                    unknown: 'bg-gray-500/20 text-gray-400 border-gray-500/30'
                };
                return `<span class="px-2 py-0.5 rounded text-xs border ${colors[status] || colors.unknown}">${escapeHtml(status)}</span>`;
            };

            providers.forEach(p => {
                const row = document.createElement('tr');
                row.className = 'border-b border-border/50 hover:bg-muted/30';
                const _hn = escapeHtml(p.name);
                const _ha = escapeHtml(p.apiType);
                row.innerHTML = `
                    <td class="py-2 pr-3 font-medium"><a href="javascript:void(0)" onclick="navigateToProviderKeys('${_ha}', '${_hn}')" class="text-primary hover:underline cursor-pointer">${_hn}</a></td>
                    <td class="py-2 pr-3">${statusBadge(p.status)}</td>
                    <td class="py-2 pr-3" id="cb-${_hn}">${statusBadge('unknown')}</td>
                    <td class="py-2 pr-3 text-xs text-muted-foreground">${_ha}</td>
                    <td class="py-2 pr-3 text-xs"><span class="text-green-400">${p.enabledKeys}</span>/<span class="text-muted-foreground">${p.totalKeys}</span>${p.exhaustedKeys ? ` <span class="text-red-400">(-${p.exhaustedKeys})</span>` : ''}</td>
                    <td class="py-2 pr-3 text-xs text-muted-foreground">${p.totalRequests}</td>
                    <td class="py-2 pr-3 text-xs text-muted-foreground">${p.avgResponseTime ? p.avgResponseTime + 'ms' : '-'}</td>
                    <td class="py-2 pr-3 text-xs text-muted-foreground" title="${p.lastCheckTime ? new Date(p.lastCheckTime).toLocaleString() : 'Never'}">${formatRelativeTime(p.lastCheckTime)}</td>
                    <td class="py-2 pr-3 text-xs text-red-400">${escapeHtml(p.lastError || '')}</td>
                    <td class="py-2 text-xs">
                        <button id="reset-btn-${_hn}" onclick="resetProviderHealth('${_hn}', this)" class="text-muted-foreground hover:text-foreground" title="Reset key history, circuit breaker, and force re-check">Reset</button>
                    </td>
                `;
                tbody.appendChild(row);
            });
            loadCircuitBreakerStates();
        }

        // Auto-refresh health tab every 30s
        setInterval(() => {
            const mgmtTab = document.getElementById('management');
            if (mgmtTab && !mgmtTab.classList.contains('hidden')) {
                refreshHealth();
            }
        }, 30000);

        // Utility functions
        function showError(elementId, message) {
            const errorDiv = document.getElementById(elementId);
            errorDiv.textContent = sanitizeError(message);
            errorDiv.classList.remove('hidden');
            setTimeout(() => errorDiv.classList.add('hidden'), 5000);
        }
        
        function showSuccess(elementId, message) {
            const successDiv = document.getElementById(elementId);
            successDiv.textContent = message;
            successDiv.classList.remove('hidden');
            setTimeout(() => successDiv.classList.add('hidden'), 5000);
        }
        
        // Event listeners
        document.getElementById('password').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                login();
            }
        });
        
        // Dialog keyboard handling
        document.addEventListener('keydown', function(e) {
            if (!document.getElementById('confirmDialog').classList.contains('hidden')) {
                if (e.key === 'Escape') {
                    cancelDelete();
                } else if (e.key === 'Enter') {
                    confirmDelete();
                }
            }
        });
        
        // Check authentication on page load
        async function checkAuth() {
            // Always check rate limit status first
            await checkLoginRateLimit();

            try {
                const response = await fetch('/admin/api/auth');
                const data = await response.json();

                if (data.authenticated) {
                    // Fetch CSRF token when authenticated
                    await fetchCsrfToken();

                    document.body.classList.remove('checking-auth');
                    document.body.classList.add('authenticated');
                    document.getElementById('loginForm').classList.add('hidden');
                    document.getElementById('adminPanel').classList.remove('hidden');

                    // Always load base data
                    await loadEnvVars();
                    loadRetryConfig();

                    // Restore tab from URL hash or show default
                    const tabFromUrl = getTabFromHash();
                    if (tabFromUrl) {
                        showTab(tabFromUrl);
                    } else {
                        startRecoveryPoller();
                    }

                    setTimeout(adjustStickyHeaderPositioning, 100);
                } else {
                    document.body.classList.remove('checking-auth');
                    document.body.classList.add('not-authenticated');
                }
            } catch (error) {
                console.log('Auth check failed, showing login form');
                document.body.classList.remove('checking-auth');
                document.body.classList.add('not-authenticated');
            }
        }

        async function checkLoginRateLimit() {
            try {
                const response = await fetch('/admin/api/login-status');
                const data = await response.json();

                if (data.blocked) {
                    const passwordInput = document.getElementById('password');
                    const loginButton = document.getElementById('loginButton');
                    const errorDiv = document.getElementById('loginError');

                    if (passwordInput) passwordInput.disabled = true;
                    if (loginButton) loginButton.disabled = true;

                    // Start countdown from remaining seconds
                    startLoginCountdown(data.remainingSeconds, passwordInput, loginButton, errorDiv);
                }
            } catch (error) {
                console.log('Failed to check login rate limit status:', error);
            }
        }
        
        // Setup notification hover functionality
        function setupNotificationHover() {
            const headerNotifications = document.getElementById('headerNotifications');
            const singleNotification = document.getElementById('singleNotification');
            const expandedNotifications = document.getElementById('expandedNotifications');
            
            if (!headerNotifications || !singleNotification || !expandedNotifications) return;
            
            let hoverTimeout;
            
            // Show expanded view on hover
            const showExpanded = () => {
                clearTimeout(hoverTimeout);
                // Only show expanded view if there are notifications
                if (activeNotifications.length > 0) {
                    updateExpandedNotifications();
                    positionNotifications();
                    expandedNotifications.classList.remove('hidden');
                }
            };
            
            headerNotifications.addEventListener('mouseenter', showExpanded);
            singleNotification.addEventListener('mouseenter', showExpanded);
            
            // Hide expanded view on leave with small delay
            headerNotifications.addEventListener('mouseleave', () => {
                hoverTimeout = setTimeout(() => {
                    expandedNotifications.classList.add('hidden');
                }, 200); // Small delay to prevent flickering
            });
            
            // Keep expanded view open if hovering over it
            expandedNotifications.addEventListener('mouseenter', () => {
                clearTimeout(hoverTimeout);
            });
            
            expandedNotifications.addEventListener('mouseleave', () => {
                hoverTimeout = setTimeout(() => {
                    expandedNotifications.classList.add('hidden');
                }, 200);
            });
        }
        
        // Fix sticky header positioning
        function adjustStickyHeaderPositioning() {
            const header = document.querySelector('header.sticky-header');
            const navTabs = document.getElementById('navigationTabs');
            const mainContent = document.querySelector('.content-with-sticky-header');
            
            if (header && navTabs && mainContent) {
                const headerHeight = header.offsetHeight;
                const navTabsHeight = navTabs.offsetHeight;
                const totalHeight = headerHeight + navTabsHeight;
                
                console.log('Header height:', headerHeight);
                console.log('Nav tabs height:', navTabsHeight);
                console.log('Total height:', totalHeight);
                
                // Position nav tabs below the header
                navTabs.style.top = headerHeight + 'px';
                
                // Add margin to main content to account for both elements
                mainContent.style.marginTop = (totalHeight + 20) + 'px';
            }
        }
        
        // Initialize active tab styling and check auth
        document.addEventListener('DOMContentLoaded', function() {
            // Initialize theme
            initializeTheme();

            const activeTab = document.querySelector('.tab-btn.active');
            if (activeTab) {
                activeTab.classList.add('text-foreground', 'border-primary');
                activeTab.classList.remove('text-muted-foreground');
            }

            // Keyboard navigation for tab list
            const tabList = document.querySelector('[role="tablist"]');
            if (tabList) {
                tabList.addEventListener('keydown', function(e) {
                    const tabs = Array.from(tabList.querySelectorAll('[role="tab"]'));
                    const current = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true');
                    let next = -1;
                    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                        next = (current + 1) % tabs.length;
                    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                        next = (current - 1 + tabs.length) % tabs.length;
                    } else if (e.key === 'Home') {
                        next = 0;
                    } else if (e.key === 'End') {
                        next = tabs.length - 1;
                    }
                    if (next >= 0) {
                        e.preventDefault();
                        tabs[next].focus();
                        tabs[next].click();
                    }
                });
            }

            // Initialize provider preview
            updateProviderPreview();
            
            // Fix sticky header positioning
            adjustStickyHeaderPositioning();
            
            // Re-adjust on window resize
            window.addEventListener('resize', adjustStickyHeaderPositioning);
            
            // Setup notification hover functionality
            setupNotificationHover();
            
            // Check if user is already authenticated
            checkAuth();

            // Handle browser back/forward (hash changes)
            window.addEventListener('hashchange', () => {
                if (document.body.classList.contains('authenticated')) {
                    const tab = getTabFromHash();
                    if (tab) showTab(tab);
                }
            });
        });
