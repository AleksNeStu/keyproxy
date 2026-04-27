    // CSRF Token Management
    let csrfToken = null;

    /**
     * Fetch CSRF token from server
     */
    async function fetchCsrfToken() {
        try {
            const response = await fetch('/admin/api/csrf-token');
            if (response.ok) {
                const data = await response.json();
                csrfToken = data.csrfToken;
                localStorage.setItem('keyproxy_csrf_token', csrfToken);
                return csrfToken;
            }
        } catch (error) {
            console.error('Failed to fetch CSRF token:', error);
        }
        return null;
    }

    /**
     * Get current CSRF token from memory or localStorage
     */
    function getCsrfToken() {
        if (!csrfToken) {
            csrfToken = localStorage.getItem('keyproxy_csrf_token');
        }
        return csrfToken;
    }

    /**
     * Clear CSRF token (on logout)
     */
    function clearCsrfToken() {
        csrfToken = null;
        localStorage.removeItem('keyproxy_csrf_token');
    }

    /**
     * Get authentication headers including CSRF token
     * Use this function to get headers for authenticated API requests
     */
    function authHeaders() {
        const token = getCsrfToken();
        const headers = {};
        if (token) {
            headers['X-CSRF-Token'] = token;
        }
        return headers;
    }

    /**
     * Intercept fetch calls to add CSRF token and credentials.
     * Server rotates CSRF token after every POST — we refresh it after each state-changing request.
     */
    const originalFetch = window.fetch;
    window.fetch = function(url, options = {}) {
        // Always include credentials to send cookies
        options.credentials = options.credentials || 'include';

        const isStateChanging = options.method && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(options.method.toUpperCase());

        // Add CSRF token to state-changing requests
        if (isStateChanging) {
            const token = getCsrfToken();
            if (token) {
                options.headers = options.headers || {};
                options.headers['X-CSRF-Token'] = token;
            }
        }

        return originalFetch(url, options).then(async response => {
            if (response.status === 403) {
                const data = await response.clone().json().catch(() => ({}));
                if (data.error === 'Invalid CSRF token') {
                    console.warn('[CSRF] Token invalid, refreshing...');
                    const newToken = await fetchCsrfToken().catch(() => null);
                    if (newToken) {
                        options.headers = options.headers || {};
                        options.headers['X-CSRF-Token'] = newToken;
                        return originalFetch(url, options);
                    }
                }
                throw new Error(data.error || 'Request failed');
            }
            // Server rotates token after every state-changing request — pre-fetch new one
            if (isStateChanging && response.ok) {
                fetchCsrfToken().catch(() => {});
            }
            return response;
        });
    };

    function checkPasswordUpgrade() {
        const loginData = JSON.parse(sessionStorage.getItem('loginResponse') || '{}');
        const banner = document.getElementById('passwordUpgradeBanner');
        if (banner && loginData.passwordUpgradeAvailable) {
            banner.classList.remove('hidden');
        } else if (banner) {
            banner.classList.add('hidden');
        }
    }

    async function upgradePassword() {
        try {
            const res = await fetch('/admin/api/upgrade-password', { method: 'POST' });
            const data = await res.json();
            if (res.ok && data.success) {
                document.getElementById('passwordUpgradeBanner').classList.add('hidden');
                sessionStorage.removeItem('loginResponse');
                document.getElementById('passwordChangeStatus').textContent = 'Password upgraded to secure hash.';
                document.getElementById('passwordChangeStatus').className = 'text-xs text-green-400';
            } else {
                document.getElementById('passwordChangeStatus').textContent = data.error || 'Upgrade failed';
                document.getElementById('passwordChangeStatus').className = 'text-xs text-red-400';
            }
        } catch (err) {
            document.getElementById('passwordChangeStatus').textContent = 'Error: ' + err.message;
            document.getElementById('passwordChangeStatus').className = 'text-xs text-red-400';
        }
    }

    async function loadNotifications() {
        try {
            const res = await fetch('/admin/api/notifications');
            if (!res.ok) return;
            const data = await res.json();
            const urlEl = document.getElementById('slackWebhookUrl');
            const slackEl = document.getElementById('slackNotifyOn');
            const tgEl = document.getElementById('telegramNotifyOn');
            if (urlEl) urlEl.value = data.slackWebhookUrl || '';
            if (slackEl) slackEl.value = data.slackNotifyOn || '';
            if (tgEl) tgEl.value = data.telegramNotifyOn || '';
        } catch (err) { console.error('Failed to load notifications:', err); }
    }

    async function saveNotifications() {
        const status = document.getElementById('notificationStatus');
        try {
            const res = await fetch('/admin/api/notifications', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    slackWebhookUrl: document.getElementById('slackWebhookUrl').value,
                    slackNotifyOn: document.getElementById('slackNotifyOn').value,
                    telegramNotifyOn: document.getElementById('telegramNotifyOn').value
                })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                status.textContent = 'Saved';
                status.className = 'text-xs text-green-400';
            } else {
                status.textContent = data.error || 'Failed';
                status.className = 'text-xs text-red-400';
            }
            setTimeout(() => { status.textContent = ''; }, 3000);
        } catch (err) {
            status.textContent = 'Error: ' + err.message;
            status.className = 'text-xs text-red-400';
        }
    }

    async function testNotification(channel) {
        const status = document.getElementById('notificationStatus');
        status.textContent = 'Testing...';
        status.className = 'text-xs text-amber-400';
        try {
            const res = await fetch('/admin/api/notifications/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channel })
            });
            const data = await res.json();
            status.textContent = data.success ? 'Test sent!' : 'Test failed';
            status.className = data.success ? 'text-xs text-green-400' : 'text-xs text-red-400';
        } catch (err) {
            status.textContent = 'Error: ' + err.message;
            status.className = 'text-xs text-red-400';
        }
        setTimeout(() => { status.textContent = ''; }, 3000);
    }

    // Load provider configuration table
    function loadProviderConfig() {
        const tbody = document.getElementById('providerConfigTableBody');
        const noProvidersMsg = document.getElementById('noProvidersConfig');

        if (!tbody) return;

        tbody.innerHTML = '';

        // Build providers object from envVars (same logic as renderProviders)
        const providers = {};

        for (const [key, value] of Object.entries(envVars)) {
            if (key.endsWith('_API_KEYS') && value) {
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
                            allowedModels: []
                        };
                    }
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
            }
        }

        const providerList = Object.values(providers);

        if (providerList.length === 0) {
            if (noProvidersMsg) noProvidersMsg.classList.remove('hidden');
            return;
        }

        if (noProvidersMsg) noProvidersMsg.classList.add('hidden');

        providerList.forEach(provider => {
            const row = document.createElement('tr');
            row.className = 'border-b border-border hover:bg-muted/30';

            const expectedPattern = ['gemini', 'firecrawl', 'context7', 'onref'].includes(provider.name.toLowerCase())
                ? `${provider.name.toUpperCase()}_API_KEY_01`
                : `${provider.apiType.toUpperCase()}_${provider.name.toUpperCase()}_API_KEY_01`;

            const endpointUrl = `${window.location.host}/${provider.name}/*`;

            row.innerHTML = `
                <td class="py-2 px-3">
                    <div class="font-medium">${escapeHtml(provider.name)}</div>
                    <div class="text-xs text-muted-foreground">${provider.disabled ? '(disabled)' : ''}</div>
                </td>
                <td class="py-2 px-3">
                    <span class="text-xs font-mono bg-muted/30 rounded px-2 py-1">${escapeHtml(provider.apiType.toUpperCase())}</span>
                </td>
                <td class="py-2 px-3">
                    <div class="font-mono text-xs bg-muted/30 rounded px-2 py-1 max-w-xs truncate" title="${escapeHtml(provider.baseUrl || 'Using Default URL')}">
                        ${escapeHtml(provider.baseUrl || 'Using Default URL')}
                    </div>
                </td>
                <td class="py-2 px-3">
                    <div class="font-mono text-xs bg-primary/10 text-primary rounded px-2 py-1 max-w-xs truncate" title="${escapeHtml(endpointUrl)}">
                        ${escapeHtml(endpointUrl)}
                    </div>
                </td>
                <td class="py-2 px-3">
                    <span class="font-mono text-xs bg-muted/30 rounded px-2 py-1 text-primary">${escapeHtml(expectedPattern)}</span>
                </td>
                <td class="py-2 px-3 text-center">
                    <button onclick="copyToClipboard('${safeJsAttr(expectedPattern)}')" class="text-xs px-2 py-1 rounded bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 transition-colors">Copy</button>
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    // Filter provider configuration
    function filterProviderConfig(searchTerm) {
        const rows = document.querySelectorAll('#providerConfigTableBody tr');
        const term = searchTerm.toLowerCase();

        rows.forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(term) ? '' : 'none';
        });
    }

    // Copy to clipboard helper
    function copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            showNotification('Copied to clipboard: ' + text);
        }).catch(err => {
            console.error('Failed to copy:', err);
            showNotification('Failed to copy to clipboard');
        });
    }

    // Show notification helper
    function showNotification(message) {
        // Create notification element if it doesn't exist
        let notification = document.getElementById('toastNotification');
        if (!notification) {
            notification = document.createElement('div');
            notification.id = 'toastNotification';
            notification.className = 'fixed bottom-4 right-4 bg-foreground text-background px-4 py-2 rounded-md shadow-lg text-sm z-50 transition-opacity';
            document.body.appendChild(notification);
        }

        notification.textContent = message;
        notification.classList.remove('opacity-0');
        notification.classList.add('opacity-100');

        setTimeout(() => {
            notification.classList.remove('opacity-100');
            notification.classList.add('opacity-0');
        }, 3000);
    }

    async function changePassword() {
        const currentPw = document.getElementById('currentPassword').value;
        const newPw = document.getElementById('newPassword').value;
        const status = document.getElementById('passwordChangeStatus');

        if (!currentPw || !newPw) {
            status.textContent = 'Both fields are required';
            status.className = 'text-xs text-red-400';
            return;
        }

        try {
            const res = await fetch('/admin/api/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                status.textContent = 'Password changed successfully.';
                status.className = 'text-xs text-green-400';
                document.getElementById('currentPassword').value = '';
                document.getElementById('newPassword').value = '';
                document.getElementById('passwordUpgradeBanner').classList.add('hidden');
            } else {
                status.textContent = data.error || 'Change failed';
                status.className = 'text-xs text-red-400';
            }
        } catch (err) {
            status.textContent = 'Error: ' + err.message;
            status.className = 'text-xs text-red-400';
        }
    }

    // ─── Fallback Routing ────────────────────────────
    async function loadFallbacks() {
        try {
            const res = await fetch('/admin/api/fallbacks', { headers: authHeaders() });
            const chains = await res.json();
            const list = document.getElementById('fallbackList');
            if (!list) return;

            const entries = Object.entries(chains);
            if (entries.length === 0) {
                list.innerHTML = '<p class="text-xs text-muted-foreground">No fallback chains configured.</p>';
            } else {
                list.innerHTML = entries.map(([from, to]) =>
                    `<div class="flex items-center gap-2 bg-muted/30 rounded-md px-3 py-2 text-sm">
                        <span class="font-medium">${escapeHtml(from)}</span>
                        <span class="text-muted-foreground">&rarr;</span>
                        <span class="font-medium">${escapeHtml(to.provider)}</span>
                        ${to.model ? `<span class="text-xs text-muted-foreground">(model: ${escapeHtml(to.model)})</span>` : ''}
                        <button onclick="removeFallback('${escapeHtml(from)}')" class="ml-auto text-red-400 hover:text-red-300 text-xs">Remove</button>
                    </div>`
                ).join('');
            }

            // Populate provider selects
            populateFallbackSelects();
        } catch (err) {
            console.error('Failed to load fallbacks:', err);
        }
    }

    function populateFallbackSelects() {
        const fromSel = document.getElementById('fbFromProvider');
        const toSel = document.getElementById('fbToProvider');
        if (!fromSel || !toSel) return;

        const providers = Object.keys(window._providerConfig || {});
        const opts = providers.map(p => `<option value="${p}">${p}</option>`).join('');
        fromSel.innerHTML = opts || '<option disabled>No providers</option>';
        toSel.innerHTML = opts || '<option disabled>No providers</option>';
    }

    async function addFallback() {
        const from = document.getElementById('fbFromProvider')?.value;
        const to = document.getElementById('fbToProvider')?.value;
        const model = document.getElementById('fbModel')?.value;
        if (!from || !to) return;
        try {
            await fetch('/admin/api/fallbacks', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: from, fallbackProvider: to, fallbackModel: model || null })
            });
            loadFallbacks();
        } catch (err) {
            showErrorToast('Failed: ' + err.message);
        }
    }

    async function removeFallback(provider) {
        try {
            await fetch('/admin/api/fallbacks', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider, fallbackProvider: null })
            });
            loadFallbacks();
        } catch (err) {
            showErrorToast('Failed: ' + err.message);
        }
    }


    // ─── Load Balancing ────────────────────────────
    let lbStrategyData = {};

    async function loadLbSettings() {
        try {
            const res = await fetch('/admin/api/lb-strategy');
            if (!res.ok) return;
            lbStrategyData = await res.json();
            renderLbSettings();
        } catch (err) {
            console.error('Failed to load LB settings:', err);
        }
    }

    function renderLbSettings() {
        const list = document.getElementById('lbStrategyList');
        const weightEditors = document.getElementById('lbWeightEditors');
        if (!list || !weightEditors) return;

        const providers = Object.keys(lbStrategyData);
        if (providers.length === 0) {
            list.innerHTML = '<p class="text-xs text-muted-foreground">No active providers found.</p>';
            weightEditors.innerHTML = '';
            return;
        }

        const strategies = ['round-robin', 'weighted-random', 'least-used'];
        list.innerHTML = providers.map(function(name) {
            const cfg = lbStrategyData[name];
            const opts = strategies.map(function(s) {
                return '<option value="' + s + '"' + (s === cfg.strategy ? ' selected' : '') + '>' + s + '</option>';
            }).join('');
            return '<div class="flex items-center gap-3 bg-muted/30 rounded-md px-3 py-2">' +
                '<span class="font-medium text-sm flex-1">' + escapeHtml(name) + '</span>' +
                '<select onchange="saveLbStrategy(\'' + escapeHtml(name) + '\', this.value)" class="input-field px-2 py-1 rounded-md text-xs">' +
                opts + '</select></div>';
        }).join('');

        var weightedProviders = providers.filter(function(n) { return lbStrategyData[n].strategy === 'weighted-random'; });
        if (weightedProviders.length === 0) {
            weightEditors.innerHTML = '<p class="text-xs text-muted-foreground">Select "weighted-random" strategy above to configure key weights.</p>';
            return;
        }

        weightEditors.innerHTML = weightedProviders.map(function(name) {
            var cfg = lbStrategyData[name];
            var weightRows = cfg.weights.map(function(w, i) {
                return '<div class="flex items-center gap-2">' +
                    '<span class="text-xs text-muted-foreground font-mono flex-1 truncate">' + escapeHtml(w.maskedKey) + '</span>' +
                    '<input type="range" min="1" max="10" value="' + w.weight + '" class="w-20 accent-primary"' +
                    ' oninput="this.nextElementSibling.textContent=this.value"' +
                    ' onchange="saveLbWeight(\'' + escapeHtml(name) + '\', ' + i + ', this.value)">' +
                    '<span class="text-xs font-medium w-4 text-center">' + w.weight + '</span></div>';
            }).join('');
            return '<div class="bg-muted/30 rounded-md px-3 py-2">' +
                '<p class="text-xs font-medium text-foreground mb-1">' + escapeHtml(name) + ' — Key Weights</p>' +
                '<div class="space-y-1.5">' + weightRows + '</div></div>';
        }).join('');
    }

    async function saveLbStrategy(provider, strategy) {
        try {
            const res = await fetch('/admin/api/lb-strategy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: provider, strategy: strategy })
            });
            if (res.ok) {
                lbStrategyData[provider].strategy = strategy;
                renderLbSettings();
                showSuccessToast('Strategy for ' + provider + ' set to ' + strategy);
            } else {
                const err = await res.json();
                showErrorToast(err.error || 'Failed to save strategy');
            }
        } catch (err) {
            showErrorToast('Failed: ' + err.message);
        }
    }

    async function saveLbWeight(provider, weightIndex, weight) {
        try {
            const cfg = lbStrategyData[provider];
            if (!cfg || !cfg.weights[weightIndex]) return;
            const res = await fetch('/admin/api/lb-strategy');
            const freshData = await res.json();
            const fullKey = freshData[provider] && freshData[provider].weights && freshData[provider].weights[weightIndex] && freshData[provider].weights[weightIndex].key;
            if (!fullKey) {
                showErrorToast('Could not resolve key for weight update');
                return;
            }
            const resp = await fetch('/admin/api/lb-weight', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ provider: provider, key: fullKey, weight: parseInt(weight) })
            });
            if (resp.ok) {
                lbStrategyData[provider].weights[weightIndex].weight = parseInt(weight);
                showSuccessToast('Weight updated to ' + weight);
            } else {
                showErrorToast('Failed to update weight');
            }
        } catch (err) {
            showErrorToast('Failed: ' + err.message);
        }
    }

    // ─── Circuit Breaker ────────────────────────────
    async function loadCircuitBreakerStates() {
        try {
            const res = await fetch('/admin/api/circuit-breaker', { headers: authHeaders() });
            if (!res.ok) return;
            const states = await res.json();
            const cbColors = {
                closed: 'bg-green-500/20 text-green-400 border-green-500/30',
                open: 'bg-red-500/20 text-red-400 border-red-500/30',
                'half-open': 'bg-amber-500/20 text-amber-400 border-amber-500/30'
            };
            for (const [name, state] of Object.entries(states)) {
                const td = document.getElementById('cb-' + name);
                if (!td) continue;
                const color = cbColors[state.state] || cbColors.closed;
                let html = `<span class="px-2 py-0.5 rounded text-xs border ${color}">${state.state}</span>`;
                if (state.state === 'open') {
                    html += ` <button onclick="forceCloseCircuit('${name}')" class="text-xs text-blue-400 hover:text-blue-300 ml-1">force-close</button>`;
                } else if (state.state === 'closed' && state.failures > 0) {
                    html += ` <span class="text-xs text-muted-foreground">(${state.failures}/${state.threshold})</span>`;
                }
                td.innerHTML = html;
            }
        } catch (err) {
            console.error('CB load error:', err);
        }
    }

    async function forceCloseCircuit(provider) {
        try {
            await fetch(`/admin/api/circuit-breaker/${provider}/force-close`, {
                method: 'POST',
                headers: authHeaders()
            });
            loadCircuitBreakerStates();
            showInfoToast(`Circuit for ${provider} force-closed`);
        } catch (err) {
            showErrorToast('Failed: ' + err.message);
        }
    }

    // ─── Import/Export ────────────────────────────────
    async function exportConfig() {
        const status = document.getElementById('importExportStatus');
        const includeSecrets = document.getElementById('exportIncludeSecrets')?.checked || false;
        try {
            status.textContent = 'Exporting...';
            const res = await fetch('/admin/api/export-config', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ includeSecrets })
            });
            const data = await res.json();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `keyproxy-config-${new Date().toISOString().slice(0,10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            status.textContent = 'Exported!';
            status.className = 'text-xs text-green-400';
        } catch (err) {
            status.textContent = 'Export failed: ' + err.message;
            status.className = 'text-xs text-red-400';
        }
        setTimeout(() => { status.textContent = ''; }, 4000);
    }

    async function importConfig(event) {
        const file = event.target.files[0];
        if (!file) return;
        const status = document.getElementById('importExportStatus');
        try {
            const text = await file.text();
            const importData = JSON.parse(text);
            const mode = confirm('Merge with existing config? (Cancel = Replace all)') ? 'merge' : 'replace';
            status.textContent = 'Importing...';
            const res = await fetch('/admin/api/import-config', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ config: importData, mode })
            });
            const result = await res.json();
            if (result.success) {
                status.textContent = `Imported ${result.providersImported} providers (${mode}). Reload to apply.`;
                status.className = 'text-xs text-green-400';
            } else {
                status.textContent = result.error || 'Import failed';
                status.className = 'text-xs text-red-400';
            }
        } catch (err) {
            status.textContent = 'Import failed: ' + err.message;
            status.className = 'text-xs text-red-400';
        }
        event.target.value = '';
        setTimeout(() => { status.textContent = ''; }, 5000);
    }

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !document.getElementById('createVirtualKeyDialog').classList.contains('hidden')) {
            closeCreateVirtualKeyDialog();
        }
    });

    // ─── Environment Sources (Manual Import) ────────────────────
    let envSourcesData = [];
    let pendingPullSourceId = null;

    async function loadEnvSources() {
        try {
            const res = await fetch('/admin/api/env-sources', { headers: authHeaders() });
            if (!res.ok) return;
            const data = await res.json();
            envSourcesData = data.sources || [];
            renderEnvSources();
        } catch (err) {
            console.error('Failed to load env sources:', err);
        }
    }

    function renderEnvSources() {
        const list = document.getElementById('envSourcesList');
        if (!envSourcesData || envSourcesData.length === 0) {
            list.innerHTML = '<div class="text-center text-muted-foreground text-sm py-4">No environment sources registered</div>';
            return;
        }
        list.innerHTML = envSourcesData.map(source => {
            const statusColor = source.lastPullStatus === 'success' ? 'text-green-400' :
                               source.lastPullStatus === 'never' ? 'text-muted-foreground' :
                               source.lastPullStatus === 'no-new-keys' ? 'text-blue-400' : 'text-red-400';
            const statusText = source.lastPullStatus === 'never' ? 'Never pulled' :
                              source.lastPulledAt ? `Pulled ${new Date(source.lastPulledAt).toLocaleString()}` :
                              source.lastPullStatus;
            return `
            <div class="flex items-center gap-3 p-2 rounded bg-card border border-border hover:border-primary/30 transition-colors">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                        <span class="text-sm font-medium text-foreground">${escapeHtml(source.name)}</span>
                        <span class="text-xs ${statusColor}">${statusText}</span>
                    </div>
                    <div class="text-xs text-muted-foreground truncate" title="${escapeHtml(source.filePath)}">${escapeHtml(source.filePath)}</div>
                </div>
                <button onclick="previewPullEnvSource('${safeJsAttr(source.id)}')" class="btn btn-primary px-3 py-1 text-xs">Pull</button>
                <button onclick="removeEnvSource('${safeJsAttr(source.id)}')" class="p-1.5 hover:bg-red-500/10 text-red-500 rounded transition-colors" title="Remove source">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>
            </div>`;
        }).join('');
    }

    async function addEnvSource() {
        const name = document.getElementById('newEnvSourceName').value.trim();
        const filePath = document.getElementById('newEnvSourcePath').value.trim();
        if (!name || !filePath) {
            showToast('Name and file path are required', 'error');
            return;
        }
        try {
            const res = await fetch('/admin/api/env-sources', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: JSON.stringify({ name, filePath })
            });
            const data = await res.json();
            if (!res.ok) {
                showToast(data.error || 'Failed to add source', 'error');
                return;
            }
            document.getElementById('newEnvSourceName').value = '';
            document.getElementById('newEnvSourcePath').value = '';
            showSuccessToast(`Source "${name}" added`);
            loadEnvSources();
        } catch (err) {
            showToast('Failed to add source', 'error');
        }
    }

    async function removeEnvSource(id) {
        if (!confirm('Remove this environment source? Imported keys will remain in config.')) return;
        try {
            const res = await fetch('/admin/api/env-sources', {
                method: 'DELETE',
                headers: { ...authHeaders(), 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: JSON.stringify({ id })
            });
            if (res.ok) {
                showSuccessToast('Source removed');
                loadEnvSources();
            }
        } catch (err) {
            showToast('Failed to remove source', 'error');
        }
    }

    async function previewPullEnvSource(id) {
        cancelPullEnvSource();
        try {
            const res = await fetch('/admin/api/env-sources/preview', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: JSON.stringify({ id })
            });
            const data = await res.json();
            if (!res.ok) {
                showToast(data.error || 'Preview failed', 'error');
                return;
            }

            if (Object.keys(data.newKeys || {}).length === 0) {
                showSuccessToast('No new keys found in this source');
                loadEnvSources();
                return;
            }

            pendingPullSourceId = id;

            // Build preview list
            const keysDiv = document.getElementById('envSourcePreviewKeys');
            const keyEntries = Object.entries(data.newKeys);
            keysDiv.innerHTML = keyEntries.map(([key, value]) => {
            const _ek = escapeHtml(key); const _ev = escapeHtml(value);
                const isKeyList = key.endsWith('_API_KEYS');
                const count = isKeyList ? value.split(',').filter(Boolean).length : 1;
                const display = isKeyList
                    ? value.split(',').map(k => k.trim()).map(k => k.length > 20 ? k.substring(0, 8) + '...' + k.substring(k.length - 4) : k).join(', ')
                    : value;
                return `<div class="flex items-center gap-2 p-1.5 rounded bg-muted/50">
                    <span class="font-mono text-foreground">${_ek}</span>
                    <span class="text-muted-foreground">${isKeyList ? '(' + count + ' key' + (count > 1 ? 's' : '') + ')' : ''}</span>
                    <span class="ml-auto font-mono text-muted-foreground truncate max-w-[50%]">${escapeHtml(display)}</span>
                </div>`;
            }).join('');

            document.getElementById('envSourcePreviewPanel').classList.remove('hidden');
            document.getElementById('envSourcePullStatus').textContent = `${data.totalNewKeys} new key(s) from ${data.totalNewProviders} provider(s)`;
        } catch (err) {
            showToast('Preview failed', 'error');
        }
    }

    async function confirmPullEnvSource() {
        if (!pendingPullSourceId) return;
        const statusEl = document.getElementById('envSourcePullStatus');
        statusEl.textContent = 'Importing...';
        try {
            const res = await fetch('/admin/api/env-sources/pull', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                body: JSON.stringify({ id: pendingPullSourceId })
            });
            const data = await res.json();
            if (!res.ok) {
                statusEl.innerHTML = '<span class="text-red-400">' + escapeHtml(data.error || 'Pull failed') + '</span>';
                return;
            }
            cancelPullEnvSource();
            if (data.message) {
                showSuccessToast(data.message);
            } else {
                showSuccessToast(`Imported ${data.imported.keys} key(s) from ${data.imported.providers} provider(s)`);
            }
            loadEnvSources();
            loadConfiguration();
        } catch (err) {
            statusEl.innerHTML = '<span class="text-red-400">Network error</span>';
        }
    }

    function cancelPullEnvSource() {
        document.getElementById('envSourcePreviewPanel').classList.add('hidden');
        document.getElementById('envSourcePullStatus').textContent = '';
        pendingPullSourceId = null;
    }

    async function browseEnvSourceFile() {
        try {
            const res = await fetch('/admin/api/fs-list?path=', { headers: authHeaders() });
            if (!res.ok) return;
            const data = await res.json();
            // Simple prompt-based file selection (reuse existing pattern)
            const input = document.getElementById('newEnvSourcePath');
            if (input.value) {
                const browseRes = await fetch('/admin/api/fs-list?path=' + encodeURIComponent(input.value), { headers: authHeaders() });
                if (browseRes.ok) {
                    const items = await browseRes.json();
                    const envFiles = (items.entries || []).filter(e => e.name.endsWith('.env'));
                    if (envFiles.length > 0) {
                        input.value = envFiles[0].path;
                        return;
                    }
                }
            }
            showToast('Enter the full path to an .env file', 'error');
        } catch (err) {
            // Silently fail — user can type path manually
        }
    }

    async function loadTelegramSettings() {
        try {
            const response = await fetch('/admin/api/telegram');
            if (!response.ok) return;
            const data = await response.json();

            document.getElementById('telegramBotToken').value = data.botToken || '';
            document.getElementById('telegramAllowedUsers').value = data.allowedUsers || '';
            document.getElementById('defaultStatusCodes').value = data.defaultStatusCodes || '429';
            document.getElementById('keepAliveMinutes').value = data.keepAliveMinutes != null ? data.keepAliveMinutes : 10;

            const statusEl = document.getElementById('telegramBotStatus');
            if (data.botRunning) {
                statusEl.innerHTML = '<span class="text-green-500 font-medium">Bot is running</span>';
            } else if (data.botToken) {
                statusEl.innerHTML = '<span class="text-yellow-500 font-medium">Bot token set but not running</span>';
            } else {
                statusEl.innerHTML = '<span class="text-muted-foreground">Bot not configured</span>';
            }
        } catch (err) {
            console.error('Failed to load telegram settings:', err);
        }
    }

    async function saveTelegramSettings() {
        const botToken = document.getElementById('telegramBotToken').value.trim();
        const allowedUsers = document.getElementById('telegramAllowedUsers').value.trim();
        const statusCodesInput = document.getElementById('defaultStatusCodes').value.trim() || '429';
        const keepAliveMinutes = parseInt(document.getElementById('keepAliveMinutes').value) || 0;
        const statusEl = document.getElementById('telegramBotStatus');

        try {
            const response = await fetch('/admin/api/telegram', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ botToken, allowedUsers, defaultStatusCodes: statusCodesInput, keepAliveMinutes })
            });

            const data = await response.json();
            if (data.success) {
                // Update global status codes for curl generation (use server-sorted value)
                defaultStatusCodes = data.defaultStatusCodes || '429';
                document.getElementById('defaultStatusCodes').value = defaultStatusCodes;
                if (data.botRunning) {
                    statusEl.innerHTML = '<span class="text-green-500 font-medium">Settings saved - Bot is running</span>';
                } else {
                    statusEl.innerHTML = '<span class="text-muted-foreground">Settings saved - Bot stopped (no token)</span>';
                }
                showSuccessToast('Settings saved');
            } else {
                statusEl.innerHTML = '<span class="text-red-500 font-medium">Failed to save</span>';
            }
        } catch (err) {
            statusEl.innerHTML = '<span class="text-red-500 font-medium">Error: ' + escapeHtml(err.message) + '</span>';
        }
    }

    // --- File Browser Logic ---
    let currentFsPath = '';

    async function openFsBrowser(startPath) {
        const modal = document.getElementById('fsBrowserModal');
        modal.classList.remove('hidden');
        loadDrives();
        
        // If path is a file, use its directory
        let target = startPath || '';
        if (target && !target.endsWith('\\') && !target.endsWith('/')) {
            target = target.substring(0, Math.max(target.lastIndexOf('\\'), target.lastIndexOf('/')));
        }
        
        await listFs(target);
    }

    function closeFsBrowser() {
        document.getElementById('fsBrowserModal').classList.add('hidden');
    }

    async function loadDrives() {
        try {
            const res = await fetch('/admin/api/fs-drives');
            const data = await res.json();
            const select = document.getElementById('fsDriveSelect');
            if (select) {
                select.innerHTML = data.drives.map(d => `<option value="${escapeHtml(d.path)}">${escapeHtml(d.name)}</option>`).join('');
                
                // Select current drive
                if (currentFsPath) {
                    const drive = currentFsPath.substring(0, 3); // e.g. "C:\"
                    const opt = Array.from(select.options).find(o => o.value.startsWith(drive));
                    if (opt) opt.selected = true;
                }
            }
        } catch (e) {
            console.error('Failed to load drives:', e);
        }
    }

    async function listFs(path) {
        const list = document.getElementById('fsItemList');
        const loader = document.getElementById('fsLoader');
        
        list.classList.add('opacity-50');
        if (loader) loader.classList.remove('hidden');
        
        try {
            const url = `/admin/api/fs-list${path ? '?path=' + encodeURIComponent(path) : ''}`;
            const res = await fetch(url);
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Access denied');
            }
            const data = await res.json();
            
            currentFsPath = data.currentPath;
            document.getElementById('currentFsPathDisplay').textContent = currentFsPath;
            
            list.innerHTML = '';
            
            // Parent directory item
            if (data.parentPath && data.parentPath !== currentFsPath) {
                list.appendChild(createFsItem('..', data.parentPath, true, true));
            }
            
            data.items.forEach(item => {
                list.appendChild(createFsItem(item.name, item.path, item.isDirectory, false, item.size));
            });
        } catch (e) {
            showErrorToast('FS Error: ' + e.message);
        } finally {
            list.classList.remove('opacity-50');
            if (loader) loader.classList.add('hidden');
        }
    }

    function createFsItem(name, path, isDir, isParent, size) {
        const div = document.createElement('div');
        div.className = 'flex items-center justify-between p-2 hover:bg-accent/50 cursor-pointer rounded transition-colors group border-b border-border/50 last:border-0';
        div.onclick = () => isDir ? listFs(path) : selectFsFile(path);
        
        const icon = isDir ? 
            `<svg class="w-4 h-4 text-amber-500" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"></path></svg>` :
            `<svg class="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>`;
        
        div.innerHTML = `
            <div class="flex items-center gap-3 overflow-hidden">
                ${icon}
                <span class="text-xs truncate ${isParent ? 'italic text-muted-foreground' : 'text-foreground'}">${name}</span>
            </div>
            ${!isDir && size !== undefined ? `<span class="text-[10px] text-muted-foreground whitespace-nowrap opacity-0 group-hover:opacity-100">${formatBytes(size)}</span>` : ''}
        `;
        return div;
    }

    function selectFsFile(path) {
        document.getElementById('externalEnvPath').value = path;
        closeFsBrowser();
        showInfoToast('Path selected');
    }

    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    // ─── Analytics ────────────────────────────────────────
    let analyticsData = null;

    async function loadAnalytics() {
        const range = document.getElementById('analyticsRange')?.value || '7d';
        try {
            const resp = await fetch(`/admin/api/analytics?range=${range}`, { headers: authHeaders() });
            if (!resp.ok) throw new Error(await resp.text());
            analyticsData = await resp.json();
            renderAnalytics(analyticsData);
        } catch (err) {
            console.error('Analytics load error:', err);
        }
    }

    async function resetAnalytics() {
        if (!confirm('Reset all analytics data? This cannot be undone.')) return;
        try {
            await fetch('/admin/api/analytics/reset', { method: 'POST', headers: authHeaders() });
            loadAnalytics();
            showInfoToast('Analytics data reset');
        } catch (err) {
            showErrorToast('Reset failed: ' + err.message);
        }
    }

    function renderAnalytics(data) {
        // Summary cards
        document.getElementById('analyticsTotalReqs').textContent = data.totalRequests.toLocaleString();
        document.getElementById('analyticsAvgLatency').textContent = data.avgLatencyMs + 'ms';
        document.getElementById('analyticsP95Latency').textContent = (data.p95LatencyMs || 0) + 'ms';

        const totalTokens = (data.totalInputTokens || 0) + (data.totalOutputTokens || 0);
        document.getElementById('analyticsTotalTokens').textContent = totalTokens >= 1000000
            ? (totalTokens / 1000000).toFixed(1) + 'M'
            : totalTokens >= 1000 ? (totalTokens / 1000).toFixed(1) + 'K' : totalTokens.toLocaleString();

        document.getElementById('analyticsTotalCost').textContent = '$' + data.totalCost.toFixed(4);
        const errRate = data.totalRequests > 0 ? ((data.totalErrors / data.totalRequests) * 100).toFixed(1) : '0';
        document.getElementById('analyticsErrorRate').textContent = errRate + '%';

        // Provider table
        const provBody = document.getElementById('analyticsProviderTable');
        const provEntries = Object.entries(data.providers);
        if (provEntries.length === 0) {
            provBody.innerHTML = '<tr><td colspan="6" class="py-4 text-center text-muted-foreground">No data yet</td></tr>';
        } else {
            provBody.innerHTML = provEntries.map(([name, p]) => {
                const avgLat = p.requests > 0 ? Math.round(p.latencyMs / p.requests) : 0;
                const inK = (p.estimatedInputTokens / 1000).toFixed(1);
                const outK = (p.estimatedOutputTokens / 1000).toFixed(1);
                return `<tr class="border-b border-border/50">
                    <td class="py-2 pr-4 font-medium">${escapeHtml(name)}</td>
                    <td class="text-right py-2 pr-4">${p.requests.toLocaleString()}</td>
                    <td class="text-right py-2 pr-4 ${p.errors > 0 ? 'text-red-500' : ''}">${p.errors}</td>
                    <td class="text-right py-2 pr-4">${avgLat}ms</td>
                    <td class="text-right py-2 pr-4">${inK}K / ${outK}K</td>
                    <td class="text-right py-2">$${p.estimatedCost.toFixed(4)}</td>
                </tr>`;
            }).join('');
        }

        // Top keys table
        const keysBody = document.getElementById('analyticsKeysTable');
        if (data.topKeys.length === 0) {
            keysBody.innerHTML = '<tr><td colspan="4" class="py-4 text-center text-muted-foreground">No data yet</td></tr>';
        } else {
            keysBody.innerHTML = data.topKeys.map(k => `<tr class="border-b border-border/50">
                <td class="py-2 pr-4 font-mono text-xs">${escapeHtml(k.key)}</td>
                <td class="text-right py-2 pr-4">${k.requests.toLocaleString()}</td>
                <td class="text-right py-2 pr-4 ${k.errors > 0 ? 'text-red-500' : ''}">${k.errors}</td>
                <td class="text-right py-2">$${k.estimatedCost.toFixed(4)}</td>
            </tr>`).join('');
        }

        // Model breakdown table
        const modelBody = document.getElementById('analyticsModelTable');
        const modelEntries = Object.entries(data.modelBreakdown || {}).sort((a, b) => b[1].requests - a[1].requests);
        if (modelEntries.length === 0) {
            modelBody.innerHTML = '<tr><td colspan="3" class="py-4 text-center text-muted-foreground">No data yet</td></tr>';
        } else {
            modelBody.innerHTML = modelEntries.map(([model, s]) => `<tr class="border-b border-border/50">
                <td class="py-2 pr-4 font-mono text-xs">${escapeHtml(model)}</td>
                <td class="text-right py-2 pr-4">${s.requests.toLocaleString()}</td>
                <td class="text-right py-2">$${s.estimatedCost.toFixed(4)}</td>
            </tr>`).join('');
        }

        // Draw charts
        drawRequestsChart(data.dailyRequests);
        drawCostChart(data.providers);
        drawLatencyDistributionChart(data.latencyBuckets, data.p50LatencyMs, data.p95LatencyMs, data.p99LatencyMs);
        drawLatencyTrendChart(data.dailyLatency);
    }

    // ─── Chart.js helpers ─────────────────────────────────
    // Track Chart.js instances to destroy before recreating
    window.chartInstances = window.chartInstances || {};

    const chartDarkTheme = {
        grid: { color: 'rgba(255,255,255,0.06)' },
        ticks: { color: '#888' },
        border: { color: 'rgba(255,255,255,0.1)' },
    };

    function destroyChart(name) {
        if (window.chartInstances[name]) {
            window.chartInstances[name].destroy();
            window.chartInstances[name] = null;
        }
    }

    function drawRequestsChart(dailyRequests) {
        destroyChart('requests');
        const canvas = document.getElementById('chartRequests');
        if (!canvas) return;

        if (!dailyRequests || dailyRequests.length === 0) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#888';
            ctx.font = '13px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No data', canvas.width / 2, canvas.height / 2);
            return;
        }

        const labels = dailyRequests.map(d => d.date.slice(5));
        const counts = dailyRequests.map(d => d.count);

        window.chartInstances.requests = new Chart(canvas, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Requests',
                    data: counts,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 3,
                    pointBackgroundColor: '#3b82f6',
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: (items) => {
                                const idx = items[0].dataIndex;
                                return dailyRequests[idx].date;
                            },
                            label: (item) => `Requests: ${item.raw.toLocaleString()}`
                        }
                    }
                },
                scales: {
                    x: { ...chartDarkTheme, grid: { display: false } },
                    y: { ...chartDarkTheme, beginAtZero: true }
                }
            }
        });
    }

    function drawCostChart(providers) {
        destroyChart('cost');
        const canvas = document.getElementById('chartCost');
        if (!canvas) return;

        const entries = Object.entries(providers).filter(([, p]) => p.estimatedCost > 0);
        if (entries.length === 0) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#888';
            ctx.font = '13px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No cost data', canvas.width / 2, canvas.height / 2);
            return;
        }

        const totalCost = entries.reduce((s, [, p]) => s + p.estimatedCost, 0);
        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
        entries.sort((a, b) => b[1].estimatedCost - a[1].estimatedCost);

        const labels = entries.map(([name]) => name);
        const values = entries.map(([, p]) => p.estimatedCost);
        const bgColors = entries.map((_, i) => colors[i % colors.length]);

        // Center text plugin
        const centerTextPlugin = {
            id: 'centerText',
            afterDraw(chart) {
                const { ctx: c, chartArea: { left, right, top, bottom } } = chart;
                const cx = (left + right) / 2;
                const cy = (top + bottom) / 2;
                c.save();
                c.font = 'bold 16px sans-serif';
                c.fillStyle = '#ccc';
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.fillText('$' + totalCost.toFixed(4), cx, cy - 8);
                c.font = '11px sans-serif';
                c.fillStyle = '#888';
                c.fillText('Total Cost', cx, cy + 10);
                c.restore();
            }
        };

        window.chartInstances.cost = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data: values,
                    backgroundColor: bgColors,
                    borderColor: 'rgba(0,0,0,0.3)',
                    borderWidth: 2,
                }]
            },
            plugins: [centerTextPlugin],
            options: {
                responsive: true,
                maintainAspectRatio: true,
                cutout: '60%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#aaa', font: { size: 11 }, padding: 12 }
                    },
                    tooltip: {
                        callbacks: {
                            label: (item) => `${item.label}: $${item.raw.toFixed(4)}`
                        }
                    }
                }
            }
        });
    }

    function drawLatencyDistributionChart(buckets, p50, p95, p99) {
        destroyChart('latency');
        const canvas = document.getElementById('chartLatency');
        if (!canvas) return;

        if (!buckets) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#888';
            ctx.font = '13px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No data', canvas.width / 2, canvas.height / 2);
            return;
        }

        const bucketLabels = ['<100', '100-250', '250-500', '500-1000', '1000-3000', '3000-10000', '>10000'];
        const displayLabels = ['<100ms', '100-250ms', '250-500ms', '500ms-1s', '1s-3s', '3s-10s', '>10s'];
        const values = bucketLabels.map(k => buckets[k] || 0);
        const total = values.reduce((a, b) => a + b, 0);

        // Color gradient: green (fast) -> red (slow)
        const barColors = [
            '#22c55e', '#84cc16', '#eab308', '#f97316', '#ef4444', '#dc2626', '#991b1b'
        ];

        window.chartInstances.latency = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: displayLabels,
                datasets: [{
                    label: 'Requests',
                    data: values,
                    backgroundColor: barColors,
                    borderColor: barColors,
                    borderWidth: 1,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (item) => {
                                const pct = total > 0 ? ((item.raw / total) * 100).toFixed(1) : 0;
                                return `${item.raw.toLocaleString()} requests (${pct}%)`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        ...chartDarkTheme,
                        grid: { display: false },
                        ticks: { ...chartDarkTheme.ticks, maxRotation: 45, font: { size: 10 } }
                    },
                    y: { ...chartDarkTheme, beginAtZero: true }
                }
            },
            plugins: [{
                id: 'percentileLines',
                afterDraw(chart) {
                    if (!p50 && !p95 && !p99) return;
                    const { ctx: c, chartArea: { top, bottom, left, right } } = chart;
                    const maxMs = 30000;

                    const drawPLine = (val, color, label) => {
                        if (!val || val <= 0) return;
                        const ratio = Math.min(val / maxMs, 1);
                        const px = left + ratio * (right - left);
                        if (px < left || px > right) return;
                        c.save();
                        c.strokeStyle = color;
                        c.lineWidth = 2;
                        c.setLineDash([4, 3]);
                        c.beginPath();
                        c.moveTo(px, top);
                        c.lineTo(px, bottom);
                        c.stroke();
                        c.setLineDash([]);
                        c.fillStyle = color;
                        c.font = 'bold 10px sans-serif';
                        c.textAlign = 'center';
                        c.fillText(label, px, top - 4);
                        c.restore();
                    };
                    drawPLine(p50, '#22c55e', 'p50');
                    drawPLine(p95, '#f59e0b', 'p95');
                    drawPLine(p99, '#ef4444', 'p99');
                }
            }]
        });
    }

    function drawLatencyTrendChart(dailyLatency) {
        destroyChart('latencyTrend');
        const canvas = document.getElementById('chartLatencyTrend');
        if (!canvas) return;

        if (!dailyLatency || dailyLatency.length === 0) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#888';
            ctx.font = '13px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No data', canvas.width / 2, canvas.height / 2);
            return;
        }

        const labels = dailyLatency.map(d => d.date.slice(5));
        const values = dailyLatency.map(d => d.avgMs);

        window.chartInstances.latencyTrend = new Chart(canvas, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Avg Latency (ms)',
                    data: values,
                    borderColor: '#f59e0b',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 3,
                    pointBackgroundColor: '#f59e0b',
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: (items) => {
                                const idx = items[0].dataIndex;
                                return dailyLatency[idx].date;
                            },
                            label: (item) => `Avg Latency: ${item.raw}ms`
                        }
                    }
                },
                scales: {
                    x: { ...chartDarkTheme, grid: { display: false } },
                    y: { ...chartDarkTheme, beginAtZero: true, title: { display: true, text: 'ms', color: '#888' } }
                }
            }
        });
    }

    // escapeHtml() replaced by global escapeHtml() at top of script

    // ─── Unified Status Loader (solves N+1 problem) ────────────────────────────
    
    /**
     * Debounce helper to prevent excessive API calls
     */
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * Load unified status (RPM + Key Expiry) in single request
     * Solves N+1 request problem
     */
    async function loadUnifiedStatus() {
        try {
            const res = await fetch('/admin/api/status', { headers: authHeaders() });
            if (!res.ok) {
                console.warn('[STATUS] Failed to load unified status:', res.status);
                return;
            }
            const data = await res.json();
            
            // Update RPM badges
            if (data.rpm) {
                updateRpmBadges(data.rpm);
            }
            
            // Update expiry badges
            if (data.keyExpiry) {
                updateExpiryBadges(data.keyExpiry);
            }
        } catch (error) {
            console.error('[STATUS] Error loading unified status:', error);
        }
    }

    /**
     * Update RPM badges from unified status data
     */
    function updateRpmBadges(rpmData) {
        document.querySelectorAll('.rpm-badge').forEach(badge => {
            const key = badge.dataset.key;
            const rpm = rpmData[key];
            if (rpm !== undefined && rpm > 0) {
                badge.textContent = rpm + ' rpm';
                const providerType = badge.dataset.provider || '';
                const heat = getRpmHeatColor(rpm, providerType);
                badge.className = `rpm-badge text-xs px-1.5 py-0.5 rounded rpm-${heat}`;
            } else {
                badge.textContent = '0 rpm';
                badge.className = 'rpm-badge text-xs px-1.5 py-0.5 rounded rpm-green';
            }
        });
    }

    /**
     * Update expiry badges from unified status data
     */
    function updateExpiryBadges(keyExpiryData) {
        document.querySelectorAll('.expiry-slot').forEach(badge => {
            const maskedKey = badge.dataset.maskedkey;
            const provider = badge.dataset.provider;
            const providerEntries = keyExpiryData[provider];
            
            if (!providerEntries) {
                badge.textContent = '—';
                badge.className = 'expiry-badge expiry-none expiry-slot';
                badge.title = 'Key TTL';
                return;
            }
            
            const entry = providerEntries.find(e => e.key === maskedKey);
            if (!entry || !entry.expiry) {
                badge.textContent = '—';
                badge.className = 'expiry-badge expiry-none expiry-slot';
                badge.title = 'Key TTL';
                return;
            }
            
            const expiry = entry.expiry;
            badge.textContent = formatExpiry(expiry);
            badge.className = 'expiry-badge ' + getExpiryColorClass(expiry) + ' expiry-slot';
            badge.title = 'Expires: ' + expiry.expiresAt;
        });
    }

    // ─── Legacy RPM Badge Loader (kept for backward compatibility) ────────────────────────────
    async function loadRpmBadges() {
        try {
            const res = await fetch('/admin/api/rpm', { headers: authHeaders() });
            if (!res.ok) return;
            const rpmData = await res.json();
            updateRpmBadges(rpmData);
        } catch {}
    }

    function getRpmHeatColor(rpm, providerType) {
        const limits = { openai: 3, gemini: 15, groq: 30, anthropic: 5 };
        const limit = limits[providerType] || 999;
        const pct = rpm / limit;
        if (pct >= 1) return 'red';
        if (pct >= 0.75) return 'orange';
        if (pct >= 0.5) return 'yellow';
        return 'green';
    }

    // Refresh status every 15s when API Keys tab is visible (with debounce)
    const debouncedStatusLoad = debounce(loadUnifiedStatus, 1000);
    
    setInterval(() => {
        const envTab = document.getElementById('environment');
        if (envTab && !envTab.classList.contains('hidden')) {
            debouncedStatusLoad();
        }
    }, 15000);

    // ─── Key Expiry Badges ──────────────────────────────

    function formatExpiry(expiry) {
        if (!expiry) return '—';
        if (expiry.expired) return 'Expired';
        const ms = expiry.remainingMs;
        if (ms >= 86400000) {
            const d = Math.floor(ms / 86400000);
            const h = Math.floor((ms % 86400000) / 3600000);
            return d + 'd ' + h + 'h';
        }
        if (ms >= 3600000) {
            const h = Math.floor(ms / 3600000);
            const m = Math.floor((ms % 3600000) / 60000);
            return h + 'h ' + m + 'm';
        }
        if (ms >= 60000) {
            const m = Math.floor(ms / 60000);
            const s = Math.floor((ms % 60000) / 1000);
            return m + 'm ' + s + 's';
        }
        return '<1m';
    }

    function getExpiryColorClass(expiry) {
        if (!expiry) return 'expiry-none';
        if (expiry.expired) return 'expiry-gray';
        const ms = expiry.remainingMs;
        if (ms >= 86400000) return 'expiry-green';
        if (ms >= 3600000) return 'expiry-yellow';
        return 'expiry-red';
    }

    async function loadExpiryBadges() {
        try {
            const res = await fetch('/admin/api/key-expiry', { headers: authHeaders() });
            if (!res.ok) return;
            const data = await res.json();
            updateExpiryBadges(data);
        } catch {}
    }

    async function extendKeyTtl(providerName, btn) {
        const fullKey = btn.dataset.fullkey;
        if (!fullKey) return;
        const origText = btn.textContent;
        btn.textContent = '...';
        btn.disabled = true;
        try {
            const res = await fetch('/admin/api/key-extend', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ provider: providerName, fullKey: fullKey })
            });
            if (res.ok) {
                btn.textContent = 'Done';
                showToast('Key TTL extended');
                loadUnifiedStatus(); // Use unified status loader
                setTimeout(() => { btn.textContent = origText; btn.disabled = false; }, 1500);
            } else {
                const err = await res.json().catch(() => ({}));
                showToast(err.error || 'Failed to extend key TTL', 'error');
                btn.textContent = origText;
                btn.disabled = false;
            }
        } catch (e) {
            showToast('Network error: ' + e.message, 'error');
            btn.textContent = origText;
            btn.disabled = false;
        }
    }

    // Note: Unified status (RPM + Expiry) is now loaded via single setInterval above
    // Old separate intervals for loadRpmBadges and loadExpiryBadges have been removed

    // ─── Virtual Keys ──────────────────────────────────────────

    async function refreshVirtualKeys() {
        try {
            const res = await fetch('/admin/api/virtual-keys');
            if (!res.ok) return;
            const keys = await res.json();
            renderVirtualKeysTable(keys);
        } catch (error) {
            console.log('Failed to load virtual keys:', error);
        }
    }

    function renderVirtualKeysTable(keys) {
        const tbody = document.getElementById('virtualKeysTableBody');
        const total = keys.length;
        const enabled = keys.filter(k => k.enabled).length;
        const disabled = total - enabled;
        const totalUsage = keys.reduce((sum, k) => sum + (k.usageCount || 0), 0);

        document.getElementById('vkTotal').textContent = total;
        document.getElementById('vkEnabled').textContent = enabled;
        document.getElementById('vkDisabled').textContent = disabled;
        document.getElementById('vkTotalUsage').textContent = totalUsage.toLocaleString();

        if (total === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="py-6 text-center text-muted-foreground">No virtual keys yet. Click "Create Virtual Key" to add one.</td></tr>';
            return;
        }

        tbody.innerHTML = keys.map(k => {
            const statusBadge = k.enabled
                ? '<span class="key-badge badge-fresh">ENABLED</span>'
                : '<span class="key-badge badge-exhausted">DISABLED</span>';

            const providers = k.allowedProviders && k.allowedProviders.length > 0
                ? k.allowedProviders.map(p => `<span class="key-badge" style="background:rgba(59,130,246,0.15);color:#3b82f6">${escapeHtml(p)}</span>`).join(' ')
                : '<span class="text-xs text-muted-foreground">All</span>';

            const models = k.allowedModels && k.allowedModels.length > 0
                ? `<span class="text-xs text-muted-foreground" title="${escapeHtml(k.allowedModels.join(', '))}">${escapeHtml(k.allowedModels.join(', '))}</span>`
                : '<span class="text-xs text-muted-foreground">All</span>';

            const rpmLimit = k.rpmLimit > 0
                ? `<span class="text-xs font-mono">${k.rpmLimit}</span>`
                : '<span class="text-xs text-muted-foreground">Unlimited</span>';

            const expires = k.expiresAt
                ? (() => {
                    const exp = new Date(k.expiresAt);
                    const now = new Date();
                    const isExpired = exp < now;
                    const dateStr = exp.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    return isExpired
                        ? `<span class="text-xs text-destructive">${dateStr} (expired)</span>`
                        : `<span class="text-xs text-foreground">${dateStr}</span>`;
                })()
                : '<span class="text-xs text-muted-foreground">Never</span>';

            const lastUsed = k.lastUsedAt
                ? new Date(k.lastUsedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : 'Never';

            return `<tr class="border-b border-border hover:bg-muted/20 transition-colors">
                <td class="py-2.5 pr-3">
                    <div class="font-medium text-foreground text-xs">${escapeHtml(k.name)}</div>
                    <div class="text-[10px] text-muted-foreground">Created ${new Date(k.createdAt).toLocaleDateString()}</div>
                </td>
                <td class="py-2.5 pr-3"><code class="text-xs font-mono text-muted-foreground">${escapeHtml(k.tokenPrefix)}...</code></td>
                <td class="py-2.5 pr-3"><div class="flex flex-wrap gap-1">${providers}</div></td>
                <td class="py-2.5 pr-3">${models}</td>
                <td class="py-2.5 pr-3">${rpmLimit}</td>
                <td class="py-2.5 pr-3">${expires}</td>
                <td class="py-2.5 pr-3">
                    <div class="text-xs text-foreground">${(k.usageCount || 0).toLocaleString()} reqs</div>
                    <div class="text-[10px] text-muted-foreground">Last: ${lastUsed}</div>
                </td>
                <td class="py-2.5 pr-3">${statusBadge}</td>
                <td class="py-2.5">
                    <div class="flex items-center space-x-1">
                        <button onclick="toggleVirtualKey('${safeJsAttr(k.id)}')" class="btn btn-secondary px-2 py-1 text-[10px] font-medium" title="${k.enabled ? 'Disable' : 'Enable'}">
                            ${k.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button onclick="showRevokeVirtualKeyConfirmation('${safeJsAttr(k.id)}', '${escapeHtml(k.name)}')" class="btn btn-destructive px-2 py-1 text-[10px] font-medium" title="Revoke">
                            Revoke
                        </button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    // escapeHtml replaced by global function at top of script

    function openCreateVirtualKeyDialog() {
        document.getElementById('vkName').value = '';
        document.getElementById('vkProviders').value = '';
        document.getElementById('vkModels').value = '';
        document.getElementById('vkRpmLimit').value = '0';
        document.getElementById('vkExpiresAt').value = '';
        document.getElementById('vkTokenDisplay').classList.add('hidden');
        document.getElementById('vkCreateBtn').textContent = 'Create Key';
        document.getElementById('vkCreateBtn').disabled = false;
        document.getElementById('createVirtualKeyDialog').classList.remove('hidden');
    }

    function closeCreateVirtualKeyDialog() {
        document.getElementById('createVirtualKeyDialog').classList.add('hidden');
    }

    async function createVirtualKey() {
        const name = document.getElementById('vkName').value.trim();
        const providersRaw = document.getElementById('vkProviders').value.trim();
        const modelsRaw = document.getElementById('vkModels').value.trim();
        const rpmLimit = parseInt(document.getElementById('vkRpmLimit').value, 10) || 0;
        const expiresAtRaw = document.getElementById('vkExpiresAt').value;

        const allowedProviders = providersRaw ? providersRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
        const allowedModels = modelsRaw ? modelsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
        const expiresAt = expiresAtRaw ? new Date(expiresAtRaw).toISOString() : null;

        if (!name) {
            showErrorToast('Name is required');
            return;
        }

        const btn = document.getElementById('vkCreateBtn');
        btn.textContent = 'Creating...';
        btn.disabled = true;

        try {
            const res = await fetch('/admin/api/virtual-keys', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, allowedProviders, allowedModels, rpmLimit, expiresAt })
            });
            if (!res.ok) {
                showErrorToast('Failed to create virtual key');
                return;
            }
            const result = await res.json();

            // Show the token
            document.getElementById('vkTokenValue').textContent = result.token;
            document.getElementById('vkTokenDisplay').classList.remove('hidden');
            btn.textContent = 'Created';
            btn.disabled = true;

            showSuccessToast('Virtual key created successfully');
            refreshVirtualKeys();
        } catch (error) {
            showErrorToast('Failed to create virtual key: ' + error.message);
            btn.textContent = 'Create Key';
            btn.disabled = false;
        }
    }

    function copyVkToken() {
        const token = document.getElementById('vkTokenValue').textContent;
        navigator.clipboard.writeText(token).then(() => {
            showSuccessToast('Token copied to clipboard');
        }).catch(() => {
            // Fallback
            const ta = document.createElement('textarea');
            ta.value = token;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            showSuccessToast('Token copied to clipboard');
        });
    }

    function showRevokeVirtualKeyConfirmation(id, name) {
        const dialog = document.getElementById('confirmDialog');
        const message = document.getElementById('confirmMessage');

        message.textContent = `Revoke virtual key '${name}'? This action cannot be undone. All requests using this key will be rejected.`;

        const confirmBtn = dialog.querySelector('button[onclick="confirmDelete()"]');
        confirmBtn.textContent = 'Revoke';
        confirmBtn.onclick = () => {
            dialog.classList.add('hidden');
            confirmBtn.textContent = 'Delete';
            revokeVirtualKey(id);
        };

        dialog.classList.remove('hidden');
    }

    async function revokeVirtualKey(id) {
        try {
            const res = await fetch(`/admin/api/virtual-keys/${id}`, { method: 'DELETE' });
            if (!res.ok) {
                showErrorToast('Failed to revoke virtual key');
                return;
            }
            showSuccessToast('Virtual key revoked');
            refreshVirtualKeys();
        } catch (error) {
            showErrorToast('Failed to revoke virtual key: ' + error.message);
        }
    }

    async function toggleVirtualKey(id) {
        try {
            const res = await fetch(`/admin/api/virtual-keys/${id}`, { method: 'POST' });
            if (!res.ok) {
                showErrorToast('Failed to toggle virtual key');
                return;
            }
            showSuccessToast('Virtual key toggled');
            refreshVirtualKeys();
        } catch (error) {
            showErrorToast('Failed to toggle virtual key: ' + error.message);
        }
    }

    // ─── Budget Management ──────────────────────────
    let budgetRefreshTimer = null;

    async function loadBudgets() {
        try {
            const res = await fetch('/admin/api/budgets', { headers: authHeaders() });
            if (!res.ok) return;
            const statuses = await res.json();
            renderBudgetSummary(statuses);
            renderBudgetTable(statuses);
            document.getElementById('budgetLastRefresh').textContent = 'Last refresh: ' + new Date().toLocaleTimeString();
            // Auto-refresh every 30s
            clearTimeout(budgetRefreshTimer);
            budgetRefreshTimer = setTimeout(loadBudgets, 30000);
        } catch (err) {
            console.error('Failed to load budgets:', err);
        }
    }

    function renderBudgetSummary(statuses) {
        const entries = Object.values(statuses);
        const total = entries.length;
        const allowed = entries.filter(e => e.allowed).length;
        const exceeded = total - allowed;
        const totalSpend = entries.reduce((sum, e) => sum + (e.dailySpent || 0), 0);
        document.getElementById('budgetTotal').textContent = total;
        document.getElementById('budgetAllowed').textContent = allowed;
        document.getElementById('budgetExceeded').textContent = exceeded;
        document.getElementById('budgetTotalSpend').textContent = '$' + totalSpend.toFixed(2);
    }

    function renderBudgetTable(statuses) {
        const tbody = document.getElementById('budgetTableBody');
        const entries = Object.entries(statuses);
        if (entries.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="py-4 text-center text-muted-foreground">No budgets configured. Click "Set Budget" to add one.</td></tr>';
            return;
        }
        tbody.innerHTML = entries.map(([hash, b]) => {
            const displayKey = b.maskedKey || hash.substring(0, 8) + '...';
            const provider = b.provider || 'unknown';
            const statusBadge = b.allowed
                ? '<span class="key-badge badge-fresh">OK</span>'
                : '<span class="key-badge badge-exhausted">Exceeded</span>';
            const dailyPct = b.dailyLimit > 0 ? Math.min((b.dailySpent / b.dailyLimit) * 100, 100) : -1;
            const monthlyPct = b.monthlyLimit > 0 ? Math.min((b.monthlySpent / b.monthlyLimit) * 100, 100) : -1;
            const dailyBar = dailyPct >= 0 ? renderProgressBar(dailyPct, b.dailySpent, b.dailyLimit) : '<span class="text-muted-foreground">no limit</span>';
            const monthlyBar = monthlyPct >= 0 ? renderProgressBar(monthlyPct, b.monthlySpent, b.monthlyLimit) : '<span class="text-muted-foreground">no limit</span>';
            return `<tr class="border-b border-border/50">
                <td class="py-2 pr-3 font-mono text-xs">${escapeHtml(displayKey)}</td>
                <td class="py-2 pr-3">${escapeHtml(provider)}</td>
                <td class="py-2 pr-3">${statusBadge}</td>
                <td class="py-2 pr-3">${dailyBar}</td>
                <td class="py-2 pr-3 text-xs">$${(b.dailyLimit || 0).toFixed(2)}</td>
                <td class="py-2 pr-3">${monthlyBar}</td>
                <td class="py-2 pr-3 text-xs">$${(b.monthlyLimit || 0).toFixed(2)}</td>
                <td class="py-2">
                    <div class="flex items-center gap-1">
                        <button onclick="editBudget('${safeJsAttr(hash)}')" class="text-xs text-blue-400 hover:text-blue-300" title="Edit">Edit</button>
                        <span class="text-border">|</span>
                        <button onclick="removeBudget('${safeJsAttr(hash)}')" class="text-xs text-red-400 hover:text-red-300" title="Remove">Remove</button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    function renderProgressBar(pct, spent, limit) {
        const color = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#22c55e';
        const spentStr = '$' + spent.toFixed(2);
        const limitStr = '$' + limit.toFixed(2);
        return `<div class="w-full max-w-[120px]">
            <div class="flex items-center justify-between text-[10px] mb-0.5">
                <span>${spentStr}</span>
                <span class="text-muted-foreground">${Math.round(pct)}%</span>
            </div>
            <div class="w-full bg-muted rounded-full h-1.5">
                <div class="h-1.5 rounded-full transition-all" style="width: ${pct}%; background-color: ${color};"></div>
            </div>
        </div>`;
    }

    async function openSetBudgetModal(prefillHash) {
        const modal = document.getElementById('setBudgetModal');
        modal.classList.remove('hidden');
        document.getElementById('budgetSaveStatus').classList.add('hidden');
        document.getElementById('budgetExistingInfo').classList.add('hidden');
        document.getElementById('budgetDailyLimit').value = '';
        document.getElementById('budgetMonthlyLimit').value = '';

        // Load available keys
        try {
            const res = await fetch('/admin/api/budgets/available-keys', { headers: authHeaders() });
            if (!res.ok) return;
            const keys = await res.json();
            const select = document.getElementById('budgetKeySelect');
            select.innerHTML = '<option value="">-- Select a key --</option>' +
                keys.map(k => `<option value="${escapeHtml(k.keyHash)}" data-provider="${escapeHtml(k.provider)}" data-masked="${escapeHtml(k.maskedKey)}">${escapeHtml(k.provider)}: ${escapeHtml(k.maskedKey)}${k.hasBudget ? ' (has budget)' : ''}</option>`).join('');

            // If editing, pre-select the key
            if (prefillHash) {
                select.value = prefillHash;
                if (select.value === prefillHash) {
                    loadExistingBudgetInfo(prefillHash);
                }
            }
        } catch (err) {
            console.error('Failed to load available keys:', err);
            document.getElementById('budgetKeySelect').innerHTML = '<option value="">Error loading keys</option>';
        }
    }

    async function loadExistingBudgetInfo(keyHash) {
        try {
            const res = await fetch('/admin/api/budgets', { headers: authHeaders() });
            if (!res.ok) return;
            const statuses = await res.json();
            const status = statuses[keyHash];
            if (status) {
                document.getElementById('budgetExistingInfo').classList.remove('hidden');
                document.getElementById('budgetDailyLimit').value = status.dailyLimit || '';
                document.getElementById('budgetMonthlyLimit').value = status.monthlyLimit || '';
                const dailyStr = status.dailyLimit > 0
                    ? `$${status.dailySpent.toFixed(2)} / $${status.dailyLimit.toFixed(2)}`
                    : 'no limit ($' + status.dailySpent.toFixed(2) + ' spent)';
                const monthlyStr = status.monthlyLimit > 0
                    ? `$${status.monthlySpent.toFixed(2)} / $${status.monthlyLimit.toFixed(2)}`
                    : 'no limit ($' + status.monthlySpent.toFixed(2) + ' spent)';
                document.getElementById('budgetExistingDaily').textContent = dailyStr;
                document.getElementById('budgetExistingMonthly').textContent = monthlyStr;
            }
        } catch (err) {
            console.error('Failed to load budget info:', err);
        }
    }

    function closeSetBudgetModal() {
        document.getElementById('setBudgetModal').classList.add('hidden');
    }

    async function saveBudget() {
        const keyHash = document.getElementById('budgetKeySelect').value;
        if (!keyHash) {
            showBudgetStatus('Please select an API key', 'error');
            return;
        }
        const dailyLimit = parseFloat(document.getElementById('budgetDailyLimit').value) || 0;
        const monthlyLimit = parseFloat(document.getElementById('budgetMonthlyLimit').value) || 0;
        if (dailyLimit === 0 && monthlyLimit === 0) {
            showBudgetStatus('Set at least one limit (daily or monthly)', 'error');
            return;
        }

        try {
            const res = await fetch('/admin/api/budgets', {
                method: 'POST',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ keyHash, dailyLimit, monthlyLimit })
            });
            if (!res.ok) {
                const err = await res.json();
                showBudgetStatus('Failed: ' + (err.error || 'Unknown error'), 'error');
                return;
            }
            showBudgetStatus('Budget saved successfully', 'success');
            closeSetBudgetModal();
            loadBudgets();
        } catch (err) {
            showBudgetStatus('Error: ' + err.message, 'error');
        }
    }

    function showBudgetStatus(msg, type) {
        const el = document.getElementById('budgetSaveStatus');
        el.classList.remove('hidden');
        el.className = 'text-xs mt-2 ' + (type === 'error' ? 'text-red-400' : 'text-green-400');
        el.textContent = msg;
    }

    function editBudget(keyHash) {
        openSetBudgetModal(keyHash);
    }

    async function removeBudget(keyHash) {
        if (!confirm('Remove budget for this key? The key will no longer have spend limits.')) return;
        try {
            const res = await fetch('/admin/api/budgets/' + encodeURIComponent(keyHash), { method: 'DELETE', headers: authHeaders() });
            if (res.ok) {
                showSuccessToast('Budget removed');
                loadBudgets();
            } else {
                showErrorToast('Failed to remove budget');
            }
        } catch (err) {
            showErrorToast('Error: ' + err.message);
        }
    }
