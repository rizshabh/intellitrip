// IntelliTrip - Complete Application JavaScript
// Manages both Landing Page and Dashboard functionality

// Prevent duplicate class declaration
if (typeof IntelliTripApp !== 'undefined') {
    console.warn('[IntelliTrip] Class already loaded, skipping redeclaration');
} else {

    class IntelliTripApp {
        constructor() {
            this.currentView = 'dashboard';
            this.isLoggedIn = !!localStorage.getItem('token');
            this.userData = this.getUserData();
            this.currentUserId = this.userData ? this.userData.id : null;
            this.allTrips = [];
            this.allExpenses = [];
            this.userLocation = null;
            this.geocodingCache = {};
            this.destinationImageCache = {};
            this.weatherCache = {};
            this.requestUserLocation();
            this.init();
            if (window.currencyService) window.currencyService.getRates();
        }

        // ================================================================
        // CURRENCY HELPERS
        // ================================================================
        getCurrencySymbol() {
            const userData = JSON.parse(localStorage.getItem('user') || '{}');
            const currencyCode = userData.preferred_currency || 'INR';
            return window.currencyService ? window.currencyService.getSymbol(currencyCode) : '\u20b9';
        }

        // Returns PLAIN TEXT formatted amount. Safe for textContent, innerHTML, template literals, attributes.
        formatCurrency(amount, includeSymbol = true) {
            const userData = JSON.parse(localStorage.getItem('user') || '{}');
            const toCurrency = userData.preferred_currency || 'INR';
            const symbol = this.getCurrencySymbol();

            if (typeof amount === 'string') {
                const allSymbols = window.currencyService ? Object.values(window.currencyService.getAllSymbols()) : ['\u20b9', '$', '\u20ac', '\u00a3'];
                if (allSymbols.some(s => s.length > 0 && amount.includes(s))) return amount;
            }

            const numericValue = parseFloat(amount);
            if (isNaN(numericValue)) return String(amount ?? '0');
            let rate = 1;
            if (window.currencyService && window.currencyService.rates && toCurrency !== 'INR') {
                rate = window.currencyService.rates[toCurrency] || 1;
            }
            const converted = (numericValue * rate).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
            return includeSymbol ? (symbol + converted) : converted;
        }

        // Returns an HTML <span data-raw-amount> wrapper around the formatted value.
        // Used only in setCurrencyEl() -- never inserted raw into template literals.
        formatCurrencyHTML(amount) {
            const numericValue = parseFloat(amount);
            const display = this.formatCurrency(isNaN(numericValue) ? 0 : numericValue);
            const raw = isNaN(numericValue) ? 0 : numericValue;
            return '<span class="currency-val" data-raw-amount="' + raw + '">' + display + '</span>';
        }

        // Helper: set a DOM element's innerHTML to a trackable currency span.
        setCurrencyEl(el, amount) {
            if (!el) return;
            el.innerHTML = this.formatCurrencyHTML(amount);
        }

        // Plain-text version (no span) for data attributes and title tooltips
        formatCurrencyPlain(amount, includeSymbol = true) {
            const userData = JSON.parse(localStorage.getItem('user') || '{}');
            const toCurrency = userData.preferred_currency || 'INR';
            const symbol = this.getCurrencySymbol();
            const numericValue = parseFloat(amount);
            if (isNaN(numericValue)) return String(amount ?? '0');
            let rate = 1;
            if (window.currencyService && window.currencyService.rates && toCurrency !== 'INR') {
                rate = window.currencyService.rates[toCurrency] || 1;
            }
            const converted = (numericValue * rate).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
            return includeSymbol ? (symbol + converted) : converted;
        }

        /**
         * Converts an amount from the user's preferred currency BACK to the base currency (INR).
         * Used before sending data to the backend.
         */
        async convertToBaseCurrency(amount) {
            const numericValue = parseFloat(amount);
            if (isNaN(numericValue)) return 0;

            const userData = JSON.parse(localStorage.getItem('user') || '{}');
            const fromCurrency = userData.preferred_currency || 'INR';

            if (fromCurrency === 'INR') return numericValue;

            if (window.currencyService) {
                const rates = await window.currencyService.getRates();
                const rate = rates[fromCurrency];
                if (rate && rate !== 0) {
                    return numericValue / rate;
                }
            }
            return numericValue;
        }

        // Instantly reformat every .currency-val span already rendered in the DOM.
        // Zero server calls — just reads data-raw-amount and applies the new rate.
        refreshAllCurrencyDisplays() {
            const userData = JSON.parse(localStorage.getItem('user') || '{}');
            const toCurrency = userData.preferred_currency || 'INR';
            const symbol = this.getCurrencySymbol();
            let rate = 1;
            if (window.currencyService && window.currencyService.rates && toCurrency !== 'INR') {
                rate = window.currencyService.rates[toCurrency] || 1;
            }
            let count = 0;
            document.querySelectorAll('.currency-val[data-raw-amount]').forEach(el => {
                const raw = parseFloat(el.dataset.rawAmount);
                if (isNaN(raw)) return;
                const converted = (raw * rate).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
                el.textContent = symbol + converted;
                count++;
            });
            console.log('[Currency] Refreshed ' + count + ' elements to ' + toCurrency + ' @ rate ' + rate);
        }

        async updatePreferredCurrency(currencyCode) {
            try {
                const symbol = window.currencyService ? window.currencyService.getSymbol(currencyCode) : currencyCode;
                this.showToast('\u23f3 Fetching live ' + currencyCode + ' rates...', 'info');
                const token = localStorage.getItem('token');

                const res = await fetch(this.getApiUrl('/api/auth/profile'), {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': token },
                    body: JSON.stringify({ preferred_currency: currencyCode })
                });

                if (!res.ok) throw new Error('Failed to update currency preference');

                const data = await res.json();
                localStorage.setItem('user', JSON.stringify(data.user));
                this.userData = data.user;

                // Step 1: Invalidate old rate cache, fetch fresh real-time rates
                if (window.currencyService) {
                    window.currencyService.invalidateCache();
                    await window.currencyService.getRates();
                }

                // Step 2: INSTANT DOM reformat — no server call needed
                this.refreshAllCurrencyDisplays();

                this.showToast('\u2705 Switched to ' + symbol + ' ' + currencyCode + '!', 'success');

                // Step 3: Full background re-render (silent, non-blocking)
                if (this.isDashboard) {
                    (async () => {
                        try {
                            await this.updateRealTimeStats();
                            await this.loadTripsData();
                            await this.loadExpensesData();
                            await this.loadAnalyticsData();
                            if (typeof this.loadReportsData === 'function') await this.loadReportsData().catch(() => { });
                            await this.updateAuthUI();
                            if ((this.currentView || 'dashboard') === 'dashboard') this.updateDashboardData();
                            await this.loadAITips(true); // Always refresh AI tips background to sync currency
                        } catch (bgErr) {
                            console.warn('[Currency] Background refresh partial error:', bgErr);
                        }
                    })();
                }
            } catch (err) {
                console.error('Currency Update Error:', err);
                this.showToast('\u274c Failed to update currency', 'error');
            }
        }

        // ================================================================
        // AUTO-DETECT CURRENCY FROM TRIP DESTINATION
        // Uses Nominatim geocoding → country code → currency lookup
        // ================================================================
        async detectAndSetTripCurrency(destination) {
            if (!destination || !window.currencyService) return;
            try {
                // Step 1: Geocode destination. We add "country" hinting for vague terms like "China" or "India"
                let url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(destination)}&limit=1&addressdetails=1`;

                let res = await fetch(url, {
                    headers: { 'Accept': 'application/json', 'User-Agent': 'IntelliTrip/1.0' }
                });

                if (!res.ok) return;
                let data = await res.json();

                // If top result isn't great, try appending "country" to query for ambiguous terms
                if (!data || data.length === 0 || !data[0].address?.country_code) {
                    const fallbackUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(destination)}+country&limit=1&addressdetails=1`;
                    const fallbackRes = await fetch(fallbackUrl, {
                        headers: { 'Accept': 'application/json', 'User-Agent': 'IntelliTrip/1.0' }
                    });
                    if (fallbackRes.ok) data = await fallbackRes.json();
                }

                if (!data || data.length === 0) {
                    console.warn('[Currency] Could not geocode destination:', destination);
                    return;
                }

                // Step 2: Extract country code from result (robust check)
                const countryCode = data[0].address?.country_code?.toUpperCase();

                if (!countryCode) {
                    console.warn('[Currency] No country code found for:', destination);
                    return;
                }

                // Step 3: Map country code → currency code
                const detectedCurrency = window.currencyService.getCurrencyForCountry(countryCode);
                if (!detectedCurrency) {
                    console.warn('[Currency] No currency mapped for country:', countryCode);
                    return;
                }

                // Step 4: Check if it's different from the current currency
                const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
                const currentCurrency = currentUser.preferred_currency || 'INR';

                if (detectedCurrency === currentCurrency) {
                    console.log(`[Currency] Already using ${currentCurrency} for ${destination}`);
                    return;
                }

                const symbol = window.currencyService.getSymbol(detectedCurrency);
                const currencyName = window.currencyService.getAllCurrencies().find(c => c.code === detectedCurrency);
                const currencyLabel = currencyName ? `${currencyName.flag} ${currencyName.name} (${detectedCurrency})` : detectedCurrency;

                console.log(`[Currency] 🌍 Detected ${destination} → ${countryCode} → ${detectedCurrency}`);

                // Step 5: Auto-switch currency and update the UI select dropdown
                await this.updatePreferredCurrency(detectedCurrency);

                // Update the currency dropdown in profile settings too
                const currencySelect = document.getElementById('profileCurrencySelect');
                if (currencySelect) currencySelect.value = detectedCurrency;

                this.showToast(`🌍 Currency auto-set to ${symbol} ${currencyLabel} for ${destination}`, 'success');

            } catch (err) {
                console.warn('[Currency] detectAndSetTripCurrency failed silently:', err);
            }
        }

        // ================================================================
        // AUTO-CONTEXT CURRENCY SWITCHER (Used after Delete)
        // Switches to active trip, upcoming trip, or user's physical location
        // ================================================================
        async autoSwitchCurrencyContext() {
            try {
                if (!this.allTrips || this.allTrips.length === 0) {
                    console.log('[Currency] No trips available in system. Calling location-based fallback...');
                    await this.switchToUserLocationCurrency();
                    return;
                }

                const now = new Date();
                let targetTrip = null;

                // Find an active/ongoing trip
                const ongoingTrip = this.allTrips.find(t => {
                    const start = new Date(t.start_date); start.setHours(0, 0, 0, 0);
                    const end = new Date(t.end_date); end.setHours(23, 59, 59, 999);
                    return now >= start && now <= end;
                });

                if (ongoingTrip) {
                    console.log('[Currency] Found active trip:', ongoingTrip.destination);
                    targetTrip = ongoingTrip;
                } else {
                    // Find the closest upcoming trip
                    const upcomingTrips = this.allTrips.filter(t => {
                        const start = new Date(t.start_date); start.setHours(0, 0, 0, 0);
                        return start > now;
                    }).sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

                    if (upcomingTrips.length > 0) {
                        console.log('[Currency] Found upcoming trip:', upcomingTrips[0].destination);
                        targetTrip = upcomingTrips[0];
                    }
                }

                if (targetTrip) {
                    await this.detectAndSetTripCurrency(targetTrip.destination);
                } else {
                    console.log('[Currency] All trips are in the past. Reverting to current physical location...');
                    await this.switchToUserLocationCurrency();
                }

            } catch (err) {
                console.warn('[Currency] autoSwitchCurrencyContext failed:', err);
            }
        }

        async switchToUserLocationCurrency() {
            // Method 0: Browser Locale (Fastest, Offline-Ready, No Permissions)
            try {
                const localeCurrency = new Intl.NumberFormat().resolvedOptions().currency;
                if (localeCurrency && window.currencyService && window.currencyService.getAllSymbols()[localeCurrency]) {
                    console.log(`[Currency] Browser locale detected: ${localeCurrency}`);
                    await this._applyUserCurrency(localeCurrency, 'Local Environment');
                    return;
                }
            } catch (e) {
                console.warn('[Currency] Intl detection failed:', e);
            }

            // Method 1: IP Geolocation (Fast, No Permissions needed)
            try {
                const res = await fetch('https://ipapi.co/json/');
                if (res.ok) {
                    const data = await res.json();
                    let detectedCurrency = data.currency;
                    let countryCode = data.country || data.country_code;
                    let countryName = data.country_name || countryCode;

                    if (!detectedCurrency && countryCode && window.currencyService) {
                        detectedCurrency = window.currencyService.getCurrencyForCountry(countryCode);
                    }

                    if (detectedCurrency) {
                        console.log(`[Currency] IP detected country: ${countryName} (${countryCode}) → ${detectedCurrency}`);
                        await this._applyUserCurrency(detectedCurrency, countryName);
                        return; // Success, skip GPS
                    }
                }
            } catch (err) {
                console.warn('[Currency] IP Geolocation failed:', err);
            }

            // Method 2: Fallback free GeoJS IP API
            try {
                const res = await fetch('https://get.geojs.io/v1/ip/geo.json');
                if (res.ok) {
                    const data = await res.json();
                    const detectedCurrency = window.currencyService ? window.currencyService.getCurrencyForCountry(data.country_code) : null;
                    if (detectedCurrency) {
                        console.log(`[Currency] GeoJS detected country: ${data.country} (${data.country_code}) → ${detectedCurrency}`);
                        await this._applyUserCurrency(detectedCurrency, data.country);
                        return; // Success, skip GPS
                    }
                }
            } catch (err) {
                console.warn('[Currency] GeoJS Geolocation failed:', err);
            }

            // Method 3: Browser GPS (Requires Permission popup)
            if (this.userLocation) {
                await this._geocodeAndSetUserCurrency();
            } else if (navigator.geolocation) {
                console.log('[Currency] Attempting Browser GPS fallback location tracking...');
                navigator.geolocation.getCurrentPosition(
                    async (position) => {
                        this.userLocation = {
                            lat: position.coords.latitude,
                            lng: position.coords.longitude
                        };
                        await this._geocodeAndSetUserCurrency();
                    },
                    (error) => console.warn('⚠️ Geolocation denied by user:', error.message)
                );
            } else {
                console.warn('[Currency] Could not determine user location by any method.');
            }
        }

        async _geocodeAndSetUserCurrency() {
            if (!this.userLocation || !window.currencyService) return;
            try {
                const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${this.userLocation.lat}&lon=${this.userLocation.lng}`;
                const res = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'IntelliTrip/1.0' } });
                if (!res.ok) return;
                const data = await res.json();

                const countryCode = data.address?.country_code?.toUpperCase();
                if (!countryCode) return;

                const detectedCurrency = window.currencyService.getCurrencyForCountry(countryCode);
                if (detectedCurrency) {
                    await this._applyUserCurrency(detectedCurrency, countryCode);
                }
            } catch (err) {
                console.warn('[Currency] Geocoding user location failed:', err);
            }
        }

        async _applyUserCurrency(detectedCurrency, locationName) {
            const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
            const currentCurrency = currentUser.preferred_currency || 'INR';

            if (detectedCurrency === currentCurrency) {
                console.log(`[Currency] Location matches preferred currency: ${currentCurrency}. No change needed.`);
                return;
            }

            console.log(`[Currency] 📍 Automatic fallback triggered: Setting current local currency → ${detectedCurrency}`);
            await this.updatePreferredCurrency(detectedCurrency);

            const currencySelect = document.getElementById('profileCurrencySelect');
            if (currencySelect) currencySelect.value = detectedCurrency;

            const symbol = window.currencyService.getSymbol(detectedCurrency);
            this.showToast(`📍 Reverted to local currency: ${symbol} ${detectedCurrency}`, 'success');
        }

        getImageUrl(path) {
            if (!path) return null;
            if (path.startsWith('data:') || path.startsWith('http')) return path;
            return this.getApiUrl(path);
        }

        getApiUrl(path) {
            const hostname = window.location.hostname;
            const port = window.location.port;
            const protocol = window.location.protocol;

            // If we are in a browser and not on port 5000, we likely need to point to the backend explicitly
            // This covers Live Server (5500), Vite (5173), etc.
            if (hostname && port !== '5000' && port !== '') {
                return `http://${hostname}:5000${path.startsWith('/') ? '' : '/'}${path}`;
            }

            // Handle file protocol or empty hostname (direct file open)
            if (!hostname || protocol === 'file:') {
                return `http://localhost:5000${path.startsWith('/') ? '' : '/'}${path}`;
            }

            return path;
        }

        requestUserLocation() {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        this.userLocation = {
                            lat: position.coords.latitude,
                            lng: position.coords.longitude
                        };
                        console.log('📍 User location acquired:', this.userLocation);
                    },
                    (error) => console.warn('⚠️ Geolocation denied or unavailable:', error.message),
                    { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
                );
            }
        }

        calculateDistance(destLat, destLng) {
            if (!this.userLocation) return null;

            const R = 6371; // Earth's radius in km
            const dLat = (destLat - this.userLocation.lat) * Math.PI / 180;
            const dLon = (destLng - this.userLocation.lng) * Math.PI / 180;
            const a =
                Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(this.userLocation.lat * Math.PI / 180) * Math.cos(destLat * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const d = R * c;

            if (d < 1) return `${Math.round(d * 1000)}m`;
            return `${d.toFixed(1)}km`;
        }

        async getCityCoordinates(city) {
            if (!city) return null;
            const cleanCity = city.toLowerCase().trim();
            if (this.geocodingCache[cleanCity]) return this.geocodingCache[cleanCity];

            try {
                // Nominatim requires a User-Agent to avoid 403 errors
                const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(city)}&limit=1`;
                const res = await fetch(url, {
                    headers: { 'Accept': 'application/json', 'User-Agent': 'IntelliTrip/1.0' }
                });
                const data = await res.json();

                if (data && data.length > 0) {
                    const coords = {
                        lat: parseFloat(data[0].lat),
                        lng: parseFloat(data[0].lon),
                        displayName: data[0].display_name
                    };
                    this.geocodingCache[cleanCity] = coords;
                    console.log(`📍 Geocoded ${city} to:`, coords);
                    return coords;
                }
            } catch (e) {
                console.warn(`Geocoding failed for ${city}:`, e);
            }
            return null;
        }


        init() {
            this.detectPageType();
            this.setupEventListeners();
            this.setupNavigation();
            this.loadInitialData();
            this.setupAnimations();
            this.updateAuthUI();

            // Global Error Handler for better debugging
            window.onerror = (msg, url, lineNo, columnNo, error) => {
                console.error('System Error:', msg, error);
                if (this.showToast) this.showToast(`System Error: ${msg}`, 'error');
                return false;
            };

            // Handle hash navigation (e.g. #expenses) on load
            if (this.isDashboard) {
                this.handleHashNavigation();

                // Auto-refresh tips if cache was cleared elsewhere (e.g. create-trip.html)
                window.addEventListener('focus', () => {
                    const cached = localStorage.getItem('cachedAITips');
                    if (!cached && !this._loadingAITips) {
                        console.log('[AutoRefresh] Cache missing on focus, reloading tips...');
                        this.loadAITips();
                    }
                });

                // Dynamic Updates - Poll every 10 seconds
                // Dynamic Updates - Poll every 10 seconds
                setInterval(() => {
                    if (!document.hidden) this.updateRealTimeStats();
                }, 10000);

                // Update time every minute
                setInterval(() => {
                    if (!document.hidden) this.updateGreeting();
                }, 60000);
            }
        }

        handleHashNavigation() {
            const hash = window.location.hash.slice(1); // remove #
            if (hash) {
                // Find valid views
                const validViews = ['dashboard', 'trips', 'expenses', 'analytics', 'reports', 'ai-tips'];
                if (validViews.includes(hash)) {
                    this.showView(hash);
                    // Update active nav state
                    const activeLink = document.querySelector(`.nav-link[data-view="${hash}"]`);
                    if (activeLink) this.updateActiveNav(activeLink);
                }
            }
        }

        getTripStatus(trip) {
            const now = new Date();
            const start = new Date(trip.start_date); start.setHours(0, 0, 0, 0);
            const end = new Date(trip.end_date); end.setHours(23, 59, 59, 999);

            if (now > end) return 'completed';
            if (now >= start && now <= end) return 'ongoing';
            return 'upcoming';
        }

        detectPageType() {
            // Check if we're on dashboard or landing page
            const sidebar = document.querySelector('.sidebar');
            this.isDashboard = !!sidebar;
            console.log(`Loading ${this.isDashboard ? 'Dashboard' : 'Landing Page'}...`);
        }

        setupEventListeners() {
            // Declare these first so the delegated handler can reference them
            const notificationBtn = document.getElementById('notificationBtn');
            const notificationsDropdown = document.getElementById('notificationsDropdown');

            // ============================================================
            // UNIFIED DELEGATED CLICK HANDLER
            // Handles ALL click-based interactions in one place so that
            // re-renders (e.g. after currency change) never break toggles.
            // ============================================================
            document.addEventListener('click', (e) => {
                const sidebar = document.querySelector('.sidebar');

                // --- Landing Page: Mobile Menu Toggle ---
                const landingToggle = e.target.closest('#menuToggle');
                if (landingToggle) {
                    const navMenu = document.querySelector('.nav-menu');
                    if (navMenu) {
                        const isActive = navMenu.classList.toggle('active');
                        landingToggle.innerHTML = isActive ? '<i class="fas fa-times"></i>' : '<i class="fas fa-bars"></i>';
                    }
                    return;
                }

                // --- Landing Page: Close menu on link click ---
                if (e.target.closest('.nav-menu a')) {
                    const navMenu = document.querySelector('.nav-menu');
                    const toggle = document.getElementById('menuToggle');
                    if (navMenu) navMenu.classList.remove('active');
                    if (toggle) toggle.innerHTML = '<i class="fas fa-bars"></i>';
                    return;
                }

                // --- Dashboard: Nav Link (View Switcher) ---
                const navLink = e.target.closest('.nav-link[data-view]');
                if (navLink) {
                    e.preventDefault();
                    const view = navLink.dataset.view;
                    this.showView(view);
                    this.updateActiveNav(navLink);
                    // Close sidebar on mobile after navigation
                    if (sidebar && window.innerWidth < 992) {
                        sidebar.classList.remove('active');
                    }
                    return;
                }

                // --- Dashboard: Sidebar Toggle (Desktop = collapsed, Mobile = active) ---
                const sidebarToggle = e.target.closest('#sidebarToggle');
                if (sidebarToggle && sidebar) {
                    if (window.innerWidth > 992) {
                        sidebar.classList.toggle('collapsed');
                    } else {
                        sidebar.classList.toggle('active');
                    }
                    return;
                }

                // --- Dashboard: Mobile Menu Button ---
                const mobileMenuBtn = e.target.closest('#mobileMenuBtn');
                if (mobileMenuBtn && sidebar) {
                    sidebar.classList.toggle('active');
                    return;
                }

                // --- Dashboard: User Profile Menu Toggle ---
                const userProfile = e.target.closest('.user-profile');
                if (userProfile) {
                    if (!e.target.closest('a')) {
                        this.toggleUserMenu(e);
                    }
                    return;
                }

                // --- Close Notifications Dropdown ---
                const notifDropdown = document.getElementById('notificationsDropdown');
                const notifBtn = document.getElementById('notificationBtn');
                if (notifDropdown && notifDropdown.classList.contains('show')) {
                    if (!notifDropdown.contains(e.target) && notifBtn && !notifBtn.contains(e.target)) {
                        notifDropdown.classList.remove('show');
                    }
                }

                // --- Close User Menu Dropdown ---
                const userMenu = document.querySelector('.user-menu-dropdown');
                if (userMenu && userMenu.classList.contains('show') && !e.target.closest('.user-profile')) {
                    userMenu.classList.remove('show');
                    document.querySelector('.user-profile')?.classList.remove('active');
                }

                // --- Close Modal on Overlay Click ---
                if (e.target.classList.contains('modal-overlay')) {
                    this.closeModal();
                }

                // --- Save AI Tip ---
                if (e.target.closest('.ai-tip-save')) {
                    const tip = e.target.closest('.ai-tip');
                    if (tip) {
                        const title = tip.querySelector('h4')?.textContent;
                        if (title) this.saveAITip(title);
                    }
                }
            });


            // AI Tips functionality
            const aiTipsBtn = document.getElementById('aiTipsBtn');
            const aiTipsLink = document.getElementById('aiTipsLink');
            const viewMoreTipsBtn = document.getElementById('viewMoreTipsBtn');

            if (aiTipsBtn) {
                aiTipsBtn.addEventListener('click', () => this.openAITips());
            }

            if (aiTipsLink) {
                aiTipsLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.openAITips();
                });
            }

            if (viewMoreTipsBtn) {
                viewMoreTipsBtn.addEventListener('click', () => this.openAITips());
            }

            // Notifications button handler
            if (notificationBtn && notificationsDropdown) {
                notificationsDropdown.style.position = 'absolute';
                notificationsDropdown.style.minWidth = '260px';

                notificationBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isOpen = notificationsDropdown.classList.toggle('show');

                    if (isOpen) {
                        if (window.innerWidth > 768) {
                            notificationsDropdown.style.position = 'absolute';
                            notificationsDropdown.style.minWidth = '260px';

                            const btnRect = notificationBtn.getBoundingClientRect();
                            const actionsEl = document.querySelector('.top-bar-actions');
                            const parentRect = actionsEl ? actionsEl.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth };

                            let dropdownWidth = notificationsDropdown.offsetWidth || 300;
                            let desiredLeft = (btnRect.left - parentRect.left) + (btnRect.width / 2) - (dropdownWidth / 2);

                            const screenFactor = Math.min(1, window.innerWidth / 1200);
                            const extraShift = Math.round(220 * screenFactor);
                            desiredLeft -= extraShift;

                            const minLeft = 8;
                            const maxLeft = Math.max(8, parentRect.width - dropdownWidth - 12);
                            let finalLeft = Math.min(Math.max(desiredLeft, minLeft), maxLeft);

                            const viewportMax = window.innerWidth - dropdownWidth - 12;
                            const viewportLeft = Math.min(finalLeft + parentRect.left, viewportMax) - parentRect.left;
                            finalLeft = Math.max(minLeft, viewportLeft);

                            const top = btnRect.bottom - parentRect.top + 8;

                            notificationsDropdown.style.left = Math.round(finalLeft) + 'px';
                            notificationsDropdown.style.top = Math.round(top) + 'px';
                        } else {
                            notificationsDropdown.style.position = '';
                            notificationsDropdown.style.top = '';
                            notificationsDropdown.style.left = '';
                            notificationsDropdown.style.minWidth = '';
                            notificationsDropdown.style.transform = '';
                        }
                        notificationsDropdown.setAttribute('aria-hidden', 'false');
                    } else {
                        notificationsDropdown.setAttribute('aria-hidden', 'true');
                    }
                });
            }

            // Search functionality
            const globalSearch = document.getElementById('globalSearch');
            const clearSearchBtn = document.getElementById('clearSearchBtn');

            if (globalSearch) {
                globalSearch.addEventListener('input', (e) => {
                    if (clearSearchBtn) {
                        clearSearchBtn.style.opacity = e.target.value ? '1' : '0';
                    }
                });

                globalSearch.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        this.performSearch(globalSearch.value);
                    }
                });
            }

            if (clearSearchBtn) {
                clearSearchBtn.addEventListener('click', () => {
                    if (globalSearch) {
                        globalSearch.value = '';
                        clearSearchBtn.style.opacity = '0';
                    }
                });
            }

            // My Trips Filters & Search
            const tripStatusFilter = document.getElementById('tripStatusFilter');
            const tripSearchInput = document.getElementById('tripSearchInput');

            if (tripStatusFilter) {
                tripStatusFilter.addEventListener('change', () => this.applyTripFilters());
            }

            if (tripSearchInput) {
                tripSearchInput.addEventListener('input', () => this.applyTripFilters());
            }

            // Modal functionality
            const modalClose = document.querySelector('.modal-close');
            if (modalClose) {
                modalClose.addEventListener('click', () => this.closeModal());
            }

            // Modal tabs
            const modalTabs = document.querySelectorAll('.modal-tab');
            modalTabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    const tabId = tab.dataset.tab;
                    this.switchModalTab(tabId);
                });
            });

            // Quick create button
            const quickCreateBtn = document.getElementById('quickCreateBtn');
            if (quickCreateBtn) {
                quickCreateBtn.addEventListener('click', () => {
                    window.location.href = 'create-trip.html';
                });
            }

            // Dashboard preview tilt effect (Landing Page)
            const dashboardPreview = document.querySelector('.dashboard-preview');
            if (dashboardPreview) {
                let ticking = false;
                dashboardPreview.addEventListener('mousemove', (e) => {
                    if (!ticking) {
                        window.requestAnimationFrame(() => {
                            const rect = dashboardPreview.getBoundingClientRect();
                            const x = e.clientX - rect.left;
                            const y = e.clientY - rect.top;

                            const centerX = rect.width / 2;
                            const centerY = rect.height / 2;

                            const rotateY = (x - centerX) / 20;
                            const rotateX = (centerY - y) / 20;

                            dashboardPreview.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
                            ticking = false;
                        });
                        ticking = true;
                    }
                });

                dashboardPreview.addEventListener('mouseleave', () => {
                    dashboardPreview.style.transform = 'perspective(1000px) rotateX(0) rotateY(-5deg)';
                });
            }

            // CTA buttons
            document.querySelectorAll('.cta-primary, .signup-btn, .login-btn').forEach(btn => {
                btn.addEventListener('mouseenter', function () {
                    this.style.transform = 'translateY(-2px)';
                });

                btn.addEventListener('mouseleave', function () {
                    this.style.transform = 'translateY(0)';
                });

                btn.addEventListener('click', function (e) {
                    if (!this.href || this.href === '#') return;
                    this.classList.add('loading');
                    setTimeout(() => {
                        this.classList.remove('loading');
                    }, 1500);
                });
            });

            // Feature cards interaction
            document.querySelectorAll('.feature').forEach(feature => {
                feature.addEventListener('click', function () {
                    this.style.transform = 'translateY(-8px) scale(1.02)';
                    setTimeout(() => {
                        this.style.transform = 'translateY(-8px)';
                    }, 150);
                });
            });

            // Metric cards interaction (Dashboard)
            document.querySelectorAll('.metric-card').forEach(card => {
                card.addEventListener('click', function () {
                    // In a real app, you would show actual breakdown or expand the card
                });
            });

            // Keyboard shortcuts
            document.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                    e.preventDefault();
                    if (globalSearch) globalSearch.focus();
                }
                if (e.key === 'Escape') {
                    this.closeModal();
                    const notifDrop = document.getElementById('notificationsDropdown');
                    if (notifDrop) notifDrop.classList.remove('show');
                }
                if (e.key === 'F1') {
                    e.preventDefault();
                    this.openAITips();
                }
            });

            // Helper: Throttle
            const throttle = (func, limit) => {
                let inThrottle;
                return function () {
                    const args = arguments;
                    const context = this;
                    if (!inThrottle) {
                        func.apply(context, args);
                        inThrottle = true;
                        setTimeout(() => inThrottle = false, limit);
                    }
                }
            };

            // Helper: Debounce
            const debounce = (func, delay) => {
                let debounceTimer;
                return function () {
                    const context = this;
                    const args = arguments;
                    clearTimeout(debounceTimer);
                    debounceTimer = setTimeout(() => func.apply(context, args), delay);
                }
            };

            // Optimized Scroll Handler
            window.addEventListener('scroll', throttle(() => {
                if (typeof this.handleScroll === 'function') this.handleScroll();
                if (typeof this.highlightNavOnScroll === 'function') this.highlightNavOnScroll();
            }, 100), { passive: true });

            // Optimized Resize Handler
            window.addEventListener('resize', debounce(() => this.handleResize(), 200));

            // Smooth scrolling for anchor links
            document.querySelectorAll('a[href^="#"]').forEach(anchor => {
                anchor.addEventListener('click', function (e) {
                    const targetId = this.getAttribute('href');
                    if (targetId === '#' || targetId === '') return;
                    const targetElement = document.querySelector(targetId);
                    if (targetElement) {
                        e.preventDefault();
                        window.scrollTo({
                            top: targetElement.offsetTop - 80,
                            behavior: 'smooth'
                        });
                    }
                });
            });

            // Trip item click handlers
            document.querySelectorAll('.trip-item').forEach(trip => {
                trip.addEventListener('click', () => {
                    // In a real app, navigate to trip details or open trip modal
                });
            });

            // Chart interaction
            document.querySelectorAll('.chart-bar, .trend-bar').forEach(bar => {
                bar.addEventListener('mouseenter', function () {
                    const value = this.getAttribute('data-value') ||
                        this.textContent ||
                        this.style.height;
                    this.setAttribute('title', value);
                });
            });

            // Add CSS for loading state
            this.addLoadingStyles();
        }

        setupNavigation() {
            // Set initial view from URL hash or default
            const hash = window.location.hash.substring(1);
            if (hash && this.isDashboard) {
                this.showView(hash);
            }

            // Handle browser back/forward
            window.addEventListener('popstate', () => {
                if (this.isDashboard) {
                    const hash = window.location.hash.substring(1) || 'dashboard';
                    this.showView(hash);
                }
            });
        }


        setupAnimations() {
            // Intersection Observer for scroll animations - triggers EVERY TIME
            const observerOptions = {
                threshold: 0.1,
                rootMargin: '0px 0px -50px 0px'
            };

            const observer = new IntersectionObserver((entries) => {
                entries.forEach((entry, index) => {
                    if (entry.isIntersecting) {
                        // Animate in
                        setTimeout(() => {
                            entry.target.style.opacity = '1';
                            entry.target.style.transform = 'translateY(0)';
                        }, index * 100);
                    } else {
                        // Reset when out of view - allows re-animation
                        entry.target.style.opacity = '0';
                        entry.target.style.transform = 'translateY(20px)';
                    }
                });
            }, observerOptions);

            // Observe elements to animate
            const animatedElements = document.querySelectorAll('.feature, .step, .metric-card, .stat-card, .dashboard-card');
            animatedElements.forEach(el => {
                el.style.opacity = '0';
                el.style.transform = 'translateY(20px)';
                el.style.transition = 'all 0.5s ease';
                observer.observe(el); // Keeps observing - no unobserve
            });

            // Progress bar animations - also repeatable
            const progressBars = document.querySelectorAll('.progress');
            const progressObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        this.animateProgressBars();
                        // DON'T unobserve - keep animating on each view
                    } else {
                        // Reset progress bars when out of view
                        const bars = entry.target.querySelectorAll('.progress');
                        bars.forEach(bar => {
                            bar.style.width = '0%';
                        });
                    }
                });
            }, { threshold: 0.5 });

            progressBars.forEach(bar => {
                if (bar.parentElement) {
                    progressObserver.observe(bar.parentElement);
                }
            });
        }

        animateProgressBars() {
            const progressBars = document.querySelectorAll('.progress');
            progressBars.forEach(bar => {
                const width = bar.style.width;
                bar.style.width = '0%';

                setTimeout(() => {
                    bar.style.transition = 'width 1.5s ease';
                    bar.style.width = width;
                }, 300);
            });
        }

        showView(viewName) {
            if (!this.isDashboard) return;

            const views = document.querySelectorAll('.view');
            const selectedView = document.getElementById(`${viewName}View`);

            if (!selectedView) return;

            // Hide all views
            views.forEach(view => view.classList.remove('active'));

            // Show selected view
            selectedView.classList.add('active');
            this.currentView = viewName;

            // Update URL
            history.pushState(null, null, `#${viewName}`);

            // Update page title
            this.updatePageTitle(viewName);

            // Load view-specific data
            this.loadViewData(viewName);
        }

        handleScroll() {
            const navbar = document.querySelector('.navbar');
            if (navbar) {
                if (window.scrollY > 50) {
                    navbar.classList.add('scrolled');
                } else {
                    navbar.classList.remove('scrolled');
                }
            }
        }

        highlightNavOnScroll() {
            if (this.isDashboard) return;

            const sections = document.querySelectorAll('section');
            const navLinks = document.querySelectorAll('.nav-menu a');

            let current = '';

            sections.forEach(section => {
                const sectionTop = section.offsetTop;
                if (window.scrollY >= sectionTop - 150) {
                    current = section.getAttribute('id');
                }
            });

            navLinks.forEach(link => {
                link.classList.remove('active');
                if (link.getAttribute('href').includes(current)) {
                    link.classList.add('active');
                }
            });
        }

        updatePageTitle(view) {
            const pageTitle = document.getElementById('currentPageTitle');
            const pageSubtitle = document.getElementById('currentPageSubtitle');

            const titles = {
                dashboard: {
                    title: 'Dashboard',
                    subtitle: 'Welcome back! Manage your travel expenses efficiently'
                },
                trips: {
                    title: 'My Trips',
                    subtitle: 'Manage all your travel plans and upcoming journeys'
                },
                expenses: {
                    title: 'Expenses',
                    subtitle: 'Track and manage all your travel expenses'
                },
                analytics: {
                    title: 'Analytics',
                    subtitle: 'Get insights about your travel patterns and spending'
                },
                reports: {
                    title: 'Reports',
                    subtitle: 'Generate detailed travel expense reports'
                }
            };

            if (pageTitle && pageSubtitle) {
                const titleData = titles[view] || titles.dashboard;
                pageTitle.textContent = titleData.title;
                pageSubtitle.textContent = titleData.subtitle;
            }
        }

        updateActiveNav(activeLink) {
            const navLinks = document.querySelectorAll('.nav-link');
            navLinks.forEach(link => {
                link.classList.remove('active');
                if (link === activeLink) {
                    link.classList.add('active');
                }
            });
        }

        async loadInitialData() {
            if (this.isDashboard) {
                this.updateDashboardData();
                this.updateGreeting();

                // Load real data in parallel - fail-safe
                await Promise.allSettled([
                    this.loadAnalyticsData(),
                    this.loadTripsData(),
                    this.loadExpensesData(),
                    this.loadAITips()
                ]);

                this.startHeroSlideshow();
                await this.autoSwitchCurrencyContext();
            }
        }

        updateDashboardData() {
            const now = new Date();
            const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            // Get user data
            const user = JSON.parse(localStorage.getItem('user') || '{}');
            const name = user.name ? user.name.split(' ')[0] : 'Traveler';

            // Update greeting
            const greeting = this.getGreeting();
            const greetingElement = document.getElementById('greeting');
            const timeElement = document.getElementById('heroTime');

            if (greetingElement) {
                greetingElement.textContent = `${greeting}, ${name}`;
            }

            if (timeElement) {
                timeElement.textContent = timeString;
            }

            // Update charts with animation
            this.updateChartData();

            // Update stats if needed
            this.updateRealTimeStats();
        }

        getGreeting() {
            const hour = new Date().getHours();
            if (hour < 12) return 'Good morning';
            if (hour < 18) return 'Good afternoon';
            return 'Good evening';
        }

        updateGreeting() {
            const now = new Date();
            const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            let greeting = this.getGreeting();
            const user = JSON.parse(localStorage.getItem('user') || '{}');
            const name = user.name ? user.name.split(' ')[0] : 'Traveler';

            // Update main dashboard greeting
            const greetingElement = document.getElementById('greeting');
            const timeElement = document.getElementById('heroTime');

            if (greetingElement) {
                greetingElement.textContent = `${greeting}, ${name}`;
            }

            if (timeElement) {
                timeElement.textContent = timeString;
            }

            // Sync Sidebar Info (Original Sidebar Layout)
            document.querySelectorAll('.user-name').forEach(el => el.textContent = user.name || 'Traveler');
            document.querySelectorAll('.user-email').forEach(el => el.textContent = user.email || 'user@intellitrip.com');

            const dashboardAvatar = document.getElementById('dashboardAvatar');
            if (dashboardAvatar && user.profile_picture) {
                dashboardAvatar.src = this.getImageUrl(user.profile_picture);
            }

        }

        updateChartData() {
            // Update expense chart bars with animation
            const bars = document.querySelectorAll('.chart-bar, .trend-bar');
            bars.forEach(bar => {
                const currentHeight = bar.style.height;
                bar.style.height = '0%';

                setTimeout(() => {
                    bar.style.height = currentHeight;
                }, 300);
            });
        }

        startHeroSlideshow() {
            if (!this.isDashboard) return;

            const slides = document.querySelectorAll('.hero-slide');
            if (slides.length === 0) return;

            let currentSlide = 0;
            setInterval(() => {
                slides[currentSlide].classList.remove('active');
                currentSlide = (currentSlide + 1) % slides.length;
                slides[currentSlide].classList.add('active');
            }, 4000); // Change every 4 seconds
        }

        async updateRealTimeStats() {
            try {
                if (window.currencyService) await window.currencyService.getRates();
                const token = localStorage.getItem('token');
                if (!token) return;

                const res = await fetch('/api/dashboard', {
                    headers: { 'Authorization': token }
                });

                if (!res.ok) throw new Error('Failed to fetch stats');

                const data = await res.json();
                const stats = data.stats;
                const notifications = stats ? stats.notifications : [];

                // Update Stats Cards
                if (stats) {
                    this.animateValue(document.querySelector('[data-stat="trips"]'), stats.trips || 0);

                    const spentEl = document.querySelector('[data-stat="spent"]');
                    if (spentEl) this.setCurrencyEl(spentEl, stats.spent || 0);

                    const savingsEl = document.querySelector('[data-stat="savings"]');
                    if (savingsEl) this.setCurrencyEl(savingsEl, stats.savings || 0);
                }

                const notiBadge = document.getElementById('navNotificationCount');
                if (notiBadge) {
                    const count = notifications ? notifications.length : 0;
                    notiBadge.textContent = count;
                    notiBadge.style.display = count > 0 ? 'inline-flex' : 'none';
                }

                // Populate Notifications Dropdown
                if (notifications) {
                    this.renderNotifications(notifications);
                }

                // Fetch and render recent activity if container exists
                if (data.activity && document.getElementById('activityList')) {
                    this.renderRecentActivity(data.activity);
                }

                // Render Upcoming Trips
                if (data.upcoming && document.getElementById('upcomingTripsList')) {
                    this.renderUpcomingTrips(data.upcoming);
                }

                // Update Expenses View Summary ONLY if not currently viewing expenses
                // (The expenses view has its own filtered calculation that shouldn't be overwritten)
                if (this.currentView !== 'expenses') {
                    const expTotal = document.getElementById('expSummaryTotal');
                    if (expTotal) this.setCurrencyEl(expTotal, stats.spent);

                    const expMonth = document.getElementById('expSummaryMonth');
                    if (expMonth) this.setCurrencyEl(expMonth, stats.expensesThisMonth);

                    const expAvg = document.getElementById('expSummaryAvg');
                    if (expAvg) this.setCurrencyEl(expAvg, stats.avgDailySpend);
                }

                // Update Analytics View Cards
                const anTotal = document.getElementById('analyticsTotalSpent');
                if (anTotal) this.setCurrencyEl(anTotal, stats.spent);

                const anDays = document.getElementById('analyticsTravelDays');
                if (anDays) anDays.textContent = stats.travelDays || 0;

                const anAvg = document.getElementById('analyticsAvgDaily');
                if (anAvg) this.setCurrencyEl(anAvg, stats.avgDailySpend);

                const anDest = document.getElementById('analyticsDestinations');
                if (anDest) anDest.textContent = `${stats.uniqueDestinations} places`;

                // Render Charts (if container exists)
                if (data.categories && (document.querySelector('.charts-grid') || document.getElementById('expenseChart'))) {
                    this.renderCharts(data);
                }

                // Update Hero Trip Count & Grammar with Explicit Destinations
                const allTrips = data.upcoming || [];
                const now = new Date();

                const ongoingTrips = allTrips.filter(t => {
                    const start = new Date(t.start_date); start.setHours(0, 0, 0, 0);
                    const end = new Date(t.end_date); end.setHours(23, 59, 59, 999);
                    return now >= start && now <= end;
                });

                const futureTrips = allTrips.filter(t => {
                    const start = new Date(t.start_date); start.setHours(0, 0, 0, 0);
                    return now < start;
                });

                const heroMsgEl = document.getElementById('heroMessage');
                if (heroMsgEl) {
                    let message = '';
                    const style = 'color:white; font-weight:800;';
                    const toTitleCase = (str) => {
                        return str.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
                    };

                    if (ongoingTrips.length > 0) {
                        // Only show the FIRST ongoing trip as primary
                        const trip = ongoingTrips[0];
                        const firstLoc = trip.destination.includes(' → ') ? trip.destination.split(' → ')[0] : trip.destination;
                        const name = toTitleCase(firstLoc);
                        const others = ongoingTrips.length - 1;
                        message = `Enjoying <b style="color:#B8E7ED;">${name}</b>!${others > 0 ? ` (+${others} more)` : ''} <span style="${style}">${ongoingTrips.length}</span> ongoing trip${ongoingTrips.length === 1 ? '' : 's'}.`;
                    } else if (futureTrips.length > 0) {
                        const trip = futureTrips[0];
                        const firstLoc = trip.destination.includes(' → ') ? trip.destination.split(' → ')[0] : trip.destination;
                        const name = toTitleCase(firstLoc);
                        const others = futureTrips.length - 1;
                        message = `Next up: <b style="color:#B8E7ED;">${name}</b>!${others > 0 ? ` (+${others} more)` : ''} <span style="${style}">${futureTrips.length}</span> upcoming trip${futureTrips.length === 1 ? '' : 's'}.`;
                    } else {
                        message = `Ready for an adventure? Plan your next trip.`;
                    }
                    heroMsgEl.innerHTML = message;
                }


                // Update Hero Status Message (Pills) - Isolated to prevent blocking
                try {
                    await this.updateHeroStatus(data.upcoming || []);
                } catch (pillErr) {
                    console.warn('Hero Pill Update Failed:', pillErr);
                }

                if (data.upcoming) {
                    data.upcoming.forEach(trip => {
                        const exists = this.allTrips && this.allTrips.some(t => t.id === trip.id);
                        if (!exists) {
                            if (!this.allTrips) this.allTrips = [];
                            this.allTrips.push(trip);
                        }
                    });
                }


                // Trigger Smart Logistics (Flights/Activities)
                this._triggerSmartLogisticsInternal();

            } catch (err) {
                console.error('Stats Update Error:', err);
                const heroEl = document.getElementById('heroMessage');
                if (heroEl) heroEl.textContent = `Error: ${err.message}`;
            }
        }

        async updateHeroStatus(trips) {
            if (!trips) return;

            const now = new Date();
            now.setHours(0, 0, 0, 0);

            const ongoing = trips.filter(t => {
                const start = new Date(t.start_date);
                const end = new Date(t.end_date);
                start.setHours(0, 0, 0, 0);
                end.setHours(23, 59, 59, 999);
                return start <= now && end >= now;
            });

            const upcoming = trips.filter(t => {
                const start = new Date(t.start_date);
                start.setHours(0, 0, 0, 0);
                return start > now;
            });

            const pillContainer = document.getElementById('heroStatusPill');
            if (!pillContainer) return;

            // "Remove all this" text and replace with sleek pill
            if (ongoing.length > 0) {
                const trip = ongoing[0];
                const [tripImg, weather] = await Promise.all([
                    this.getDestinationImage(trip.destination),
                    this.getDestinationWeather(trip.destination)
                ]);
                const titleDest = trip.destination.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                pillContainer.innerHTML = `
                <div class="hero-status-pill ongoing">
                    <img src="${tripImg}" class="pill-location-img" alt="${titleDest}">
                    <div class="pill-content">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span class="location-text">${titleDest}</span>
                            <span class="hero-badge ongoing">ONGOING</span>
                        </div>
                        <div style="font-size: 0.75rem; color: #0369A1; font-weight: 600; display: flex; align-items: center; gap: 4px; margin-top: 2px;">
                            <i class="fas fa-thermometer-half"></i> ${weather ? weather.temp : '--'}°C
                            ${weather ? `<span style="opacity: 0.8; font-weight: 400;">&bull; ${weather.main}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
            } else if (upcoming.length > 0) {
                const trip = upcoming[0];
                const start = new Date(trip.start_date);
                const days = Math.ceil((start - new Date()) / (1000 * 60 * 60 * 24));
                const [tripImg, weather] = await Promise.all([
                    this.getDestinationImage(trip.destination),
                    this.getDestinationWeather(trip.destination)
                ]);
                const dayText = days === 1 ? 'Tomorrow' : `In ${days} days`;

                const titleDest = trip.destination.toLowerCase().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

                pillContainer.innerHTML = `
                <div class="hero-status-pill upcoming">
                    <img src="${tripImg}" class="pill-location-img" alt="${titleDest}">
                    <div class="pill-content">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span class="location-text">Next: ${titleDest}</span>
                            <span class="days-text">${dayText}</span>
                        </div>
                        <div style="font-size: 0.75rem; color: #0891B2; font-weight: 600; display: flex; align-items: center; gap: 4px; margin-top: 2px;">
                            <i class="fas fa-thermometer-half"></i> ${weather ? weather.temp : '--'}°C
                            ${weather ? `<span style="opacity: 0.8; font-weight: 400;">&bull; Forecast: ${weather.main}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
            } else {
                pillContainer.innerHTML = `
                <div class="hero-status-pill empty">
                    <span>✨ Start planning your next adventure</span>
                </div>
            `;
            }
        }

        renderNotifications(notifications) {
            const container = document.querySelector('.notifications-list');
            if (!container) return;

            // Store notifications for pagination
            this.currentNotifications = notifications || [];

            // Update notification badge count
            const unreadCount = this.currentNotifications.filter(n => !n.read).length;
            const badge = document.getElementById('navNotificationCount');
            if (badge) {
                badge.textContent = unreadCount;
                badge.style.display = unreadCount > 0 ? 'inline-flex' : 'none';
            }

            if (this.currentNotifications.length === 0) {
                container.innerHTML = '<div class="notification-item empty">No new notifications</div>';
                return;
            }

            // Render first 5
            this.renderNotificationItems(5);
        }

        renderNotificationItems(limit) {
            const container = document.querySelector('.notifications-list');
            if (!container) return;

            const visibleNotis = this.currentNotifications.slice(0, limit);

            const html = visibleNotis.map(n => {
                const notiDate = n.time ? new Date(n.time) : new Date();
                const timeAgo = this.formatRelativeTime(notiDate);

                let displayMessage = n.message || '';
                if (displayMessage.includes('undefined')) {
                    const tripMatch = displayMessage.match(/"([^"]+)"/);
                    displayMessage = tripMatch ? `A user has accepted your invitation to join "${tripMatch[1]}"` : displayMessage.replace('undefined', 'A user');
                }

                let icon = 'bell';
                if (n.type === 'invite') icon = 'user-plus';
                else if (n.type === 'alert') icon = 'exclamation-circle';
                else if (n.type === 'tips') icon = 'lightbulb';

                return `
            <div id="noti-${n.id}" class="custom-noti-row" style="padding: 1rem 1.25rem; border-bottom: 1px solid #f1f5f9; display: flex; align-items: flex-start; gap: 0.75rem; background: ${n.read ? '#ffffff' : '#f0faff'}; transition: background 0.2s; position: relative !important;">
                
                <!-- Content Section -->
                <div style="flex: 1; cursor: pointer; min-width: 0;" onclick="app.markNotificationAsRead('${n.id}')">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <h5 style="margin: 0; font-size: 0.95rem; font-weight: ${n.read ? '600' : '800'}; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${n.title}</h5>
                        <span style="font-size: 0.7rem; color: #94a3b8; font-weight: 500;">${timeAgo}</span>
                    </div>
                    <p style="margin: 0; font-size: 0.85rem; color: #475569; line-height: 1.4;">${displayMessage}</p>
                    
                    ${n.type === 'invite' ? `
                        <div style="margin-top: 10px; display: flex; gap: 10px;">
                            <button onclick="event.stopPropagation(); app.respondToInvite(${n.tripId}, 'accepted')" style="padding: 5px 12px; background: #0b3b5b; color: white; border: none; border-radius: 6px; font-size: 0.75rem; cursor: pointer; font-weight: 600;">Accept</button>
                            <button onclick="event.stopPropagation(); app.respondToInvite(${n.tripId}, 'rejected')" style="padding: 5px 12px; background: #f1f5f9; color: #64748b; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.75rem; cursor: pointer; font-weight: 600;">Decline</button>
                        </div>
                    ` : ''}
                </div>

                <!-- Delete Icon (Far Right) -->
                <div style="flex-shrink: 0; width: 32px; display: flex; justify-content: flex-end;">
                     <button class="app-trash-btn" onclick="event.stopPropagation(); app.deleteNotification('${n.id}')" title="Delete" style="width: 32px; height: 32px; background: transparent; border: none; color: #cbd5e1; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; border-radius: 6px;">
                        <i class="fas fa-trash-alt" style="font-size: 0.95rem; position: static !important; display: inline-block !important;"></i>
                     </button>
                </div>
            </div>
            <style>
                .custom-noti-row:hover .app-trash-btn { color: #94a3b8; }
                .app-trash-btn:hover { background: #fee2e2 !important; color: #ef4444 !important; }
            </style>
            `;
            }).join('');

            container.innerHTML = html;

            // Show More Button
            if (this.currentNotifications.length > limit) {
                const remaining = this.currentNotifications.length - limit;
                const btnDiv = document.createElement('div');
                btnDiv.className = 'text-center mt-2 pb-2';
                btnDiv.innerHTML = `<button onclick="app.renderNotificationItems(${this.currentNotifications.length})" style="background: none; border: none; color: #0b3b5b; font-weight: 600; font-size: 0.9rem; cursor: pointer; padding: 1rem;">Show ${remaining} More</button>`;
                container.appendChild(btnDiv);
            }
        }

        // Notification Logic - Dynamic State Management
        async markNotificationAsRead(id) {
            try {
                // Optimistic UI Update
                const notiIndex = this.currentNotifications.findIndex(n => n.id == id);
                if (notiIndex > -1) {
                    this.currentNotifications[notiIndex].read = true;

                    // Call backend to persist read status
                    const token = localStorage.getItem('token');
                    if (token && !isNaN(id)) {
                        // Assuming endpoint exists or create it
                        fetch(`/api/notifications/${id}/read`, {
                            method: 'PUT',
                            headers: { 'Authorization': token }
                        }).catch(e => console.error('Sync read status failed', e));
                    }

                    // Update Badge
                    this.updateNotificationBadge();

                    // Update DOM directly for instant feedback
                    const item = document.getElementById(`noti-${id}`);
                    if (item) {
                        item.classList.remove('unread');
                        item.classList.add('read');
                        const dot = item.querySelector('.unread-dot');
                        if (dot) dot.remove();
                        const checkBtn = item.querySelector('button[title="Mark as read"]');
                        if (checkBtn) checkBtn.remove();
                    }
                }
            } catch (err) {
                console.error(err);
            }
        }

        async deleteNotification(id) {
            try {
                const token = localStorage.getItem('token');

                // Call backend API to permanently delete from database
                if (id) {
                    await fetch(`/api/notifications/${id}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': token }
                    });
                }

                // Remove from local state
                this.currentNotifications = this.currentNotifications.filter(n => n.id != id);

                // Update Badge
                this.updateNotificationBadge();

                // Re-render list to reflect removal
                const showMoreBtn = document.querySelector('.notifications-list .btn-link');
                const limit = showMoreBtn ? 5 : this.currentNotifications.length;
                this.renderNotificationItems(limit);

                this.showToast('Notification deleted', 'success');
            } catch (err) {
                console.error(err);
                this.showToast('Failed to delete notification', 'error');
            }
        }

        updateNotificationBadge() {
            const unreadCount = (this.currentNotifications || []).filter(n => !n.read).length;
            const badge = document.getElementById('navNotificationCount');
            if (badge) {
                badge.textContent = unreadCount;
                badge.style.display = unreadCount > 0 ? 'inline-flex' : 'none';
            }
        }

        renderRecentActivity(activities) {
            const container = document.getElementById('activityList');
            if (!container) return;

            if (activities.length === 0) {
                container.innerHTML = '<p class="text-muted text-center py-3">No recent activity</p>';
                return;
            }

            container.innerHTML = activities.map(act => `
            <div class="activity-item">
                <div class="activity-icon ${act.type === 'trip' ? 'bg-primary' : 'bg-success'}">
                    <i class="fas ${act.type === 'trip' ? 'fa-suitcase' : 'fa-receipt'}"></i>
                </div>
                <div class="activity-details">
                    <h4 class="activity-title">${act.title}</h4>
                    <p class="activity-meta">${act.description.charAt(0).toUpperCase() + act.description.slice(1)} &bull; ${new Date(act.date).toLocaleDateString()}</p>
                </div>
                <div class="activity-amount ${act.type === 'trip' ? '' : 'negative'}">
                    ${act.type === 'trip' ? 'Budget: ' : '-'}${this.formatCurrency(act.amount)}
                </div>
            </div>
        `).join('');
        }

        renderCharts(data) {
            // Dashboard Charts
            try {
                // 1. Category Chart
                // 1. Category Chart
                const catChart = document.getElementById('categoryChart') || document.getElementById('expenseChart');
                if (catChart && Array.isArray(data.categories) && data.categories.length > 0) {

                    const validCats = data.categories.filter(c => c && c.total != null);
                    const total = validCats.reduce((acc, curr) => acc + parseFloat(curr.total), 0);

                    const barsHtml = validCats.slice(0, 5).map((cat, i) => {
                        const catTotal = parseFloat(cat.total) || 0;
                        const percent = total > 0 ? ((catTotal / total) * 100).toFixed(1) : 0;
                        // Use fixed heights relative to percentage for visualization
                        const height = Math.min(percent * 2.5, 90);
                        const colors = ['#1e293b', '#334155', '#2563eb', '#60a5fa', '#bfdbfe'];
                        const catName = cat.category || 'Uncategorized';

                        return `<div class="chart-bar" style="height: ${height}%; background: ${colors[i % 5]};" 
                        title="${catName}: ${this.formatCurrency(catTotal)} (${percent}%)"></div>`;
                    }).join('');

                    const labelsHtml = validCats.slice(0, 5).map(cat =>
                        `<span>${cat.category || 'Other'}</span>`
                    ).join('');

                    catChart.innerHTML = `
                <div class="simple-chart">${barsHtml}</div>
                <div class="chart-labels">${labelsHtml}</div>
            `;
                }

                // 2. Trend Chart
                const trendChart = document.getElementById('trendChart');
                if (trendChart && Array.isArray(data.trend) && data.trend.length > 0) {
                    const validTrends = data.trend.filter(t => t && t.total != null);
                    const max = Math.max(...validTrends.map(t => parseFloat(t.total) || 0));

                    const pointsHtml = validTrends.map((t, i) => {
                        const val = parseFloat(t.total) || 0;
                        const percent = max > 0 ? (val / max) * 80 : 0; // max 80% height
                        const left = (i / (validTrends.length - 1 || 1)) * 95; // spread across width

                        return `<div class="trend-point" style="left: ${left}%; bottom: ${percent}%;" 
                        data-value="${this.formatCurrency(val)}" title="${t.month}: ${this.formatCurrency(val)}"></div>`;
                    }).join('');

                    trendChart.innerHTML = `<div class="trend-line">${pointsHtml}</div>`;
                }
            } catch (err) {
                console.error('Error rendering charts:', err);
            }
        }
        animateValue(obj, end, duration = 1000) {
            if (!obj) return;
            let startTimestamp = null;
            const step = (timestamp) => {
                if (!startTimestamp) startTimestamp = timestamp;
                const progress = Math.min((timestamp - startTimestamp) / duration, 1);
                obj.innerHTML = Math.floor(progress * end);
                if (progress < 1) {
                    window.requestAnimationFrame(step);
                } else {
                    obj.innerHTML = end;
                }
            };
            window.requestAnimationFrame(step);
        }

        // --- Currency Converter (Exchange Hub) ---

        async openCurrencyConverter() {
            const modal = document.getElementById('currencyModal');
            if (!modal) return;

            modal.classList.add('show');

            const fromSelect = document.getElementById('convertFromCurrency');
            const toSelect = document.getElementById('convertToCurrency');

            if (fromSelect.options.length <= 1) {
                const currencies = window.currencyService.getAllCurrencies();
                const symbols = window.currencyService.getAllSymbols();

                [fromSelect, toSelect].forEach(select => {
                    select.innerHTML = '';
                    currencies.forEach(c => {
                        const opt = document.createElement('option');
                        opt.value = c.code;
                        opt.textContent = `${c.code} (${symbols[c.code] || ''})`;
                        select.appendChild(opt);
                    });
                });

                // Default selections
                const user = JSON.parse(localStorage.getItem('user') || '{}');
                fromSelect.value = 'INR';
                toSelect.value = user.preferred_currency || 'USD';

                // Add listeners
                [fromSelect, toSelect, document.getElementById('convertFromAmount')].forEach(el => {
                    el.addEventListener('input', () => this.updateConversion());
                });
            }

            this.updateConversion();
        }

        async updateConversion() {
            const amount = parseFloat(document.getElementById('convertFromAmount').value) || 0;
            const from = document.getElementById('convertFromCurrency').value;
            const to = document.getElementById('convertToCurrency').value;
            const resultInput = document.getElementById('convertToAmount');
            const infoBox = document.getElementById('exchangeRateInfo');

            if (!window.currencyService) return;

            const rates = await window.currencyService.getRates();

            // Logic: amount * (rates[to] / rates[from])
            // Since our rates are based on INR (baseCurrency), we can convert it.
            // convert amount to INR first, then to 'to'
            const inINR = from === 'INR' ? amount : (amount / rates[from]);
            const final = to === 'INR' ? inINR : (inINR * rates[to]);

            resultInput.value = final.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

            const rateForOne = to === 'INR' ? (1 / rates[from]) : (rates[to] / rates[from]);
            infoBox.innerHTML = `1 ${from} = ${rateForOne.toFixed(4)} ${to}`;
        }

        swapConverterCurrencies() {
            const fromSelect = document.getElementById('convertFromCurrency');
            const toSelect = document.getElementById('convertToCurrency');
            const temp = fromSelect.value;
            fromSelect.value = toSelect.value;
            toSelect.value = temp;

            this.updateConversion();
        }

        closeCurrencyConverter() {
            const modal = document.getElementById('currencyModal');
            if (modal) {
                modal.classList.remove('show');
            }
        }

        loadViewData(view) {
            switch (view) {
                case 'dashboard':
                    this.updateDashboardData();
                    break;
                case 'trips':
                    this.loadTripsData();
                    break;
                case 'expenses':
                    this.loadExpensesData();
                    break;
                case 'analytics':
                    this.loadAnalyticsData();
                    break;
                case 'reports':
                    this.loadReportsData();
                    break;
                case 'profile':
                    this.loadProfileViewData();
                    break;
            }
        }

        async fetchCoreData(force = false) {
            if (this.coreDataPromise && !force) return this.coreDataPromise;

            this.coreDataPromise = (async () => {
                const token = localStorage.getItem('token');
                if (!token) return { trips: [], expenses: [] };

                try {
                    const [tripsRes, expensesRes] = await Promise.all([
                        fetch('/api/trips', { headers: { 'Authorization': token } }),
                        fetch('/api/expenses', { headers: { 'Authorization': token } })
                    ]);

                    if (tripsRes.ok) this.allTrips = await tripsRes.json();
                    if (expensesRes.ok) this.allExpenses = await expensesRes.json();

                    return { trips: this.allTrips, expenses: this.allExpenses };
                } catch (e) {
                    console.error("Core data fetch failed", e);
                    throw e;
                }
            })();

            return this.coreDataPromise;
        }

        async loadTripsData() {
            const tripsGrid = document.getElementById('tripsGrid');
            if (!tripsGrid) return;

            // Prevent flickering: Only show loading if no data exists
            if (!this.allTrips || this.allTrips.length === 0) {
                tripsGrid.innerHTML = '<div class="loading-spinner"></div>';
            }

            try {
                await this.fetchCoreData();

                // Dashboard Widget Update
                const dashboardList = document.getElementById('upcomingTripsList');
                if (dashboardList) {
                    const now = new Date();
                    const upcoming = this.allTrips
                        .filter(t => new Date(t.end_date) >= now)
                        .sort((a, b) => new Date(a.start_date) - new Date(b.start_date))
                        .slice(0, 3);
                    await this.renderUpcomingTrips(upcoming);
                }

                // Collaborators handled via dedicated endpoint if needed
                this.allCollaborators = [];

                // Bind Filter Events
                const filterIds = ['tripStatusFilter', 'tripSearchInput'];
                filterIds.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) {
                        el.onchange = () => this.applyTripFilters();
                        el.oninput = () => this.applyTripFilters();
                    }
                });

                this.applyTripFilters();
            } catch (err) {
                console.error(err);
                tripsGrid.innerHTML = `<p style="color:red; text-align:center;">Failed to load trips. Please try again.</p>`;

                // Prevent dashboard hanging
                const dashboardList = document.getElementById('upcomingTripsList');
                if (dashboardList) dashboardList.innerHTML = `<p class="text-muted text-center py-3">Unavailable</p>`;
            }
        }

        async renderTrips(tripsToRender) {
            const tripsGrid = document.getElementById('tripsGrid');
            if (!tripsGrid) return;

            if (tripsToRender.length === 0) {
                tripsGrid.innerHTML = `
                <div class="empty-state-card" style="grid-column: 1/-1; padding: 5rem 2rem;">
                    <div style="width: 80px; height: 80px; background: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem; box-shadow: var(--shadow-sm);">
                        <i class="fas fa-suitcase-rolling" style="font-size: 2.5rem; color: var(--gray-300);"></i>
                    </div>
                    <h3 style="color: var(--navy-900); margin-bottom: 0.5rem; font-weight: 800; font-size: 1.5rem;">No trips found</h3>
                    <p style="color: var(--gray-500); margin-bottom: 2rem; max-width: 300px; margin-left: auto; margin-right: auto;">Try adjusting your filters or start fresh with a new adventure!</p>
                    <a href="create-trip.html" class="btn-primary" style="display: inline-flex; align-items: center; gap: 0.75rem; padding: 0.8rem 2rem; border-radius: 14px; font-weight: 700;">
                        <i class="fas fa-plus"></i> Create New Trip
                    </a>
                </div>
            `;
                return;
            }

            const tripCards = await Promise.all(tripsToRender.map(async trip => {
                const now = new Date();
                const start = new Date(trip.start_date); start.setHours(0, 0, 0, 0);
                const end = new Date(trip.end_date); end.setHours(23, 59, 59, 999);

                const isActive = now >= start && now <= end;

                let status = 'upcoming';
                if (now > end) status = 'completed';
                else if (isActive) status = 'ongoing';

                // Budget Calculation
                const tripExpenses = (this.allExpenses || []).filter(e => e.trip_id === trip.id);
                const spent = tripExpenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);
                const budget = parseFloat(trip.budget) || 0;
                const budgetPercent = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
                const budgetColor = budgetPercent > 90 ? 'var(--error)' : (budgetPercent > 70 ? 'var(--warning)' : 'var(--blue-600)');

                const options = { month: 'short', day: 'numeric' };
                const dateStr = `${start.toLocaleDateString('en-US', options)} - ${end.toLocaleDateString('en-US', options)}, ${start.getFullYear()}`;

                const [tripImg, weather] = await Promise.all([
                    this.getDestinationImage(trip.destination),
                    this.getDestinationWeather(trip.destination)
                ]);

                const totalDurationDays = parseInt(trip.total_days) || Math.ceil((end - start) / (1000 * 60 * 60 * 24)) || 1;
                const durationText = `${totalDurationDays} Day${totalDurationDays === 1 ? '' : 's'}`;

                const daysElapsed = parseInt(trip.days_elapsed) || (isActive ? Math.ceil((now - start) / (1000 * 60 * 60 * 24)) : 0);
                const journeyProgressPct = parseInt(trip.journey_progress_pct) || (isActive ? Math.min(100, Math.floor((daysElapsed / totalDurationDays) * 100)) : 0);

                return `
            <div class="trip-card-premium" id="trip-card-${trip.id}">
                <!-- Header -->
                <div class="trip-card-hero" style="background-image: url('${tripImg}')">
                    <div class="trip-card-badges">
                        <span class="trip-status-tag ${status}">${status}</span>
                        <div class="weather-badge" title="${weather ? (weather.description || weather.main) : 'Weather unavailable'}">
                            <i class="fas fa-thermometer-half" style="color: #2a8faa; font-size: 0.9rem;"></i>
                            <span>${weather ? weather.temp : '--'}°C</span>
                        </div>
                    </div>
                    <div class="trip-info" style="min-width: 0; width: 100%;">
                        <h3 style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; margin: 0;" title="${trip.destination}">${trip.destination}</h3>
                        <div class="trip-dates" style="font-size: 0.75rem; opacity: 0.9;">
                            <i class="fas fa-calendar-alt"></i> ${dateStr}
                        </div>
                    </div>
                </div>

                <!-- Body -->
                <div class="trip-card-body">
                    <div class="trip-stats-grid">
                        <div class="trip-stat-item">
                            <span class="trip-stat-label">Duration</span>
                            <span class="trip-stat-value">${durationText}</span>
                        </div>
                        <div class="trip-stat-item">
                            <span class="trip-stat-label">Travelers</span>
                            <span class="trip-stat-value">${trip.traveler_count || 1}</span>
                        </div>
                    </div>

                    ${status === 'ongoing' ? `
                    <div class="trip-progress-group">
                        <div class="progress-header">
                            <span class="progress-label">Journey Progress</span>
                            <span class="progress-pct">${journeyProgressPct}%</span>
                        </div>
                        <div class="progress-bar-premium">
                            <div class="progress-fill-premium" style="width: ${journeyProgressPct}%; background: var(--accent-gradient);"></div>
                        </div>
                        <div class="budget-details">
                            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Day ${daysElapsed}</span>
                            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: right;">${totalDurationDays} Days</span>
                        </div>
                    </div>
                    ` : ''}

                    <div class="trip-progress-group">
                        <div class="progress-header">
                            <span class="progress-label">Budget Spent</span>
                            <span class="progress-pct" style="color: ${budgetColor}">${budgetPercent.toFixed(0)}%</span>
                        </div>
                        <div class="progress-bar-premium">
                            <div class="progress-fill-premium" style="width: ${budgetPercent}%; background: ${budgetColor}"></div>
                        </div>
                        <div class="budget-details" style="gap: 5px;">
                            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 50%;">${this.formatCurrency(spent)}</span>
                            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 50%; text-align: right;">${this.formatCurrency(budget)}</span>
                        </div>
                    </div>
                </div>

                <!-- Footer -->
                <div class="trip-card-footer">
                    <div class="trip-card-actions">
                        <div id="tripActions-${trip.id}" style="display: flex; gap: 0.5rem;">
                            <button class="btn-card-action btn-add-expense" onclick="app.showAddExpenseModal(${trip.id})" title="Add Expense">
                                <i class="fas fa-plus"></i>
                            </button>
                            <button class="btn-card-action" onclick="window.openTripPlanner(${trip.id})" style="color: #6366f1; background: rgba(99, 102, 241, 0.1); border-color: rgba(99, 102, 241, 0.2);" title="AI Smart Plan">
                                <i class="fas fa-magic"></i>
                            </button>
                            <button class="btn-card-action btn-audit-trip" onclick="app.auditTrip(${trip.id})" style="color: #2a8faa; background: rgba(42, 143, 170, 0.1); border-color: rgba(42, 143, 170, 0.2);" title="AI Trip Audit">
                                <i class="fas fa-robot"></i>
                            </button>
                            <button class="btn-card-action btn-manage-trip" onclick="app.manageTrip(${trip.id})" title="Manage Trip">
                                <i class="fas fa-cog"></i>
                            </button>
                            <button class="btn-card-action btn-delete-trip" onclick="app.showTripDeleteConfirm(${trip.id})" title="Delete Trip">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </div>
                        <div id="tripConfirm-${trip.id}" style="display: none; gap: 0.3rem; align-items: center; padding: 0.2rem 0.5rem; background: #FEF2F2; border-radius: 10px; border: 1px solid #FEE2E2;">
                            <span style="font-size: 0.6rem; font-weight: 800; color: #DC2626; margin-right: 0.2rem;">SURE?</span>
                            <button onclick="app.deleteTrip(${trip.id})" style="background: #DC2626; color: white; border: none; padding: 0.25rem 0.5rem; border-radius: 6px; font-weight: 700; font-size: 0.6rem; cursor: pointer;">YES</button>
                            <button onclick="app.cancelTripDeleteConfirm(${trip.id})" style="background: white; color: #64748B; border: 1px solid #D1D5DB; padding: 0.25rem 0.5rem; border-radius: 6px; font-weight: 700; font-size: 0.6rem; cursor: pointer;">NO</button>
                        </div>
                    </div>
                    <div class="active-pills">
                        ${isActive ? '<span class="active-dot"></span>' : ''}
                        <span class="status-text">${isActive ? 'Active' : status}</span>
                    </div>
                </div>
            </div>
            `;
            }));

            tripsGrid.innerHTML = tripCards.join('');
        }

        applyTripFilters() {
            const statusFilter = document.getElementById('tripStatusFilter').value;
            const searchQuery = document.getElementById('tripSearchInput').value.toLowerCase();

            const filteredTrips = this.allTrips.filter(trip => {
                const now = new Date();
                const start = new Date(trip.start_date);
                const end = new Date(trip.end_date);
                const isActive = now >= start && now <= end;

                let status = 'upcoming';
                if (now > end) {
                    status = 'completed';
                } else if (isActive) {
                    status = 'ongoing';
                }

                const matchesStatus = statusFilter === 'all' || status === statusFilter;
                const matchesSearch = trip.destination.toLowerCase().includes(searchQuery);

                return matchesStatus && matchesSearch;
            });

            this.renderTrips(filteredTrips);
        }

        async loadExpensesData() {
            const grid = document.getElementById('expensesGrid');
            if (!grid) return;

            // Prevent flickering: If we have cached data, don't show loading message
            if (!this.allExpenses || this.allExpenses.length === 0) {
                grid.innerHTML = '<div style="grid-column: 1 / -1; text-align:center; padding: 3rem;"><div class="loading-spinner"></div><p style="margin-top:1rem; color:#64748b; font-weight:600;">Loading your expenses...</p></div>';
            }

            try {
                await this.fetchCoreData();
                const token = localStorage.getItem('token');

                // PROFESSIONAL UPGRADE: Parallel fetch all elements needed for status checks
                await Promise.all(this.allTrips.map(async t => {
                    try {
                        const r = await fetch(`/api/trips/${t.id}/members`, { headers: { 'Authorization': token } });
                        t.members = r.ok ? await r.json() : [];
                    } catch (e) { t.members = []; }
                }));

                // Populate Trip Filter Dropdown
                const tripFilter = document.getElementById('filterExpenseTrip');
                if (tripFilter) {
                    const currentSelection = tripFilter.value;

                    // Populate dynamic options
                    tripFilter.innerHTML = '<option value="all">All Trips</option>' +
                        this.allTrips.map(t => `<option value="${t.id}">${t.destination}</option>`).join('');

                    // Default logic: Keep "All Trips" selected on initial load to show all expenses
                    // Only preserve selection if user already made a choice
                    if (currentSelection && currentSelection !== '' && currentSelection !== 'all') {
                        // User previously selected a specific trip, preserve that selection
                        tripFilter.value = currentSelection;
                    } else {
                        // Default to "All Trips" to show all expenses
                        tripFilter.value = 'all';
                    }
                }

                // Bind Filter Events (Re-bind ensures they work after innerHTML change)
                ['filterExpenseSearch', 'filterExpenseCategory', 'filterExpenseTrip'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) {
                        el.onchange = () => this.applyExpenseFilters();
                        el.oninput = () => this.applyExpenseFilters();
                    }
                });

                // Initial render
                this.applyExpenseFilters();
                this.updateDebtIntelligence();

            } catch (err) {
                console.error('[loadExpensesData] Error:', err);
                // Only show failure banner if we failed to fetch data entirely
                if (!this.allExpenses) {
                    grid.innerHTML = '<div style="grid-column: 1 / -1; color:var(--error); text-align:center; padding: 2rem; background: #fff5f5; border-radius: 12px; font-weight: 600;">Failed to load expenses. Please check your connection.</div>';
                }
            }
        }

        applyExpenseFilters() {
            const categoryFilter = document.getElementById('filterExpenseCategory').value;
            const tripFilter = document.getElementById('filterExpenseTrip').value;
            const searchInput = document.getElementById('filterExpenseSearch');

            // Proactively refresh debt intelligence when trip filter changes
            this.updateDebtIntelligence();

            const searchQuery = searchInput ? searchInput.value.toLowerCase() : '';
            const statusFilter = document.getElementById('filterExpenseStatus') ? document.getElementById('filterExpenseStatus').value : 'all';

            if (!this.allExpenses) return;

            const filtered = this.allExpenses.filter(expense => {
                const matchesCategory = categoryFilter === 'all' || expense.category === categoryFilter;
                const matchesTrip = tripFilter === 'all' || (expense.trip_id && expense.trip_id.toString() === tripFilter);
                const matchesSearch = (expense.description || '').toLowerCase().includes(searchQuery) ||
                    (expense.amount || '').toString().includes(searchQuery);

                let matchesStatus = true;
                if (statusFilter !== 'all') {
                    const trip = this.allTrips ? this.allTrips.find(t => t.id == expense.trip_id) : null;
                    const members = (trip && trip.members) ? trip.members : [];
                    const reconstructedDetails = this.getReconstructedSplit(expense, members);
                    const splitUids = Object.keys(reconstructedDetails);
                    const _payerIdString = (expense.payer_id || '').toString();
                    const oweUids = splitUids.filter(id => id !== _payerIdString);
                    const settledUidsRaw = typeof expense.settled_uids === 'string' ? JSON.parse(expense.settled_uids || '[]') : (expense.settled_uids || []);
                    const settledUids = (settledUidsRaw || []).map(id => id.toString());

                    let isCleared = false;
                    if (expense.split_type === 'full') {
                        isCleared = true;
                    } else if (oweUids.length > 0) {
                        isCleared = oweUids.every(id => settledUids.includes(id));
                    } else if (oweUids.length === 0 && expense.split_type !== 'custom') {
                        isCleared = true;
                    }

                    if (statusFilter === 'cleared') {
                        matchesStatus = isCleared;
                    } else if (statusFilter === 'pending') {
                        matchesStatus = !isCleared;
                    }
                }

                return matchesCategory && matchesTrip && matchesSearch && matchesStatus;
            });

            this.renderExpenses(filtered);
        }

        renderExpenses(expenses) {
            const expensesGrid = document.getElementById('expensesGrid');
            if (!expensesGrid) return;

            if (expenses.length === 0) {
                expensesGrid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align:center; padding: 4rem 2rem; background: white; border-radius: 20px; border: 1px dashed #e2e8f0;">
                    <div style="width: 60px; height: 60px; background: var(--gray-50); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem; color: var(--gray-400);">
                        <i class="fas fa-search" style="font-size: 1.5rem;"></i>
                    </div>
                    <p style="color: var(--gray-600); font-weight: 600; font-size: 1.1rem; margin-bottom: 0.5rem;">No matching expenses found</p>
                    <p style="color: var(--gray-500); font-size: 0.9rem;">Try adjusting your filters or search terms</p>
                </div>
            `;
                // Zero out summary
                if (document.getElementById('expSummaryTotal')) this.setCurrencyEl(document.getElementById('expSummaryTotal'), 0);
                if (document.getElementById('expSummaryDays')) document.getElementById('expSummaryDays').textContent = '0 days';
                if (document.getElementById('expSummaryAvg')) this.setCurrencyEl(document.getElementById('expSummaryAvg'), 0);
                if (document.getElementById('expSummaryDest')) document.getElementById('expSummaryDest').textContent = '0 places';
                return;
            }

            expensesGrid.innerHTML = expenses.map(expense => {
                const splitText = expense.split_type === 'equal' ? 'Split Equally' :
                    expense.split_type === 'full' ? 'Paid Full' : 'Custom Split';

                // Find trip name
                // Find trip name
                const trip = this.allTrips ? this.allTrips.find(t => t.id == expense.trip_id) : null;
                const tripName = trip ? trip.destination : `Trip #${expense.trip_id}`;

                const currentUser = JSON.parse(localStorage.getItem('user'));
                const currentUserId = currentUser ? currentUser.id : null;

                // Ensure split_details and settled_uids are objects/arrays
                const splitDetails = typeof expense.split_details === 'string' ? JSON.parse(expense.split_details || '{}') : (expense.split_details || {});
                const settledUidsRaw = typeof expense.settled_uids === 'string' ? JSON.parse(expense.settled_uids || '[]') : (expense.settled_uids || []);
                const settledUids = (settledUidsRaw || []).map(id => id.toString());

                // FETCH TRIP MEMBERS for reconstruction (used as fallback for equal splits)
                const members = (trip && trip.members) ? trip.members : [];
                const reconstructedDetails = this.getReconstructedSplit(expense, members);
                const splitUids = Object.keys(reconstructedDetails);
                const _payerIdString = (expense.payer_id || '').toString();

                // isCleared: full = always cleared; else all non-payers must be in settled list
                const oweUids = splitUids.filter(id => id !== _payerIdString);

                let isCleared = false;
                if (expense.split_type === 'full') {
                    isCleared = true;
                } else if (oweUids.length > 0) {
                    isCleared = oweUids.every(id => settledUids.includes(id));
                } else if (oweUids.length === 0 && expense.split_type !== 'custom') {
                    isCleared = true;
                }

                const currentUserPic = currentUser ? this.getImageUrl(currentUser.profile_picture) : null;
                const payerPic = (expense.payer_id == currentUserId && currentUserPic) ? currentUserPic : (this.getImageUrl(expense.payer_profile_picture) || `https://ui-avatars.com/api/?name=${expense.payer_name || 'Member'}&background=e0f2fe&color=0369a1`);

                // --- ROBUST PAY BUTTON LOGIC (members-independent) ---
                // Compute current user's share directly from split_details or equal-split formula
                const currentUserIdStr = String(currentUserId);
                const payerIdString = (expense.payer_id || '').toString();
                const payerUpi = expense.payer_upi_id;

                // Helper: compute my share
                const computeMyShare = () => {
                    // Custom split — share is directly in split_details
                    if (expense.split_type === 'custom' || expense.split_type === 'equal') {
                        const keys = Object.keys(splitDetails);
                        if (keys.length > 0) {
                            return parseFloat(splitDetails[currentUserIdStr] || 0);
                        }
                    }
                    // Equal split fallback using member count from reconstructedDetails
                    const members = (trip && trip.members) ? trip.members : [];
                    if (members.length > 0) {
                        return parseFloat((parseFloat(expense.amount) / members.length).toFixed(2));
                    }
                    // Last resort: half
                    return parseFloat((parseFloat(expense.amount) / 2).toFixed(2));
                };

                const myShare = computeMyShare();

                // I owe if: I'm not the payer, AND I'm in split_details (or equal split), AND I haven't settled
                const iAmPayer = payerIdString === currentUserIdStr;
                const iAmInSplit = splitDetails && Object.keys(splitDetails).length > 0
                    ? currentUserIdStr in splitDetails
                    : !iAmPayer; // Equal split without details — everyone except payer owes
                const iHaveSettled = settledUids.includes(currentUserIdStr);
                const doIOwe = !iAmPayer && iAmInSplit && !iHaveSettled && myShare > 0;

                let payButtonHtml = '';
                if (doIOwe && payerUpi) {
                    const safePayerName = (expense.payer_name || '').replace(/'/g, "\\'");
                    const safePayerUpi = (payerUpi || '').replace(/'/g, "\\'");
                    payButtonHtml = `
                    <button onclick="event.stopPropagation(); app.openPaymentGateway(${expense.id}, '${currentUserIdStr}', ${myShare.toFixed(2)}, '${safePayerName}', '${safePayerUpi}')" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); border: none; padding: 0.5rem 0.85rem; color: white; cursor: pointer; font-weight: 700; font-size: 0.75rem; border-radius: 8px; display: flex; align-items: center; gap: 0.5rem; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow: 0 4px 12px rgba(16, 185, 129, 0.25); text-transform: uppercase; letter-spacing: 0.02em;" 
                    onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 8px 16px rgba(16, 185, 129, 0.35)'" 
                    onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(16, 185, 129, 0.25)'">
                        <i class="fas fa-wallet"></i> Pay Now (${this.formatCurrency(myShare)})
                    </button>`;
                } else if (doIOwe) {
                    // Payer has no UPI — show owe badge with tip to ask them to add UPI
                    payButtonHtml = `
                        <div style="display:flex; flex-direction:column; align-items:flex-end;">
                            <span style="font-size:0.6rem; color:#9a3412; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:2px;">You Owe</span>
                            <span style="font-size:0.75rem; color:#c2410c; font-weight:700; background:#fff7ed; padding:4px 10px; border-radius:6px; border:1px solid #ffedd5; display:flex; align-items:center; gap:4px;" title="Ask ${expense.payer_name || 'the payer'} to add their UPI ID in their profile">
                               <i class="fas fa-exclamation-circle" style="font-size:0.7rem;"></i> ${this.formatCurrency(myShare)}
                            </span>
                        </div>`;
                }


                return `
            <div class="expense-card" style="background: white; border-radius: 18px; padding: 1rem; box-shadow: 0 10px 30px rgba(0,0,0,0.04); border: 1px solid #f1f5f9; display: flex; flex-direction: column; gap: 0.85rem; transition: all 0.3s ease; position: relative; overflow: hidden; border-left: 4px solid ${isCleared ? '#10b981' : '#2a8faa'};">
                <!-- Header -->
                <div style="display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
                    <div style="display: flex; gap: 0.6rem; align-items: center; flex: 1; min-width: 0;">
                        <div style="background: #f8fafc; padding: 0.4rem; border-radius: 10px; display: flex; flex-direction: column; align-items: center; min-width: 42px; border: 1px solid #f1f5f9; flex-shrink: 0;">
                            <span style="font-size: 0.55rem; font-weight: 800; color: #94a3b8; text-transform: uppercase;">${new Date(expense.date).toLocaleDateString([], { month: 'short' })}</span>
                            <span style="font-size: 1rem; font-weight: 900; color: #0b3b5b; line-height: 1;">${new Date(expense.date).getDate()}</span>
                        </div>
                        <div style="display: flex; flex-direction: column; min-width: 0; flex: 1;">
                            <span style="font-size: 0.85rem; font-weight: 800; color: #0b3b5b; letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${tripName}">${tripName}</span>
                            <span style="font-size: 0.65rem; color: #94a3b8; font-weight: 600;">${new Date(expense.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                    </div>
                    <span class="category-badge ${expense.category || 'other'}" style="margin:0; padding: 0.35rem 0.6rem; border-radius: 8px; font-weight: 800; font-size: 0.6rem; letter-spacing: 0.02em; flex-shrink: 0; box-shadow: 0 4px 8px rgba(0,0,0,0.05);">${(expense.category || 'Other').toUpperCase()}</span>
                </div>

                <!-- Info -->
                <div style="display: flex; gap: 0.85rem; align-items: center;">
                    <div style="position: relative; flex-shrink: 0;">
                        ${expense.receipt_url ? `
                            <div style="width: 48px; height: 48px; border-radius: 14px; overflow: hidden; border: 2px solid white; box-shadow: 0 6px 15px rgba(0,0,0,0.1); cursor: pointer; transition: transform 0.2s;" onclick="app.viewReceipt('${this.getImageUrl(expense.receipt_url)}')">
                                <img src="${this.getImageUrl(expense.receipt_url)}" style="width: 100%; height: 100%; object-fit: cover;">
                            </div>
                        ` : `
                            <div style="width: 48px; height: 48px; background: linear-gradient(135deg, #f8fafc, #f1f5f9); border: 1.2px solid #e2e8f0; border-radius: 14px; display: flex; align-items: center; justify-content: center; color: #cbd5e1;">
                                <i class="fas fa-file-invoice-dollar" style="font-size: 1.2rem;"></i>
                            </div>
                        `}
                    </div>
                    <div style="flex: 1; min-width: 0;">
                        <h4 style="margin: 0 0 0.2rem 0; font-weight: 800; color: #0b3b5b; font-size: 1.05rem; letter-spacing: -0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${expense.description}">${expense.description}</h4>
                        <div style="font-size: 0.75rem; color: #64748b; font-weight: 600; display: flex; align-items: center; gap: 0.4rem;">
                            <img src="${payerPic}" style="width: 16px; height: 16px; border-radius: 50%; object-fit: cover;">
                            <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Paid by <strong style="color: #0b3b5b;">${expense.payer_id == currentUserId ? 'You' : (expense.payer_name || 'Member')}</strong></span>
                        </div>
                    </div>
                </div>

                <!-- Footer Summary -->
                <div style="background: #f8fafc; padding: 0.85rem; border-radius: 16px; border: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;">
                    <div style="min-width: 0; flex: 1;">
                        <div style="font-size: 0.6rem; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.1rem;">Amount</div>
                        <div style="font-weight: 900; color: #0b3b5b; font-size: 1.35rem; letter-spacing: -0.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${this.formatCurrency(expense.amount)}</div>
                    </div>
                    <div style="text-align: right; flex-shrink: 0;">
                        ${isCleared ? `
                            <div style="background: #10b981; color: white; font-size: 0.65rem; font-weight: 900; padding: 0.35rem 0.7rem; border-radius: 8px; display: inline-flex; align-items: center; gap: 0.3rem;">
                                <i class="fas fa-check-circle"></i> CLEARED
                            </div>
                        ` : `
                            <div style="background: white; color: #2a8faa; border: 1.5px solid #2a8faa; font-size: 0.65rem; font-weight: 900; padding: 0.3rem 0.6rem; border-radius: 8px; display: inline-flex; align-items: center; gap: 0.3rem;">
                                <i class="far fa-clock"></i> PENDING
                            </div>
                        `}
                    </div>
                </div>

                <!-- Footer Actions -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.2rem;">
                        <button onclick="app.viewSplitDetails(${expense.id})" style="background: #eefbff; border: none; padding: 0.45rem 0.75rem; color: #2a8faa; cursor: pointer; font-weight: 800; font-size: 0.7rem; border-radius: 8px; display: flex; align-items: center; gap: 0.4rem; transition: all 0.3s ease;">
                            <i class="fas fa-users-cog"></i> Split
                        </button>
                        ${payButtonHtml}
                    
                    <div style="display: flex; gap: 0.5rem;">
                        <div id="expActions-${expense.id}" style="display: flex; gap: 0.5rem;">
                            <button onclick="app.editExpense(${expense.id})" title="Edit Expense" style="background: white; color: #64748b; border: 1.2px solid #f1f5f9; width: 34px; height: 34px; border-radius: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 0.9rem;">
                                <i class="fas fa-pen-nib"></i>
                            </button>
                            <button onclick="app.showExpenseDeleteConfirm(${expense.id})" title="Delete Expense" style="background: #fff5f5; color: #ef4444; border: 1.2px solid #fff5f5; width: 34px; height: 34px; border-radius: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 0.9rem;">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </div>
                        <div id="expConfirm-${expense.id}" style="display: none; gap:0.3rem; align-items:center;">
                           <button onclick="app.deleteExpenseRow(${expense.id})" style="background:#dc2626; color:white; border:none; padding:4px 8px; border-radius:8px; font-size:0.7rem; font-weight:900;">YES</button>
                           <button onclick="app.cancelExpenseDeleteConfirm(${expense.id})" style="background:white; color:#64748b; border:1px solid #e2e8f0; padding:4px 8px; border-radius:8px; font-size:0.7rem; font-weight:900;">NO</button>
                        </div>
                    </div>
                </div>
            </div>
            </div>
            </div>`;
            }).join('');

            // Calculate and update summary cards
            const totalSpent = expenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);

            // Improved Average Daily Cost: Use trips in view (fix type comparison)
            const tripIdsInView = [...new Set(expenses.map(e => String(e.trip_id)))];
            const tripsInView = (this.allTrips || []).filter(t => tripIdsInView.includes(String(t.id)));

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            let totalTravelDays = tripsInView.reduce((sum, t) => {
                const start = new Date(t.start_date);
                const end = new Date(t.end_date);

                if (today >= start) {
                    // Trip has started or is in the past
                    const effectiveEnd = today < end ? today : end;
                    const diffTime = Math.abs(effectiveEnd - start);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                    return sum + (diffDays > 0 ? diffDays : 1);
                }
                // If trip is in the future, it contributes 0 days
                return sum;
            }, 0);

            // Fallback to unique expense dates if trips mapping fails
            if (totalTravelDays === 0) {
                totalTravelDays = new Set(expenses.map(e => e.date.split('T')[0])).size;
            }

            const avgDaily = totalTravelDays > 0 ? Math.round(totalSpent / totalTravelDays) : 0;
            const uniqueTrips = tripsInView.length;

            if (document.getElementById('expSummaryTotal')) this.setCurrencyEl(document.getElementById('expSummaryTotal'), totalSpent);
            if (document.getElementById('expSummaryDays')) document.getElementById('expSummaryDays').textContent = `${totalTravelDays} days`;
            if (document.getElementById('expSummaryAvg')) this.setCurrencyEl(document.getElementById('expSummaryAvg'), avgDaily);
            if (document.getElementById('expSummaryAvgDesc')) document.getElementById('expSummaryAvgDesc').textContent = `Across ${totalTravelDays} travel days`;
            if (document.getElementById('expSummaryDest')) document.getElementById('expSummaryDest').textContent = `${uniqueTrips} trip${uniqueTrips === 1 ? '' : 's'}`;
        }

        async loadAnalyticsData(range = 'all') {
            const token = localStorage.getItem('token');
            if (!token) return;

            // Ensure charts container exists
            if (!this.charts) this.charts = {};

            try {
                // Fetch fresh data
                await this.fetchCoreData();

                // Filter Logic
                const now = new Date();
                let filteredExpenses = this.allExpenses;

                if (range === '30') {
                    const limit = new Date(); limit.setDate(now.getDate() - 30);
                    filteredExpenses = this.allExpenses.filter(e => new Date(e.date) >= limit);
                } else if (range === '90') {
                    const limit = new Date(); limit.setDate(now.getDate() - 90);
                    filteredExpenses = this.allExpenses.filter(e => new Date(e.date) >= limit);
                } else if (range === '180') {
                    const limit = new Date(); limit.setDate(now.getDate() - 180);
                    filteredExpenses = this.allExpenses.filter(e => new Date(e.date) >= limit);
                } else if (range === 'year') {
                    const startOfYear = new Date(now.getFullYear(), 0, 1);
                    filteredExpenses = this.allExpenses.filter(e => new Date(e.date) >= startOfYear);
                }

                // --- Update Summary Cards ---
                const totalSpent = filteredExpenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);

                // Improved Travel Days: Sum of durations for trips that have started (fix type comparison)
                const tripIdsInRange = [...new Set(filteredExpenses.map(e => String(e.trip_id)))];
                const tripsInRange = (this.allTrips || []).filter(t => tripIdsInRange.includes(String(t.id)));

                const today = new Date();
                today.setHours(0, 0, 0, 0);

                let totalTravelDays = tripsInRange.reduce((sum, t) => {
                    const start = new Date(t.start_date);
                    const end = new Date(t.end_date);

                    if (today >= start) {
                        const effectiveEnd = today < end ? today : end;
                        const diffTime = Math.abs(effectiveEnd - start);
                        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                        return sum + (diffDays > 0 ? diffDays : 1);
                    }
                    return sum;
                }, 0);

                // Fallback
                if (totalTravelDays === 0) {
                    totalTravelDays = new Set(filteredExpenses.map(e => e.date.split('T')[0])).size;
                }

                const avgDaily = totalTravelDays > 0 ? Math.round(totalSpent / totalTravelDays) : 0;
                const uniqueTrips = tripsInRange.length;

                if (document.getElementById('analyticsTotalSpent'))
                    document.getElementById('analyticsTotalSpent').textContent = this.formatCurrency(totalSpent);

                if (document.getElementById('analyticsTravelDays'))
                    document.getElementById('analyticsTravelDays').textContent = `${totalTravelDays} days`;

                if (document.getElementById('analyticsAvgDaily'))
                    this.setCurrencyEl(document.getElementById('analyticsAvgDaily'), avgDaily);

                if (document.getElementById('analyticsAvgDailyDesc'))
                    document.getElementById('analyticsAvgDailyDesc').textContent = `Across ${totalTravelDays} travel days`;

                if (document.getElementById('analyticsDestinations'))
                    document.getElementById('analyticsDestinations').textContent = `${uniqueTrips} trips`;


                // --- Prepare Chart Data ---

                // 1. By Category
                const categoryTotals = {};
                filteredExpenses.forEach(e => {
                    const cat = e.category || 'other';
                    categoryTotals[cat] = (categoryTotals[cat] || 0) + parseFloat(e.amount);
                });

                // 2. By Month (Trend)
                const monthlyTotals = {};
                const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                months.forEach(m => monthlyTotals[m] = 0); // Init 0

                filteredExpenses.forEach(e => {
                    const d = new Date(e.date);
                    if (!isNaN(d)) {
                        const monthName = d.toLocaleString('default', { month: 'short' });
                        if (monthlyTotals[monthName] !== undefined) {
                            monthlyTotals[monthName] += parseFloat(e.amount);
                        }
                    }
                });

                const trendData = months.map(m => monthlyTotals[m]);


                // --- Render Charts ---
                if (categoryTotals && Object.keys(categoryTotals).length > 0) {
                    this.renderDetailedCharts(categoryTotals, months, trendData);
                } this.updateAIInsights(categoryTotals, totalSpent);

            } catch (e) {
                console.error('Analytics Loading Error:', e);
            }
        }

        renderDetailedCharts(categoryData, trendLabels, trendValues) {
            // Convert data to preferred currency first
            const userData = JSON.parse(localStorage.getItem('user') || '{}');
            const toCurrency = userData.preferred_currency || 'INR';
            let rate = 1;
            if (window.currencyService && window.currencyService.rates && toCurrency !== 'INR') {
                rate = window.currencyService.rates[toCurrency] || 1;
            }

            // Convert Category Data
            const convertedCategoryData = {};
            Object.keys(categoryData).forEach(k => {
                convertedCategoryData[k] = Math.round(categoryData[k] * rate);
            });

            // Convert Trend Data
            const convertedTrendValues = trendValues.map(v => Math.round(v * rate));
            // --- Professional Gradient Configuration ---
            const getGradient = (ctx, colorStart, colorEnd) => {
                const gradient = ctx.createLinearGradient(0, 0, 0, 400);
                gradient.addColorStop(0, colorStart);
                gradient.addColorStop(1, colorEnd);
                return gradient;
            };

            // 1. Doughnut Chart (Categories)
            const ctxCat = document.getElementById('categoryChartCanvas');
            if (ctxCat) {
                if (this.charts.category) this.charts.category.destroy();

                // Teal/Ocean Theme Palette
                const palette = [
                    ['#2A8FAA', '#0B3B5B'], // Ocean Blue
                    ['#4ecdc4', '#2980b9'], // Cyan to Blue
                    ['#ff6b6b', '#c0392b'], // Coral Red
                    ['#ffe66d', '#f1c40f'], // Yellow
                    ['#a8e6cf', '#16a085'], // Mint
                    ['#cbd5e1', '#64748b']  // Grey
                ];

                // Generate Gradients for Segments
                const catCtx = ctxCat.getContext('2d');
                const bgColors = Object.keys(convertedCategoryData).map((_, i) =>
                    getGradient(catCtx, palette[i % palette.length][0], palette[i % palette.length][1])
                );

                this.charts.category = new Chart(ctxCat, {
                    type: 'doughnut',
                    data: {
                        labels: Object.keys(convertedCategoryData).map(k => k.charAt(0).toUpperCase() + k.slice(1)),
                        datasets: [{
                            data: Object.values(convertedCategoryData),
                            backgroundColor: bgColors,
                            borderWidth: 0,
                            hoverOffset: 10
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        cutout: '75%', // Thinner ring for modern look
                        plugins: {
                            legend: {
                                position: 'right',
                                labels: {
                                    font: { family: 'Inter', size: 12, weight: '500' },
                                    usePointStyle: true,
                                    padding: 20
                                }
                            },
                            tooltip: {
                                backgroundColor: 'rgba(11, 59, 91, 0.9)',
                                padding: 12,
                                titleFont: { family: 'Inter', size: 13 },
                                bodyFont: { family: 'Inter', size: 13 },
                                cornerRadius: 8,
                                callbacks: {
                                    label: (context) => {
                                        const value = context.raw;
                                        const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                        const percentage = Math.round((value / total) * 100) + '%';
                                        return ` ${context.label}: ${this.getCurrencySymbol()}${value.toLocaleString()} (${percentage})`;
                                    }
                                }
                            }
                        },
                        layout: { padding: 20 }
                    }
                });
            }

            // 2. Trend Chart (Line Chart with Gradient Fill)
            const ctxTrend = document.getElementById('trendChartCanvas');
            if (ctxTrend) {
                if (this.charts.trend) this.charts.trend.destroy();

                const trendCtx = ctxTrend.getContext('2d');

                // Rich Gradient Fill
                const fillGradient = trendCtx.createLinearGradient(0, 0, 0, 300);
                fillGradient.addColorStop(0, 'rgba(42, 143, 170, 0.5)'); // Theme Teal
                fillGradient.addColorStop(1, 'rgba(42, 143, 170, 0.0)');

                // Stroke Gradient
                const strokeGradient = trendCtx.createLinearGradient(0, 0, 500, 0);
                strokeGradient.addColorStop(0, '#2A8FAA');
                strokeGradient.addColorStop(1, '#6dd5ed');

                this.charts.trend = new Chart(ctxTrend, {
                    type: 'line',
                    data: {
                        labels: trendLabels,
                        datasets: [{
                            label: 'Monthly Spending',
                            data: convertedTrendValues,
                            borderColor: strokeGradient,
                            backgroundColor: fillGradient,
                            borderWidth: 3,
                            pointBackgroundColor: '#ffffff',
                            pointBorderColor: '#2A8FAA',
                            pointBorderWidth: 2,
                            pointRadius: 4,
                            pointHoverRadius: 6,
                            fill: true,
                            tension: 0.4 // Smooth curves
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                backgroundColor: 'rgba(11, 59, 91, 0.9)',
                                padding: 12,
                                titleFont: { family: 'Inter', size: 13 },
                                bodyFont: { family: 'Inter', size: 13 },
                                displayColors: false,
                                callbacks: {
                                    label: (ctx) => ` Spending: ${this.getCurrencySymbol()}${ctx.raw.toLocaleString()}`
                                }
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                border: { display: false },
                                grid: { color: '#f1f5f9', drawBorder: false },
                                ticks: {
                                    font: { family: 'Inter', size: 11, weight: '500' },
                                    color: '#64748b',
                                    callback: (value) => this.getCurrencySymbol() + (value >= 1000 ? (value / 1000).toFixed(1) + 'k' : value)
                                }
                            },
                            x: {
                                border: { display: false },
                                grid: { display: false },
                                ticks: { font: { family: 'Inter', size: 11, weight: '500' }, color: '#64748b' }
                            }
                        },
                        interaction: {
                            mode: 'index',
                            intersect: false,
                        },
                    }
                });
            }
        }

        updateAIInsights(categoryData, total) {
            const container = document.querySelector('.insights-grid');
            if (!container) return;

            // 1. Spending Pattern Analysis
            let maxCat = '';
            let maxVal = 0;
            for (const [cat, val] of Object.entries(categoryData)) {
                if (val > maxVal) { maxVal = val; maxCat = cat; }
            }
            const percent = total > 0 ? ((maxVal / total) * 100).toFixed(0) : 0;

            let insightTitle = 'Spending Balanced';
            let insightMsg = "Your spending is well-distributed across categories.";
            let icon = "fa-check-circle";
            let color = "#10b981"; // Green

            if (percent > 40) {
                insightTitle = 'High Category Alert';
                icon = "fa-exclamation-circle";
                color = "#f59e0b"; // Orange
                if (maxCat === 'food') insightMsg = `Dining is consuming ${percent}% of your budget. Consider cooking or local street food.`;
                else if (maxCat === 'shopping') insightMsg = `Shopping reflects ${percent}% of expenses. Ensure meaningful souvenirs over impulse buys.`;
                else if (maxCat === 'transport') insightMsg = `Transport is ${percent}% of costs. Look for weekly passes or group discounts.`;
                else insightMsg = `${maxCat.charAt(0).toUpperCase() + maxCat.slice(1)} accounts for ${percent}% of your total spending.`;
            }

            // 2. Budget Health Analysis (Mocked logic using allTrips budget vs total spent)
            let budgetMsg = "You are within your estimated budget parameters.";
            let budgetTitle = "Budget On Track";
            let budgetIcon = "fa-piggy-bank";
            let budgetColor = "#2A8FAA"; // Theme Blue

            // Calculate global budget vs spent from loaded data
            let totalBudget = 0;
            if (this.allTrips) totalBudget = this.allTrips.reduce((sum, t) => sum + parseFloat(t.budget || 0), 0);

            if (totalBudget > 0) {
                const budgetUsed = (total / totalBudget) * 100;
                if (budgetUsed > 90) {
                    budgetTitle = "Budget Critical";
                    budgetMsg = `You have used ${budgetUsed.toFixed(0)}% of your total trip budget. Proceed with caution.`;
                    budgetColor = "#ef4444"; // Red
                    budgetIcon = "fa-chart-pie";
                } else if (budgetUsed < 50 && (this.allTrips && this.allTrips.some(t => new Date(t.end_date) < new Date()))) {
                    budgetTitle = "Under Budget";
                    budgetMsg = `Great job! You saved significant money on your completed trips.`;
                    budgetColor = "#10b981";
                }
            }

            container.innerHTML = `
            <div class="insight-card" style="border-left: 4px solid ${color};">
                <div class="insight-icon" style="background: ${color}20; color: ${color};">
                    <i class="fas ${icon}"></i>
                </div>
                <div class="insight-content">
                    <h4>${insightTitle}</h4>
                    <p style="color:#475569;">${insightMsg}</p>
                </div>
            </div>
             <div class="insight-card" style="border-left: 4px solid ${budgetColor};">
                <div class="insight-icon" style="background: ${budgetColor}20; color: ${budgetColor};">
                    <i class="fas ${budgetIcon}"></i>
                </div>
                <div class="insight-content">
                    <h4>${budgetTitle}</h4>
                    <p style="color:#475569;">${budgetMsg}</p>
                </div>
            </div>
        `;
        }


        // Create Trip
        // Create Trip
        async createTrip(tripData) {
            try {
                const token = localStorage.getItem('token');
                if (!token) {
                    this.showToast('Session expired. Please login again.', 'error');
                    setTimeout(() => window.location.href = 'login.html', 1500);
                    return;
                }

                // Combine trip name into notes since schema doesn't have a name column yet
                const notes = `Trip Name: ${tripData.name}`;

                // Convert budget to base currency (INR) before saving
                const baseBudget = await this.convertToBaseCurrency(tripData.budget);

                const response = await fetch('/api/trips', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': token
                    },
                    body: JSON.stringify({
                        destination: tripData.destination,
                        starting_point: tripData.starting_point,
                        start_date: tripData.startDate,
                        end_date: tripData.endDate,
                        budget: baseBudget,
                        collaborators: tripData.collaborators,
                        notes: notes,
                        travelers: tripData.travelers,
                        travel_style: tripData.travel_style
                    })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.msg || 'Failed to create trip');
                }

                this.showToast('Trip created successfully! Launching planner...', 'success');

                // Clear AI tips cache to force regeneration with new trip context
                localStorage.removeItem('cachedAITips');
                this.aiTips = null;

                // Auto-detect and set currency based on the new trip destination
                await this.detectAndSetTripCurrency(tripData.destination);

                // Force Refresh Data and Redirect
                await this.fetchCoreData(true);

                if (data && data.id) {
                    setTimeout(() => window.location.href = `planner.html?id=${data.id}`, 1000);
                } else {
                    setTimeout(() => window.location.href = 'dashboard.html#trips', 1000);
                }


            } catch (err) {
                console.error(err);
                this.showToast(err.message || 'Error creating trip', 'error');
            }
        }

        async showAddExpenseModal(tripId = null) {
            let trips = [];
            const token = localStorage.getItem('token');
            const user = JSON.parse(localStorage.getItem('user'));
            try {
                const res = await fetch('/api/trips', { headers: { 'Authorization': token } });
                if (res.ok) trips = await res.json();
            } catch (e) { console.error(e); }

            if (trips.length === 0) {
                this.showToast('Please create a trip first!', 'info');
                return;
            }

            const existing = document.getElementById('expenseModal');
            if (existing) existing.remove();

            const tripOptions = trips.map(t => `<option value="${t.id}" ${t.id == tripId ? 'selected' : ''}>${t.destination}</option>`).join('');

            const modalHTML = `
        <div id="expenseModal" style="display:flex; position:fixed; inset:0; z-index:99999; align-items:center; justify-content:center; background:rgba(0,0,0,0.6); backdrop-filter:blur(8px);">
            <div style="background:white; border-radius:20px; width:95%; max-width:400px; box-shadow:0 25px 70px rgba(0,0,0,0.3); overflow:visible; animation:modalSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1); max-height: 90vh; display: flex; flex-direction: column;">
                
                <!-- Themed Header -->
                <div style="padding:1rem 1.25rem; background: linear-gradient(135deg, #0B3B5B, #2A8FAA); border-radius: 20px 20px 0 0; display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid rgba(255,255,255,0.1);">
                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                        <div style="width:36px; height:36px; background:rgba(255,255,255,0.2); border-radius:10px; display:flex; align-items:center; justify-content:center; color:white; backdrop-filter: blur(4px);">
                            <i class="fas fa-receipt" style="font-size:1.1rem;"></i>
                        </div>
                        <h2 style="color:white; margin:0; font-size:1.1rem; font-weight:700; letter-spacing: 0.02em;">Add Expense</h2>
                    </div>
                    <button onclick="document.getElementById('expenseModal').remove()" style="background:rgba(255,255,255,0.15); border:none; color:white; width:32px; height:32px; border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center; transition: all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.15)'">
                        <i class="fas fa-times"></i>
                    </button>
                </div>

                <div style="padding:1.25rem; overflow-y: auto; flex: 1;">
                    <div style="display:flex; flex-direction:column; gap:1rem;">
                        
                        <!-- Compact Receipt & Trip Row + Camera Integration -->
                         <div style="display: grid; grid-template-columns: auto auto 1fr; gap: 0.75rem; align-items: center;">
                            <div id="receiptSection" style="width: 50px; height: 50px; border: 2px dashed #cbd5e1; border-radius: 12px; display:flex; align-items:center; justify-content:center; cursor:pointer; background:#f8fafc; overflow:hidden; position:relative; transition: border-color 0.2s;" onclick="document.getElementById('receiptInput').click()" title="Upload Receipt File">
                                <input type="file" id="receiptInput" hidden accept="image/*">
                                <input type="hidden" id="receiptUrl">
                                <i class="fas fa-folder-open" id="receiptIcon" style="color:#64748b; font-size:1.1rem;"></i>
                                <img id="previewImg" src="" style="width:100%; height:100%; object-fit:cover; display:none;">
                            </div>
                            
                             <div id="cameraSection" style="width: 50px; height: 50px; border: 2px solid #e2e8f0; border-radius: 12px; display:flex; align-items:center; justify-content:center; cursor:pointer; background:white; position:relative; transition: all 0.2s;" onclick="document.getElementById('cameraInput').click()" title="Take Photo with Camera">
                                <input type="file" id="cameraInput" hidden accept="image/*" capture="environment">
                                <i class="fas fa-camera" style="color:#0B3B5B; font-size:1.1rem;"></i>
                            </div>

                             <div style="min-width: 0;">
                                <label style="display:block; font-size:0.75rem; font-weight:600; color:#64748b; margin-bottom:0.25rem; text-transform: uppercase; letter-spacing: 0.05em;">Select Trip</label>
                                <select id="expenseTripId" style="width:100%; padding:0.6rem; border:1px solid #e2e8f0; border-radius:10px; font-size:0.9rem; background:white; outline:none; color: #0B3B5B; font-weight: 500;">${tripOptions}</select>
                            </div>
                        </div>
                        <div id="ocrStatus" style="font-size:0.8rem; color:#64748b; font-weight:600; display:none; padding:0.5rem; background:#f0f9ff; border:1px solid #e0f2fe; border-radius:8px;"></div>

                        <!-- Amount, Date & Time -->
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                            <div>
                                <label style="display:block; font-size:0.75rem; font-weight:600; color:#64748b; margin-bottom:0.25rem; text-transform: uppercase;">Amount</label>
                                <div style="position: relative;">
                                    <span style="position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%); color: #64748b; font-weight: 600;">${this.getCurrencySymbol()}</span>
                                    <input type="number" id="expenseAmount" style="width:100%; padding:0.75rem 0.75rem 0.75rem 1.8rem; border:1px solid #e2e8f0; border-radius:10px; font-size:1.1rem; font-weight: 700; color: #0B3B5B; background:white; outline:none;" placeholder="0.00">
                                </div>
                            </div>
                            <div>
                                <label style="display:block; font-size:0.75rem; font-weight:600; color:#64748b; margin-bottom:0.25rem; text-transform: uppercase;">Category</label>
                                <select id="expenseCategory" style="width:100%; padding:0.75rem; border:1px solid #e2e8f0; border-radius:10px; font-size:0.9rem; color: #0B3B5B; background:white; outline:none;">
                                    <option value="transport">Transport</option>
                                    <option value="accommodation">Accommodation</option>
                                    <option value="food">Food & Dining</option>
                                    <option value="activities">Activities</option>
                                    <option value="shopping">Shopping</option>
                                    <option value="other">Other</option>
                                </select>
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                            <div>
                                <label style="display:block; font-size:0.75rem; font-weight:600; color:#64748b; margin-bottom:0.25rem; text-transform: uppercase;">Date</label>
                                <input type="date" id="expenseDate" style="width:100%; padding:0.75rem; border:1px solid #e2e8f0; border-radius:10px; font-size:0.95rem; color: #0B3B5B; background:white; outline:none;" value="${new Date().toISOString().split('T')[0]}">
                            </div>
                            <div>
                                <label style="display:block; font-size:0.75rem; font-weight:600; color:#64748b; margin-bottom:0.25rem; text-transform: uppercase;">Time</label>
                                <input type="time" id="expenseTime" style="width:100%; padding:0.75rem; border:1px solid #e2e8f0; border-radius:10px; font-size:0.95rem; color: #0B3B5B; background:white; outline:none;" value="${new Date().getHours().toString().padStart(2, '0')}:${new Date().getMinutes().toString().padStart(2, '0')}">
                            </div>
                        </div>

                        <!-- Description -->
                        <div>
                            <label style="display:block; font-size:0.75rem; font-weight:600; color:#64748b; margin-bottom:0.25rem; text-transform: uppercase;">Description</label>
                            <input type="text" id="expenseDesc" style="width:100%; padding:0.75rem; border:1px solid #e2e8f0; border-radius:10px; font-size:0.9rem; color: #0B3B5B; background:white; outline:none;" placeholder="Lunch at Starbucks...">
                        </div>

                        <!-- Paid By Section -->
                        <div>
                            <label style="display:block; font-size:0.75rem; font-weight:600; color:#64748b; margin-bottom:0.25rem; text-transform: uppercase;">Paid By</label>
                            <select id="expensePayer" style="width:100%; padding:0.75rem; border:1px solid #e2e8f0; border-radius:10px; font-size:0.9rem; color: #0B3B5B; background:white; outline:none;">
                                <option value="${user.id}">You</option>
                            </select>
                        </div>

                        <!-- Split Settings (Revamped) -->
                        <div style="background:#f8fafc; padding:0.75rem; border-radius:12px; border: 1px solid #f1f5f9;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
                                <label style="font-size:0.75rem; font-weight:600; color:#64748b; text-transform: uppercase; letter-spacing: 0.05em;">Split Details</label>
                                <div style="display: flex; background: #e2e8f0; padding: 2px; border-radius: 8px;">
                                    <label style="cursor: pointer;">
                                        <input type="radio" name="splitType" value="equal" checked style="display: none;">
                                        <span class="split-type-label" style="display: block; padding: 4px 12px; border-radius: 6px; font-size: 0.75rem; font-weight: 700; color: #64748b; transition: all 0.2s;">Equal</span>
                                    </label>
                                    <label style="cursor: pointer;">
                                        <input type="radio" name="splitType" value="custom" style="display: none;">
                                        <span class="split-type-label" style="display: block; padding: 4px 12px; border-radius: 6px; font-size: 0.75rem; font-weight: 700; color: #64748b; transition: all 0.2s;">Custom</span>
                                    </label>
                                </div>
                            </div>
                            <div id="splitMembersContainer" style="max-height: 150px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem;">
                                <p style="font-size: 0.75rem; color: #94a3b8; text-align: center; margin: 0;">Loading members...</p>
                            </div>
                        </div>

                        <button id="saveExpenseBtn" style="width:100%; padding:0.9rem; background: linear-gradient(135deg, #0B3B5B, #2A8FAA); color:white; border:none; border-radius:12px; font-weight:600; font-size:1rem; letter-spacing: 0.02em; cursor:pointer; margin-top: 0.25rem; box-shadow: 0 4px 12px rgba(11, 59, 91, 0.2); transition: transform 0.2s;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">
                            Save Expense
                        </button>
                    </div>
                </div>
            </div>
            <style>
                #expenseModal input:focus, #expenseModal select:focus { border-color: #2A8FAA !important; box-shadow: 0 0 0 3px rgba(42, 143, 170, 0.1); }
                #receiptSection:hover { border-color: #2A8FAA !important; background: white !important; }
                input[name="splitType"]:checked + .split-type-label { background: white; color: #2A8FAA; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
                @keyframes modalSlideIn { from { opacity: 0; transform: translateY(15px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
            </style>
        </div>`;
            document.body.insertAdjacentHTML('beforeend', modalHTML);

            // Bind Events
            const receiptInput = document.getElementById('receiptInput');
            receiptInput.addEventListener('change', (e) => this.handleReceiptUpload(e));

            const cameraInput = document.getElementById('cameraInput');
            if (cameraInput) cameraInput.addEventListener('change', (e) => this.handleReceiptUpload(e));

            const tripSelect = document.getElementById('expenseTripId');
            tripSelect.addEventListener('change', () => this.updateSplitMembers());

            const splitTypeRadios = document.getElementsByName('splitType');
            splitTypeRadios.forEach(radio => {
                radio.addEventListener('change', () => this.updateSplitMembers());
            });

            // Update when amount changes to re-calculate equal splits
            document.getElementById('expenseAmount').addEventListener('input', () => {
                if (document.querySelector('input[name="splitType"]:checked').value === 'equal') {
                    this.updateSplitMembers();
                }
            });

            document.getElementById('saveExpenseBtn').onclick = () => this.submitExpense();
        }

        async handleReceiptUpload(event) {
            const file = event.target.files[0];
            if (!file) return;

            if (file.size > 30 * 1024 * 1024) {
                this.showToast('File too large (max 30MB)', 'error');
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                document.getElementById('receiptUrl').value = e.target.result;
                const img = document.getElementById('previewImg');
                img.src = e.target.result;
                img.style.display = 'block';
                document.getElementById('receiptIcon').style.display = 'none';
                document.getElementById('receiptSection').style.borderStyle = 'solid';
            };
            reader.readAsDataURL(file);

            // OCR Integration
            const statusEl = document.getElementById('ocrStatus');
            if (statusEl && window.Tesseract) {
                statusEl.style.display = 'block';
                statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Scanning receipt with OCR...';
                statusEl.style.color = '#0284c7';

                try {
                    const result = await Tesseract.recognize(file, 'eng');
                    const text = result.data.text;
                    console.log("OCR Extracted:", text);

                    // 1. Refined Amount Parsing
                    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                    let foundAmount = null;

                    let explicitTotals = [];
                    let allPrices = [];

                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i].toLowerCase();

                        // Break Tesseract OCR lines that might combine things
                        const combinedScan = line + " " + (lines[i + 1] ? lines[i + 1].toLowerCase() : "");

                        // Extract any reasonable currency string e.g. "41.29" or "41,29"
                        const matches = line.match(/\b\d{1,5}[.,]\d{2}\b/g);
                        if (!matches) continue;

                        for (const m of matches) {
                            const val = parseFloat(m.replace(',', '.'));
                            // Filter out completely irrational numbers
                            if (val <= 0 || val > 99999) continue;

                            // Prevent "Cash Given" or "Change Due" from artificially inflating the max check
                            if (line.includes('cash') || line.includes('change') || line.includes('tendered')) {
                                continue;
                            }

                            allPrices.push(val);

                            // If this line states Total (avoiding Subtotal or Sub Total)
                            if (combinedScan.includes('total') && !combinedScan.includes('sub')) {
                                explicitTotals.push(val);
                            }
                        }
                    }

                    // Smartest Selection: 
                    // Use the highest number associated with a explicitly labelled "Total"
                    // Or mathematically fallback to the highest valid price seen on the receipt.
                    if (explicitTotals.length > 0) {
                        foundAmount = Math.max(...explicitTotals);
                    } else if (allPrices.length > 0) {
                        foundAmount = Math.max(...allPrices);
                    }

                    // 2. Date
                    const dateRegex = /(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})|(\d{4}-\d{2}-\d{2})/;
                    const dateMatch = text.match(dateRegex);

                    // 3. Merchant / Description Name
                    let foundMerchant = null;
                    for (let i = 0; i < Math.min(8, lines.length); i++) {
                        // Strip numbers and special chars to evaluate if it's a real brand name
                        const alphaOnly = lines[i].replace(/[^a-zA-Z\s&]/g, '').trim();
                        const lower = alphaOnly.toLowerCase();

                        // Ignore basic utility lines at the top of receipts
                        if (alphaOnly.length > 4
                            && !lower.includes('receipt')
                            && !lower.includes('order')
                            && !lower.includes('date')
                            && !lower.includes('ticket')
                            && !lower.includes('guest')
                            && !lower.includes('host')
                            && !lower.includes('table')) {
                            // Keep actual original casing and symbols for the injection
                            foundMerchant = lines[i].replace(/[^\w\s&',.-]/g, '').trim();
                            break;
                        }
                    }

                    // Apply parsed values dynamically to fields
                    if (foundAmount) {
                        const amtEl = document.getElementById('expenseAmount');
                        if (amtEl) {
                            amtEl.value = foundAmount.toFixed(2);
                            amtEl.dispatchEvent(new Event('input'));
                        }
                    }

                    if (dateMatch) {
                        try {
                            const d = new Date(dateMatch[0]);
                            if (!isNaN(d.getTime())) {
                                document.getElementById('expenseDate').valueAsDate = d;
                            }
                        } catch (e) { }
                    }

                    if (foundMerchant) {
                        const descEl = document.getElementById('expenseDesc');
                        if (descEl) descEl.value = foundMerchant;
                    }

                    if (foundAmount || dateMatch || foundMerchant) {
                        statusEl.innerHTML = '<i class="fas fa-check-circle"></i> Extracted details!';
                        statusEl.style.color = '#059669';
                        setTimeout(() => statusEl.style.display = 'none', 4000);
                    } else {
                        statusEl.innerHTML = '<i class="fas fa-info-circle"></i> Partial scan. Please enter missing fields manually.';
                        statusEl.style.color = '#d97706';
                    }

                } catch (err) {
                    console.error("OCR Failed:", err);
                    statusEl.textContent = 'Scanner Error';
                    statusEl.style.color = '#64748b';
                }
            }
        }

        async updateSplitMembers() {
            const tripId = document.getElementById('expenseTripId').value;
            const container = document.getElementById('splitMembersContainer');
            const payerSelect = document.getElementById('expensePayer');
            const splitTypeRadio = document.querySelector('input[name="splitType"]:checked');
            const splitType = splitTypeRadio ? splitTypeRadio.value : 'equal';
            const totalAmount = parseFloat(document.getElementById('expenseAmount').value) || 0;

            if (!tripId) return;

            // 1. Fetch Members if needed (Cache by Trip ID)
            if (!this.currentTripMembers || this.currentTripId !== tripId) {
                try {
                    const token = localStorage.getItem('token');
                    const currentUser = JSON.parse(localStorage.getItem('user'));
                    container.innerHTML = '<p style="font-size: 0.75rem; color: #94a3b8; text-align: center; margin: 0;">Loading members...</p>';

                    const res = await fetch(`/api/trips/${tripId}/members`, {
                        headers: { 'Authorization': token }
                    });
                    if (!res.ok) throw new Error('Failed to fetch members');
                    this.currentTripMembers = await res.json();
                    this.currentTripId = tripId;

                    // Reset rendered ID to force re-render
                    if (container) container.dataset.renderedTripId = '';

                    // Update Payer Select
                    if (payerSelect) {
                        const currentPayer = payerSelect.value || currentUser.id;
                        payerSelect.innerHTML = this.currentTripMembers.map(m => `
                            <option value="${m.id}" ${m.id == currentPayer ? 'selected' : ''}>
                                ${m.name} ${m.id == currentUser.id ? '(You)' : ''}
                            </option>
                        `).join('');
                    }
                } catch (err) {
                    console.error(err);
                    if (container) container.innerHTML = '<p style="color:red; font-size:0.8rem;">Error loading members</p>';
                    return;
                }
            }

            // 2. Render Checkboxes (Only if not already rendered for this trip)
            // This prevents inputs loosing focus/state on every keystroke of Amount
            if (container && container.dataset.renderedTripId !== tripId && this.currentTripMembers) {
                const members = this.currentTripMembers;
                const currentUser = JSON.parse(localStorage.getItem('user'));

                // Smart Template with Clickable Row
                container.innerHTML = members.map(m => `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.35rem 0.5rem; border-radius: 8px; transition: background 0.2s; cursor: pointer; user-select: none;" 
                     class="split-row" onclick="this.querySelector('.split-checkbox').click()">
                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                         <input type="checkbox" class="split-checkbox" data-user-id="${m.id}" checked 
                                style="width: 18px; height: 18px; accent-color: #2A8FAA; cursor: pointer;" onclick="event.stopPropagation()">
                        
                        <div style="display:flex; align-items:center; gap:0.5rem;">
                            <img src="${this.getImageUrl(m.profile_picture) || 'https://ui-avatars.com/api/?name=' + m.name}" style="width: 24px; height: 24px; border-radius: 50%;">
                            <span style="font-size: 0.9rem; font-weight: 500; color: #334155;">${m.name} ${m.id == currentUser.id ? '(You)' : ''}</span>
                        </div>
                    </div>

                    <div style="display: flex; align-items: center; gap: 0.5rem;" onclick="event.stopPropagation()">
                        <input type="number" class="split-input" data-user-id="${m.id}" placeholder="0.00" step="0.01" 
                               style="width: 80px; padding: 0.35rem; border: 1px solid #e2e8f0; border-radius: 6px; text-align: right; font-weight: 600; color: #0f172a; outline: none; background: #f8fafc;">
                        <span style="font-size: 0.75rem; color: #94a3b8; font-weight: 600;">${this.getCurrencySymbol()}</span>
                    </div>
                </div>
                `).join('');

                container.dataset.renderedTripId = tripId;

                // Bind Checkbox Events - Trigger Recalculation
                container.querySelectorAll('.split-checkbox').forEach(cb => {
                    cb.addEventListener('change', () => this.updateSplitMembers());
                });
            }

            // 3. Update Logic (Runs every time function is called)
            const checkboxes = container.querySelectorAll('.split-checkbox');
            const inputs = container.querySelectorAll('.split-input');
            const checkedBoxes = Array.from(checkboxes).filter(c => c.checked);

            // UI State Updates
            checkboxes.forEach((cb, idx) => {
                const row = cb.closest('.split-row');
                const input = inputs[idx];

                if (cb.checked) {
                    row.style.background = '#f1f5f9';
                    row.style.opacity = '1';
                    if (splitType === 'custom') {
                        input.disabled = false;
                        input.readOnly = false;
                        input.style.background = 'white';
                    } else {
                        input.disabled = false;
                        input.readOnly = true; // Use readOnly for Equal mode so it looks cleaner
                        input.style.background = '#f8fafc';
                    }
                } else {
                    row.style.background = 'transparent';
                    row.style.opacity = '0.5';
                    input.disabled = true;
                    input.value = '0.00';
                    input.style.background = '#f1f5f9';
                }
            });

            // Math Logic
            if (splitType === 'equal') {
                if (checkedBoxes.length > 0) {
                    const share = (totalAmount / checkedBoxes.length).toFixed(2);
                    let distributed = 0;

                    // Distribute base share
                    checkboxes.forEach((cb, idx) => {
                        if (cb.checked) {
                            inputs[idx].value = share;
                            distributed += parseFloat(share);
                        }
                    });

                    // Distribute remainder properly to avoid penny rounding errors
                    const diff = totalAmount - distributed;
                    if (Math.abs(diff) > 0.001) {
                        // Add difference to the first checked person (simplest)
                        // Or search for 'You' if you want to be generous? 
                        // Standard is usually random or first.
                        for (let i = 0; i < inputs.length; i++) {
                            if (checkboxes[i].checked) {
                                let val = parseFloat(inputs[i].value) || 0;
                                inputs[i].value = (val + diff).toFixed(2);
                                break;
                            }
                        }
                    }
                } else {
                    inputs.forEach(i => i.value = '0.00');
                }
            }
        }





        showTripDeleteConfirm(id) {
            document.getElementById(`tripActions-${id}`).style.display = 'none';
            document.getElementById(`tripConfirm-${id}`).style.display = 'flex';
        }

        cancelTripDeleteConfirm(id) {
            document.getElementById(`tripActions-${id}`).style.display = 'flex';
            document.getElementById(`tripConfirm-${id}`).style.display = 'none';
        }

        showExpenseDeleteConfirm(id) {
            document.getElementById(`expActions-${id}`).style.display = 'none';
            document.getElementById(`expConfirm-${id}`).style.display = 'flex';
        }

        cancelExpenseDeleteConfirm(id) {
            document.getElementById(`expActions-${id}`).style.display = 'flex';
            document.getElementById(`expConfirm-${id}`).style.display = 'none';
        }

        async deleteExpenseRow(id) {
            try {
                const token = localStorage.getItem('token');
                const res = await fetch(`/api/expenses/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': token }
                });
                if (res.ok) {
                    this.showToast('Expense deleted', 'success');
                    await this.fetchCoreData(true); // Force Refresh
                    this.loadExpensesData();
                    if (this.loadInitialData) this.loadInitialData(); // Dashboard update
                } else {
                    const data = await res.json();
                    this.showToast(data.msg || 'Failed to delete', 'error');
                    this.cancelExpenseDeleteConfirm(id);
                }
            } catch (e) {
                console.error(e);
                this.showToast('Network error', 'error');
                this.cancelExpenseDeleteConfirm(id);
            }
        }

        async deleteExpense(id) {
            this.showConfirmationModal(
                'Delete Expense?',
                'Are you sure you want to delete this expense? This action cannot be undone.',
                async () => {
                    const token = localStorage.getItem('token');
                    const res = await fetch(`/api/expenses/${id}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': token }
                    });
                    if (res.ok) {
                        this.showToast('Expense deleted', 'success');
                        await this.fetchCoreData(true); // Force Refresh
                        this.loadExpensesData();
                        if (this.loadInitialData) this.loadInitialData();
                    } else {
                        const data = await res.json();
                        this.showToast(data.msg || 'Failed to delete', 'error');
                    }
                }
            );
        }

        async confirmDeleteTrip(tripId) {
            this.showConfirmationModal(
                'Delete Trip?',
                'Are you sure you want to delete this entire trip? All associated expenses and data will be permanently removed.',
                async () => {
                    this.deleteTrip(tripId);
                },
                true // dangerous action style
            );
        }

        async deleteTrip(tripId) {
            try {
                const token = localStorage.getItem('token');
                const res = await fetch(`/api/trips/${tripId}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': token }
                });

                if (res.ok) {
                    this.showToast('Trip deleted successfully', 'success');
                    // Refresh both the dashboard and the trips view
                    await this.fetchCoreData(true); // Force Refresh
                    await this.autoSwitchCurrencyContext(); // Re-evaluate currency context
                    this.loadTripsData();
                    if (this.loadInitialData) this.loadInitialData();
                } else {
                    const data = await res.json();
                    this.showToast(data.msg || 'Failed to delete trip', 'error');
                }
            } catch (err) {
                console.error(err);
                this.showToast('Network error while deleting trip', 'error');
            }
        }

        viewReceipt(url) {
            let rotation = 0;
            let scale = 1;

            const modal = document.createElement('div');
            modal.className = 'receipt-viewer-overlay';
            modal.innerHTML = `
            <div style="position:relative; width:100%; height:100%; display:flex; align-items:center; justify-content:center; overflow:hidden;">
                <img id="viewingReceipt" src="${url}" style="max-width:90%; max-height:90%; border-radius:12px; transition:transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); box-shadow:0 30px 60px rgba(0,0,0,0.5); border:4px solid white;">
                <div class="receipt-viewer-controls">
                    <button class="control-btn" id="rotateBtn" title="Rotate"><i class="fas fa-redo"></i></button>
                    <button class="control-btn" id="zoomOutBtn" title="Zoom Out"><i class="fas fa-search-minus"></i></button>
                    <button class="control-btn" id="zoomInBtn" title="Zoom In"><i class="fas fa-search-plus"></i></button>
                    <button class="control-btn" onclick="this.closest('.receipt-viewer-overlay').remove()" title="Close"><i class="fas fa-times"></i></button>
                </div>
            </div>
        `;
            document.body.appendChild(modal);

            const img = document.getElementById('viewingReceipt');
            document.getElementById('rotateBtn').onclick = (e) => { e.stopPropagation(); rotation += 90; img.style.transform = `scale(${scale}) rotate(${rotation}deg)`; };
            document.getElementById('zoomInBtn').onclick = (e) => { e.stopPropagation(); scale += 0.2; img.style.transform = `scale(${scale}) rotate(${rotation}deg)`; };
            document.getElementById('zoomOutBtn').onclick = (e) => { e.stopPropagation(); scale = Math.max(0.5, scale - 0.2); img.style.transform = `scale(${scale}) rotate(${rotation}deg)`; };
            modal.onclick = () => modal.remove();
        }

        async viewSplitDetails(expenseId) {
            try {
                const token = localStorage.getItem('token');

                // Use local cache if possible, otherwise fetch
                let expense = (this.allExpenses || []).find(e => e.id == expenseId);

                if (!expense) {
                    const res = await fetch(`/api/expenses`, {
                        headers: { 'Authorization': token }
                    });
                    const expenses = await res.json();
                    expense = expenses.find(e => e.id == expenseId);
                }

                if (!expense) {
                    this.showToast('Expense not found', 'error');
                    return;
                }

                let splitDetails = typeof expense.split_details === 'string' ? JSON.parse(expense.split_details || '{}') : (expense.split_details || {});
                const settledUidsRaw = typeof expense.settled_uids === 'string' ? JSON.parse(expense.settled_uids || '[]') : (expense.settled_uids || []);
                const settledUids = (settledUidsRaw || []).map(id => id.toString());

                // FETCH MEMBERS: Always needed for names and reconstructing lists
                const membersRes = await fetch(`/api/trips/${expense.trip_id}/members`, {
                    headers: { 'Authorization': token }
                });
                const members = await membersRes.json();

                // Reconstruct split details using universal logic
                splitDetails = this.getReconstructedSplit(expense, members);

                const currentUser = JSON.parse(localStorage.getItem('user'));
                const currentUserId = currentUser ? currentUser.id : null;
                // Use loose equality for IDs
                const isAuthorizedToSettle = expense.payer_id == currentUserId || expense.user_id == currentUserId;

                let breakdownHTML = '';
                let totalSettled = 0;
                let totalToSettle = 0;

                for (const [userId, amount] of Object.entries(splitDetails)) {
                    const member = members.find(m => m.id == userId);
                    const name = member ? (member.id == currentUserId ? 'You' : member.name) : `Member #${userId}`;
                    const pic = this.getImageUrl(member?.profile_picture) || `https://ui-avatars.com/api/?name=${name}`;


                    const isPaid = settledUids.includes(userId.toString()) || parseFloat(amount) <= 0;
                    const isPayer = expense.payer_id == userId;

                    if (!isPayer) {
                        totalToSettle += parseFloat(amount);
                        if (isPaid) totalSettled += parseFloat(amount);
                    }

                    // Show checkbox ONLY if authorized, NOT the payer, AND they actually owe something
                    const showCheckbox = isAuthorizedToSettle && !isPayer && parseFloat(amount) > 0;

                    let showPayBtn = false;
                    const userIdStr = userId.toString();
                    const currentUserIdStr = currentUserId ? currentUserId.toString() : '';
                    if (userIdStr === currentUserIdStr && !isPayer && !isPaid && parseFloat(amount) > 0) {
                        showPayBtn = true;
                    }
                    const safePayerName = (expense.payer_name || 'the payer').replace(/'/g, "\\'");
                    const safePayerUpi = (expense.payer_upi_id || '').replace(/'/g, "\\'");

                    breakdownHTML += `
                    <div class="breakdown-item" style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 0; border-bottom: 1px solid #f1f5f9; ${isPaid ? 'background: #f0fdf450;' : ''}">
                        <div style="display:flex; align-items:center; gap:0.75rem;">
                            ${showCheckbox ? `
                            <div style="position: relative; width: 22px; height: 22px;">
                                <input type="checkbox" 
                                    ${isPaid ? 'checked' : ''} 
                                    onchange="app.toggleExpensePayment(${expense.id}, ${userId})"
                                    style="width: 22px; height: 22px; cursor: pointer; accent-color: #10b981; margin:0;"
                                    title="Mark as Paid"
                                >
                            </div>` : (isPaid || isPayer ? '<i class="fas fa-check-circle" style="color:#10b981; font-size: 1.2rem;"></i>' : '<i class="far fa-circle" style="color:#cbd5e1; font-size: 1.2rem;"></i>')}
                            
                            <img src="${pic}" style="width:36px; height:36px; border-radius:50%; object-fit:cover; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                            <div>
                                <div style="font-weight:700; color:#1e293b; font-size: 0.9rem;">${name}</div>
                                <div style="font-size: 0.7rem; color: #64748b; font-weight: 600;">${isPayer ? 'PAYER' : (isPaid ? 'SETTLED' : 'OWES')}</div>
                            </div>
                        </div>
                        <div style="display:flex; align-items:center; gap:0.6rem; flex-shrink:0;">
                            <span style="font-weight:800; color:${isPaid || isPayer ? '#10b981' : '#0f172a'}; font-size: 1rem;">${this.formatCurrency(amount)}</span>
                            ${showPayBtn ? `
                            <button 
                                onclick="event.stopPropagation(); app.openPaymentGateway(${expense.id}, '${userIdStr}', ${parseFloat(amount).toFixed(2)}, '${safePayerName}', '${safePayerUpi}')"
                                style="background: linear-gradient(135deg, #0b3b5b, #2a8faa); border: none; color: white; font-size: 0.7rem; font-weight: 800; padding: 0.35rem 0.75rem; border-radius: 10px; cursor: pointer; display: flex; align-items: center; gap: 0.35rem; white-space: nowrap; box-shadow: 0 4px 12px rgba(42,143,170,0.35); transition: all 0.2s; text-transform: uppercase; letter-spacing: 0.03em;"
                                onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 6px 16px rgba(42,143,170,0.45)'"
                                onmouseout="this.style.transform=''; this.style.boxShadow='0 4px 12px rgba(42,143,170,0.35)'">
                                <i class="fas fa-bolt"></i> Pay
                            </button>` : ''}
                        </div>
                    </div>
                `;
                }

                const settleProgress = totalToSettle > 0 ? (totalSettled / totalToSettle) * 100 : 100;

                const existingModal = document.getElementById('splitBreakdownModal');
                if (existingModal) existingModal.remove();

                const modalHTML = `
            <div id="splitBreakdownModal" style="display:flex; position:fixed; inset:0; z-index:999999; align-items:center; justify-content:center; background:rgba(0,0,0,0.6); backdrop-filter:blur(8px);">
                <div style="background:white; border-radius:30px; width:90%; max-width:400px; overflow:hidden; animation:modalSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);">
                    <div style="background:linear-gradient(135deg, #0b3b5b, #2a8faa); padding:1.75rem; color:white; display:flex; justify-content:space-between; align-items:center; position:relative;">
                        <div>
                            <h3 style="margin:0; font-size:1.2rem; font-weight:800; letter-spacing:-0.02em;">Expense Breakdown</h3>
                            <div style="font-size:0.75rem; opacity:0.8; margin-top:0.2rem; font-weight:600; text-transform:uppercase; letter-spacing:0.05em;">${expense.description}</div>
                        </div>
                        <button onclick="document.getElementById('splitBreakdownModal').remove()" style="background:rgba(255,255,255,0.2); border:none; color:white; width:36px; height:36px; border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.2)'">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    
                    <div style="padding:1.5rem;">
                        <!-- Summary Bar -->
                        <div style="background:#f8fafc; padding:1.25rem; border-radius:20px; border:1px solid #f1f5f9; margin-bottom:1.5rem;">
                            <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:0.75rem;">
                                <div>
                                    <div style="font-size:0.75rem; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:0.2rem;">Settled Progress</div>
                                    <div style="font-size:1.5rem; font-weight:800; color:#0f172a;">${Math.round(settleProgress)}% <span style="font-size:0.8rem; color:#10b981; font-weight:700;">${settleProgress === 100 ? 'CLEARED' : ''}</span></div>
                                </div>
                                <div style="text-align:right;">
                                    <div style="font-size:0.75rem; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:0.2rem;">Total Share</div>
                                    <div style="font-size:1rem; font-weight:800; color:#2a8faa;">${this.formatCurrency(totalToSettle)}</div>
                                </div>
                            </div>
                            <div style="width:100%; height:8px; background:#e2e8f0; border-radius:10px; overflow:hidden;">
                                <div style="width:${settleProgress}%; height:100%; background:linear-gradient(to right, #10b981, #34d399); transition:width 0.5s ease; border-radius:10px;"></div>
                            </div>
                        </div>

                        <div style="max-height:300px; overflow-y:auto; padding-right:5px; display:flex; flex-direction:column; gap:0.25rem;">
                            ${breakdownHTML || '<p style="text-align:center; padding:1rem; color:#64748b;">No split participants found.</p>'}
                        </div>
                        
                        <div style="margin-top:1.5rem; text-align:center;">
                            <p style="font-size:0.75rem; color:#94a3b8; font-weight:600;">Only the payer or trip owner can mark items as paid.</p>
                        </div>
                    </div>
                </div>
            </div>
            `;
                document.body.insertAdjacentHTML('beforeend', modalHTML);

            } catch (e) {
                console.error(e);
                this.showToast('Failed to load split details: ' + e.message, 'error');
            }
        }

        async toggleExpensePayment(expenseId, userId) {
            try {
                const token = localStorage.getItem('token');
                const res = await fetch(`/api/expenses/${expenseId}/settle`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', 'Authorization': token },
                    body: JSON.stringify({ userId })
                });

                if (res.ok) {
                    // --- OPTIMISTIC UI UPDATE ---
                    // Immediately update in-memory cache so the card flips to CLEARED right away
                    const userIdStr = userId.toString();
                    if (this.allExpenses) {
                        const expIdx = this.allExpenses.findIndex(e => e.id == expenseId);
                        if (expIdx > -1) {
                            const exp = this.allExpenses[expIdx];
                            let settled = typeof exp.settled_uids === 'string'
                                ? JSON.parse(exp.settled_uids || '[]')
                                : (exp.settled_uids || []);
                            settled = settled.map(id => id.toString());
                            if (!settled.includes(userIdStr)) {
                                settled.push(userIdStr);
                            }
                            this.allExpenses[expIdx] = { ...exp, settled_uids: settled };
                        }
                    }

                    // Force fresh fetch from backend and re-render the expenses grid
                    this.coreDataPromise = null; // reset cache
                    await this.fetchCoreData(true);

                    // Re-render expenses view (works even if modal is open on top)
                    this.applyExpenseFilters();

                    // Also refresh split details modal if it's open
                    const splitModal = document.getElementById('splitDetailsModal');
                    if (splitModal) this.viewSplitDetails(expenseId);
                } else {
                    const data = await res.json();
                    this.showToast(data.msg || 'Update failed', 'error');
                }
            } catch (e) {
                console.error(e);
                this.showToast('Network error', 'error');
            }
        }

        // Helper to intelligently reconstruct split data for all split modes
        getReconstructedSplit(expense, members) {
            let details = typeof expense.split_details === 'string' ? JSON.parse(expense.split_details || '{}') : (expense.split_details || {});

            // Return if custom details exist and are valid
            if (expense.split_type === 'custom' && Object.keys(details).length > 0) return details;

            // Otherwise (Equal, Full, or Missing Data), reconstruct based on current trip members
            const totalAmt = parseFloat(expense.amount);
            const payerIdStr = (expense.payer_id || '').toString();
            const newDetails = {};

            if (members && members.length > 0) {
                const equalAmt = (totalAmt / members.length).toFixed(2);
                members.forEach(m => {
                    const mid = m.id.toString();
                    if (expense.split_type === 'equal') {
                        newDetails[mid] = equalAmt;
                    } else if (mid === payerIdStr) {
                        newDetails[mid] = totalAmt;
                    } else {
                        newDetails[mid] = 0;
                    }
                });
                return newDetails;
            }

            return details; // Fallback to whatever we had
        }

        async updateDebtIntelligence() {
            const hub = document.getElementById('debtSettlementHub');
            const details = document.getElementById('settlementDetails');
            const status = document.getElementById('settlementStatus');
            const tripFilter = document.getElementById('filterExpenseTrip');

            if (!hub || !details || !tripFilter) return;

            const tripId = tripFilter.value;

            // ONLY SHOW if a specific trip is selected
            if (!tripId || tripId === 'all') {
                hub.style.display = 'none';
                return;
            }

            try {
                hub.style.display = 'block';
                if (status) status.textContent = 'ANALYZING...';

                const token = localStorage.getItem('token');
                const res = await fetch(`/api/expenses/${tripId}/balances`, {
                    headers: { 'Authorization': token }
                });

                if (!res.ok) throw new Error('Balance fetch failed');
                const data = await res.json();

                if (status) status.textContent = 'COMPLETED';

                if (!data.settlements || data.settlements.length === 0) {
                    details.innerHTML = `
                        <div style="grid-column: 1 / -1; padding: 2rem; text-align: center; background: rgba(87, 193, 211, 0.05); border-radius: 12px; border: 1px dashed rgba(87, 193, 211, 0.2);">
                            <p style="color: var(--blue-600); font-weight: 600; margin: 0;">Everything is settled! No outstanding debts for this trip.</p>
                        </div>
                    `;
                    return;
                }

                details.innerHTML = data.settlements.map(p => {
                    const isMe = p.fromId == this.currentUserId;
                    return `
                    <div class="settlement-card ${isMe ? 'my-debt' : ''}" 
                         style="background: white; padding: 1.25rem; border-radius: 16px; border: 1px solid rgba(87, 193, 211, 0.1); box-shadow: 0 4px 12px rgba(0,0,0,0.02); display: flex; flex-direction: column; gap: 0.75rem;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 0.7rem; font-weight: 800; color: #64748b; text-transform: uppercase;">Optimization Path</span>
                            ${isMe ? '<span style="background: #fee2e2; color: #dc2626; font-size: 0.6rem; font-weight: 800; padding: 2px 6px; border-radius: 4px;">YOU OWE</span>' : ''}
                        </div>
                        <div style="display: flex; align-items: center; gap: 0.75rem;">
                            <div style="font-weight: 700; color: var(--navy-900);">${p.fromName}</div>
                            <div style="color: #6366f1;"><i class="fas fa-long-arrow-alt-right"></i></div>
                            <div style="font-weight: 700; color: var(--navy-900);">${p.toName}</div>
                        </div>
                        <div style="font-size: 1.5rem; font-weight: 900; color: #1e293b;">
                            ${this.formatCurrency(p.amount)}
                        </div>
                        ${isMe ? `
                        <button class="settle-btn" 
                                onclick="app.initiatePayment('${p.toId}', ${p.amount}, 'Individual Settlement', '${p.toUpi}')"
                                style="width: 100%; border: none; background: var(--navy-900); color: white; padding: 0.6rem; border-radius: 10px; font-weight: 700; cursor: pointer; transition: 0.2s; display: flex; align-items: center; justify-content: center; gap: 6px;">
                            <i class="fas fa-bolt"></i> Settle Now
                        </button>` : ''}
                    </div>
                    `;
                }).join('');

            } catch (err) {
                console.error(err);
                if (status) status.textContent = 'ERROR';
                hub.style.display = 'none';
            }
        }

        initiatePayment(toId, amount, description, toUpi) {
            this._manualSettleAmt = amount;
            const name = "Settlement Receiver";
            this.openPaymentGateway(null, toId, amount, name, toUpi);
        }


        async editExpense(id) {
            try {
                const token = localStorage.getItem('token');
                const res = await fetch(`/api/expenses`, {
                    headers: { 'Authorization': token }
                });
                const expenses = await res.json();
                const expense = expenses.find(e => e.id == id);

                if (!expense) throw new Error('Expense not found');

                await this.showAddExpenseModal(expense.trip_id); // Open modal for this trip

                // Ensure members are loaded for Payer dropdown and split details
                await this.updateSplitMembers();

                // Populate modal with existing data
                const modal = document.getElementById('expenseModal');
                modal.setAttribute('data-edit-id', id);
                document.getElementById('expenseDesc').value = expense.description;
                if (document.getElementById('expensePayer')) document.getElementById('expensePayer').value = expense.payer_id;
                document.getElementById('expenseAmount').value = expense.amount;
                const expenseDateObj = new Date(expense.date);
                document.getElementById('expenseDate').value = expenseDateObj.toISOString().split('T')[0];
                document.getElementById('expenseTime').value = expenseDateObj.getHours().toString().padStart(2, '0') + ':' + expenseDateObj.getMinutes().toString().padStart(2, '0');
                const catVal = (expense.category || '').toLowerCase().trim();
                const catEl = document.getElementById('expenseCategory');

                // Try explicit match
                let matched = false;
                if (catEl) {
                    for (let i = 0; i < catEl.options.length; i++) {
                        if (catEl.options[i].value.toLowerCase() === catVal) {
                            catEl.selectedIndex = i;
                            matched = true;
                            break;
                        }
                    }
                    if (!matched) {
                        // Default to 'other' if variant found, else use first
                        const otherOpt = Array.from(catEl.options).find(o => o.value.toLowerCase() === 'other');
                        if (otherOpt) catEl.value = otherOpt.value;
                        else catEl.selectedIndex = 0;
                    }
                }


                if (expense.split_type === 'equal' || expense.split_type === 'custom') {
                    const radio = document.querySelector(`input[name="splitType"][value="${expense.split_type}"]`);
                    if (radio) {
                        radio.checked = true;
                    }
                } else {
                    // Default to equal if unknown or old 'full' type
                    const radio = document.querySelector(`input[name="splitType"][value="equal"]`);
                    if (radio) {
                        radio.checked = true;
                    }
                }

                document.getElementById('receiptUrl').value = expense.receipt_url || '';

                if (expense.receipt_url) {
                    document.getElementById('previewImg').src = this.getImageUrl(expense.receipt_url);

                    document.getElementById('receiptPlaceholder') ? document.getElementById('receiptPlaceholder').style.display = 'none' : null;
                    document.getElementById('receiptPreview') ? document.getElementById('receiptPreview').style.display = 'block' : null;
                    // Adjust if using other IDs for receipt preview in revamped modal
                    document.getElementById('receiptIcon') ? document.getElementById('receiptIcon').style.display = 'none' : null;
                }

                // Wait to ensure members are loaded and UI rendered
                await this.updateSplitMembers();

                if (expense.split_type === 'custom' && expense.split_details) {
                    // Manually set custom split values & checks
                    const container = document.getElementById('splitMembersContainer');
                    const checkboxes = container.querySelectorAll('.split-checkbox');

                    // Reset all first
                    checkboxes.forEach(cb => {
                        cb.checked = false;
                        cb.dispatchEvent(new Event('change'));
                    });

                    for (const [userId, amount] of Object.entries(expense.split_details)) {
                        const input = container.querySelector(`.split-input[data-user-id="${userId}"]`);
                        const cb = container.querySelector(`.split-checkbox[data-user-id="${userId}"]`);

                        if (cb && input) {
                            cb.checked = true;
                            input.disabled = false;
                            input.value = amount;
                            // Correct opacity
                            cb.closest('div').querySelector('div').style.opacity = '1';
                            cb.closest('div').parentElement.querySelectorAll('div')[1].style.opacity = '1';
                        }
                    }
                } else if (expense.split_type === 'equal' && expense.split_details) {
                    // For equal, we just need to tick the participants who were involved
                    const container = document.getElementById('splitMembersContainer');
                    const checkboxes = container.querySelectorAll('.split-checkbox');

                    // If split_details exists for equal, it keys the participants.
                    // We should uncheck everyone not in details
                    checkboxes.forEach(cb => {
                        const userId = cb.dataset.userId;
                        if (expense.split_details[userId] !== undefined) {
                            cb.checked = true;
                        } else {
                            cb.checked = false;
                        }
                        cb.dispatchEvent(new Event('change'));
                    });
                }

                // Update modal title and button text
                const modalTitle = document.querySelector('#expenseModal h2');
                if (modalTitle) modalTitle.innerText = 'Edit Expense';

                const btn = document.getElementById('saveExpenseBtn');
                btn.innerHTML = 'Update Expense';
                btn.onclick = () => this.submitExpense(id); // Pass ID to submitExpense

            } catch (e) {
                console.error(e);
                this.showToast('Failed to load expense for editing', 'error');
            }
        }

        async submitExpense(editId = null) {
            const btn = document.getElementById('saveExpenseBtn');
            const token = localStorage.getItem('token');

            const amountVal = document.getElementById('expenseAmount').value;
            const baseAmount = await this.convertToBaseCurrency(amountVal);

            const formData = new FormData();
            formData.append('trip_id', document.getElementById('expenseTripId').value);
            formData.append('description', document.getElementById('expenseDesc').value);
            formData.append('amount', baseAmount);
            formData.append('date', `${document.getElementById('expenseDate').value}T${document.getElementById('expenseTime').value}:00`);
            formData.append('category', document.getElementById('expenseCategory').value.toLowerCase().trim());
            const splitType = document.querySelector('input[name="splitType"]:checked').value;
            formData.append('split_type', splitType);
            formData.append('payer_id', document.getElementById('expensePayer').value);

            // Add receipt file if selected
            const receiptFile = document.getElementById('receiptInput').files[0];
            if (receiptFile) {
                formData.append('receipt', receiptFile);
            }

            // Logic for both Equal and Custom is now unified via the inputs in the UI
            const splitDetails = {};
            let totalSplit = 0;

            document.querySelectorAll('.split-checkbox').forEach(cb => {
                const userId = cb.dataset.userId;
                if (cb.checked) {
                    const input = document.querySelector(`.split-input[data-user-id="${userId}"]`);
                    const val = parseFloat(input ? input.value : 0) || 0;
                    splitDetails[userId] = val;
                    totalSplit += val;
                }
            });

            const expenseAmt = parseFloat(document.getElementById('expenseAmount').value);

            // Validation check for rounding errors
            if (Math.abs(totalSplit - expenseAmt) > 0.1) {
                this.showToast(`Split total (${this.formatCurrency(totalSplit)}) must match expense amount (${this.formatCurrency(expenseAmt)})`, 'warning');
                return;
            }

            formData.append('split_details', JSON.stringify(splitDetails));

            if (!document.getElementById('expenseDesc').value || !document.getElementById('expenseAmount').value) {
                this.showToast('Missing required fields!', 'error');
                return;
            }

            btn.disabled = true;
            btn.innerHTML = editId ? '<i class="fas fa-spinner fa-spin"></i> Updating...' : '<i class="fas fa-spinner fa-spin"></i> Saving...';

            try {
                const url = editId ? `/api/expenses/${editId}` : '/api/expenses';
                const method = editId ? 'PUT' : 'POST';

                const res = await fetch(url, {
                    method: method,
                    headers: { 'Authorization': token },
                    body: formData
                });


                if (res.ok) {
                    this.showToast(editId ? 'Expense updated!' : 'Expense added!', 'success');
                    document.getElementById('expenseModal').remove();

                    // FORCE REFRESH DATA to ensure new expense appears immediately
                    await this.fetchCoreData(true);

                    this.loadExpensesData();
                    if (this.loadInitialData) this.loadInitialData(); // Refresh Dashboard too
                } else {
                    const data = await res.json();
                    this.showToast(data.msg || 'Failed to save expense', 'error');
                }
            } catch (err) {
                console.error(err);
                this.showToast('Network error', 'error');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = editId ? 'Update Expense' : 'Save & Notify Members';
                }
            }
        }
        async addToCalendar(tripId) {
            try {
                const token = localStorage.getItem('token');
                const res = await fetch('/api/trips', { headers: { 'Authorization': token } });
                const trips = await res.json();
                const trip = trips.find(t => t.id === tripId);

                if (!trip) return;

                const start = new Date(trip.start_date).toISOString().replace(/-|:|\.\d+/g, '');
                const end = new Date(trip.end_date).toISOString().replace(/-|:|\.\d+/g, '');
                const title = encodeURIComponent(`Trip to ${trip.destination}`);
                const details = encodeURIComponent(trip.notes || 'Trip planned with IntelliTrip');

                const gCalUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}&location=${encodeURIComponent(trip.destination)}&sf=true&output=xml`;

                window.open(gCalUrl, '_blank');
                this.showToast('Opening Google Calendar...', 'info');
            } catch (e) { console.error(e); }
        }


        viewExpense(id) { this.showToast('Expense details coming soon!', 'info'); }
        openAddExpenseModal() { this.showAddExpenseModal(); } // Redirect to new method

        async loadReportsData() {
            const reportsGrid = document.getElementById('reportsGrid');
            if (!reportsGrid) return;

            reportsGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align:center; padding: 5rem;"><div class="loading-spinner"></div><p style="margin-top:1.5rem; color:#64748b; font-weight:600; font-size:1.1rem; letter-spacing:-0.2px;">Analyzing financial datasets...</p></div>';

            try {
                const token = localStorage.getItem('token');
                const [tripsRes, expensesRes] = await Promise.all([
                    fetch('/api/trips', { headers: { 'Authorization': token } }),
                    fetch('/api/expenses', { headers: { 'Authorization': token } })
                ]);

                if (!tripsRes.ok || !expensesRes.ok) throw new Error('Failed to load report data');

                this.allTripsForReports = await tripsRes.json();
                this.allExpensesForReports = await expensesRes.json();

                // Update summary stats
                if (document.getElementById('reportCount')) document.getElementById('reportCount').textContent = this.allTripsForReports.length;
                if (document.getElementById('lastReportDate')) document.getElementById('lastReportDate').textContent = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

                // Portfolio Total Calculation
                const portfolioTotal = this.allTripsForReports.reduce((sum, t) => sum + (parseFloat(t.budget) || 0), 0);
                if (document.getElementById('portfolioTotal')) document.getElementById('portfolioTotal').innerHTML = `${this.formatCurrency(portfolioTotal)}`;

                // Shared trips count
                const currentUser = this.userData || JSON.parse(localStorage.getItem('user'));
                const sharedCount = this.allTripsForReports.filter(t => t.user_id != currentUser?.id).length;
                if (document.getElementById('sharedReportCount')) document.getElementById('sharedReportCount').textContent = sharedCount;

                this.filterReports();

            } catch (err) {
                console.error(err);
                reportsGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align:center; padding: 3rem; color:var(--error); font-weight:600;">Failed to generate reports. Please try again.</div>';
            }
        }

        async filterReports() {
            const reportsGrid = document.getElementById('reportsGrid');
            if (!reportsGrid || !this.allTripsForReports) return;

            const searchQuery = (document.getElementById('reportSearch')?.value || '').toLowerCase();
            const typeFilter = document.getElementById('reportTypeFilter')?.value || 'all';
            const sortOrder = document.getElementById('reportSort')?.value || 'newest';

            let filtered = [...this.allTripsForReports];

            // Search
            if (searchQuery) {
                filtered = filtered.filter(t => t.destination.toLowerCase().includes(searchQuery));
            }

            // Sort
            if (sortOrder === 'newest') filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            else if (sortOrder === 'oldest') filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
            else if (sortOrder === 'budget') filtered.sort((a, b) => b.budget - a.budget);

            reportsGrid.innerHTML = '';

            // Handle different report types
            if (typeFilter === 'monthly') {
                const monthlyData = {};
                (this.allExpensesForReports || []).forEach(e => {
                    const date = new Date(e.date);
                    const key = `${date.toLocaleString('default', { month: 'long' })} ${date.getFullYear()}`;
                    if (!monthlyData[key]) monthlyData[key] = { spent: 0, transactions: 0 };
                    monthlyData[key].spent += parseFloat(e.amount);
                    monthlyData[key].transactions++;
                });

                const monthlyCards = Object.entries(monthlyData).map(([month, data]) => `
                <div class="report-card-premium" style="background: white; border-radius: 32px; border: 1px solid #f1f5f9; padding: 2rem; display: flex; flex-direction: column; gap: 1.5rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; color: #0b3b5b; font-weight: 900;">${month}</h3>
                        <span style="background: #f0f9ff; color: #0369a1; padding: 0.5rem 1rem; border-radius: 12px; font-weight: 800; font-size: 0.75rem;">MONTHLY RECAP</span>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div style="background: #f8fafc; padding: 1rem; border-radius: 18px;">
                            <span style="display: block; font-size: 0.65rem; color: #64748b; font-weight: 800; text-transform: uppercase;">Total Outflow</span>
                            <span style="font-size: 1.35rem; font-weight: 900; color: #0b3b5b;">${this.formatCurrency(data.spent)}</span>
                        </div>
                        <div style="background: #f8fafc; padding: 1rem; border-radius: 18px;">
                            <span style="display: block; font-size: 0.65rem; color: #64748b; font-weight: 800; text-transform: uppercase;">Entries</span>
                            <span style="font-size: 1.35rem; font-weight: 900; color: #0b3b5b;">${data.transactions}</span>
                        </div>
                    </div>
                    <button onclick="app.viewMonthlyReport('${month}')" class="btn-primary" style="width: 100%; border-radius: 16px; padding: 0.8rem; background: #0b3b5b; font-weight: 800; cursor: pointer;">Detailed Breakdown</button>
                </div>
            `);
                reportsGrid.innerHTML = monthlyCards.join('');
                return;
            }

            if (typeFilter === 'category') {
                const categoryData = {};
                (this.allExpensesForReports || []).forEach(e => {
                    if (!categoryData[e.category]) categoryData[e.category] = { spent: 0, transactions: 0 };
                    categoryData[e.category].spent += parseFloat(e.amount);
                    categoryData[e.category].transactions++;
                });

                const categoryCards = Object.entries(categoryData).map(([cat, data]) => `
                <div class="report-card-premium" style="background: white; border-radius: 32px; border: 1px solid #f1f5f9; padding: 2rem; display: flex; flex-direction: column; gap: 1.5rem;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; color: #0b3b5b; font-weight: 900; text-transform: capitalize;">${cat}</h3>
                        <span style="background: #f0fdf4; color: #166534; padding: 0.5rem 1rem; border-radius: 12px; font-weight: 800; font-size: 0.75rem;">SECTOR ANALYSIS</span>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div style="background: #f8fafc; padding: 1rem; border-radius: 18px;">
                            <span style="display: block; font-size: 0.65rem; color: #64748b; font-weight: 800; text-transform: uppercase;">Asset Total</span>
                            <span style="font-size: 1.35rem; font-weight: 900; color: #0b3b5b;">${this.formatCurrency(data.spent)}</span>
                        </div>
                        <div style="background: #f8fafc; padding: 1rem; border-radius: 18px;">
                            <span style="display: block; font-size: 0.65rem; color: #64748b; font-weight: 800; text-transform: uppercase;">Frequency</span>
                            <span style="font-size: 1.35rem; font-weight: 900; color: #0b3b5b;">${data.transactions}</span>
                        </div>
                    </div>
                    <button onclick="app.viewCategoryReport('${cat}')" class="btn-primary" style="width: 100%; border-radius: 16px; padding: 0.8rem; background: #0b3b5b; font-weight: 800; cursor: pointer;">Sector Insight</button>
                </div>
            `);
                reportsGrid.innerHTML = categoryCards.join('');
                return;
            }

            // Show trip summary cards (for 'all' or 'trip_summary' filter)
            if (typeFilter === 'all' || typeFilter === 'trip_summary') {
                if (filtered.length === 0) {
                    reportsGrid.innerHTML = '<div style="grid-column: 1 / -1; text-align:center; padding: 5rem; background: #f8fafc; border-radius: 30px; border: 2px dashed #e2e8f0;"><div style="font-size: 4rem; margin-bottom: 2rem;">📄</div><h3 style="color: #0b3b5b; font-weight:800; font-size:1.5rem;">No matching travel reports</h3><p style="color: #64748b;">Try adjusting your search or filters</p></div>';
                    return;
                }

                const cards = await Promise.all(filtered.map(async trip => {
                    const totalSpent = parseFloat(trip.total_spent) || 0;
                    const budget = parseFloat(trip.budget) || 0;

                    const start = new Date(trip.start_date);
                    const end = new Date(trip.end_date);
                    const dateParams = { day: '2-digit', month: '2-digit', year: 'numeric' };
                    const dateRange = `${start.toLocaleDateString('en-GB', dateParams)} - ${end.toLocaleDateString('en-GB', dateParams)}`;
                    const year = start.getFullYear();

                    // Backend Progress for "Day X of Y" logic
                    const totalDurationDays = parseInt(trip.total_days) || 1;
                    const daysElapsed = parseInt(trip.days_elapsed) || 0;
                    const journeyProgressPct = parseInt(trip.journey_progress_pct) || 0;
                    const isOngoing = trip.status === 'ongoing';

                    const [tripImg, weather] = await Promise.all([
                        this.getDestinationImage(trip.destination),
                        this.getDestinationWeather(trip.destination)
                    ]);

                    // PROFESSIONAL COMPACT CARD DESIGN
                    return `
            <div class="trip-card-premium" style="border-radius: 20px; cursor: pointer;" onclick="app.viewReport(${trip.id})">
                <!-- Compact Hero -->
                <div class="trip-card-hero" style="height: 100px; background-image: url('${tripImg}')">
                    <div class="trip-card-badges">
                        <div class="weather-badge" title="${weather ? (weather.description || weather.main) : 'Weather unavailable'}" style="transform: scale(0.85); transform-origin: top right; margin: -5px -5px 0 0;">
                            <i class="fas fa-thermometer-half" style="color: #2a8faa; font-size: 0.9rem;"></i>
                            <span>${weather ? weather.temp : '--'}°C</span>
                        </div>
                    </div>
                    <div class="trip-info">
                        <h3 style="font-size: 1.1rem;">${trip.destination}</h3>
                        <div class="trip-dates" style="font-size: 0.7rem;">
                            <i class="fas fa-calendar-alt"></i> ${dateRange}
                        </div>
                    </div>
                </div>

                <!-- Body -->
                <div class="trip-card-body" style="padding: 1.25rem; gap: 1rem;">
                    ${isOngoing && daysElapsed ? `
                    <div class="trip-progress-group">
                        <div class="progress-header">
                            <span class="progress-label" style="font-size: 0.65rem;">Journey Progress</span>
                            <span class="progress-pct" style="font-size: 0.85rem;">${journeyProgressPct}%</span>
                        </div>
                        <div class="progress-bar-premium" style="height: 6px;">
                            <div class="progress-fill-premium" style="width: ${journeyProgressPct}%; background: var(--accent-gradient);"></div>
                        </div>
                    </div>
                    ` : ''}

                    <div class="trip-stats-grid">
                        <div class="trip-stat-item" style="padding: 0.6rem;">
                            <span class="trip-stat-label" style="font-size: 0.6rem;">Total Budget</span>
                            <span class="trip-stat-value" style="font-size: 0.95rem;">${this.formatCurrency(budget)}</span>
                        </div>
                        <div style="padding: 0.75rem; border-radius: 10px; border: 1px solid ${totalSpent > budget ? '#FECACA' : '#BBF7D0'}; background: ${totalSpent > budget ? '#FEF2F2' : '#F0FDF4'};">
                            <div style="font-size:0.65rem; color: ${totalSpent > budget ? '#B91C1C' : '#166534'}; font-weight: 600; margin-bottom: 0.25rem;">Total Spent</div>
                            <div style="font-size: 0.95rem; font-weight: 700; color: ${totalSpent > budget ? '#991B1B' : '#15803D'};">${this.formatCurrency(totalSpent)}</div>
                        </div>
                    </div>
                </div>
            </div>
            `;
                }));


                reportsGrid.innerHTML = cards.join('');
            }
        }


        async viewReport(tripId) {
            try {
                const token = localStorage.getItem('token');
                const [tripRes, expensesRes, membersRes] = await Promise.all([
                    fetch(`/api/trips`, { headers: { 'Authorization': token } }),
                    fetch(`/api/expenses`, { headers: { 'Authorization': token } }),
                    fetch(`/api/trips/${tripId}/members`, { headers: { 'Authorization': token } })
                ]);

                const trips = await tripRes.json();
                const expenses = await expensesRes.json();
                const members = membersRes.ok ? await membersRes.json() : [];
                const trip = trips.find(t => t.id == tripId);
                const tripExpenses = expenses.filter(e => e.trip_id == tripId);

                if (!trip) return;

                const subView = document.getElementById('reportDetailSubView');
                const uiBox = document.getElementById('reportDetailUIBox');
                const grid = document.getElementById('reportsGrid');
                const filters = document.querySelector('.filters-section');
                const templates = document.querySelector('.templates-section');
                const summary = document.querySelector('.expense-summary');
                const header = document.querySelector('.page-header');

                // Hide grid and related elements
                if (grid) grid.style.display = 'none';
                if (filters) filters.style.display = 'none';
                if (templates) templates.style.display = 'none';
                if (summary) summary.style.display = 'none';

                // Show Subview
                if (subView) subView.style.display = 'block';
                window.scrollTo({ top: 0, behavior: 'smooth' });

                // Data Preparation
                const totalSpent = tripExpenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);

                const budget = parseFloat(trip.budget);
                const categories = {};
                tripExpenses.forEach(e => {
                    categories[e.category] = (categories[e.category] || 0) + parseFloat(e.amount);
                });

                // Dynamic scaling helper for large amounts in compact UI
                const getDynamicFontSize = (amt, baseSize) => {
                    const str = this.formatCurrency(amt);
                    if (str.length > 12) return (parseFloat(baseSize) * 0.7) + baseSize.replace(/[0-9.]/g, '');
                    if (str.length > 9) return (parseFloat(baseSize) * 0.85) + baseSize.replace(/[0-9.]/g, '');
                    return baseSize;
                };

                const delta = budget - totalSpent;
                const dailyRate = Math.max(0, totalSpent / Math.max(1, (new Date(trip.end_date) - new Date(trip.start_date)) / (1000 * 60 * 60 * 24)));

                // Calculate Balances
                const balances = {};
                const memberNames = {};
                members.forEach(m => {
                    memberNames[m.id] = m.name;
                });

                tripExpenses.forEach(e => {
                    const payerId = e.payer_id || e.user_id;
                    const splitDetails = typeof e.split_details === 'string' ? JSON.parse(e.split_details || '{}') : (e.split_details || {});
                    const settledUids = (typeof e.settled_uids === 'string' ? JSON.parse(e.settled_uids || '[]') : (e.settled_uids || [])).map(id => id.toString());

                    if (e.split_type === 'equal' || e.split_type === 'custom') {
                        for (const [userIdStr, amount] of Object.entries(splitDetails)) {
                            if (userIdStr !== payerId.toString() && !settledUids.includes(userIdStr) && parseFloat(amount) > 0) {
                                if (!balances[userIdStr]) balances[userIdStr] = {};
                                balances[userIdStr][payerId] = (balances[userIdStr][payerId] || 0) + parseFloat(amount);
                            }
                        }
                    }
                });

                // Simplify balances
                Object.keys(balances).forEach(A => {
                    Object.keys(balances[A]).forEach(B => {
                        if (balances[B] && balances[B][A]) {
                            const min = Math.min(balances[A][B], balances[B][A]);
                            balances[A][B] -= min;
                            balances[B][A] -= min;
                        }
                    });
                });

                let owesHTML = '';
                let hasOwes = false;
                Object.entries(balances).forEach(([owerId, payees]) => {
                    Object.entries(payees).forEach(([payeeId, amount]) => {
                        if (amount > 0.01) {
                            hasOwes = true;
                            const owerName = memberNames[owerId] || 'Member';
                            const payeeName = memberNames[payeeId] || 'Member';
                            owesHTML += `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 0; border-bottom: 1px dashed #e2e8f0;">
                                <div style="display: flex; align-items: center; gap: 0.5rem;">
                                    <div style="font-weight: 800; color: #ef4444; font-size: 0.85rem;">${owerName}</div>
                                    <i class="fas fa-arrow-right" style="color: #cbd5e1; font-size: 0.75rem;"></i>
                                    <div style="font-weight: 800; color: #10b981; font-size: 0.85rem;">${payeeName}</div>
                                </div>
                                <span style="font-weight: 900; color: #0b3b5b; font-size: 0.95rem;">${this.formatCurrency(amount)}</span>
                            </div>`;
                        }
                    });
                });

                if (!hasOwes) {
                    owesHTML = '<div style="text-align:center; padding: 1.5rem; color:#64748b; font-size: 0.85rem; font-weight: 600;">No outstanding balances. Everything is settled! 🎉</div>';
                }

                uiBox.innerHTML = `
                <div class="report-details-container" style="color: #0b3b5b; padding: 2rem 1.5rem; background: white; max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 2rem;">
                    <!-- Trip Header Overlay - Compact Statement Header -->
                    <div style="background: linear-gradient(135deg, #0b3b5b 0%, #2a8faa 100%); padding: 2rem 1.5rem; border-radius: 24px; color: white; box-shadow: 0 15px 40px rgba(11, 59, 91, 0.15); text-align: center; position: relative; overflow: hidden;">
                        <div style="position: absolute; top:0; left:0; right:0; bottom:0; background: radial-gradient(circle at top right, rgba(255,255,255,0.1), transparent); pointer-events:none;"></div>
                        <div style="position: relative; z-index: 2; display: flex; flex-direction: column; align-items: center; gap: 1rem;">
                            <div style="display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
                                <div style="font-family: 'Courier New', monospace; font-size: 0.7rem; background: rgba(255,255,255,0.1); padding: 0.35rem 1.25rem; border-radius: 8px; border: 1.2px solid rgba(255,255,255,0.2); color: white; letter-spacing: 2px; font-weight: 700;">AUDIT ID: #IT-${trip.id}-${Date.now().toString().slice(-6)}</div>
                                <span style="background: #10b981; padding: 0.35rem 1rem; border-radius: 40px; font-size: 0.6rem; font-weight: 900; letter-spacing: 1px; text-transform: uppercase;">Verified Statement</span>
                            </div>
                            
                            <h1 style="margin: 0; font-size: 2.2rem; font-weight: 900; letter-spacing: -1.5px; line-height: 1; color: white;">${trip.destination}</h1>
                            
                            <div style="display: flex; align-items: center; justify-content: center; gap: 0.75rem; font-size: 0.95rem; opacity: 0.95; font-weight: 600;">
                                <i class="far fa-calendar-check" style="font-size: 0.8rem;"></i>
                                <span>${new Date(trip.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                <span style="opacity: 0.4;">&mdash;</span>
                                <span>${new Date(trip.end_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                            </div>
                        </div>
                    </div>

                    <!-- Compact Performance Cards -->
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; justify-content: center;">
                         <div class="report-stat-box-premium" style="background: #f8fafc; padding: 1.5rem 1rem; border-radius: 20px; border: 1px solid #eef2f6; text-align: center; display: flex; flex-direction: column; align-items: center; box-shadow: 0 2px 4px rgba(0,0,0,0.02); overflow: hidden;">
                            <div style="width: 42px; height: 42px; background: #0b3b5b; color: white; border-radius: 12px; display: flex; align-items: center; justify-content: center; margin-bottom: 1rem; font-size: 1.1rem;"><i class="fas fa-chart-line"></i></div>
                            <span style="color: #64748b; font-size: 0.65rem; font-weight: 800; text-transform: uppercase; letter-spacing: 1px;">Budget</span>
                            <h3 style="margin: 0.5rem 0 0; color: #0b3b5b; font-size: ${getDynamicFontSize(budget, '1.5rem')}; font-weight: 900; letter-spacing: -0.5px; width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${this.formatCurrency(budget)}">${this.formatCurrency(budget)}</h3>
                         </div>
                         <div class="report-stat-box-premium" style="background: #f8fafc; padding: 1.5rem 1rem; border-radius: 20px; border: 1px solid #eef2f6; text-align: center; display: flex; flex-direction: column; align-items: center; box-shadow: 0 2px 4px rgba(0,0,0,0.02); overflow: hidden;">
                            <div style="width: 42px; height: 42px; background: ${totalSpent > budget ? '#ef4444' : '#2a8faa'}; color: white; border-radius: 12px; display: flex; align-items: center; justify-content: center; margin-bottom: 1rem; font-size: 1.1rem;"><i class="fas fa-receipt"></i></div>
                            <span style="color: #64748b; font-size: 0.65rem; font-weight: 800; text-transform: uppercase; letter-spacing: 1px;">Spent</span>
                            <h3 style="margin: 0.5rem 0 0; color: ${totalSpent > budget ? '#ef4444' : '#0b3b5b'}; font-size: ${getDynamicFontSize(totalSpent, '1.5rem')}; font-weight: 900; letter-spacing: -0.5px; width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${this.formatCurrency(totalSpent)}">${this.formatCurrency(totalSpent)}</h3>
                         </div>
                         <div class="report-stat-box-premium" style="background: #f8fafc; padding: 1.5rem 1rem; border-radius: 20px; border: 1px solid #eef2f6; text-align: center; display: flex; flex-direction: column; align-items: center; box-shadow: 0 2px 4px rgba(0,0,0,0.02); overflow: hidden;">
                            <div style="width: 42px; height: 42px; background: ${delta < 0 ? '#f97316' : '#10b981'}; color: white; border-radius: 12px; display: flex; align-items: center; justify-content: center; margin-bottom: 1rem; font-size: 1.1rem;"><i class="fas fa-piggy-bank"></i></div>
                            <span style="color: #64748b; font-size: 0.65rem; font-weight: 800; text-transform: uppercase; letter-spacing: 1px;">Delta</span>
                            <h3 style="margin: 0.5rem 0 0; color: ${delta < 0 ? '#ef4444' : '#10b981'}; font-size: ${getDynamicFontSize(delta, '1.5rem')}; font-weight: 900; letter-spacing: -0.5px; width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${this.formatCurrency(delta)}">${this.formatCurrency(delta)}</h3>
                         </div>
                    </div>

                    <!-- Compact Analytic Sections -->
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; width: 100%; align-items: stretch;">
                        <div style="background: white; border: 1px solid #f1f5f9; border-radius: 20px; padding: 1.5rem; display: flex; flex-direction: column; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.02);">
                             <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; border-bottom: 1px solid #f1f5f9; padding-bottom: 0.75rem;">
                                <h4 style="margin: 0; font-size: 1.1rem; font-weight: 900; color: #0b3b5b; text-transform: uppercase; letter-spacing: 0.5px;">Spending Analysis</h4>
                                <span style="font-size: 0.65rem; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">Sectors</span>
                            </div>
                            <div class="chart-container" style="height: 220px; position: relative; display: flex; align-items: center; justify-content: center; flex: 1;">
                                <canvas id="reportDoughnutChart"></canvas>
                                <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; z-index: 10; padding: 0 10%; box-sizing: border-box;">
                                    <div style="font-size: 0.6rem; color: #94a3b8; font-weight: 800; letter-spacing: 1.5px; opacity: 0.8;">TOTAL</div>
                                    <div style="font-size: ${getDynamicFontSize(totalSpent, '1.4rem')}; font-weight: 900; color: #0b3b5b; letter-spacing: -0.5px; width: 100%; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${this.formatCurrency(totalSpent)}</div>
                                </div>
                            </div>
                        </div>
                        
                        <div style="width: 100%;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                                <h4 style="margin: 0; font-size: 1.1rem; font-weight: 900; color: #0b3b5b; text-transform: uppercase; letter-spacing: 0.5px;">Efficiency Metrics</h4>
                            </div>
                            <div style="background: #ffffff; border-radius: 20px; border: 1px solid #f1f5f9; padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; box-shadow: 0 4px 10px rgba(0,0,0,0.02);">
                                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed #e2e8f0; padding-bottom: 0.75rem;">
                                    <div style="display: flex; gap: 1rem; align-items: center; min-width: 0;">
                                        <div style="width: 32px; height: 32px; background: #f0f9ff; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #2a8faa; font-size: 0.9rem; flex-shrink: 0;"><i class="fas fa-calendar-day"></i></div>
                                        <div style="min-width: 0;">
                                            <div style="font-weight: 800; font-size: 0.85rem; color: #0b3b5b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Daily Velocity</div>
                                            <p style="margin:0; font-size: 0.7rem; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Daily consumption rate</p>
                                        </div>
                                    </div>
                                    <span style="font-weight: 900; font-size: ${getDynamicFontSize(dailyRate, '1.1rem')}; color: #0b3b5b; flex-shrink: 0; margin-left: 1rem;">${this.formatCurrency(dailyRate)}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed #e2e8f0; padding-bottom: 0.75rem;">
                                    <div style="display: flex; gap: 1rem; align-items: center;">
                                        <div style="width: 32px; height: 32px; background: #f0fdf4; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #10b981; font-size: 0.9rem; flex-shrink: 0;"><i class="fas fa-layer-group"></i></div>
                                        <div>
                                            <div style="font-weight: 800; font-size: 0.85rem; color: #0b3b5b;">Txn Count</div>
                                            <p style="margin:0; font-size: 0.7rem; color: #64748b;">Total ledger entries</p>
                                        </div>
                                    </div>
                                    <span style="font-weight: 900; font-size: 1.1rem; color: #0b3b5b; flex-shrink: 0; margin-left: 1rem;">${tripExpenses.length}</span>
                                </div>
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <div style="display: flex; gap: 1rem; align-items: center;">
                                        <div style="width: 32px; height: 32px; background: ${totalSpent > budget ? '#fef2f2' : '#f0fdf4'}; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: ${totalSpent > budget ? '#ef4444' : '#10b981'}; font-size: 0.9rem; flex-shrink: 0;"><i class="fas fa-gauge-high"></i></div>
                                        <div>
                                            <div style="font-weight: 800; font-size: 0.85rem; color: #0b3b5b;">Budget Adherence</div>
                                            <p style="margin:0; font-size: 0.7rem; color: #64748b;">Variance from target</p>
                                        </div>
                                    </div>
                                    <span style="font-weight: 900; font-size: 1.1rem; color: ${totalSpent > budget ? '#ef4444' : '#10b981'}; flex-shrink: 0; margin-left: 1rem;">
                                        ${totalSpent > budget ? '+' : ''}${budget > 0 ? Math.round(((totalSpent - budget) / budget) * 100) : 0}%
                                    </span>
                                </div>
                            </div>
                        </div>

                        <!-- NEW: Settlement and Balances -->
                        <div style="grid-column: 1 / -1; width: 100%; margin-top: 1rem; page-break-before: auto; page-break-inside: avoid;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                                <h4 style="margin: 0; font-size: 1.1rem; font-weight: 900; color: #0b3b5b; text-transform: uppercase; letter-spacing: 0.5px;">Settlement & Balances</h4>
                            </div>
                            <div style="background: #ffffff; border-radius: 20px; border: 1px solid #f1f5f9; padding: 1.5rem; display: flex; flex-direction: column; gap: 0.25rem; box-shadow: 0 4px 10px rgba(0,0,0,0.02);">
                                ${owesHTML}
                            </div>
                        </div>
                    </div>
                    <div style="margin-top: 1rem;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                            <h4 style="margin: 0; font-size: 1rem; font-weight: 900; color: #0b3b5b; text-transform: uppercase;">Transaction Audit Log</h4>
                        </div>
                        <div style="overflow-x: auto; background: #f8fafc; padding: 1rem; border-radius: 20px; border: 1px solid #eef2f6;">
                            <table style="width: 100%; border-collapse: separate; border-spacing: 0 0.5rem;">
                                <thead>
                                    <tr style="text-align: left; color: #64748b; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 1px; font-weight: 800;">
                                        <th style="padding: 0 1rem 0.5rem;">Date</th>
                                        <th style="padding: 0 1rem 0.5rem;">Merchant / Details</th>
                                        <th style="padding: 0 1rem 0.5rem;">Class</th>
                                        <th style="padding: 0 1rem 0.5rem; text-align: right;">Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${tripExpenses.length > 0 ? tripExpenses.map(e => `
                                        <tr style="background: white; transform: scale(1); transition: 0.2s;" onmouseover="this.style.background='#f0f9ff';" onmouseout="this.style.background='white';">
                                            <td style="padding: 0.8rem 1rem; border-top: 1px solid #f1f5f9; border-bottom: 1px solid #f1f5f9; border-left: 1px solid #f1f5f9; border-top-left-radius: 12px; border-bottom-left-radius: 12px; font-weight: 700; font-size: 0.75rem; color: #64748b;">
                                                ${new Date(e.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                            </td>
                                            <td style="padding: 0.8rem 1rem; border-top: 1px solid #f1f5f9; border-bottom: 1px solid #f1f5f9; font-weight: 800; font-size: 0.85rem; color: #0b3b5b;">
                                                ${e.description}
                                            </td>
                                            <td style="padding: 0.8rem 1rem; border-top: 1px solid #f1f5f9; border-bottom: 1px solid #f1f5f9;">
                                                <span style="padding: 0.25rem 0.6rem; background: #f1f5f9; border-radius: 8px; font-size: 0.6rem; font-weight: 900; color: #0369a1; text-transform: uppercase;">
                                                    ${e.category}
                                                </span>
                                            </td>
                                            <td style="padding: 0.8rem 1rem; border-top: 1px solid #f1f5f9; border-bottom: 1px solid #f1f5f9; border-right: 1px solid #f1f5f9; border-top-right-radius: 12px; border-bottom-right-radius: 12px; text-align: right; font-weight: 900; color: #0b3b5b; font-size: 0.9rem;">
                                                ${this.formatCurrency(e.amount)}
                                            </td>
                                        </tr>
                                    `).join('') : '<tr><td colspan="4" style="text-align:center; padding: 2rem; color:#94a3b8; font-weight:700;">Zero transactions detected</td></tr>'}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            `;

                // Professional Footer Actions 
                uiBox.innerHTML += `
                <div class="report-footer-actions" style="margin: 0 2.5rem 2.5rem; padding-top: 2rem; border-top: 1px solid #f1f5f9; display: flex; justify-content: flex-end; gap: 1.5rem;">
                    <button onclick="window.print()" style="padding: 1rem 2rem; background: white; border: 2px solid #0b3b5b; color: #0b3b5b; border-radius: 16px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 0.75rem; transition: 0.3s;" onmouseover="this.style.background='#f0f9ff'" onmouseout="this.style.background='white'">
                        <i class="fas fa-print"></i> Print Report
                    </button>
                    <button onclick="app.downloadReport(${trip.id})" style="padding: 1rem 2.5rem; background: #0b3b5b; color: white; border: none; border-radius: 16px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 0.75rem; box-shadow: 0 10px 20px rgba(11,59,91,0.2); transition: 0.3s;" onmouseover="this.style.transform='translateY(-3px)'; this.style.boxShadow='0 15px 30px rgba(11,59,91,0.3)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 10px 20px rgba(11,59,91,0.2)'">
                        <i class="fas fa-file-pdf"></i> Download Official PDF
                    </button>
                </div>
            `;

                // Initialize Chart.js
                setTimeout(() => {
                    const ctx = document.getElementById('reportDoughnutChart').getContext('2d');
                    new Chart(ctx, {
                        type: 'doughnut',
                        data: {
                            labels: Object.keys(categories).map(c => c.charAt(0).toUpperCase() + c.slice(1)),
                            datasets: [{
                                data: Object.values(categories),
                                backgroundColor: ['#0b3b5b', '#1a5f7a', '#2a8faa', '#57c1d3', '#10b981', '#f59e0b', '#ef4444'],
                                borderWidth: 0,
                                hoverOffset: 15
                            }]
                        },
                        options: {
                            animation: false,
                            responsive: true,
                            maintainAspectRatio: false,
                            cutout: '80%',
                            plugins: {
                                legend: {
                                    position: 'bottom',
                                    labels: {
                                        usePointStyle: true,
                                        padding: 15,
                                        font: { size: 10, weight: '700', family: "'Inter', sans-serif" },
                                        color: '#64748b'
                                    }
                                },
                                tooltip: {
                                    backgroundColor: '#0b3b5b',
                                    titleFont: { size: 14, weight: '900' },
                                    bodyFont: { size: 13, weight: '600' },
                                    padding: 15,
                                    displayColors: false,
                                    callbacks: {
                                        label: (context) => ` ${this.getCurrencySymbol()}${context.raw.toLocaleString()} `
                                    }
                                }
                            }
                        }
                    });
                }, 100);

            } catch (err) {
                console.error(err);
                this.showToast('Failed to load strategic audit data', 'error');
            }
        }

        closeReportDetail() {
            const subView = document.getElementById('reportDetailSubView');
            const grid = document.getElementById('reportsGrid');
            const filters = document.querySelector('.filters-section');
            const templates = document.querySelector('.templates-section');
            const summary = document.querySelector('.expense-summary');

            if (subView) subView.style.display = 'none';
            if (grid) grid.style.display = 'grid';
            if (filters) filters.style.display = 'block';
            if (templates) templates.style.display = 'block';
            if (summary) summary.style.display = 'grid';

            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        async viewMonthlyReport(month) {
            this.showToast(`Generating consolidated audit for ${month}...`, 'info');
        }

        async viewCategoryReport(category) {
            this.showToast(`Analyzing sector performance for ${category}...`, 'info');
        }

        async downloadReport(tripId) {
            // Validation: Attempt to find target even if tripId is missing
            let element = document.getElementById('reportDetailUIBox');

            try {
                this.showToast('Generating official archive...', 'info');

                // 1. ENSURE VISIBILITY: The element MUST be in the DOM and visible for a valid capture
                if (!element || element.innerHTML.trim() === "" || (tripId && !element.getAttribute('data-active-trip') == tripId)) {
                    await this.viewReport(tripId);
                    element = document.getElementById('reportDetailUIBox'); // Re-select after render
                }

                // 2. STABILITY DELAY: Reduced to avoid long loading screen
                await new Promise(r => setTimeout(r, 500));

                if (!element || !window.html2pdf) {
                    throw new Error('Capture engine or target missing');
                }

                // 3. PRE-CAPTURE PREP: Temporarily hide action buttons on the LIVE element
                const footerActions = element.querySelector('.report-footer-actions');
                if (footerActions) footerActions.style.opacity = '0';

                const destination = element.querySelector('h1')?.innerText || 'Trip_Analysis';
                const filename = `IntelliTrip_Report_${destination.replace(/\s+/g, '_')}.pdf`;

                // 4. MASTER CAPTURE CONFIG: Fast but Vibrant Engine
                const opt = {
                    margin: [10, 5, 10, 5],
                    filename: filename,
                    image: { type: 'jpeg', quality: 1.0 },
                    html2canvas: {
                        scale: 3,
                        useCORS: true,
                        letterRendering: true,
                        scrollY: 0,
                        backgroundColor: '#ffffff'
                    },
                    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
                    pagebreak: { mode: ['css', 'legacy'] }
                };

                // 5. EXECUTE EXPORT
                await html2pdf().set(opt).from(element).save();

                // 6. RESTORE UI: Bring buttons back after capture
                if (footerActions) footerActions.style.opacity = '1';

                this.showToast('Report Exported Successfully!', 'success');

            } catch (err) {
                console.error('PDF Master Engine Error:', err);
                this.showToast('Native capture failed. Reverting to system print...', 'warning');
                window.print();
            }
        }

        shareReport(tripId) {
            const trip = this.allTripsForReports?.find(t => t.id == tripId);
            const dest = trip ? trip.destination : 'Trip';
            const shareLink = `https://intellitrip.com/shared/${tripId}-${Math.random().toString(36).substr(2, 5)}`;
            navigator.clipboard.writeText(shareLink).then(() => {
                this.showToast(`Encrypted share link for ${dest} copied!`, 'success');
            });
        }

        generateReport() {
            this.showToast('Refreshing your travel financial data...', 'info');
            this.loadReportsData();
        }

        useTemplate(template) {
            this.showToast(`Loading ${template.replace('_', ' ')} logic...`, 'success');
            if (template === 'trip_summary') {
                document.getElementById('reportTypeFilter').value = 'trip';
                this.filterReports();
            } else if (template === 'category_analysis') {
                document.getElementById('reportTypeFilter').value = 'category';
                this.filterReports();
            }
        }

        applyReportFilters() {
            this.filterReports();
        }

        loadNotifications() {
            // This function is now superseded by loadDashboardData which fetches all data at once.
        }

        async respondToInvite(tripId, status) {
            try {
                const token = localStorage.getItem('token');
                if (!token) return;

                const res = await fetch('/api/trips/invite/respond', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': token
                    },
                    body: JSON.stringify({ tripId, status })
                });

                const data = await res.json();
                if (res.ok) {
                    this.showToast(`Trip invitation ${status} `, 'success');
                    await this.fetchCoreData(true); // Force Refresh Data (New Trip or Removed Invite)
                    this.loadDashboardData();
                } else {
                    this.showToast(data.msg || 'Error responding to invite', 'error');
                }
            } catch (err) {
                console.error('Invite Response Error:', err);
                this.showToast('Failed to connect to server', 'error');
            }
        }

        getNotificationIcon(type) {
            const icons = {
                trip: 'suitcase',
                expense: 'file-invoice-dollar',
                system: 'cog',
                collaborator: 'user-plus',
                invite: 'user-plus'
            };
            return icons[type] || 'bell';
        }

        formatRelativeTime(date) {
            if (isNaN(date.getTime())) return 'Recently';
            const now = new Date();
            const diffInSeconds = Math.floor((now - date) / 1000);

            if (diffInSeconds < 60) return 'Just now';

            const diffInMinutes = Math.floor(diffInSeconds / 60);
            if (diffInMinutes < 60) return `${diffInMinutes}m ago`;

            const diffInHours = Math.floor(diffInMinutes / 60);
            if (diffInHours < 24) return `${diffInHours}h ago`;

            const diffInDays = Math.floor(diffInHours / 24);
            if (diffInDays < 7) return `${diffInDays}d ago`;

            return date.toLocaleDateString();
        }

        async markNotificationAsRead(id) {
            if (!id || id.toString().startsWith('invite_') || id.toString().startsWith('tip_') || id.toString().startsWith('trip_start_')) return;
            try {
                const token = localStorage.getItem('token');
                const res = await fetch(`/api/notifications/${id}/mark-read`, {
                    method: 'PUT',
                    headers: { 'Authorization': token }
                });
                if (res.ok) {
                    this.loadDashboardData(); // Refresh to update badge and list
                }
            } catch (err) {
                console.error('Mark Read Error:', err);
            }
        }

        // Call this inside loadDashboardData to trigger smart logistics
        // Helper to find the "active" trip for logistics logic
        getActiveTrip() {
            if (!this.allTrips || this.allTrips.length === 0) return null;
            const now = new Date();
            // 1. Check for currently ongoing trip
            const ongoing = this.allTrips.find(t => {
                const start = new Date(t.start_date);
                const end = new Date(t.end_date);
                return now >= start && now <= end;
            });
            if (ongoing) return ongoing;

            // 2. Check for next upcoming
            const upcoming = this.allTrips
                .filter(t => new Date(t.start_date) > now)
                .sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

            return upcoming.length > 0 ? upcoming[0] : null;
        }

        async markAllNotificationsRead() {
            try {
                // Optimistic Update
                this.currentNotifications.forEach(n => n.read = true);

                // Immediate UI update
                this.updateNotificationBadge();
                this.renderNotificationItems(5); // Re-render visible list

                this.showToast('Marking all as read...', 'info');

                const token = localStorage.getItem('token');
                const res = await fetch('/api/notifications/mark-all-read', {
                    method: 'PUT',
                    headers: { 'Authorization': token }
                });

                if (res.ok) {
                    // Background refresh to ensure sync
                    // no need to show another toast if successful
                } else {
                    this.showToast('Sync failed, reloading...', 'error');
                    this.loadDashboardData(); // Revert on failure
                }
            } catch (err) {
                console.error('Mark All Read Error:', err);
                this.loadDashboardData(); // Revert on error
            }
        }

        async loadAITips(refresh = false) {
            if (this._loadingAITips) return;
            this._loadingAITips = true;

            try {
                const token = localStorage.getItem('token');
                if (!token) {
                    console.error('[loadAITips] No token found in localStorage');
                    this.showToast('Please log in to access AI tips', 'warning');
                    return;
                }

                console.log('[loadAITips] Starting load, refresh=' + refresh);

                // 1. Load basic tips from cache if not refreshing
                if (!refresh) {
                    const cached = localStorage.getItem('cachedAITips');
                    if (cached) {
                        try {
                            const parsedCache = JSON.parse(cached);
                            // Check if cached currency matches current preference
                            const userData = JSON.parse(localStorage.getItem('user') || '{}');
                            const currentCurrency = userData.preferred_currency || 'INR';
                            // If parsedCache doesn't have currency field (legacy) or mismatch, we invalidate
                            if (parsedCache.currency && parsedCache.currency !== currentCurrency) {
                                console.log('[loadAITips] Currency mismatch in cache, forcing refresh.');
                                throw new Error('Currency mismatch');
                            }

                            if (parsedCache && parsedCache.personalized && parsedCache.personalized.length > 0) {
                                // Clean up cached tips
                                const cleanTipTitle = (tip) => {
                                    let cleanedTitle = tip.title
                                        .replace(/DYNAMIC-AI-X\s*/gi, '')
                                        .replace(/\[.*?\]\s*/g, '')
                                        .trim();
                                    return { ...tip, title: cleanedTitle };
                                };

                                this.aiTips = {
                                    personalized: (parsedCache.personalized || []).map(cleanTipTitle),
                                    travel: (parsedCache.travel || []).map(cleanTipTitle),
                                    budget: (parsedCache.budget || []).map(cleanTipTitle),
                                    places: (parsedCache.places || []).map(cleanTipTitle),
                                    saved: parsedCache.saved || []
                                };

                                // Still fetch fresh SAVED tips from backend to ensure consistency
                                try {
                                    const sRes = await fetch('/api/ai/tips/saved', { headers: { 'Authorization': token } });
                                    if (sRes.ok) this.aiTips.saved = await sRes.json();
                                } catch (e) { console.warn('Saved tips sync failed:', e); }

                                this.updateDashboardAITips();
                                this.assembleForYouTips();
                                return;
                            }
                        } catch (e) {
                            localStorage.removeItem('cachedAITips');
                        }
                    }
                }

                // Show loading state if refreshing
                if (refresh) {
                    const container = document.querySelector('.ai-tips-container');
                    if (container) container.innerHTML = '<div style="text-align:center; padding:1rem;"><i class="fas fa-spinner fa-spin" style="color:#2a8faa; font-size:1.5rem;"></i><p style="color:#64748b; font-size:0.85rem; margin-top:0.5rem;">Generating fresh insights for you...</p></div>';
                }

                const userData = JSON.parse(localStorage.getItem('user') || '{}');
                const currency = userData.preferred_currency || 'INR';
                const url = `/api/ai/tips?refresh=${refresh ? 'true' : 'false'}&currency=${currency}&t=${Date.now()}`;
                console.log('[loadAITips] Fetching from:', url);



                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s Timeout for AI

                const res = await fetch(url, {
                    headers: { 'Authorization': token },
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                console.log('[loadAITips] Response status:', res.status, res.statusText);

                if (res.ok) {
                    let data = await res.json();
                    let tips = [];
                    let focus = null;

                    console.log('[loadAITips] Data received:', data);

                    // Handle different response structures
                    if (Array.isArray(data)) {
                        tips = data;
                    } else if (data.tips && Array.isArray(data.tips)) {
                        tips = data.tips;
                        focus = data.focus; // Extract focus theme
                    } else {
                        throw new Error("Invalid tips format");
                    }

                    console.log('[loadAITips] Total tips received:', tips.length);

                    // Categorize tips from API (Case-Insensitive)
                    const normalize = (cat) => (cat || '').toLowerCase();

                    // Clean up tip titles - remove debug markers and city prefixes
                    const cleanTipTitle = (tip) => {
                        let cleanedTitle = tip.title
                            .replace(/DYNAMIC-AI-X\s*/gi, '')  // Remove DYNAMIC-AI-X
                            .replace(/\[.*?\]\s*/g, '')         // Remove [City] prefixes
                            .trim();
                        return { ...tip, title: cleanedTitle };
                    };

                    const categorized = {
                        personalized: tips.filter(t => normalize(t.category) === 'personalized').map(cleanTipTitle),
                        travel: tips.filter(t => normalize(t.category) === 'travel').map(cleanTipTitle),
                        budget: tips.filter(t => normalize(t.category) === 'budget').map(cleanTipTitle),
                        places: tips.filter(t => normalize(t.category) === 'places').map(cleanTipTitle)
                    };

                    console.log('[loadAITips] Categorized:', {
                        personalized: categorized.personalized.length,
                        'travel': categorized.travel.length,
                        'budget': categorized.budget.length,
                        'places': categorized.places.length
                    });

                    // Load saved tips from BACKEND (Source of truth)
                    let savedTips = [];
                    try {
                        const sRes = await fetch('/api/ai/tips/saved', { headers: { 'Authorization': token } });
                        if (sRes.ok) savedTips = await sRes.json();
                    } catch (e) { console.warn('Initial saved tips fetch failed:', e); }

                    this.aiTips = {
                        ...categorized,
                        saved: savedTips,
                        activeFocus: focus,
                        currency: currency // Store currency for cache invalidation
                    };

                    // Persist to localStorage (Base tips only)
                    localStorage.setItem('cachedAITips', JSON.stringify(this.aiTips));

                    console.log('[loadAITips] Success! Tips loaded and cached');
                    this.updateDashboardAITips();
                    this.assembleForYouTips(); // Build the mixed feed
                } else {
                    const errorText = await res.text();
                    console.error('[loadAITips] API returned error:', res.status, errorText);
                    if (refresh && this.showToast) {
                        this.showToast('Unable to refresh AI tips. Keeping cached data.', 'warning');
                    }
                }
            } catch (err) {
                console.error("[loadAITips] Exception:", err);
                if (refresh && this.showToast) {
                    this.showToast('Network error while refreshing tips.', 'error');
                }
            }

            // Only load static/empty IF we don't have data yet.
            if (!this.aiTips || !this.aiTips.personalized || this.aiTips.personalized.length === 0) {
                console.warn('[loadAITips] No data available, calling loadStaticAITips');
                this.loadStaticAITips();
            } else {
                this.updateDashboardAITips();
            }
            this._loadingAITips = false;
        }

        assembleForYouTips() {
            if (!this.aiTips) return;

            const p = this.aiTips.personalized || [];
            const t = this.aiTips.travel || [];
            const b = this.aiTips.budget || [];
            const l = this.aiTips.places || [];

            // Build a mixed feed of purely travel-specific data
            const mixed = [
                ...p.slice(0, 4),  // Top 4 Personalized
                ...t.slice(0, 3),  // 3 Travel logistics
                ...b.slice(0, 3),  // 3 Budget tips
                ...l.slice(0, 3),  // 3 Places to visit
            ];

            // Shuffle for variety
            mixed.sort(() => Math.random() - 0.5);

            if (this.currentAITips) {
                this.currentAITips['for-you'] = mixed;
            } else {
                this.currentAITips = { 'for-you': mixed };
            }
        }

        // NEW: Smart Logistics Logic removed
        async _triggerSmartLogisticsInternal(refresh = false) {
            // No-op
        }

        async getClimateRecommendations(refresh = false) {
            try {
                const indiaKeywords = ['india', 'mumbai', 'delhi', 'bangalore', 'goa', 'kerala', 'jaipur', 'chennai', 'hyderabad', 'pune', 'manali', 'leh', 'shimla'];
                const hasIndiaTrip = this.allTrips?.some(t => {
                    const dest = t.destination.toLowerCase();
                    return indiaKeywords.some(key => dest.includes(key));
                });
                const res = await fetch(`/api/ai/recommendations?isIndia=${hasIndiaTrip}&refresh=${refresh}&t=${Date.now()}`);
                if (res.ok) {
                    return await res.json();
                }
                return [];
            } catch (e) {
                console.warn('Climate recommendations fetch failed');
                return [];
            }
        }



        loadStaticAITips() {
            // VERIFIED FALLBACKS - IF YOU SEE THESE, THE API FAILED BUT THE CODE IS UPDATED
            console.warn('⚠️ TRIGGERING VERIFIED STATIC FALLBACKS');
            this.aiTips = {
                personalized: [
                    { title: "Smart Group Sync", category: "Personalized", icon: "users", content: "AI Sync: Your group spending is currently balanced. Continue using the split feature to maintain financial transparency.", tags: ["Verified"], city: "Delhi" },
                    { title: "Adaptive Packing", category: "Personalized", icon: "briefcase", content: "Based on your trip history, we recommend a minimalist approach for your next destination. Pack for 3 days and use local laundry.", tags: ["Verified"], city: "Mumbai" }
                ],
                travel: [
                    { title: "Intelligent Routes", category: "Travel", icon: "plane", content: "Route analysis suggests peak travel efficiency between 10 AM and 2 PM. Avoid mid-morning rush for major transit hubs.", tags: ["Verified"], city: "Bangalore" },
                    { title: "Border Protocol", category: "Travel", icon: "shield-alt", content: "Maintain digital backups of all entry requirements. Our intelligence shows increased document checks in major transit corridors.", tags: ["Verified"], city: "New York" }
                ],
                budget: [
                    { title: "Arbitrage Savings", category: "Budget", icon: "wallet", content: "Using local currency accounts can bypass up to 4% in conversion fees. Always opt for local currency at point-of-sale terminals.", tags: ["Verified"], city: "London" },
                    { title: "Micro-Local Dining", category: "Budget", icon: "utensils", content: "Inland restaurants typically offer 30% lower prices than coastal tourist spots. Explore 500m away from main strips for better value.", tags: ["Verified"], city: "Paris" }
                ],
                places: [
                    { title: "Hidden Heritages", category: "Places", icon: "camera", content: "Visit cultural landmarks at opening hours to bypass 80% of crowd volume. The morning light provides 2x better photographic conditions.", tags: ["Verified"], city: "Rome" },
                    { title: "Transit Shortcuts", category: "Places", icon: "subway", content: "Secondary metro lines are often 25% faster during peak hours. Grab a multi-day pass for maximum mobility and savings.", tags: ["Tokyo"], city: "Tokyo" },
                ],
                saved: this.aiTips?.saved || []
            };
            this.updateDashboardAITips();
        }

        updateDashboardAITips() {
            const container = document.querySelector('.ai-tips-container');
            if (!container || !this.aiTips) return;

            // Take a mix from the For You feed
            if (!this.currentAITips || !this.currentAITips['for-you']) {
                this.assembleForYouTips();
            }

            const tips = (this.currentAITips?.['for-you'] || []).slice(0, 3);
            const focus = this.aiTips.activeFocus;

            if (tips.length === 0) {
                container.innerHTML = '<p class="text-muted p-3" style="text-align:center; font-size:0.9rem;">No AI insights currently generated.</p>';
                return;
            }

            let focusHtml = '';
            if (focus) {
                focusHtml = `
            <div class="ai-focus-banner">
                <i class="fas fa-sparkles"></i> 
                <span>FOCUS: ${focus}</span>
            </div>
        `;
            }

            container.innerHTML = focusHtml + tips.map(tip => `
            <div class="dashboard-ai-tip" onclick="app.openAITips()" style="padding:1rem 1.25rem; border-bottom:1px solid #f1f5f9; cursor:pointer; transition:background 0.2s;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:0.25rem;">
                    <h4 style="margin:0; font-size:0.9rem; color:#0f172a; font-weight:700;">${tip.title}</h4>
                    <span style="font-size:0.6rem; background:#e0f2fe; color:#0284c7; padding:2px 6px; border-radius:3px; font-weight:700; text-transform:uppercase;">${tip.category || 'TIP'}</span>
                </div>
                <p style="margin:0; font-size:0.8rem; color:#64748b; line-height:1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${tip.content}</p>
            </div>
        `).join('') + `
            <div style="padding:0.75rem; text-align:center;">
                <button onclick="app.openAITips()" style="background:none; border:none; color:#0e7490; font-size:0.75rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:4px; margin:0 auto;">
                    View Detailed Insights <i class="fas fa-arrow-right"></i>
                </button>
            </div>
        `;
        }

        async renderUpcomingTrips(trips) {
            const container = document.getElementById('upcomingTripsList');
            if (!container) return;

            if (!trips || trips.length === 0) {
                container.innerHTML = '<p class="text-muted text-center py-3">No upcoming trips</p>';
                return;
            }

            const tripItems = await Promise.all(trips.map(async t => {
                const now = new Date();
                const start = new Date(t.start_date);
                const end = new Date(t.end_date);

                // Reset times for accurate day calculation
                const nowMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
                const startMs = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
                const endMs = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();

                const tripDuration = Math.max(1, Math.ceil((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1); // +1 inc start date
                const daysUntil = Math.ceil((startMs - nowMs) / (1000 * 60 * 60 * 24));

                const isOngoing = nowMs >= startMs && nowMs <= endMs;
                const isPast = nowMs > endMs;

                let statusBadge = '';
                let progressHTML = '';

                const [tripImg, weather] = await Promise.all([
                    this.getDestinationImage(t.destination),
                    this.getDestinationWeather(t.destination)
                ]);

                let weatherHTML = '';
                let aiHintHTML = '';

                weatherHTML = `
            <div style="font-size: 0.75rem; color: #0e7490; background: #e0f2fe; padding: 2px 8px; border-radius: 10px; display: inline-flex; align-items: center; gap: 4px; margin-top: 4px;">
                <i class="fas fa-thermometer-half"></i> ${weather ? weather.temp : '--'}°C ${weather ? weather.main : 'N/A'}
                </div>
            `;

                if (weather) {
                    // Quick climate-based tip logic (simple heuristic for the list view)
                    const isCold = weather.temp < 15;
                    const isHot = weather.temp > 28;
                    const isRainy = weather.main.toLowerCase().includes('rain');

                    let hint = 'Plan your activities';
                    if (isCold) hint = 'Pack warm layers';
                    else if (isHot) hint = 'Stay hydrated & sunscreen';
                    else if (isRainy) hint = 'Carry an umbrella/raincoat';

                    aiHintHTML = `
            <div style="font-size: 0.7rem; color: #a16207; background: #fef9c3; padding: 2px 8px; border-radius: 10px; display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; margin-left: 4px;">
                <i class="fas fa-lightbulb"></i> AI: ${hint}
                    </div>
            `;
                }

                if (isOngoing) {
                    const dayOfTrip = Math.ceil((nowMs - startMs) / (1000 * 60 * 60 * 24)) + 1;
                    const progress = Math.min(100, Math.max(0, (dayOfTrip / tripDuration) * 100));

                    statusBadge = `<span class="status-badge ongoing" style="background:var(--accent-gradient); color:white; border:none;">ONGOING</span>`;

                    progressHTML = `
            <div style="margin-top:0.5rem; width:100%;">
                    <div style="display:flex; justify-content:space-between; font-size:0.75rem; font-weight:600; color:var(--gray-500); margin-bottom:0.25rem;">
                        <span>Day ${dayOfTrip} of ${tripDuration}</span>
                        <span>${Math.round(progress)}%</span>
                    </div>
                    <div style="height:6px; background:var(--gray-100); border-radius:3px; overflow:hidden;">
                        <div style="height:100%; background:var(--success); width:${progress}%; transition:width 1s ease;"></div>
                    </div>
                </div>
            `;
                } else if (isPast) {
                    statusBadge = `<span class="status-badge" style="background:var(--gray-200); color:var(--gray-600);">COMPLETED</span>`;
                } else {
                    const dayText = daysUntil === 0 ? 'Starts Today' : (daysUntil === 1 ? 'Starts Tomorrow' : `In ${daysUntil} days`);
                    statusBadge = `<span class="status-badge upcoming">${dayText}</span>`;
                }

                return `
            <div class="trip-item" onclick="openTripPlanner(${t.id})" style="flex-wrap:wrap; padding: 1rem 1.25rem; cursor: pointer;">
            <div class="trip-img-container">
                <img src="${tripImg}" alt="${t.destination}" onerror="this.onerror=null; this.src='https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=800&q=80';">
            </div>
            <div class="trip-details" style="flex:1; min-width:150px;">
                <h4 style="margin-bottom:0.1rem;">${t.destination}</h4>
                <p style="margin:0; font-size:0.85rem; color:var(--gray-500);">${start.toLocaleDateString()} - ${end.toLocaleDateString()}</p>
                <div style="display: flex; flex-wrap: wrap;">
                    ${weatherHTML}
                    ${aiHintHTML}
                </div>
                ${progressHTML}
            </div>
            <div class="trip-status" style="display:flex; flex-direction:column; align-items:flex-end; gap:0.25rem; margin-left:1rem;">
                ${statusBadge}
                <button class="btn-link" onclick="event.stopPropagation(); app.manageTrip(${t.id})" style="font-size:0.8rem; background: #f1f5f9; padding: 4px 10px; border-radius: 8px;">
                    <i class="fas fa-users-cog"></i> Manage
                </button>
            </div>
        </div>
            `;
            }));

            container.innerHTML = tripItems.join('');
        }

        scanReceipt() {
            const btn = document.querySelector('button[onclick="app.scanReceipt()"]');
            if (btn) {
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Scanning...';
                btn.disabled = true;
            }

            // Simulate AI Delay
            setTimeout(() => {
                // Fill with dummy data
                document.getElementById('expenseDesc').value = 'Starbucks Coffee';
                document.getElementById('expenseAmount').value = '350';
                document.getElementById('expenseCategory').value = 'food';
                this.showToast('Receipt scanned & parsed successfully!', 'success');

                if (btn) {
                    btn.innerHTML = '<i class="fas fa-check"></i> Scanned!';
                    btn.style.background = '#dcfce7';
                    btn.style.borderColor = '#166534';
                    btn.style.color = '#166534';
                }
            }, 1500);
        }

        async getDestinationImage(destination) {
            if (!destination) return 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=400&q=80';

            // Extract FIRST location if multi-destination (e.g., "Paris → Lyon")
            const displayLocation = destination.includes(' → ') ? destination.split(' → ')[0].trim() : destination;
            const key = displayLocation.toLowerCase().trim();
            if (this.destinationImageCache[key]) return this.destinationImageCache[key];

            const destinationMap = {
                'andaman': 'https://images.unsplash.com/photo-1589330273594-fade1ee91647',
                'manali': 'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23',
                'goa': 'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2',
                'kerala': 'https://images.unsplash.com/photo-1602216056096-3b40cc0c9944',
                'jaipur': 'https://images.unsplash.com/photo-1477587458883-47145ed94245',
                'mumbai': 'https://images.unsplash.com/photo-1566552881560-0be862a7c445',
                'bengaluru': 'https://images.unsplash.com/photo-1596176530529-78163a4f7af2',
                'shimla': 'https://images.unsplash.com/photo-1566837945700-30057527ade0',
                'ladakh': 'https://images.unsplash.com/photo-1581793496924-4f08e43e2618',
                'paris': 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34',
                'london': 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad',
                'dubai': 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c',
                'new york': 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9',
                'tokyo': 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf',
                'singapore': 'https://images.unsplash.com/photo-1525625293386-3f8f99389edd',
                'bali': 'https://images.unsplash.com/photo-1537996194471-e657df975ab4',
                'maldives': 'https://images.unsplash.com/photo-1514282401047-d79a71a590e8',
                'switzerland': 'https://images.unsplash.com/photo-1530122037265-a5f1f91d3b99',
                'italy': 'https://images.unsplash.com/photo-1523906834658-6e24ef2386f9'
            };

            let resultUrl = '';

            // Check for specific match in local map
            for (const [dest, url] of Object.entries(destinationMap)) {
                if (key.includes(dest)) {
                    resultUrl = `${url}?auto=format&fit=crop&w=400&q=80`;
                    break;
                }
            }

            if (!resultUrl) {
                // 2. Try Wikipedia Image Search (Smart Search - finds top result like Google)
                try {
                    // Use generator=search to find the most relevant page, not just exact title match
                    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(destination)}&gsrlimit=1&prop=pageimages&piprop=thumbnail&pithumbsize=600&format=json&origin=*`;

                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5s Timeout

                    const wikiRes = await fetch(wikiUrl, { signal: controller.signal });
                    clearTimeout(timeoutId);

                    const wikiData = await wikiRes.json();

                    if (wikiData.query && wikiData.query.pages) {
                        const pages = Object.values(wikiData.query.pages);
                        if (pages.length > 0 && pages[0].thumbnail) {
                            console.log(`Image found for ${destination}:`, pages[0].thumbnail.source);
                            resultUrl = pages[0].thumbnail.source;
                        }
                    }
                } catch (e) {
                    console.warn('Wiki image fetch failed, fallback to AI');
                }
            }

            if (!resultUrl) {
                // 3. Fallback to Pollinations.ai (Dynamic AI Generation)
                // Using a refined prompt for realistic travel photography
                resultUrl = `https://image.pollinations.ai/prompt/cinematic%20travel%20photography%20of%20${encodeURIComponent(destination)},%20landmark,%20scenic,%204k,%20highly%20detailed?width=600&height=400&nologo=true`;
            }

            this.destinationImageCache[key] = resultUrl;
            return resultUrl;
        }

        async getDestinationSummary(destination) {
            if (!destination) return "No destination provided.";
            const firstLoc = destination.includes(' → ') ? destination.split(' → ')[0].trim() : destination;
            try {
                // Search for the most relevant page title
                const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(firstLoc)}&srlimit=1&format=json&origin=*`;
                const searchRes = await fetch(searchUrl);
                const searchData = await searchRes.json();

                if (searchData.query.search.length > 0) {
                    const title = searchData.query.search[0].title;
                    // Get the summary (extract) for that title
                    const summaryUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&titles=${encodeURIComponent(title)}&format=json&origin=*`;
                    const summaryRes = await fetch(summaryUrl);
                    const summaryData = await summaryRes.json();
                    const pages = summaryData.query.pages;
                    const pageId = Object.keys(pages)[0];
                    if (pageId !== "-1") {
                        let extract = pages[pageId].extract;
                        if (extract.length > 450) {
                            extract = extract.substring(0, 447) + "...";
                        }
                        return `${extract} <a href="https://en.wikipedia.org/wiki/${encodeURIComponent(title)}" target="_blank" style="color:#2a8faa; font-weight:700; text-decoration:none; margin-left:4px;">Read more on Wikipedia <i class="fas fa-external-link-alt" style="font-size:0.7em;"></i></a>`;
                    }
                }
            } catch (e) {
                console.warn('Wiki summary fetch failed');
            }
            return `Explore the beauty and culture of ${destination}. Discover local landmarks, hidden gems, and create unforgettable memories. <a href="https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(destination)}" target="_blank" style="color:#2a8faa; font-weight:700; text-decoration:none; margin-left:4px;">Find out more <i class="fas fa-external-link-alt" style="font-size:0.7em;"></i></a>`;
        }

        async getDestinationAIInfo(destination) {
            const firstLoc = destination.includes(' → ') ? destination.split(' → ')[0].trim() : destination;
            try {
                const res = await fetch(`/api/ai/season?destination=${encodeURIComponent(firstLoc)}`);
                if (res.ok) {
                    return await res.json();
                }
            } catch (e) {
                console.warn('AI Destination info fetch failed');
            }
            return null;
        }

        async getDestinationWeather(destination) {
            const firstLoc = (destination || '').includes(' → ') ? destination.split(' → ')[0].trim() : (destination || '');
            const key = firstLoc.toLowerCase().trim();
            if (!key) return null;

            // Cache check (30 mins TTL)
            if (this.weatherCache[key] && (Date.now() - this.weatherCache[key].timestamp < 30 * 60 * 1000)) {
                return this.weatherCache[key].data;
            }

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);

                const res = await fetch(`/api/ai/weather?destination=${encodeURIComponent(destination)}`, { signal: controller.signal });
                clearTimeout(timeoutId);

                if (res.ok) {
                    const data = await res.json();
                    this.weatherCache[key] = { timestamp: Date.now(), data };
                    return data;
                }
            } catch (e) {
                console.warn('Weather fetch failed');
            }
            return null;
        }







        async getTripEstimate(destination, days, travelers, style = 'standard') {
            try {
                const res = await fetch(this.getApiUrl('/api/ai/predict-cost'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ destination, days, travelers, style })
                });

                if (!res.ok) throw new Error('Prediction failed');
                return await res.json();
            } catch (err) {
                console.error(err);
                this.showToast('Could not get estimate. Try again later.', 'error');
                return null;
            }
        }

        async manageTrip(tripId) {
            if (!tripId) {
                this.showToast('Invalid Trip ID', 'error');
                return;
            }
            try {
                const token = localStorage.getItem('token');
                const [membersRes, tripRes] = await Promise.all([
                    fetch(`/api/trips/${Number(tripId)}/members`, { headers: { 'Authorization': token } }),
                    fetch(`/api/trips`, { headers: { 'Authorization': token } })
                ]);

                if (!membersRes.ok || !tripRes.ok) {
                    this.showToast(`Error: ${membersRes.status}/${tripRes.status}`, 'error');
                    return;
                }

                const membersData = await membersRes.json();
                const tripsData = await tripRes.json();

                const members = Array.isArray(membersData) ? membersData : [];
                const trips = Array.isArray(tripsData) ? tripsData : [];

                const currentTrip = trips.find(t => Number(t.id) === Number(tripId));
                if (!currentTrip) {
                    this.showToast('Trip not found', 'warning');
                    return;
                }
                const isOwner = currentTrip.role === 'owner';

                // Parallel fetch for images and Wiki/AI info
                const [tripImg, wikiSummary, aiInfo, weather] = await Promise.all([
                    this.getDestinationImage(currentTrip.destination),
                    this.getDestinationSummary(currentTrip.destination),
                    this.getDestinationAIInfo(currentTrip.destination),
                    this.getDestinationWeather(currentTrip.destination),
                    this.detectAndSetTripCurrency(currentTrip.destination) // Auto-detect currency
                ]);

                const tripOptions = trips.map(t => `<option value="${t.id}" ${t.id == tripId ? 'selected' : ''}>${t.destination}</option>`).join('');

                const modalHTML = `
            <div id="manageTripModal" class="manage-modal-overlay" onclick="if(event.target === this) this.remove()">
                <div class="manage-modal-container">
                    <!-- Hero Header -->
                    <div class="manage-modal-hero">
                        <div class="manage-modal-hero-bg" style="background-image: url('${tripImg}')"></div>
                        <div class="manage-trip-badges">
                            <span class="manage-trip-badge">ADMIN &bull; TRIP SETTINGS</span>
                            ${weather ? `
                                <div class="weather-pill" title="${weather.description || weather.main}">
                                    <i class="fas fa-thermometer-half" style="margin-right: 4px;"></i>
                                    <span>${weather.temp}°C</span>
                                </div>
                            ` : ''}
                        </div>
                        <button class="close-manage-modal" onclick="document.getElementById('manageTripModal').remove()" title="Close Manage Panel">
                            <i class="fas fa-times"></i>
                        </button>
                         <div class="manage-modal-hero-content">
                            <div class="trip-title-info">
                                <h2>${currentTrip.destination}</h2>
                            </div>
                            <div class="manage-trip-select-wrapper">
                                <select class="manage-trip-switcher" onchange="document.getElementById('manageTripModal').remove(); app.manageTrip(this.value)">
                                    ${tripOptions}
                                </select>
                                <i class="fas fa-chevron-down select-arrow"></i>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Tabs -->
                    <div class="manage-modal-tabs">
                        <button class="manage-tab-btn active" onclick="app.switchManageTab('members', event)">Team Members</button>
                        <button class="manage-tab-btn" onclick="app.switchManageTab('explore', event)">Explore & AI</button>
                        <button class="manage-tab-btn" onclick="app.switchManageTab('settings', event)">Trip Settings</button>
                    </div>

                    <!-- Body Content -->
                    <div class="manage-modal-body">
                        
                        <!-- MEMBERS TAB -->
                        <div id="manage-members" class="manage-tab-content">
                            <h3 class="manage-section-title"><i class="fas fa-user-plus"></i> Invite Travelers</h3>
                            <div class="invite-group">
                                <input type="email" id="inviteEmail" class="invite-input" placeholder="traveler@example.com">
                                <button onclick="app.inviteMember(${tripId})" class="btn-invite">Send Invite</button>
                            </div>
                            
                            <h3 class="manage-section-title"><i class="fas fa-users"></i> Project Team</h3>
                            <div id="membersList">
                                ${members.map(m => {
                    const name = m.name || 'Traveler';
                    const roleClass = m.role === 'owner' ? 'role-owner' : (m.role === 'accepted' ? 'role-member' : 'role-pending');
                    const roleText = m.role === 'owner' ? 'Owner' : (m.role === 'accepted' ? 'Member' : 'Pending');
                    return `
                                    <div class="member-item-premium">
                                        <div class="member-avatar-box">
                                            ${m.profile_picture ? `<img src="${this.getImageUrl(m.profile_picture)}">` : name.charAt(0).toUpperCase()}
                                        </div>

                                        <div class="member-info-main">
                                            <span class="member-name">${name}</span>
                                            <span class="member-email">${m.email || 'No email provided'}</span>
                                        </div>
                                        <div style="display: flex; align-items: center; gap: 0.75rem;">
                                            <span class="member-role-tag ${roleClass}">${roleText}</span>
                                            ${isOwner && m.role !== 'owner' ? `
                                                <button class="remove-member-btn" onclick="app.removeMember(${tripId}, ${m.id})" title="Remove Member">
                                                    <i class="fas fa-user-minus"></i>
                                                </button>
                                            ` : ''}
                                        </div>
                                    </div>
                                    `;
                }).join('')}
                            </div>
                        </div>

                        <!-- EXPLORE TAB (NEW) -->
                        <div id="manage-explore" class="manage-tab-content" style="display:none;">
                            <div class="explore-info-card" style="background: #f8fafc; border-radius: 16px; padding: 1.5rem; border: 1px solid #e2e8f0; margin-bottom: 1rem;">
                                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1rem;">
                                    <h3 style="color: #0b3b5b; font-size: 1.1rem; margin: 0;"><i class="fab fa-wikipedia-w"></i> About ${currentTrip.destination}</h3>
                                    ${weather ? `
                                        <div style="text-align: right; background: #E0F2FE; padding: 6px 12px; border-radius: 10px; border: 1px solid #BAE6FD;">
                                            <div style="font-weight: 800; color: #0369A1; font-size: 0.9rem;"><i class="fas fa-thermometer-half" style="margin-right: 5px;"></i>${weather.temp}°C</div>
                                            <div style="font-size: 0.7rem; color: #0EA5E9; text-transform: uppercase; font-weight: 700;">${weather.main}</div>
                                            <div style="font-size: 0.65rem; color: #64748b; margin-top: 2px;">Humidity: ${weather.humidity}% | Wind: ${weather.wind}m/s</div>
                                        </div>
                                    ` : ''}
                                </div>
                                <p style="color: #475569; font-size: 0.85rem; line-height: 1.6; margin-bottom: 1.5rem;">${wikiSummary}</p>
                                
                                ${aiInfo ? `
                                <div class="ai-suggestion-box" style="background: linear-gradient(135deg, #0b3b5b 0%, #2a8faa 100%); border-radius: 12px; padding: 1.25rem; color: white;">
                                    <h4 style="margin-bottom: 0.5rem; font-size: 1rem;"><i class="fas fa-robot"></i> Smart Travel Insights</h4>
                                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; font-size: 0.85rem; opacity: 0.9;">
                                        <div>
                                            <span style="display: block; font-weight: 700; color: #B8E7ED; margin-bottom: 4px;">BEST TIME</span>
                                            ${aiInfo.best_time}
                                        </div>
                                        <div>
                                            <span style="display: block; font-weight: 700; color: #B8E7ED; margin-bottom: 4px;">HIGHLIGHTS</span>
                                            ${aiInfo.events ? aiInfo.events.slice(0, 2).join(', ') : 'Popular landmarks'}
                                        </div>
                                    </div>
                                    <p style="margin-top: 1rem; font-size: 0.8rem; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 0.75rem;">
                                        <strong>Pro Tip:</strong> ${aiInfo.reason}
                                    </p>
                                </div>
                                ` : ''}
                            </div>
                        </div>

                        <!-- SETTINGS TAB -->
                        <div id="manage-settings" class="manage-tab-content" style="display:none;">
                            <div class="settings-group">
                                <div class="setting-card">
                                    <span class="setting-label">Manage Financials</span>
                                    <div class="setting-row">
                                        <input type="number" id="tripBudget" class="invite-input" value="${currentTrip.budget}" placeholder="Update your limit">
                                        <button onclick="app.updateTripSettings(${tripId})" class="btn-invite">Update Budget</button>
                                    </div>
                                    <p style="font-size: 0.8rem; color: var(--gray-400); margin-top: 1rem; line-height: 1.4;">
                                        Updating your budget will immediately recalculate your analytics and savings progress for <strong>${currentTrip.destination}</strong>.
                                    </p>
                                </div>

                                <div class="danger-zone">
                                    <h4 class="danger-title"><i class="fas fa-exclamation-triangle"></i> Danger Zone</h4>
                                    <p class="danger-desc">Deleting this trip will permanently remove all associated expenses, receipts, and analytics. This action cannot be undone.</p>
                                    <button class="btn-delete-full" onclick="app.deleteTripWithConfirm(${tripId})">
                                        <i class="fas fa-trash-alt"></i> Delete Trip Permanently
                                    </button>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            </div>
            `;
                const existingModal = document.getElementById('manageTripModal');
                if (existingModal) existingModal.remove();
                document.body.insertAdjacentHTML('beforeend', modalHTML);
            } catch (err) {
                console.error('manageTrip error:', err);
                this.showToast(`Error: ${err.message || 'Failed to load trip details'}`, 'error');
            }
        }


        switchManageTab(tabId, event) {
            // Update tabs
            document.querySelectorAll('.manage-tab-btn').forEach(b => b.classList.remove('active'));
            if (event && event.target) {
                event.target.classList.add('active');
            }

            // Update content
            document.querySelectorAll('.manage-tab-content').forEach(c => c.style.display = 'none');
            const targetContent = document.getElementById(`manage-${tabId}`);
            if (targetContent) targetContent.style.display = 'block';
        }

        async deleteTripWithConfirm(tripId) {
            const confirmed = await this.showConfirm(
                '🚫 Critical Action',
                'Are you absolutely sure you want to delete this entire trip? This will wipe all expenses, receipts, and history forever.',
                'Continue',
                'Cancel'
            );

            if (confirmed) {
                const tripName = await this.showPrompt(
                    'Confirm Deletion',
                    'Type "DELETE" to confirm permanent removal:',
                    '',
                    '🗑️'
                );

                if (tripName === 'DELETE') {
                    await this.deleteTrip(tripId);
                    const modal = document.getElementById('manageTripModal');
                    if (modal) modal.remove();
                } else {
                    this.showToast('Deletion cancelled.', 'info');
                }
            }
        }

        async removeMember(tripId, userId) {
            const confirmed = await this.showConfirm(
                'Remove Member',
                'Are you sure you want to remove this member from the trip?',
                'Remove',
                'Cancel'
            );
            if (!confirmed) return;
            const tid = Number(tripId);
            const uid = Number(userId);
            try {
                const res = await fetch(`/api/trips/${tid}/members/${uid}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': localStorage.getItem('token') }
                });
                if (res.ok) {
                    this.showToast('Member removed', 'success');
                    document.getElementById('manageTripModal').remove();
                    await this.fetchCoreData(true); // Update trip list memory
                    this.manageTrip(tripId); // Reload modal with fresh data
                } else {
                    this.showToast('Failed to remove member', 'error');
                }
            } catch (e) { console.error(e); }
        }

        async updateTripSettings(tripId) {
            const budget = document.getElementById('tripBudget').value;
            const tid = Number(tripId);
            try {
                const res = await fetch(`/api/trips/${tid}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': localStorage.getItem('token') },
                    body: JSON.stringify({ budget })
                });
                if (res.ok) {
                    this.showToast('Budget updated successfully', 'success');
                    await this.fetchCoreData(true); // Sync new budget to app state
                    this.updateRealTimeStats(); // Refresh dashboard
                } else {
                    this.showToast('Failed to update settings', 'error');
                }
            } catch (e) { console.error(e); }
        }

        async inviteMember(tripId) {
            const email = document.getElementById('inviteEmail').value;
            if (!email) return;

            try {
                const token = localStorage.getItem('token');
                const res = await fetch(`/api/trips/${tripId}/collaborators`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': token },
                    body: JSON.stringify({ tripId, email })
                });
                const data = await res.json();
                if (res.ok) {
                    this.showToast(`Invite sent to ${email}`, 'success');
                    document.getElementById('inviteEmail').value = '';
                    document.getElementById('manageTripModal').remove(); // close for now, or reload members
                    await this.fetchCoreData(true); // Force Refresh Data
                } else {
                    this.showToast(data.msg || 'Failed to invite', 'error');
                }
            } catch (e) { console.error(e); }
        }



        async openAITips() {
            // Always try to load fresh tips when opening the modal
            if (!this.aiTips || !this.aiTips.personalized || this.aiTips.personalized.length === 0) {
                await this.loadAITips(false); // Use cache if available, otherwise fetch
            }

            // Final check - if API completely failed (no personalized AND no travel AND no budget AND no places)
            if (
                (!this.aiTips.personalized || this.aiTips.personalized.length === 0) &&
                (!this.aiTips.travel || this.aiTips.travel.length === 0) &&
                (!this.aiTips.budget || this.aiTips.budget.length === 0) &&
                (!this.aiTips.places || this.aiTips.places.length === 0)
            ) {
                console.warn('All AI API categories missing, using static fallbacks');
                this.loadStaticAITips();
            }

            this.assembleForYouTips(); // Initialize for-you mix

            // Use the consolidated data from this.aiTips
            const tips = {
                'for-you': this.currentAITips['for-you'] || [],
                'travel': this.aiTips.travel || [],
                'budget': this.aiTips.budget || [],
                'places': this.aiTips.places || [],
                'general': this.aiTips.general || [],
                'saved': this.aiTips.saved || []
            };

            this.currentAITips = tips;
            if (document.getElementById('aiTipsModal')) {
                // Modal already open, just refresh the content
                this.switchAITab('for-you');
                return;
            }

            const modalHTML = `
        <div id="aiTipsModal" style="display:flex; position:fixed; inset:0; z-index:99999; align-items:center; justify-content:center; background:rgba(0,0,0,0.7); backdrop-filter:blur(5px); animation:fadeIn 0.3s ease;">
            <div style="width:95%; max-width:600px; background:white; border-radius:16px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 25px 50px -12px rgba(0,0,0,0.5); font-family: 'Inter', sans-serif;">
                
                <!-- Blue Header -->
                <div style="padding:1.5rem 2rem; background:linear-gradient(135deg, #164e63 0%, #0891b2 100%); color:white; display:flex; justify-content:space-between; align-items:center;">
                    <div style="display:flex; flex-direction:column; gap:0.25rem;">
                        <h2 style="margin:0; font-size:1.4rem; font-weight:700; display:flex; align-items:center; gap:0.75rem;">
                            <i class="fas fa-magic"></i> Intelligence Hub
                        </h2>
                        <p style="margin:0; font-size:0.8rem; opacity:0.8;">AI-powered travel strategy & optimization</p>
                    </div>
                    ${this.currentWeather ? `
                    <div id="aiWeatherWidget" title="Real-time Weather" style="cursor:help; background:rgba(255,255,255,0.1); padding:0.4rem 0.8rem; border-radius:12px; display:flex; align-items:center; gap:0.5rem; backdrop-filter:blur(10px); margin-left: auto; margin-right: 1rem; border:1px solid rgba(255,255,255,0.15);">
                        <img src="https://openweathermap.org/img/wn/${this.currentWeather.icon}@2x.png" style="width:32px; height:32px; filter: brightness(1.2);">
                        <div style="line-height:1.1;">
                            <div style="font-weight:800; font-size:1.1rem; letter-spacing:-0.5px;">${this.currentWeather.temp}°</div>
                            <div style="font-size:0.6rem; opacity:0.8; text-transform:uppercase; letter-spacing:0.1em; font-weight:700;">${this.currentWeather.location}</div>
                        </div>
                    </div>
                    ` : ''}
                    <div style="display:flex; gap:0.75rem; align-items:center;">
                        <button onclick="app.refreshAITips()" id="refreshTipsBtn" style="background:rgba(255,255,255,0.15); border:1px solid rgba(255,255,255,0.2); padding:0.5rem 0.75rem; border-radius:8px; color:white; font-size:0.85rem; cursor:pointer; display:flex; align-items:center; gap:6px; transition: all 0.2s; backdrop-filter:blur(4px);">
                            <i class="fas fa-sync-alt"></i> Refresh
                        </button>
                        <button onclick="document.getElementById('aiTipsModal').remove()" style="background:rgba(255,255,255,0.2); border:none; width:36px; height:36px; border-radius:50%; color:white; font-size:1.1rem; cursor:pointer; display:flex; align-items:center; justify-content:center; transition: all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.3)'; this.style.transform='rotate(90deg)'" onmouseout="this.style.background='rgba(255,255,255,0.2)'; this.style.transform='rotate(0)'">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>

                <!-- Tabs Bar (Deep Ocean Theme) -->
                <div style="background:#f1f5f9; padding:0.75rem 1.5rem; display:flex; gap:0.5rem; align-items:center; overflow-x: auto; border-bottom:1px solid #e2e8f0; scrollbar-width:none;">
                    <button class="ai-tab active" onclick="app.switchAITab('for-you')">
                        <i class="fas fa-user-astronaut"></i> For You
                    </button>
                    <button class="ai-tab" onclick="app.switchAITab('travel')">
                        <i class="fas fa-plane-departure"></i> Travel
                    </button>
                    <button class="ai-tab" onclick="app.switchAITab('planning')">
                        <i class="fas fa-globe-americas"></i> Explorer
                    </button>
                    <button class="ai-tab" onclick="app.switchAITab('budget')">
                        <i class="fas fa-receipt"></i> Budget
                    </button>
                    <button class="ai-tab" onclick="app.switchAITab('places')">
                        <i class="fas fa-map-marked-alt"></i> Places
                    </button>
                    <button class="ai-tab" onclick="app.switchAITab('saved')">
                        <i class="fas fa-bookmark"></i> Saved
                    </button>
                </div>

                <!-- Content Area -->
                <div id="aiTipsContent" style="flex:1; overflow-y:auto; padding:2rem; min-height:400px; max-height:70vh; background:white;">
                    <!-- Content injected by switchAITab -->
                </div>
            </div>
            
            <style>
                .ai-tab {
                    border:none;
                    background:transparent;
                    color:#64748b;
                    padding:0.6rem 1rem;
                    border-radius:10px;
                    cursor:pointer;
                    font-size:0.85rem;
                    font-weight:700;
                    display:flex;
                    align-items:center;
                    gap:8px;
                    transition:all 0.2s;
                    white-space:nowrap;
                }
                .ai-tab:hover {
                    background:#f8fafc;
                    color:#164e63;
                }
                .ai-tab.active {
                    background:#ecfeff;
                    color:#0891b2;
                    box-shadow:inset 0 0 0 1px #cffafe;
                }
                .ai-card-item {
                    background:white;
                    border:1px solid #e2e8f0;
                    border-radius:12px;
                    padding:1.25rem;
                    margin-bottom:1rem;
                    display:flex;
                    gap:1rem;
                    align-items:start;
                    transition:transform 0.2s;
                }
                .ai-card-item:hover {
                    border-color:#22d3ee;
                    transform:translateY(-2px);
                    box-shadow:0 10px 15px -3px rgba(0,0,0,0.1);
                }
                .ai-icon-box {
                    width:40px; 
                    height:40px; 
                    border-radius:10px; 
                    background:#ecfeff; 
                    color:#0891b2; 
                    display:flex; 
                    align-items:center; 
                    justify-content:center; 
                    font-size:1.1rem;
                    flex-shrink: 0;
                }
            </style>
        </div>
        `;
            document.body.insertAdjacentHTML('beforeend', modalHTML);
            this.switchAITab('for-you');
        }

        async refreshAITips() {
            const btn = document.getElementById('refreshTipsBtn');
            const icon = btn.querySelector('i');
            const originalIconClass = icon.className;

            icon.className = 'fas fa-spinner fa-spin';
            btn.disabled = true;
            btn.style.opacity = '0.7';

            try {
                await this.loadAITips(true);

                this.assembleForYouTips();

                // CRITICAL: Update currentAITips with the new data so the UI reflects changes
                this.currentAITips = {
                    'for-you': this.currentAITips['for-you'] || [],
                    'travel': this.aiTips.travel || [],
                    'budget': this.aiTips.budget || [],
                    'places': this.aiTips.places || [],
                    'general': this.aiTips.general || [],
                    'saved': this.aiTips.saved || []
                };

                // Re-render current active tab if modal is open
                const activeTabBtn = document.querySelector('.ai-tab.active');
                if (activeTabBtn) {
                    const onclick = activeTabBtn.getAttribute('onclick');
                    const match = onclick.match(/'([^']+)'/);
                    if (match) {
                        this.switchAITab(match[1]);
                    }
                }

                // Update Weather Widget
                const widget = document.getElementById('aiWeatherWidget');
                if (this.currentWeather && widget) {
                    widget.innerHTML = `
                    <img src="https://openweathermap.org/img/wn/${this.currentWeather.icon}@2x.png" style="width:32px; height:32px; filter: brightness(1.2);">
                    <div style="line-height:1.1;">
                        <div style="font-weight:800; font-size:1.1rem; letter-spacing:-0.5px;">${this.currentWeather.temp}°</div>
                        <div style="font-size:0.6rem; opacity:0.8; text-transform:uppercase; letter-spacing:0.1em; font-weight:700;">${this.currentWeather.location}</div>
                    </div>
                `;
                } else if (this.currentWeather) {
                    // If widget didn't exist before (was null), just let it be or handle if critical. 
                    // For now, updating existing is sufficient as openAITips handles creation.
                }
                this.showToast('AI Tips refreshed!', 'success');
            } catch (e) {
                console.error(e);
                this.showToast('Refresh failed', 'error');
            } finally {
                icon.className = originalIconClass;
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        }



        async switchAITab(tabId) {
            this.activeAITab = tabId;
            // Update tabs styling
            document.querySelectorAll('.ai-tab').forEach(btn => {
                btn.classList.remove('active');
                const onClickAttr = btn.getAttribute('onclick') || '';
                if (onClickAttr.includes(`'${tabId}'`) || onClickAttr.includes(`"${tabId}"`)) {
                    btn.classList.add('active');
                }
            });

            const container = document.getElementById('aiTipsContent');
            if (!container) return;

            // NO CACHE FOR SAVED TAB - FETCH FRESH FROM BACKEND
            if (tabId === 'saved') {
                container.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:3rem; color:#64748b; animation:fadeIn 0.3s ease;">
                    <i class="fas fa-spinner fa-spin" style="font-size:2rem; margin-bottom:1rem; color:#2a8faa;"></i>
                    <p style="font-weight:600;">Retrieving your bookmarked intelligence...</p>
                </div>`;

                try {
                    const res = await fetch('/api/ai/tips/saved', {
                        headers: { 'Authorization': localStorage.getItem('token') }
                    });
                    if (this.activeAITab !== tabId) return;
                    if (res.ok) {
                        const savedTips = await res.json();
                        this.currentAITips['saved'] = savedTips;
                        this.aiTips.saved = savedTips; // Sync for dashboard
                    }
                } catch (e) {
                    console.error("Failed to fetch saved tips:", e);
                }
            }

            // Special handling for Climate Planning tab
            if (tabId === 'planning') {
                container.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:2rem; color:#64748b;">
                    <i class="fas fa-spinner fa-spin" style="font-size:2rem; margin-bottom:1rem; color:#0e7490;"></i>
                    <p>Consulting climate data for perfect destinations...</p>
                </div>
            `;
                const recs = await this.getClimateRecommendations();
                if (this.activeAITab !== tabId) return;
                if (!recs || recs.length === 0) {
                    container.innerHTML = '<p style="text-align:center; color:#94a3b8; padding:2rem;">Could not load climate recommendations.</p>';
                    return;
                }

                container.innerHTML = `
                <div style="display:flex; flex-direction:column; gap:1.5rem; animation:fadeIn 0.3s ease;">
                    <h4 style="color:#0f172a; margin:0; font-size:1.1rem; border-left:4px solid #0e7490; padding-left:0.75rem; font-weight:700;">Top Strategy for ${new Date().toLocaleString('default', { month: 'long' })}</h4>
                    ${recs.map(r => `
                        <div class="ai-card-item" style="padding:0; overflow:hidden; display:flex; flex-direction:column; background:white; border-radius:16px; border:1px solid #e2e8f0; box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);">
                            <div style="padding:1.5rem;">
                                <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:1rem;">
                                    <div style="display:flex; align-items:center; gap:12px;">
                                        <div class="ai-icon-box" style="margin:0; width:40px; height:40px; background:#fefce8; color:#a16207; border-radius:12px; display:flex; align-items:center; justify-content:center;">
                                            <i class="fas fa-umbrella-beach"></i>
                                        </div>
                                        <div>
                                            <h3 style="color:#0f172a; margin:0; font-size:1.1rem; font-weight:800;">${r.name}</h3>
                                            <p style="margin:0; font-size:0.75rem; color:#0e7490; font-weight:700; text-transform:uppercase; letter-spacing:0.05em;">Best Destination</p>
                                        </div>
                                    </div>
                                    <span style="background:#fef9c3; color:#854d0e; padding:0.25rem 0.75rem; border-radius:20px; font-size:0.7rem; font-weight:800; border:1px solid #fef08a;">${r.budget_level || 'Mid-Range'}</span>
                                </div>
                                <div style="background:#f0f9ff; padding:0.75rem 1rem; border-radius:12px; margin-bottom:1rem; border:1px solid #e0f2fe;">
                                    <p style="color:#0369a1; font-weight:700; font-size:0.85rem; margin:0; display:flex; align-items:center; gap:6px;">
                                        <i class="fas fa-cloud-sun"></i> Typical Climate: ${r.climate}
                                    </p>
                                </div>
                                <p style="color:#475569; margin:0; font-size:0.95rem; line-height:1.6;">${r.reason}</p>
                            </div>
                            <div style="background:#f8fafc; padding:1rem 1.5rem; border-top:1px solid #f1f5f9; display:flex; justify-content:space-between; align-items:center;">
                                <button onclick="window.open('https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name)}', '_blank')" style="background:white; border:1px solid #e2e8f0; padding:0.5rem 1rem; border-radius:10px; color:#475569; font-size:0.8rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:6px; transition:all 0.2s;" onmouseover="this.style.borderColor='#0e7490'; this.style.color='#0e7490'" onmouseout="this.style.borderColor='#e2e8f0'; this.style.color='#475569'">
                                    <i class="fas fa-map-marked-alt"></i> Explore Map
                                </button>
                                <span style="font-size:0.75rem; color:#94a3b8; font-weight:600;">Intelligence Grade: A+</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
                return;
            }

            if (!this.currentAITips) return;
            const tipsList = this.currentAITips[tabId] || [];
            const tipsHTML = tipsList.map((t, idx) => {
                const isSaved = this.aiTips.saved?.some(s => s.title === t.title);
                const bookmarkIcon = isSaved ? 'fas' : 'far';
                const bookmarkColor = isSaved ? '#0891b2' : '#94a3b8';

                // CRITICAL: Prioritize Tag extraction over AI-generated city field (which can hallucinate current location)
                let extractedCity = null;
                if (t.tags) {
                    const knownCities = ['delhi', 'mumbai', 'bangalore', 'goa', 'kerala', 'jaipur', 'london', 'paris', 'tokyo', 'rome', 'new york', 'dubai'];
                    const found = t.tags.find(tag => knownCities.includes(tag.toLowerCase().replace(/^#/, '')));
                    if (found) {
                        extractedCity = found.replace(/^#/, '');
                        console.log(`🏷️ Priority City extracted from Tag: ${extractedCity}`);
                    }
                }

                // Final city to use for context
                const finalCity = extractedCity || t.city || '';

                // DETERMINE IF PHYSICAL PLACE: Hide map/distance for advice/strategy tips
                const isStrategyTip = ['Budget', 'Personalized', 'General', 'Travel'].includes(t.category);
                const showMapLink = !isStrategyTip && (t.category === 'Places' || tabId === 'places');

                const mapDestSearch = `${t.title.replace(/Hike to /gi, '').trim()}, ${finalCity}`.trim().replace(/,$/, '');
                const mapUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(finalCity)}&destination=${encodeURIComponent(mapDestSearch)}`;

                let distanceText = '';

                // Real Distance calculation with higher precision
                let targetLocation = finalCity;

                if (t.title && t.title.length > 3) {
                    // Clean up title for better geocoding (e.g., "Hike to Qutub" -> "Qutub Minar")
                    let cleanTitle = t.title.replace(/Hike to /gi, '').replace(/Visit /gi, '');
                    targetLocation = `${cleanTitle}, ${finalCity}`.trim().replace(/,$/, '');
                }

                if (showMapLink && targetLocation && this.userLocation) {
                    this.getCityCoordinates(targetLocation).then(coords => {
                        if (coords) {
                            const dist = this.calculateDistance(coords.lat, coords.lng);
                            const badgeId = `dist-badge-${idx}`;
                            const mapsBtnId = `maps-btn-${idx}`;

                            const badge = document.getElementById(badgeId);
                            if (badge) {
                                badge.innerHTML = `<i class="fas fa-location-arrow" style="font-size:0.7rem;"></i> ${dist} away`;
                                badge.style.display = 'flex';
                            }

                            // Update maps button to use precise coordinates and internal city logic
                            const btn = document.getElementById(mapsBtnId);
                            if (btn) {
                                // If the tip is in a different city, default origin to that city center for local transit
                                const origin = finalCity ? encodeURIComponent(finalCity) : '';
                                const dest = `${coords.lat},${coords.lng}`;
                                btn.onclick = () => window.open(`https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=walking`, '_blank');
                            }
                        } else {
                            // Secondary fallback: Just geocode the city center if the landmark name is too vague or fails
                            if (finalCity && targetLocation !== finalCity) {
                                this.getCityCoordinates(finalCity).then(cityCoords => {
                                    if (cityCoords) {
                                        const dist = this.calculateDistance(cityCoords.lat, cityCoords.lng);
                                        const badgeId = `dist-badge-${idx}`;
                                        const badge = document.getElementById(badgeId);
                                        if (badge) {
                                            badge.innerHTML = `<i class="fas fa-location-arrow" style="font-size:0.7rem;"></i> ${dist} away`;
                                            badge.style.display = 'flex';
                                        }

                                        // Update button to city center
                                        const btn = document.getElementById(mapsBtnId);
                                        if (btn) {
                                            btn.onclick = () => window.open(`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(finalCity)}&destination=${cityCoords.lat},${cityCoords.lng}&travelmode=walking`, '_blank');
                                        }
                                    }
                                });
                            }
                        }
                    });
                }

                return `
                <div class="ai-card-item" style="padding:0; overflow:hidden; display:flex; flex-direction:column; background:white; border-radius:16px; border:1px solid #e2e8f0; box-shadow:0 4px 6px -1px rgba(0,0,0,0.05); margin-bottom:1rem; transition:transform 0.2s ease;">
                    <div style="padding:1.5rem; flex:1;">
                        <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:1rem;">
                            <div style="display:flex; align-items:center; gap:12px;">
                                <div class="ai-icon-box" style="margin:0; width:42px; height:42px; background:#f0f9ff; color:#0369a1; border-radius:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                                    <i class="fas fa-${t.icon || 'lightbulb'}" style="font-size:1.1rem;"></i>
                                </div>
                                <div>
                                    <h3 style="color:#0f172a; margin:0; font-size:1.1rem; font-weight:700; line-height:1.2;">${t.title}</h3>
                                    ${t.category ? `<span style="color:#0369a1; font-size:0.65rem; font-weight:800; text-transform:uppercase; letter-spacing:0.05em;">${t.category} Strategy</span>` : ''}
                                </div>
                            </div>
                            <button onclick="app.saveAITip('${t.title.replace(/'/g, "\\'")}')" style="background:#f8fafc; border:1px solid #e2e8f0; color:${bookmarkColor}; cursor:pointer; width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; transition:0.2s;">
                                <i class="${bookmarkIcon} fa-bookmark"></i>
                            </button>
                        </div>
                        
                        <p style="color:#475569; margin:0 0 1.25rem 0; font-size:0.95rem; line-height:1.6;">${t.content}</p>
                        
                        <div style="display:flex; flex-wrap:wrap; gap:0.5rem; align-items:center;">
                            ${t.tags ? t.tags.map(tag => `<span style="background:#f1f5f9; color:#64748b; padding:0.25rem 0.75rem; border-radius:20px; font-size:0.75rem; font-weight:600;">#${tag.replace(/^#/, '')}</span>`).join('') : ''}
                            ${showMapLink ? `
                                <span id="dist-badge-${idx}" style="display:none; background:#ecfdf5; color:#059669; padding:0.25rem 0.75rem; border-radius:20px; font-size:0.75rem; font-weight:700; align-items:center; gap:6px; border:1px solid #d1fae5;">
                                    <i class="fas fa-location-arrow" style="font-size:0.7rem;"></i> Calculating...
                                </span>
                            ` : ''}
                        </div>
                    </div>

                    ${showMapLink ? `
                    <div style="background:#f8fafc; padding:1rem 1.5rem; border-top:1px solid #f1f5f9; display:flex; border-bottom-left-radius:16px; border-bottom-right-radius:16px;">
                        <button id="maps-btn-${idx}" onclick="window.open('${mapUrl}', '_blank')" style="width:100%; background:white; border:1px solid #e2e8f0; padding:0.75rem; border-radius:12px; color:#0e7490; font-size:0.85rem; font-weight:700; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; transition:all 0.2s; box-shadow:0 1px 2px rgba(0,0,0,0.05);" onmouseover="this.style.background='#ecfeff'; this.style.borderColor='#0891b2'" onmouseout="this.style.background='white'; this.style.borderColor='#e2e8f0'">
                            <i class="fas fa-map-marked-alt"></i> View Map & Get Directions
                        </button>
                    </div>
                    ` : ''}
                </div>`;
            }).join('');

            container.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:1.5rem; animation:fadeIn 0.3s ease;">
                ${tipsHTML}
                ${tipsList.length === 0 ? '<p style="text-align:center; color:#94a3b8; padding:3rem; font-weight:500;">No intelligence reports available for this category yet.</p>' : ''}
            </div>
        `;
        }

        closeModal() {
            const modal = document.getElementById('aiTipsModal');
            if (modal) {
                modal.remove();
                document.body.style.overflow = '';
            }
        }

        switchModalTab(tabId) {
            // Update active tab
            const tabs = document.querySelectorAll('.modal-tab');
            tabs.forEach(tab => {
                tab.classList.remove('active');
                if (tab.dataset.tab === tabId) {
                    tab.classList.add('active');
                }
            });

            // Show active content
            const contents = document.querySelectorAll('.modal-tab-content');
            contents.forEach(content => {
                content.classList.remove('active');
                if (content.id === `${tabId}Tab`) {
                    content.classList.add('active');
                }
            });

            // Load tab content
            this.loadModalTabContent(tabId);
        }

        loadModalTabContent(tabId) {
            const container = document.getElementById(`${tabId}Tab`);
            if (!container || !this.aiTips) return;

            const tips = this.aiTips[tabId] || [];

            if (tips.length === 0) {
                container.innerHTML = `
                <div class="ai-tip">
                    <div class="ai-tip-icon">
                        <i class="fas fa-robot"></i>
                    </div>
                    <div class="ai-tip-content">
                        <h4>No tips available</h4>
                        <p>Check back later for personalized travel tips</p>
                    </div>
                </div>
            `;
                return;
            }

            container.innerHTML = tips.map(t => `
            <div class="ai-tip" data-id="${t.id}">
                <div class="ai-tip-icon">
                    <i class="fas fa-${t.icon || 'star'}"></i>
                </div>
                <div class="ai-tip-content">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                        <h4 style="margin:0;">${t.title}</h4>
                        ${t.category ? `<span style="background:#ecfeff; color:#0e7490; padding:2px 8px; border-radius:10px; font-size:10px; font-weight:700;">${t.category}</span>` : ''}
                    </div>
                    <p style="margin:0;">${t.content}</p>
                    <div class="ai-tip-tags">
                        ${(t.tags || []).map(tag => `<span class="ai-tip-tag">#${tag}</span>`).join('')}
                    </div>
                </div>
                <button class="ai-tip-save ${t.saved ? 'saved' : ''}" onclick="app.saveAITip(${t.id})">
                    <i class="${t.saved ? 'fas' : 'far'} fa-bookmark"></i>
                </button>
            </div>
        `).join('');
        }

        // Duplicate refreshAITips removed

        async saveAITip(title) {
            console.log(`[saveAITip] Attempting to toggle save for: "${title}"`);
            if (!this.aiTips) {
                console.warn('[saveAITip] No aiTips state available');
                return;
            }

            // Find tip across categories
            let foundTip = null;
            const categories = ['personalized', 'travel', 'budget', 'places', 'for-you'];

            for (const cat of categories) {
                if (this.currentAITips && this.currentAITips[cat]) {
                    foundTip = this.currentAITips[cat].find(t => t.title === title);
                }
                if (!foundTip && this.aiTips[cat]) {
                    foundTip = this.aiTips[cat].find(t => t.title === title);
                }
                if (foundTip) {
                    console.log(`[saveAITip] Tip found in category: ${cat}`);
                    break;
                }
            }

            if (!foundTip) {
                foundTip = (this.aiTips.saved || []).find(t => t.title === title);
                if (foundTip) console.log('[saveAITip] Tip found in already saved list');
            }

            if (!foundTip) {
                console.error(`[saveAITip] Tip NOT found: "${title}"`);
                return;
            }

            const isSaved = (this.aiTips.saved || []).some(t => t.title === title);
            const token = localStorage.getItem('token');
            console.log(`[saveAITip] Current state: ${isSaved ? 'Saved' : 'Not Saved'}. Sending to backend...`);

            try {
                if (isSaved) {
                    console.log('[saveAITip] Removing tip from backend...');
                    const res = await fetch('/api/ai/tips/remove', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': token },
                        body: JSON.stringify({ title })
                    });

                    console.log('[saveAITip] Remove response status:', res.status);

                    if (res.ok) {
                        this.aiTips.saved = (this.aiTips.saved || []).filter(t => t.title !== title);
                        localStorage.setItem('cachedAITips', JSON.stringify(this.aiTips));
                        this.showToast('Removed from saved intelligence', 'info');
                    } else {
                        const contentType = res.headers.get('content-type');
                        let errorMsg = 'Backend rejection on remove';
                        if (contentType && contentType.includes('application/json')) {
                            const errData = await res.json();
                            errorMsg = errData.message || errorMsg;
                        } else {
                            const textResp = await res.text();
                            console.error('[saveAITip] Non-JSON response:', textResp.substring(0, 200));
                            errorMsg = `Server error (${res.status})`;
                        }
                        throw new Error(errorMsg);
                    }
                } else {
                    console.log('[saveAITip] Sending tip to backend archive...', foundTip);
                    const res = await fetch('/api/ai/tips/save', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': token },
                        body: JSON.stringify(foundTip)
                    });

                    console.log('[saveAITip] Save response status:', res.status);

                    if (res.ok) {
                        if (!this.aiTips.saved) this.aiTips.saved = [];
                        this.aiTips.saved.push({ ...foundTip });
                        localStorage.setItem('cachedAITips', JSON.stringify(this.aiTips));
                        this.showToast('Intelligence archived to profile', 'success');
                    } else {
                        const contentType = res.headers.get('content-type');
                        let errorMsg = 'Backend rejection on save';
                        if (contentType && contentType.includes('application/json')) {
                            const errData = await res.json();
                            errorMsg = errData.message || errorMsg;
                        } else {
                            const textResp = await res.text();
                            console.error('[saveAITip] Non-JSON response:', textResp.substring(0, 200));
                            if (res.status === 401) {
                                errorMsg = 'Authentication failed - please log in again';
                            } else {
                                errorMsg = `Server error (${res.status})`;
                            }
                        }
                        throw new Error(errorMsg);
                    }
                }

                // Update Dashboard and Modal
                this.updateDashboardAITips();
                const activeTab = document.querySelector('.ai-tab.active');
                if (activeTab) {
                    const tabId = activeTab.getAttribute('onclick').match(/'([^']+)'/)[1];
                    this.switchAITab(tabId);
                }
            } catch (err) {
                console.error("[saveAITip] Transaction failed:", err);
                this.showToast(`Save failed: ${err.message}`, 'error');
            }
        }

        performSearch(query) {
            if (query.trim()) {
                this.showToast(`Searching for: ${query}`, 'info');
                // In a real app, this would trigger API search

                // Simulate search results
                if (this.isDashboard) {
                    this.highlightSearchResults(query);
                }
            }
        }

        highlightSearchResults(query) {
            const elements = document.querySelectorAll('.trip-item, .activity-item, .ai-tip');
            elements.forEach(el => {
                const text = el.textContent.toLowerCase();
                if (text.includes(query.toLowerCase())) {
                    el.style.backgroundColor = 'var(--blue-200)';
                    el.style.borderColor = 'var(--blue-400)';

                    setTimeout(() => {
                        el.style.backgroundColor = '';
                        el.style.borderColor = '';
                    }, 2000);
                }
            });
        }

        handleScroll() {
            // Navbar scroll effect (Landing Page)
            const navbar = document.querySelector('.navbar');
            if (navbar) {
                if (window.scrollY > 50) {
                    navbar.classList.add('scrolled');
                } else {
                    navbar.classList.remove('scrolled');
                }
            }

            // Parallax effect for hero background (Landing Page)
            const hero = document.querySelector('.hero');
            const dashboard = document.querySelector('.dashboard-preview');

            if (hero) {
                const rate = window.pageYOffset * -0.5;
                hero.style.backgroundPosition = `center ${rate}px`;
            }

            if (dashboard && window.pageYOffset < 500) {
                const rotateY = window.pageYOffset * 0.01;
                dashboard.style.transform = `perspective(1000px) rotateY(${-5 + rotateY}deg)`;
            }
        }

        highlightNavOnScroll() {
            const sections = document.querySelectorAll('section[id]');
            const navLinks = document.querySelectorAll('.nav-menu a');

            const scrollPosition = window.scrollY + 100;

            sections.forEach(section => {
                const sectionTop = section.offsetTop;
                const sectionHeight = section.offsetHeight;
                const sectionId = section.getAttribute('id');

                if (scrollPosition >= sectionTop && scrollPosition < sectionTop + sectionHeight) {
                    navLinks.forEach(link => {
                        link.classList.remove('active');
                        if (link.getAttribute('href') === `#${sectionId}`) {
                            link.classList.add('active');
                        }
                    });
                }
            });
        }

        handleResize() {
            const sidebar = document.querySelector('.sidebar');
            if (window.innerWidth >= 992 && sidebar) {
                sidebar.classList.remove('active');
            }
        }

        async updateAuthUI() {
            const token = localStorage.getItem('token');
            const landingNav = document.querySelector('.nav-buttons');
            const heroSection = document.querySelector('.hero-content');

            let userName = 'Traveler';

            // Try to get updated profile if token exists
            if (token) {
                try {
                    const res = await fetch('/api/auth/profile', {
                        headers: { 'Authorization': token }
                    });
                    if (res.ok) {
                        const user = await res.json();
                        userName = user.name;
                        localStorage.setItem('user', JSON.stringify(user));
                    } else {
                        // Token invalid
                        this.logout();
                        return;
                    }
                } catch (err) {
                    console.error('Auth check failed', err);
                }
            }

            // Retrieve from storage if fetch failed or for immediate render
            const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
            if (storedUser.name) userName = storedUser.name;

            // Capitalize name
            userName = userName.charAt(0).toUpperCase() + userName.slice(1);

            // Using token as source of truth
            const isLoggedIn = !!token;

            if (landingNav) {
                // Always preserve the existing toggle or build a fresh one with the correct id
                const existingToggle = landingNav.querySelector('#menuToggle') || landingNav.querySelector('.menu-toggle');
                let menuToggle = existingToggle;
                if (!menuToggle) {
                    menuToggle = document.createElement('button');
                }
                // Always ensure id + class are set correctly
                menuToggle.id = 'menuToggle';
                menuToggle.className = 'menu-toggle';
                if (!menuToggle.innerHTML.trim()) {
                    menuToggle.innerHTML = '<i class="fas fa-bars"></i>';
                }

                if (isLoggedIn) {
                    landingNav.innerHTML = `
                        <a href="dashboard.html" class="btn-nav-dashboard">
                            <i class="fas fa-th-large"></i> Dashboard
                        </a>
                        <button id="navLogoutBtn" class="btn-nav-logout">
                            <i class="fas fa-sign-out-alt"></i> Logout
                        </button>
                    `;

                    // Re-append toggle (always last so it stays at end)
                    landingNav.appendChild(menuToggle);

                    // Attach logout listener
                    const logoutBtn = document.getElementById('navLogoutBtn');
                    if (logoutBtn) {
                        logoutBtn.onclick = (e) => {
                            e.preventDefault();
                            this.confirmLogout();
                        };
                    }

                } else {
                    landingNav.innerHTML = `
                        <a href="login.html" class="login-btn">Log In</a>
                        <a href="signup.html" class="signup-btn">Get Started</a>
                    `;
                    landingNav.appendChild(menuToggle);
                }
            }

            // Check if user is logged in
            if (isLoggedIn) {
                // Update Hero CTA
                const heroCta = document.querySelector('.hero-actions .cta-primary');
                if (heroCta) {
                    heroCta.href = 'dashboard.html';
                    heroCta.innerHTML = '<i class="fas fa-th-large"></i> Go to Dashboard';
                }

                // Update Footer CTA
                const footerCta = document.querySelector('.cta-actions .cta-primary');
                if (footerCta) {
                    footerCta.href = 'dashboard.html';
                    footerCta.innerHTML = '<i class="fas fa-th-large"></i> Go to Dashboard';
                }
            }


            // Update sidebar profile in dashboard
            const userProfile = document.querySelector('.user-profile');
            if (userProfile) {
                const userEmail = storedUser.email || 'user@example.com';
                const profilePicture = this.getImageUrl(storedUser.profile_picture) || `https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=random&size=128&bold=true`;


                // Dynamic font size based on name length
                let nameFontSize = '0.95rem';
                if (userName.length > 20) {
                    nameFontSize = '0.75rem';
                } else if (userName.length > 15) {
                    nameFontSize = '0.85rem';
                }

                userProfile.style.position = 'relative';
                userProfile.innerHTML = `
                <div class="user-profile-content">
                    <div class="user-avatar">
                       <img src="${profilePicture}" alt="${userName}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=0b3b5b&color=fff&size=128&bold=true'">
                       <div class="status-indicator online"></div>
                    </div>
                    <div class="user-info">
                       <h4 style="font-size: ${nameFontSize};">${userName}</h4>
                    </div>
                    <div class="user-menu-btn">
                        <i class="fas fa-chevron-right"></i>
                    </div>
                </div>
                <!-- User Menu Dropdown -->
                <div class="user-menu-dropdown">
                    <div class="dropdown-header">
                        <p>Account Settings</p>
                    </div>
                    <ul>
                        <li><a href="#" onclick="app.showProfileCard(event)"><i class="fas fa-user-circle"></i> My Profile</a></li>
                        <li><hr class="dropdown-divider" style="margin: 0.5rem 0; border: none; border-top: 1px solid var(--gray-100);"></li>
                        <li><a href="#" class="text-danger" onclick="app.logout()"><i class="fas fa-sign-out-alt"></i> Logout</a></li>
                    </ul>
                </div>
            `;


            }
        }


        async showProfileCard(e) {
            if (e) {
                if (e.preventDefault) e.preventDefault();
                if (e.stopPropagation) e.stopPropagation();
            }

            // Close dropdown menu
            const userMenu = document.querySelector('.user-menu-dropdown');
            if (userMenu) userMenu.classList.remove('show');
            document.querySelector('.user-profile')?.classList.remove('active');

            const userData = JSON.parse(localStorage.getItem('user') || '{}');
            const userName = userData.name || 'User';
            const userEmail = userData.email || '';
            const profilePic = this.getImageUrl(userData.profile_picture) || `https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=0b3b5b&color=fff&size=256&bold=true`;


            // Check for existing modal
            const existing = document.getElementById('profileCardModal');
            if (existing) existing.remove();

            const modalHTML = `
        <div id="profileCardModal" class="modal-overlay" style="display:flex !important; position:fixed !important; inset:0 !important; z-index:99999 !important; align-items:center !important; justify-content:center !important; background:rgba(11, 59, 91, 0.3) !important; backdrop-filter:blur(6px) !important;">
            <div class="profile-card-container" style="background:white; width:92%; max-width:380px; border-radius:20px; box-shadow:0 20px 40px -10px rgba(0,0,0,0.2); overflow:hidden; position:relative; animation: modalSlideUp 0.3s ease-out;">
                <div style="background:linear-gradient(135deg, #0b3b5b 0%, #2a8faa 100%); padding:1.25rem 1rem; text-align:center; position:relative;">
                    <button onclick="document.getElementById('profileCardModal').remove()" style="position:absolute; top:0.75rem; right:0.75rem; background:rgba(255,255,255,0.15); border:none; color:white; width:26px; height:26px; border-radius:50%; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:0.9rem; transition:0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.25)'">
                        <i class="fas fa-times"></i>
                    </button>
                    
                    <div style="width:70px; height:70px; margin:0 auto 0.75rem; position:relative; group">
                        <img id="cardAvatar" src="${profilePic}" style="width:100%; height:100%; border-radius:50%; object-fit:cover; border:3px solid rgba(255,255,255,0.3); box-shadow:0 5px 15px rgba(0,0,0,0.1);" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=0b3b5b&color=fff&size=256&bold=true'">
                        <label for="cardAvatarUpload" style="position:absolute; bottom:0; right:0; background:#2a8faa; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; border:2px solid white; color:white; font-size:0.7rem; box-shadow:0 2px 5px rgba(0,0,0,0.2); transition:0.2s;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
                            <i class="fas fa-camera"></i>
                        </label>
                        <input type="file" id="cardAvatarUpload" hidden accept="image/*" onchange="uploadProfilePicture(this)">
                    </div>
                    
                    <h2 style="color:white; margin:0; font-size:1.2rem; font-weight:700;">${userName}</h2>
                    <p style="color:rgba(255,255,255,0.8); margin:0.1rem 0 0; font-size:0.85rem;">${userEmail}</p>
                </div>

                <div style="padding:0.75rem 1rem; background:#f8fafc;">
                    <!-- Currency & Display Name -->
                    <div style="background:white; padding:1.25rem; border-radius:15px; border:1px solid #e2e8f0; margin-bottom:1rem;">
                        <label style="display:block; font-size:0.75rem; color:#64748b; font-weight:700; text-transform:uppercase; margin-bottom:0.75rem; letter-spacing:0.05em;">Display Settings</label>
                        
                        <div style="display:flex; flex-direction:column; gap:0.75rem;">
                            <!-- Name Input -->
                            <div style="display:flex; gap:0.5rem; align-items:center;">
                                <div style="position:relative; flex:1;">
                                    <i class="fas fa-user" style="position:absolute; left:0.75rem; top:50%; transform:translateY(-50%); color:#2a8faa; font-size:0.8rem;"></i>
                                    <input type="text" id="cardNameInput" value="${userName}" placeholder="Full Name" style="width:100%; padding:0.6rem 0.75rem 0.6rem 2.25rem; border:1px solid #f1f5f9; border-radius:10px; font-weight:600; color:#1e293b; outline:none; font-size:0.85rem; background:#fcfdfe;" onfocus="this.style.borderColor='#2a8faa'">
                                </div>
                                <button id="updateCardBtn" onclick="app.updateProfileInfo()" style="padding:0.6rem 1rem; background:#0b3b5b; color:white; border:none; border-radius:10px; font-weight:700; cursor:pointer; transition:0.2s; font-size:0.8rem;" onmouseover="this.style.background='#2a8faa'">Update</button>
                            </div>

                            <!-- UPI Input in Modal -->
                            <div style="display:flex; gap:0.5rem; align-items:center;">
                                <div style="position:relative; flex:1;">
                                    <i class="fas fa-mobile-alt" style="position:absolute; left:0.75rem; top:50%; transform:translateY(-50%); color:#2a8faa; font-size:0.8rem;"></i>
                                    <input type="text" id="cardUpiInput" value="${userData.upi_id || ''}" placeholder="UPI ID (e.g. user@oksbi)" style="width:100%; padding:0.6rem 0.75rem 0.6rem 2.25rem; border:1px solid #f1f5f9; border-radius:10px; font-weight:600; color:#1e293b; outline:none; font-size:0.85rem; background:#fcfdfe;" onfocus="this.style.borderColor='#2a8faa'">
                                </div>
                            </div>

                            <!-- Currency Selector -->
                            <div style="position:relative;">
                                <i class="fas fa-coins" style="position:absolute; left:0.75rem; top:50%; transform:translateY(-50%); color:#2a8faa; font-size:0.8rem;"></i>
                                <select id="currencySelector" onchange="app.updateSetting('preferred_currency', this.value)" style="width:100%; padding:0.6rem 0.75rem 0.6rem 2.25rem; border:1px solid #f1f5f9; border-radius:10px; font-weight:600; color:#1e293b; outline:none; font-size:0.85rem; background:#fcfdfe; appearance:none; cursor:pointer;" onfocus="this.style.borderColor='#2a8faa'">
                                    <option value="INR" ${userData.preferred_currency === 'INR' ? 'selected' : ''}>INR (₹) - Indian Rupee</option>
                                    <option value="USD" ${userData.preferred_currency === 'USD' ? 'selected' : ''}>USD ($) - US Dollar</option>
                                    <option value="EUR" ${userData.preferred_currency === 'EUR' ? 'selected' : ''}>EUR (€) - Euro</option>
                                    <option value="GBP" ${userData.preferred_currency === 'GBP' ? 'selected' : ''}>GBP (£) - British Pound</option>
                                    <option value="JPY" ${userData.preferred_currency === 'JPY' ? 'selected' : ''}>JPY (¥) - Japanese Yen</option>
                                    <option value="AUD" ${userData.preferred_currency === 'AUD' ? 'selected' : ''}>AUD (A$) - Australian Dollar</option>
                                    <option value="CAD" ${userData.preferred_currency === 'CAD' ? 'selected' : ''}>CAD (C$) - Canadian Dollar</option>
                                    <option value="CHF" ${userData.preferred_currency === 'CHF' ? 'selected' : ''}>CHF (Fr) - Swiss Franc</option>
                                    <option value="CNY" ${userData.preferred_currency === 'CNY' ? 'selected' : ''}>CNY (¥) - Chinese Yuan</option>
                                    <option value="SGD" ${userData.preferred_currency === 'SGD' ? 'selected' : ''}>SGD (S$) - Singapore Dollar</option>
                                </select>
                                <i class="fas fa-chevron-down" style="position:absolute; right:0.75rem; top:50%; transform:translateY(-50%); color:#64748b; font-size:0.7rem; pointer-events:none;"></i>
                            </div>
                        </div>
                    </div>


                    <!-- Security (Grid) -->
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.6rem;">
                        <button onclick="document.getElementById('profileCardModal').remove(); app.showPasswordChangeModal()" style="padding:0.75rem; background:white; border:1px solid #e2e8f0; border-radius:15px; color:#1e293b; font-weight:700; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:0.4rem; transition:0.2s; font-size:0.75rem;" onmouseover="this.style.background='#f0f9ff'">
                            <i class="fas fa-lock" style="color:#2a8faa;"></i> Pass
                        </button>
                        <button onclick="document.getElementById('profileCardModal').remove(); app.showDeleteAccountModal()" style="padding:0.75rem; background:white; border:1px solid #fee2e2; border-radius:15px; color:#dc2626; font-weight:700; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:0.4rem; transition:0.2s; font-size:0.75rem;" onmouseover="this.style.background='#fff5f5'">
                            <i class="fas fa-trash-alt"></i> Delete
                        </button>
                    </div>
                </div>

                <div style="padding:0.75rem; background:white; border-top:1px solid #f1f5f9; display:flex; justify-content:center;">
                    <button onclick="app.logout()" style="background:transparent; border:none; color:#64748b; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:0.4rem; font-size:0.8rem; transition:0.2s; padding:0.4rem 0.8rem; border-radius:8px;" onmouseover="this.style.background='#f1f5f9'; this.style.color='#1e293b'">
                        <i class="fas fa-sign-out-alt"></i> Sign Out
                    </button>
                </div>
            </div>
        </div>`;

            document.body.insertAdjacentHTML('beforeend', modalHTML);

            // Close on background click
            const modal = document.getElementById('profileCardModal');
            modal.addEventListener('click', (ev) => {
                if (ev.target === modal) modal.remove();
            });
        }

        showSettingsModal(e) {
            this.showProfileCard(e);
        }

        confirmLogout() {
            // Remove existing if any
            const existing = document.getElementById('logoutModal');
            if (existing) existing.remove();

            const modalHTML = `
        <div id="logoutModal" class="modal-overlay" style="display:flex !important; position:fixed !important; inset:0 !important; z-index:9999999 !important; align-items:center !important; justify-content:center !important; background:rgba(11,59,91,0.6) !important; backdrop-filter:blur(8px) !important; padding: 1rem;">
            <div style="background:white; width:100%; max-width:380px; border-radius:24px; padding:2rem; text-align:center; box-shadow:0 25px 50px -12px rgba(0,0,0,0.25); animation:modalSlideUp 0.3s ease-out; position: relative; max-height: 90vh; overflow-y: auto;">
                <div style="width:60px; height:60px; background:#fee2e2; color:#ef4444; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 1rem; font-size:1.75rem;">
                    <i class="fas fa-sign-out-alt"></i>
                </div>
                <h2 style="color:#0f172a; margin-bottom:0.5rem; font-size:1.4rem; font-weight:700;">Sign Out?</h2>
                <p style="color:#64748b; margin-bottom:1.5rem; line-height:1.5; font-size: 0.95rem;">Are you sure you want to log out of your IntelliTrip account?</p>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.75rem;">
                    <button onclick="document.getElementById('logoutModal').remove()" style="padding:0.8rem; background:#f1f5f9; color:#475569; border:none; border-radius:12px; font-weight:600; cursor:pointer; transition:0.2s;" onmouseover="this.style.background='#e2e8f0'">Cancel</button>
                    <button id="confirmLogoutBtn" onclick="app.performLogout()" style="padding:0.8rem; background:#0b3b5b; color:white; border:none; border-radius:12px; font-weight:600; cursor:pointer; transition:0.2s; box-shadow:0 4px 12px rgba(11,59,91,0.25);" onmouseover="this.style.background='#082d46'">Logout</button>
                </div>
            </div>
        </div>
        `;

            document.body.insertAdjacentHTML('beforeend', modalHTML);

            // Close on background click
            const modal = document.getElementById('logoutModal');
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.remove();
            });
        }

        performLogout() {
            const btn = document.getElementById('confirmLogoutBtn');
            if (btn) {
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
                btn.disabled = true;
                btn.style.opacity = '0.8';
            }

            setTimeout(() => {
                try {
                    localStorage.removeItem('token');
                    localStorage.removeItem('user');
                    localStorage.removeItem('isLoggedIn');
                    // Use a safe check for showToast
                    if (typeof this.showToast === 'function') {
                        this.showToast('Logged out successfully', 'success');
                    }
                } catch (err) {
                    console.error('Logout error:', err);
                } finally {
                    // Always redirect
                    setTimeout(() => {
                        window.location.href = 'index.html';
                    }, 500);
                }
            }, 500);
        }

        logout() {
            this.confirmLogout();
        }

        showProfileModal_deprecated() {
            const userData = JSON.parse(localStorage.getItem('user') || '{}');
            const userName = userData.name || 'User';
            const userEmail = userData.email || 'user@example.com';
            const profilePicture = this.getImageUrl(userData.profile_picture) || `https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=random&size=256&bold=true`;


            // Remove existing modal if any
            const existing = document.getElementById('profileModal');
            if (existing) existing.remove();

            const modalHTML = `
        <div id="profileModal" style="display:flex !important; position:fixed !important; inset:0 !important; z-index:99999 !important; align-items:center !important; justify-content:center !important; background:rgba(0,0,0,0.6) !important; backdrop-filter:blur(4px) !important;">
            <div style="background:#ffffff !important; border-radius:20px !important; width:90% !important; max-width:500px !important; box-shadow:0 20px 60px rgba(0,0,0,0.3) !important; overflow:hidden !important;">
                <!-- Header -->
                <div style="background:linear-gradient(135deg, #0b3b5b 0%, #2a8faa 100%) !important; padding:2rem !important; text-align:center !important; position:relative !important;">
                    <button onclick="document.getElementById('profileModal').remove()" style="position:absolute !important; top:1rem !important; right:1rem !important; background:rgba(255,255,255,0.2) !important; border:none !important; color:white !important; width:32px !important; height:32px !important; border-radius:50% !important; cursor:pointer !important; font-size:1.2rem !important;">Ã—</button>
                    <div style="width:120px !important; height:120px !important; border-radius:50% !important; overflow:hidden !important; margin:0 auto 1rem !important; border:4px solid white !important; box-shadow:0 4px 12px rgba(0,0,0,0.2) !important;">
                        <img src="${profilePicture}" alt="${userName}" style="width:100% !important; height:100% !important; object-fit:cover !important;" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(userName)}&background=random&size=256&bold=true'">
                    </div>
                    <h2 style="color:white !important; margin:0 !important; font-size:1.5rem !important;">${userName}</h2>
                    <p style="color:rgba(255,255,255,0.9) !important; margin:0.5rem 0 0 !important; font-size:0.95rem !important;">${userEmail}</p>
                </div>
                
                <!-- Body -->
                <div style="padding:2rem !important;">
                    <div style="margin-bottom:1.5rem !important;">
                        <label style="display:block !important; font-weight:600 !important; color:#374151 !important; margin-bottom:0.5rem !important; font-size:0.9rem !important;">Name</label>
                        <input type="text" value="${userName}" style="width:100% !important; padding:0.75rem !important; border:2px solid #e5e7eb !important; border-radius:10px !important; font-size:1rem !important; transition:border 0.2s !important;" onfocus="this.style.borderColor='#2a8faa'" onblur="this.style.borderColor='#e5e7eb'">
                    </div>
                    
                    <div style="margin-bottom:1.5rem !important;">
                        <label style="display:block !important; font-weight:600 !important; color:#374151 !important; margin-bottom:0.5rem !important; font-size:0.9rem !important;">Email</label>
                        <input type="email" value="${userEmail}" disabled style="width:100% !important; padding:0.75rem !important; border:2px solid #e5e7eb !important; border-radius:10px !important; font-size:1rem !important; background:#f9fafb !important; color:#6b7280 !important;">
                    </div>
                    
                    <div style="margin-bottom:1.5rem !important;">
                        <label style="display:block !important; font-weight:600 !important; color:#374151 !important; margin-bottom:0.5rem !important; font-size:0.9rem !important;">Profile Picture URL</label>
                        <input type="text" placeholder="Enter image URL" value="${this.getImageUrl(userData.profile_picture) || ''}" style="width:100% !important; padding:0.75rem !important; border:2px solid #e5e7eb !important; border-radius:10px !important; font-size:1rem !important; transition:border 0.2s !important;" onfocus="this.style.borderColor='#2a8faa'" onblur="this.style.borderColor='#e5e7eb'">

                        <p style="font-size:0.85rem !important; color:#6b7280 !important; margin-top:0.5rem !important;">Paste a direct image URL (e.g., from Gravatar, Imgur, etc.)</p>
                    </div>
                    
                    <div style="display:flex !important; gap:1rem !important; margin-top:2rem !important;">
                        <button onclick="document.getElementById('profileModal').remove()" style="flex:1 !important; padding:0.875rem !important; border-radius:10px !important; border:2px solid #d1d5db !important; background:white !important; color:#374151 !important; font-weight:600 !important; cursor:pointer !important; font-size:1rem !important;">Cancel</button>
                        <button onclick="app.showToast('Profile update coming soon!', 'info')" style="flex:1 !important; padding:0.875rem !important; border-radius:10px !important; border:none !important; background:linear-gradient(135deg, #0b3b5b 0%, #2a8faa 100%) !important; color:white !important; font-weight:700 !important; cursor:pointer !important; font-size:1rem !important; box-shadow:0 4px 12px rgba(42,143,170,0.4) !important;">Save Changes</button>
                    </div>
                </div>
            </div>
        </div>`;

            document.body.insertAdjacentHTML('beforeend', modalHTML);
        }

        showSettingsModal_deprecated() {
            const existing = document.getElementById('settingsModal');
            if (existing) existing.remove();

            const modalHTML = `
        <div id="settingsModal" style="display:flex !important; position:fixed !important; inset:0 !important; z-index:99999 !important; align-items:center !important; justify-content:center !important; background:rgba(0,0,0,0.65) !important; backdrop-filter:blur(6px) !important;">
            <div style="background:#ffffff !important; border-radius:24px !important; width:90% !important; max-width:650px !important; box-shadow:0 25px 70px rgba(0,0,0,0.35) !important; max-height:85vh !important; overflow:hidden !important; display:flex !important; flex-direction:column !important; animation:modalSlideIn 0.3s ease !important;">
                <div style="background:linear-gradient(135deg, #0b3b5b 0%, #1a5f7a 50%, #2a8faa 100%) !important; padding:1.75rem 2rem !important; position:relative !important;">
                    <button onclick="document.getElementById('settingsModal').remove()" style="position:absolute !important; top:1.25rem !important; right:1.25rem !important; background:rgba(255,255,255,0.25) !important; border:none !important; color:white !important; width:36px !important; height:36px !important; border-radius:50% !important; cursor:pointer !important; font-size:1.3rem !important; transition:all 0.2s !important;" onmouseover="this.style.background='rgba(255,255,255,0.35)'" onmouseout="this.style.background='rgba(255,255,255,0.25)'">Ã—</button>
                    <h2 style="color:white !important; margin:0 !important; font-size:1.65rem !important; font-weight:700 !important;"><i class="fas fa-cog" style="margin-right:0.65rem !important;"></i>Settings</h2>
                </div>
                
                <div style="padding:2rem !important; overflow-y:auto !important; flex:1 !important;">
                    <div style="margin-bottom:2.5rem !important;">
                        <h3 style="font-size:1.15rem !important; color:#0b3b5b !important; margin:0 0 1.25rem 0 !important; font-weight:700 !important;">Security</h3>
                        <button id="changePasswordBtn" style="width:100% !important; padding:1.1rem 1.25rem !important; border:2px solid #2a8faa !important; background:white !important; color:#2a8faa !important; border-radius:12px !important; font-weight:700 !important; cursor:pointer !important; margin-bottom:0.85rem !important; font-size:1rem !important; transition:all 0.2s !important; text-align:left !important; display:flex !important; align-items:center !important; justify-content:space-between !important;" onmouseover="this.style.background='#f0f9ff'; this.style.transform='translateX(4px)'" onmouseout="this.style.background='white'; this.style.transform='translateX(0)'">
                            <span><i class="fas fa-key" style="margin-right:0.75rem !important; width:20px !important;"></i>Change Password</span>
                            <i class="fas fa-chevron-right" style="font-size:0.9rem !important;"></i>
                        </button>
                    </div>
                    
                    <div>
                        <h3 style="font-size:1.15rem !important; color:#dc2626 !important; margin:0 0 1.25rem 0 !important; font-weight:700 !important;">Danger Zone</h3>
                        <button id="deleteAccountBtn" style="width:100% !important; padding:1.1rem 1.25rem !important; border:2px solid #dc2626 !important; background:white !important; color:#dc2626 !important; border-radius:12px !important; font-weight:700 !important; cursor:pointer !important; font-size:1rem !important; transition:all 0.2s !important; text-align:left !important; display:flex !important; align-items:center !important; justify-content:space-between !important;" onmouseover="this.style.background='#fff5f5'; this.style.transform='translateX(4px)'" onmouseout="this.style.background='white'; this.style.transform='translateX(0)'">
                            <span><i class="fas fa-trash-alt" style="margin-right:0.75rem !important; width:20px !important;"></i>Delete Account</span>
                            <i class="fas fa-chevron-right" style="font-size:0.9rem !important;"></i>
                        </button>
                        <p style="font-size:0.85rem !important; color:#718096 !important; margin-top:0.75rem !important; line-height:1.5 !important;"><i class="fas fa-info-circle" style="margin-right:0.35rem !important;"></i>This action cannot be undone. All your data will be permanently deleted.</p>
                    </div>
                </div>
            </div>
        </div>`;

            document.body.insertAdjacentHTML('beforeend', modalHTML);

            document.getElementById('changePasswordBtn').addEventListener('click', () => {
                document.getElementById('settingsModal').remove();
                this.showPasswordChangeModal();
            });

            document.getElementById('deleteAccountBtn').addEventListener('click', () => {
                document.getElementById('settingsModal').remove();
                this.showDeleteAccountModal();
            });
        }

        showPasswordChangeModal() {
            const modalHTML = `
        <div id="passwordChangeModal" style="display:flex !important; position:fixed !important; inset:0 !important; z-index:99999 !important; align-items:center !important; justify-content:center !important; background:rgba(0,0,0,0.65) !important; backdrop-filter:blur(6px) !important;">
            <div style="background:#ffffff !important; border-radius:24px !important; width:90% !important; max-width:480px !important; box-shadow:0 25px 70px rgba(0,0,0,0.35) !important; overflow:hidden !important; animation:modalSlideIn 0.3s ease !important;">
                <div style="background:linear-gradient(135deg, #0b3b5b 0%, #2a8faa 100%) !important; padding:1.75rem 2rem !important; position:relative !important;">
                    <button onclick="app.showSettingsModal(); document.getElementById('passwordChangeModal').remove();" style="position:absolute !important; top:1.25rem !important; right:1.25rem !important; background:rgba(255,255,255,0.25) !important; border:none !important; color:white !important; width:36px !important; height:36px !important; border-radius:50% !important; cursor:pointer !important; font-size:1.3rem !important;">Ã—</button>
                    <h2 style="color:white !important; margin:0 !important; font-size:1.5rem !important; font-weight:700 !important;"><i class="fas fa-key" style="margin-right:0.65rem !important;"></i>Change Password</h2>
                </div>
                
                <div id="passwordStep1" style="padding:2rem !important;">
                    <p style="color:#4a5568 !important; margin-bottom:1.75rem !important; line-height:1.6 !important;">We'll send a 6-digit verification code to your email to confirm it's you.</p>
                    <button id="requestPasswordOTPBtn" style="width:100% !important; padding:1rem !important; border-radius:12px !important; border:none !important; background:linear-gradient(135deg, #0b3b5b 0%, #2a8faa 100%) !important; color:white !important; font-weight:700 !important; cursor:pointer !important; font-size:1.05rem !important; box-shadow:0 4px 14px rgba(42,143,170,0.4) !important; transition:all 0.2s !important;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">Send Verification Code</button>
                </div>
                
                <div id="passwordStep2" style="padding:2rem !important; display:none !important;">
                    <p style="color:#4a5568 !important; margin-bottom:1.25rem !important;">Enter the code we sent to your email</p>
                    <input type="text" id="passwordOTPInput" placeholder="Enter 6-digit code" maxlength="6" style="width:100% !important; padding:0.9rem !important; border:2px solid #e2e8f0 !important; border-radius:12px !important; font-size:1.2rem !important; text-align:center !important; letter-spacing:8px !important; margin-bottom:1rem !important; font-weight:600 !important;" onfocus="this.style.borderColor='#2a8faa'" onblur="this.style.borderColor='#e2e8f0'">
                    <input type="password" id="newPasswordInput" placeholder="New Password" style="width:100% !important; padding:0.85rem 1rem !important; border:2px solid #e2e8f0 !important; border-radius:12px !important; font-size:1rem !important; margin-bottom:1rem !important;" onfocus="this.style.borderColor='#2a8faa'" onblur="this.style.borderColor='#e2e8f0'">
                    <div id="passwordMessage" style="display:none !important; padding:0.85rem 1rem !important; border-radius:10px !important; margin-bottom:1rem !important; font-size:0.9rem !important; font-weight:600 !important;"></div>
                    <button id="verifyPasswordBtn" style="width:100% !important; padding:1rem !important; border-radius:12px !important; border:none !important; background:linear-gradient(135deg, #0b3b5b 0%, #2a8faa 100%) !important; color:white !important; font-weight:700 !important; cursor:pointer !important; font-size:1.05rem !important; box-shadow:0 4px 14px rgba(42,143,170,0.4) !important;">Change Password</button>
                </div>
            </div>
        </div>`;

            document.body.insertAdjacentHTML('beforeend', modalHTML);

            const token = localStorage.getItem('token');

            document.getElementById('requestPasswordOTPBtn').addEventListener('click', async function () {
                this.disabled = true;
                this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';

                try {
                    const response = await fetch('/api/auth/request-password-change', {
                        method: 'POST',
                        headers: { 'Authorization': token }
                    });

                    const data = await response.json();

                    if (response.ok) {
                        document.getElementById('passwordStep1').style.display = 'none';
                        document.getElementById('passwordStep2').style.display = 'block';
                        app.showToast(data.msg, 'success');
                    } else {
                        app.showToast(data.msg || 'Failed to send code', 'error');
                        this.disabled = false;
                        this.innerHTML = 'Send Verification Code';
                    }
                } catch (err) {
                    app.showToast('Server error', 'error');
                    this.disabled = false;
                    this.innerHTML = 'Send Verification Code';
                }
            });

            document.getElementById('verifyPasswordBtn').addEventListener('click', async function () {
                const otp = document.getElementById('passwordOTPInput').value.trim();
                const newPassword = document.getElementById('newPasswordInput').value;
                const messageDiv = document.getElementById('passwordMessage');

                if (otp.length !== 6) {
                    messageDiv.style.display = 'block';
                    messageDiv.style.background = '#fff5f5';
                    messageDiv.style.color = '#c53030';
                    messageDiv.innerHTML = '<i class="fas fa-times-circle"></i> Please enter 6-digit code';
                    return;
                }

                if (!newPassword || newPassword.length < 6) {
                    messageDiv.style.display = 'block';
                    messageDiv.style.background = '#fff5f5';
                    messageDiv.style.color = '#c53030';
                    messageDiv.innerHTML = '<i class="fas fa-times-circle"></i> Password must be at least 6 characters';
                    return;
                }

                this.disabled = true;
                this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Changing...';

                try {
                    const response = await fetch('/api/auth/verify-password-change', {
                        method: 'POST',
                        headers: {
                            'Authorization': token,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ otp, newPassword })
                    });

                    const data = await response.json();

                    if (response.ok) {
                        messageDiv.style.display = 'block';
                        messageDiv.style.background = '#f0fff4';
                        messageDiv.style.color = '#22543d';
                        messageDiv.innerHTML = '<i class="fas fa-check-circle"></i> ' + data.msg;

                        setTimeout(() => {
                            document.getElementById('passwordChangeModal').remove();
                            app.showToast('Password changed successfully!', 'success');
                        }, 1500);
                    } else {
                        messageDiv.style.display = 'block';
                        messageDiv.style.background = '#fff5f5';
                        messageDiv.style.color = '#c53030';
                        messageDiv.innerHTML = '<i class="fas fa-times-circle"></i> ' + (data.msg || 'Failed');
                        this.disabled = false;
                        this.innerHTML = 'Change Password';
                    }
                } catch (err) {
                    messageDiv.style.display = 'block';
                    messageDiv.style.background = '#fff5f5';
                    messageDiv.style.color = '#c53030';
                    messageDiv.innerHTML = '<i class="fas fa-times-circle"></i> Server error';
                    this.disabled = false;
                    this.innerHTML = 'Change Password';
                }
            });
        }

        showDeleteAccountModal() {
            const modalHTML = `
        <div id="deleteAccountModal" style="display:flex !important; position:fixed !important; inset:0 !important; z-index:99999 !important; align-items:center !important; justify-content:center !important; background:rgba(0,0,0,0.65) !important; backdrop-filter:blur(6px) !important;">
            <div style="background:#ffffff !important; border-radius:24px !important; width:90% !important; max-width:480px !important; box-shadow:0 25px 70px rgba(0,0,0,0.35) !important; overflow:hidden !important; animation:modalSlideIn 0.3s ease !important;">
                <div style="background:linear-gradient(135deg, #dc2626 0%, #b91c1c 100%) !important; padding:1.75rem 2rem !important; position:relative !important;">
                    <button onclick="app.showSettingsModal(); document.getElementById('deleteAccountModal').remove();" style="position:absolute !important; top:1.25rem !important; right:1.25rem !important; background:rgba(255,255,255,0.25) !important; border:none !important; color:white !important; width:36px !important; height:36px !important; border-radius:50% !important; cursor:pointer !important; font-size:1.3rem !important;">Ã—</button>
                    <h2 style="color:white !important; margin:0 !important; font-size:1.5rem !important; font-weight:700 !important;"><i class="fas fa-exclamation-triangle" style="margin-right:0.65rem !important;"></i>Delete Account</h2>
                </div>
                
                <div id="deleteStep1" style="padding:2rem !important;">
                    <div style="background:#fff5f5 !important; border:2px solid #feb2b2 !important; border-radius:12px !important; padding:1rem !important; margin-bottom:1.5rem !important;">
                        <p style="color:#c53030 !important; font-weight:700 !important; margin:0 !important; line-height:1.6 !important;"><i class="fas fa-exclamation-triangle" style="margin-right:0.5rem !important;"></i>WARNING: This action cannot be undone!</p>
                    </div>
                    <p style="color:#4a5568 !important; margin-bottom:1.75rem !important; line-height:1.6 !important;">We'll send a verification code to confirm account deletion. All your data will be permanently erased.</p>
                    <button id="requestDeleteOTPBtn" style="width:100% !important; padding:1rem !important; border-radius:12px !important; border:none !important; background:#dc2626 !important; color:white !important; font-weight:700 !important; cursor:pointer !important; font-size:1.05rem !important; box-shadow:0 4px 14px rgba(220,38,38,0.4) !important; transition:all 0.2s !important;" onmouseover="this.style.background='#b91c1c'" onmouseout="this.style.background='#dc2626'">Send Verification Code</button>
                </div>
                
                <div id="deleteStep2" style="padding:2rem !important; display:none !important;">
                    <p style="color:#4a5568 !important; margin-bottom:1.25rem !important;">Enter the verification code to confirm deletion</p>
                    <input type="text" id="deleteOTPInput" placeholder="Enter 6-digit code" maxlength="6" style="width:100% !important; padding:0.9rem !important; border:2px solid #e2e8f0 !important; border-radius:12px !important; font-size:1.2rem !important; text-align:center !important; letter-spacing:8px !important; margin-bottom:1rem !important; font-weight:600 !important;" onfocus="this.style.borderColor='#dc2626'" onblur="this.style.borderColor='#e2e8f0'">
                    <div id="deleteMessage" style="display:none !important; padding:0.85rem 1rem !important; border-radius:10px !important; margin-bottom:1rem !important; font-size:0.9rem !important; font-weight:600 !important;"></div>
                    <button id="confirmDeleteBtn" style="width:100% !important; padding:1rem !important; border-radius:12px !important; border:none !important; background:#dc2626 !important; color:white !important; font-weight:700 !important; cursor:pointer !important; font-size:1.05rem !important; box-shadow:0 4px 14px rgba(220,38,38,0.4) !important;">Delete My Account Permanently</button>
                </div>
            </div>
        </div>`;

            document.body.insertAdjacentHTML('beforeend', modalHTML);

            const token = localStorage.getItem('token');

            document.getElementById('requestDeleteOTPBtn').addEventListener('click', async function () {
                this.disabled = true;
                this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';

                try {
                    const response = await fetch('/api/auth/request-account-deletion', {
                        method: 'POST',
                        headers: { 'Authorization': token }
                    });

                    const data = await response.json();

                    if (response.ok) {
                        document.getElementById('deleteStep1').style.display = 'none';
                        document.getElementById('deleteStep2').style.display = 'block';
                        app.showToast(data.msg, 'success');
                    } else {
                        app.showToast(data.msg || 'Failed to send code', 'error');
                        this.disabled = false;
                        this.innerHTML = 'Send Verification Code';
                    }
                } catch (err) {
                    app.showToast('Server error', 'error');
                    this.disabled = false;
                    this.innerHTML = 'Send Verification Code';
                }
            });

            document.getElementById('confirmDeleteBtn').addEventListener('click', async function () {
                const otp = document.getElementById('deleteOTPInput').value.trim();
                const messageDiv = document.getElementById('deleteMessage');

                if (otp.length !== 6) {
                    messageDiv.style.display = 'block';
                    messageDiv.style.background = '#fff5f5';
                    messageDiv.style.color = '#c53030';
                    messageDiv.innerHTML = '<i class="fas fa-times-circle"></i> Please enter 6-digit code';
                    return;
                }

                this.disabled = true;
                this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';

                try {
                    const response = await fetch('/api/auth/confirm-account-deletion', {
                        method: 'POST',
                        headers: {
                            'Authorization': token,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ otp })
                    });

                    const data = await response.json();

                    if (response.ok) {
                        localStorage.removeItem('token');
                        localStorage.removeItem('user');
                        app.showToast('Account deleted successfully', 'success');

                        setTimeout(() => {
                            window.location.href = 'index.html';
                        }, 2000);
                    } else {
                        messageDiv.style.display = 'block';
                        messageDiv.style.background = '#fff5f5';
                        messageDiv.style.color = '#c53030';
                        messageDiv.innerHTML = '<i class="fas fa-times-circle"></i> ' + (data.msg || 'Failed');
                        this.disabled = false;
                        this.innerHTML = 'Delete My Account Permanently';
                    }
                } catch (err) {
                    messageDiv.style.display = 'block';
                    messageDiv.style.background = '#fff5f5';
                    messageDiv.style.color = '#c53030';
                    messageDiv.innerHTML = '<i class="fas fa-times-circle"></i> Server error';
                    this.disabled = false;
                    this.innerHTML = 'Delete My Account Permanently';
                }
            });
        }

        getUserData() {
            // Return full user object including preferred_currency
            const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
            return storedUser;
        }

        toggleUserMenu(e) {
            if (e) e.stopPropagation();

            const userMenu = document.querySelector('.user-menu-dropdown');
            const userProfile = document.querySelector('.user-profile');

            if (userMenu) {
                const isShowing = userMenu.classList.toggle('show');
                if (userProfile) {
                    userProfile.classList.toggle('active', isShowing);
                }
                console.log(`[IntelliTrip] Profile menu ${isShowing ? 'opened' : 'closed'}`);
            } else {
                console.error('[IntelliTrip] Could not find .user-menu-dropdown');
            }
        }

        updateStats() {
            // Update landing page stats
            const stats = {
                users: 1250,
                trips: 8900,
                savings: 4500000,
                rating: 4.8
            };

            // Animate numbers
            document.querySelectorAll('.stat-number').forEach(stat => {
                const target = stats[stat.dataset.stat];
                if (target) {
                    this.animateNumber(stat, 0, target, 2000);
                }
            });
        }

        animateNumber(element, start, end, duration) {
            if (!element) return;
            let startTimestamp = null;
            const step = (timestamp) => {
                if (!startTimestamp) startTimestamp = timestamp;
                const progress = Math.min((timestamp - startTimestamp) / duration, 1);
                const value = Math.floor(progress * (end - start) + start);

                if (element.dataset.stat === 'savings') {
                    element.textContent = this.formatCurrency(value);
                } else if (element.dataset.stat === 'rating') {
                    element.textContent = value.toFixed(1);
                } else {
                    element.textContent = value.toLocaleString();
                }

                if (progress < 1) {
                    window.requestAnimationFrame(step);
                }
            };
            window.requestAnimationFrame(step);
        }

        // Toast notification system
        showToast(message, type = 'info', duration = 3000) {
            let container = document.getElementById('toastContainer');
            if (!container) {
                // Create toast container if it doesn't exist
                container = document.createElement('div');
                container.id = 'toastContainer';
                container.className = 'toast-container';
                document.body.appendChild(container);
            }

            const toast = document.createElement('div');
            toast.className = `toast ${type}`;

            const iconClass = {
                success: 'fas fa-check-circle',
                error: 'fas fa-exclamation-circle',
                info: 'fas fa-info-circle',
                warning: 'fas fa-exclamation-triangle'
            }[type];

            toast.innerHTML = `
            <div class="toast-icon ${type}">
                <i class="${iconClass}"></i>
            </div>
            <div class="toast-content">
                <p class="toast-title">${type.charAt(0).toUpperCase() + type.slice(1)}</p>
                <p class="toast-message">${message}</p>
            </div>
            <button class="toast-close" onclick="this.parentElement.remove()">
                <i class="fas fa-times"></i>
            </button>
        `;

            container.appendChild(toast);

            // Trigger animation
            setTimeout(() => {
                toast.classList.add('show');
            }, 10);

            // Auto remove
            setTimeout(() => {
                toast.classList.add('hide');
                setTimeout(() => {
                    if (toast.parentNode) {
                        toast.remove();
                    }
                }, 300);
            }, duration);
        }

        addLoadingStyles() {
            const style = document.createElement('style');
            style.textContent = `
            .loading {
                position: relative;
                color: transparent !important;
                pointer-events: none;
            }
            
            .loading::after {
                content: '';
                position: absolute;
                top: 50%;
                left: 50%;
                width: 20px;
                height: 20px;
                margin: -10px 0 0 -10px;
                border: 2px solid rgba(255, 255, 255, 0.3);
                border-top-color: white;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
            }
            
            @keyframes spin {
                to { transform: rotate(360deg); }
            }
            
            .read {
                opacity: 0.6;
            }
            
            .unread {
                font-weight: 600;
            }
            
            .notification-dot {
                width: 8px;
                height: 8px;
                background: var(--blue-600);
                border-radius: 50%;
                margin-left: auto;
            }
            
            /* Smooth transitions */
            * {
                transition-property: transform, opacity, background-color, border-color, color, box-shadow;
                transition-duration: 0.3s;
                transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
            }
            
            /* Toast animations */
            .toast-container {
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 9999999;
            }
            
            .toast {
                background: var(--white);
                border: 1px solid var(--blue-200);
                border-radius: var(--border-radius);
                padding: 1rem;
                margin-bottom: 0.5rem;
                box-shadow: var(--shadow-lg);
                display: flex;
                align-items: center;
                gap: 1rem;
                min-width: 300px;
                transform: translateX(100%);
                opacity: 0;
                transition: all 0.3s ease;
            }
            
            .toast.show {
                transform: translateX(0);
                opacity: 1;
            }
            
            .toast.hide {
                transform: translateX(100%);
                opacity: 0;
            }
            
            .toast.success {
                border-left: 4px solid var(--success);
            }
            
            .toast.error {
                border-left: 4px solid var(--error);
            }
            
            .toast.info {
                border-left: 4px solid var(--blue-600);
            }
            
            .toast.warning {
                border-left: 4px solid var(--warning);
            }
        `;
            document.head.appendChild(style);
        }

        // Unified Profile Card handled by showProfileCard

        showPasswordChangeModal() {
            const modalHTML = `
        <div id="passwordChangeModal" style="display:flex !important; position:fixed !important; inset:0 !important; z-index:99999 !important; align-items:center !important; justify-content:center !important; background:rgba(0,0,0,0.65) !important; backdrop-filter:blur(6px) !important;">
            <div style="background:#ffffff !important; border-radius:24px !important; width:90% !important; max-width:480px !important; box-shadow:0 25px 70px rgba(0,0,0,0.35) !important; overflow:hidden !important; animation:modalSlideIn 0.3s ease !important;">
                <div style="background:linear-gradient(135deg, #0b3b5b 0%, #2a8faa 100%) !important; padding:1.75rem 2rem !important; position:relative !important;">
                    <button onclick="document.getElementById('passwordChangeModal').remove();" style="position:absolute !important; top:1.25rem !important; right:1.25rem !important; background:rgba(255,255,255,0.2) !important; border:none !important; color:white !important; width:34px !important; height:34px !important; border-radius:50% !important; cursor:pointer !important; display:flex !important; align-items:center !important; justify-content:center !important; transition:0.2s !important;" onmouseover="this.style.background='rgba(255,255,255,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.2)'">
                        <i class="fas fa-times" style="font-size: 1rem !important;"></i>
                    </button>
                    <h2 style="color:white !important; margin:0 !important; font-size:1.5rem !important; font-weight:700 !important;"><i class="fas fa-key" style="margin-right:0.65rem !important;"></i>Change Password</h2>
                </div>
                
                <div id="passwordStep1" style="padding:2rem !important;">
                    <p style="color:#4a5568 !important; margin-bottom:1.75rem !important; line-height:1.6 !important;">We'll send a 6-digit verification code to your email to confirm it's you.</p>
                    <button id="requestPasswordOTPBtn" style="width:100% !important; padding:1rem !important; border-radius:12px !important; border:none !important; background:linear-gradient(135deg, #0b3b5b 0%, #2a8faa 100%) !important; color:white !important; font-weight:700 !important; cursor:pointer !important; font-size:1.05rem !important; box-shadow:0 4px 14px rgba(42,143,170,0.4) !important; transition:all 0.2s !important;" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">Send Verification Code</button>
                </div>
                
                <div id="passwordStep2" style="padding:2rem !important; display:none !important;">
                    <p style="color:#4a5568 !important; margin-bottom:1.25rem !important;">Enter the code we sent to your email</p>
                    <input type="text" id="passwordOTPInput" placeholder="Enter 6-digit code" maxlength="6" style="width:100% !important; padding:0.9rem !important; border:2px solid #e2e8f0 !important; border-radius:12px !important; font-size:1.2rem !important; text-align:center !important; letter-spacing:8px !important; margin-bottom:1rem !important; font-weight:600 !important;" onfocus="this.style.borderColor='#2a8faa'" onblur="this.style.borderColor='#e2e8f0'">
                    <input type="password" id="newPasswordInput" placeholder="New Password" style="width:100% !important; padding:0.85rem 1rem !important; border:2px solid #e2e8f0 !important; border-radius:12px !important; font-size:1rem !important; margin-bottom:1rem !important;" onfocus="this.style.borderColor='#2a8faa'" onblur="this.style.borderColor='#e2e8f0'">
                    <div id="passwordMessage" style="display:none !important; padding:0.85rem 1rem !important; border-radius:10px !important; margin-bottom:1rem !important; font-size:0.9rem !important; font-weight:600 !important;"></div>
                    <button id="verifyPasswordBtn" style="width:100% !important; padding:1rem !important; border-radius:12px !important; border:none !important; background:linear-gradient(135deg, #0b3b5b 0%, #2a8faa 100%) !important; color:white !important; font-weight:700 !important; cursor:pointer !important; font-size:1.05rem !important; box-shadow:0 4px 14px rgba(42,143,170,0.4) !important;">Change Password</button>
                </div>
            </div>
        </div>`;

            document.body.insertAdjacentHTML('beforeend', modalHTML);

            const token = localStorage.getItem('token');

            document.getElementById('requestPasswordOTPBtn').addEventListener('click', async function () {
                this.disabled = true;
                this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';

                try {
                    const response = await fetch('/api/auth/request-password-change', {
                        method: 'POST',
                        headers: { 'Authorization': token }
                    });

                    const data = await response.json();

                    if (response.ok) {
                        document.getElementById('passwordStep1').style.display = 'none';
                        document.getElementById('passwordStep2').style.display = 'block';
                        app.showToast(data.msg, 'success');
                    } else {
                        app.showToast(data.msg || 'Failed to send code', 'error');
                        this.disabled = false;
                        this.innerHTML = 'Send Verification Code';
                    }
                } catch (err) {
                    app.showToast('Server error', 'error');
                    this.disabled = false;
                    this.innerHTML = 'Send Verification Code';
                }
            });

            document.getElementById('verifyPasswordBtn').addEventListener('click', async function () {
                const otp = document.getElementById('passwordOTPInput').value.trim();
                const newPassword = document.getElementById('newPasswordInput').value;
                const messageDiv = document.getElementById('passwordMessage');

                if (otp.length !== 6) {
                    messageDiv.style.display = 'block';
                    messageDiv.style.background = '#fff5f5';
                    messageDiv.style.color = '#c53030';
                    messageDiv.innerHTML = '<i class="fas fa-times-circle"></i> Please enter 6-digit code';
                    return;
                }

                if (!newPassword || newPassword.length < 6) {
                    messageDiv.style.display = 'block';
                    messageDiv.style.background = '#fff5f5';
                    messageDiv.style.color = '#c53030';
                    messageDiv.innerHTML = '<i class="fas fa-times-circle"></i> Password must be at least 6 characters';
                    return;
                }

                this.disabled = true;
                this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Changing...';

                try {
                    const response = await fetch('/api/auth/verify-password-change', {
                        method: 'POST',
                        headers: {
                            'Authorization': token,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ otp, newPassword })
                    });

                    const data = await response.json();

                    if (response.ok) {
                        messageDiv.style.display = 'block';
                        messageDiv.style.background = '#f0fff4';
                        messageDiv.style.color = '#22543d';
                        messageDiv.innerHTML = '<i class="fas fa-check-circle"></i> ' + data.msg;

                        setTimeout(() => {
                            document.getElementById('passwordChangeModal').remove();
                            app.showToast('Password changed successfully!', 'success');
                        }, 1500);
                    } else {
                        messageDiv.style.display = 'block';
                        messageDiv.style.background = '#fff5f5';
                        messageDiv.style.color = '#c53030';
                        messageDiv.innerHTML = '<i class="fas fa-times-circle"></i> ' + (data.msg || 'Failed');
                        this.disabled = false;
                        this.innerHTML = 'Change Password';
                    }
                } catch (err) {
                    messageDiv.style.display = 'block';
                    messageDiv.style.background = '#fff5f5';
                    messageDiv.style.color = '#c53030';
                    messageDiv.innerHTML = '<i class="fas fa-times-circle"></i> Server error';
                    this.disabled = false;
                    this.innerHTML = 'Change Password';
                }
            });
        }

        showDeleteAccountModal() {
            const modalHTML = `
        <div id="deleteAccountModal" style="display:flex !important; position:fixed !important; inset:0 !important; z-index:99999 !important; align-items:center !important; justify-content:center !important; background:rgba(0,0,0,0.65) !important; backdrop-filter:blur(6px) !important;">
            <div style="background:#ffffff !important; border-radius:24px !important; width:90% !important; max-width:480px !important; box-shadow:0 25px 70px rgba(0,0,0,0.35) !important; overflow:hidden !important; animation:modalSlideIn 0.3s ease !important;">
                <div style="background:linear-gradient(135deg, #dc2626 0%, #b91c1c 100%) !important; padding:1.75rem 2rem !important; position:relative !important;">
                    <button onclick="app.showSettingsModal(); document.getElementById('deleteAccountModal').remove();" style="position:absolute !important; top:1.25rem !important; right:1.25rem !important; background:rgba(255,255,255,0.25) !important; border:none !important; color:white !important; width:36px !important; height:36px !important; border-radius:50% !important; cursor:pointer !important; font-size:1.3rem !important;">Ã—</button>
                    <h2 style="color:white !important; margin:0 !important; font-size:1.5rem !important; font-weight:700 !important;"><i class="fas fa-exclamation-triangle" style="margin-right:0.65rem !important;"></i>Delete Account</h2>
                </div>
                
                <div id="deleteStep1" style="padding:2rem !important;">
                    <div style="background:#fff5f5 !important; border:2px solid #feb2b2 !important; border-radius:12px !important; padding:1rem !important; margin-bottom:1.5rem !important;">
                        <p style="color:#c53030 !important; font-weight:700 !important; margin:0 !important; line-height:1.6 !important;"><i class="fas fa-exclamation-triangle" style="margin-right:0.5rem !important;"></i>WARNING: This action cannot be undone!</p>
                    </div>
                    <p style="color:#4a5568 !important; margin-bottom:1.75rem !important; line-height:1.6 !important;">We'll send a verification code to confirm account deletion. All your data will be permanently erased.</p>
                    <button id="requestDeleteOTPBtn" style="width:100% !important; padding:1rem !important; border-radius:12px !important; border:none !important; background:#dc2626 !important; color:white !important; font-weight:700 !important; cursor:pointer !important; font-size:1.05rem !important; box-shadow:0 4px 14px rgba(220,38,38,0.4) !important; transition:all 0.2s !important;" onmouseover="this.style.background='#b91c1c'" onmouseout="this.style.background='#dc2626'">Send Verification Code</button>
                </div>
                
                <div id="deleteStep2" style="padding:2rem !important; display:none !important;">
                    <p style="color:#4a5568 !important; margin-bottom:1.25rem !important;">Enter the verification code to confirm deletion</p>
                    <input type="text" id="deleteOTPInput" placeholder="Enter 6-digit code" maxlength="6" style="width:100% !important; padding:0.9rem !important; border:2px solid #e2e8f0 !important; border-radius:12px !important; font-size:1.2rem !important; text-align:center !important; letter-spacing:8px !important; margin-bottom:1rem !important; font-weight:600 !important;" onfocus="this.style.borderColor='#dc2626'" onblur="this.style.borderColor='#e2e8f0'">
                    <div id="deleteMessage" style="display:none !important; padding:0.85rem 1rem !important; border-radius:10px !important; margin-bottom:1rem !important; font-size:0.9rem !important; font-weight:600 !important;"></div>
                    <button id="confirmDeleteBtn" style="width:100% !important; padding:1rem !important; border-radius:12px !important; border:none !important; background:#dc2626 !important; color:white !important; font-weight:700 !important; cursor:pointer !important; font-size:1.05rem !important; box-shadow:0 4px 14px rgba(220,38,38,0.4) !important;">Delete My Account Permanently</button>
                </div>
            </div>
        </div>`;

            document.body.insertAdjacentHTML('beforeend', modalHTML);

            const token = localStorage.getItem('token');

            document.getElementById('requestDeleteOTPBtn').addEventListener('click', async function () {
                this.disabled = true;
                this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';

                try {
                    const response = await fetch('/api/auth/request-account-deletion', {
                        method: 'POST',
                        headers: { 'Authorization': token }
                    });

                    const data = await response.json();

                    if (response.ok) {
                        document.getElementById('deleteStep1').style.display = 'none';
                        document.getElementById('deleteStep2').style.display = 'block';
                        app.showToast(data.msg, 'success');
                    } else {
                        app.showToast(data.msg || 'Failed to send code', 'error');
                        this.disabled = false;
                        this.innerHTML = 'Send Verification Code';
                    }
                } catch (err) {
                    app.showToast('Server error', 'error');
                    this.disabled = false;
                    this.innerHTML = 'Send Verification Code';
                }
            });

            document.getElementById('confirmDeleteBtn').addEventListener('click', async function () {
                const otp = document.getElementById('deleteOTPInput').value.trim();
                const messageDiv = document.getElementById('deleteMessage');

                if (otp.length !== 6) {
                    messageDiv.style.display = 'block';
                    messageDiv.style.background = '#fff5f5';
                    messageDiv.style.color = '#c53030';
                    messageDiv.innerHTML = '<i class="fas fa-times-circle"></i> Please enter 6-digit code';
                    return;
                }

                this.disabled = true;
                this.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';

                try {
                    const response = await fetch('/api/auth/confirm-account-deletion', {
                        method: 'POST',
                        headers: {
                            'Authorization': token,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ otp })
                    });

                    const data = await response.json();

                    if (response.ok) {
                        localStorage.removeItem('token');
                        localStorage.removeItem('user');
                        app.showToast('Account deleted successfully', 'success');

                        setTimeout(() => {
                            window.location.href = 'index.html';
                        }, 2000);
                    } else {
                        messageDiv.style.display = 'block';
                        messageDiv.style.background = '#fff5f5';
                        messageDiv.style.color = '#c53030';
                        messageDiv.innerHTML = '<i class="fas fa-times-circle"></i> ' + (data.msg || 'Failed');
                        this.disabled = false;
                        this.innerHTML = 'Delete My Account Permanently';
                    }
                } catch (err) {
                    messageDiv.style.display = 'block';
                    messageDiv.style.background = '#fff5f5';
                    messageDiv.style.color = '#c53030';
                    messageDiv.innerHTML = '<i class="fas fa-times-circle"></i> Server error';
                    this.disabled = false;
                    this.innerHTML = 'Delete My Account Permanently';
                }
            });
        }
        async auditTrip(tripId) {
            const modal = document.getElementById('tripAuditModal');
            const body = document.getElementById('tripAuditBody');
            const nameDisplay = document.getElementById('auditTripName');

            if (!modal || !body) return;

            // Show modal and loading state
            modal.style.display = 'flex';
            body.innerHTML = `
            <div class="audit-loading" style="text-align: center; padding: 4rem 0;">
                <div class="spinner-premium" style="width: 60px; height: 60px; border-width: 6px; margin-bottom: 1.5rem;"></div>
                <h3 style="color: #0b3b5b; font-weight: 700;">Analyzing your journey...</h3>
                <p style="color: #64748b;">Our AI is auditing your expenses and discovering hidden gems.</p>
            </div>
        `;

            try {
                const trip = this.allTrips.find(t => t.id === tripId);
                if (!trip) throw new Error('Trip not found');

                // Auto-detect and set currency for this trip's destination
                await this.detectAndSetTripCurrency(trip.destination);

                if (nameDisplay) nameDisplay.textContent = `${trip.destination} Journey Audit`;

                const tripExpenses = (this.allExpenses || []).filter(e => e.trip_id === trip.id);
                const totalSpent = tripExpenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);

                const start = new Date(trip.start_date);
                const end = new Date(trip.end_date);
                const duration = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) || 1;

                // Heuristic for style based on budget
                const dailyBudget = (parseFloat(trip.budget) / duration) || 0;
                let style = 'Budget';
                if (dailyBudget > 200) style = 'Luxury';
                else if (dailyBudget > 100) style = 'Mid-range';

                const token = localStorage.getItem('token');
                const res = await fetch(`/api/ai/audit?destination=${encodeURIComponent(trip.destination)}&totalSpent=${totalSpent}&duration=${duration}&style=${style}`, {
                    headers: { 'Authorization': token }
                });

                if (!res.ok) throw new Error('Audit service unavailable');
                const auditData = await res.json();

                // Render Audit Data
                this.renderAuditResults(auditData, trip);

            } catch (err) {
                body.innerHTML = `<div class="error-card" style="text-align:center; padding: 3rem;"><i class="fas fa-exclamation-triangle fa-3x" style="color:#ef4444; margin-bottom:1rem;"></i><h3 style="color:#0b3b5b;">Audit Failed</h3><p style="color:#64748b;">${err.message}</p><button class="retry-btn" onclick="app.auditTrip(${tripId})" style="margin-top:1rem; padding: 10px 20px;">Retry Analysis</button></div>`;
            }
        }

        renderAuditResults(data, trip) {
            const body = document.getElementById('tripAuditBody');
            const { perfect_places, budget_audit } = data;

            const auditStatus = budget_audit?.status || 'Unknown';
            const statusClass = auditStatus.toLowerCase().includes('track') ? 'status-on-track' :
                (auditStatus.toLowerCase().includes('warning') ? 'status-warning' : 'status-critical');

            const statusIcon = statusClass === 'status-on-track' ? 'fa-check-circle' :
                (statusClass === 'status-warning' ? 'fa-exclamation-triangle' : 'fa-skull-crossbones');

            body.innerHTML = `
            <div class="audit-grid">
                <!-- Left: Perfect Places -->
                <div class="audit-left">
                    <div class="audit-section">
                        <div class="audit-section-header">
                            <i class="fas fa-gem fa-lg"></i>
                            <h3 style="margin:0; font-weight:800;">Perfect Places for You</h3>
                        </div>
                        <div class="places-list">
                            ${perfect_places && perfect_places.length > 0 ? perfect_places.map(place => `
                                <div class="perfect-place-card">
                                    <img src="https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?w=200" class="place-img" alt="${place.name}" id="place-img-${place.name.replace(/\s+/g, '-')}">
                                    <div class="place-info">
                                        <h4>${place.name}</h4>
                                        <p>${place.description}</p>
                                        <div style="margin-top:0.75rem; display:flex; gap:0.5rem; flex-wrap:wrap;">
                                            <span style="font-size:0.7rem; background:#eff6ff; color:#2563eb; padding:2px 8px; border-radius:10px; font-weight:700; text-transform:uppercase;">${place.activity_type}</span>
                                            <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name + ' ' + trip.destination)}" target="_blank" style="font-size:0.75rem; color:#2a8faa; font-weight:700; text-decoration:none;"><i class="fas fa-map-marker-alt"></i> Directions</a>
                                        </div>
                                    </div>
                                </div>
                            `).join('') : '<p style="color:#64748b; text-align:center;">No specific places found for this itinerary.</p>'}
                        </div>
                    </div>
                </div>

                <!-- Right: Budget Audit -->
                <div class="audit-right">
                    <div class="audit-section">
                        <div class="audit-section-header">
                            <i class="fas fa-file-invoice-dollar fa-lg"></i>
                            <h3 style="margin:0; font-weight:800;">Budget Auditor</h3>
                        </div>
                        
                        <div class="audit-status-banner ${statusClass}">
                            <i class="fas ${statusIcon} fa-lg"></i>
                            <span>${auditStatus}</span>
                        </div>

                        <div class="audit-analysis-card">
                            <h5 style="color:#64748b; font-size:0.75rem; text-transform:uppercase; margin-bottom:1rem; letter-spacing:1px;">AI Analysis</h5>
                            <p style="margin-bottom:1.5rem;">${budget_audit?.analysis || 'Gathering spending data for analysis...'}</p>
                            
                            <div class="saving-tip-box">
                                <h5 style="margin-bottom:0.5rem;"><i class="fas fa-lightbulb"></i> MASTER TIP</h5>
                                <p>${budget_audit?.top_saving_tip || 'Log more expenses to get personalized saving hacks.'}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

            // Load Real Place Images
            if (perfect_places) {
                perfect_places.forEach(async place => {
                    const imgUrl = await this.getDestinationImage(`${place.name} ${trip.destination}`);
                    const sanitizedId = place.name.replace(/\s+/g, '-');
                    const imgEl = document.getElementById(`place-img-${sanitizedId}`);
                    if (imgEl && imgUrl) imgEl.src = imgUrl;
                });
            }
        }

        async loadDashboardData() {
            if (window.location.pathname.includes('dashboard.html')) {
                const token = localStorage.getItem('token');
                if (!token) return;

                // Show loading states
                document.querySelectorAll('.stat-value').forEach(el => el.innerHTML = '<div class="spinner-sm"></div>');
                const charts = ['#expenseChart', '#trendChart', '#activityList', '#tripsGrid', '#upcomingTripsList'];
                charts.forEach(selector => {
                    const el = document.querySelector(selector);
                    if (el) el.innerHTML = '<div class="loading-container"><div class="spinner"></div></div>';
                });

                try {
                    const response = await fetch('/api/dashboard', {
                        headers: { 'Authorization': token }
                    });

                    if (!response.ok) {
                        console.error('Dashboard status error:', response.status);
                        throw new Error(`Server returned ${response.status}`);
                    }

                    const data = await response.json();

                    if (data.stats) {
                        this.animateNumber(document.querySelector('[data-stat="trips"]'), 0, data.stats.trips || 0, 1000);

                        const spentEl = document.querySelector('[data-stat="spent"]');
                        if (spentEl) this.setCurrencyEl(spentEl, data.stats.spent || 0);

                        const savingsEl = document.querySelector('[data-stat="savings"]');
                        if (savingsEl) this.setCurrencyEl(savingsEl, data.stats.savings || 0);
                    }
                    // 2. Render Charts
                    if (data.categories) this.renderCategoryChart(data.categories);
                    if (data.trend) this.renderTrendChart(data.trend);
                    if (data.activity) this.renderActivityFeed(data.activity);
                    if (data.upcoming) {
                        this.renderUpcomingTrips(data.upcoming);
                        const heroCount = document.getElementById('heroTripCount');
                        if (heroCount) heroCount.textContent = data.upcoming.length;
                    }

                    // 6. Load AI Tips (Handles both widget and modal preparation)
                    this.loadAITips();

                    // 7. Render Notifications
                    if (data.notifications) {
                        this.renderNotifications(data.notifications);
                    }

                    // Daily Welcome Message Logic
                    const today = new Date().toDateString();
                    const lastWelcome = localStorage.getItem('lastWelcomeDate');
                    if (lastWelcome !== today && !sessionStorage.getItem('welcomeShown')) {
                        const user = JSON.parse(localStorage.getItem('user') || '{}');
                        const name = user.name ? user.name.split(' ')[0] : 'Traveler';
                        // Slight delay to not clash with other toasts
                        setTimeout(() => this.showToast(`Welcome back, ${name}!`, 'info'), 1500);
                        localStorage.setItem('lastWelcomeDate', today);
                        sessionStorage.setItem('welcomeShown', 'true');
                    }

                } catch (err) {
                    console.error('Dashboard Load Error:', err);
                    const container = document.querySelector('#dashboardView .dashboard-grid');
                    if (container) {
                        this.renderErrorCard('#dashboardView .dashboard-grid', `Failed to load dashboard: ${err.message}. Check console for details.`);
                    } else {
                        this.showToast('Dashboard connection failed. Are you sure the backend is running on port 5000?', 'error');
                    }
                }
            }
        }

        renderErrorCard(selector, message) {
            const container = document.querySelector(selector);
            if (container) {
                container.innerHTML = `
                <div class="error-card">
                    <div class="error-icon"><i class="fas fa-exclamation-triangle"></i></div>
                    <h3>Oops! Something went wrong</h3>
                    <p>${message}</p>
                    <button class="retry-btn" onclick="app.loadDashboardData()">Try Again</button>
                </div>
            `;
            }
        }

        renderCategoryChart(categories) {
            try {
                const container = document.getElementById('expenseChart');
                if (!container) return;

                if (!categories || !Array.isArray(categories) || categories.length === 0) {
                    container.innerHTML = '<div class="empty-state">No expense data yet</div>';
                    return;
                }

                const validCats = categories.filter(c => c && c.total != null);
                const total = validCats.reduce((sum, cat) => sum + (parseFloat(cat.total) || 0), 0);

                if (total === 0) {
                    container.innerHTML = '<div class="empty-state">No costs recorded yet.</div>';
                    return;
                }

                let html = '<div class="chart-visual">';
                html += validCats.map((cat, index) => {
                    const val = parseFloat(cat.total) || 0;
                    const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                    const colors = ['#0f172a', '#1e293b', '#334155', '#475569', '#64748b'];
                    const catName = cat.category || 'Uncategorized';
                    return `<div class="chart-bar" style="height: ${pct}%; background: ${colors[index % colors.length]};" title="${catName} - ${pct}%"><span>${pct}%</span></div>`;
                }).join('');
                html += '</div><div class="chart-labels">';
                html += validCats.map(cat => `<span>${cat.category || 'Other'}</span>`).join('');
                html += '</div>';

                container.innerHTML = html;
            } catch (err) {
                console.error('Error rendering category chart:', err);
            }
        }

        renderTrendChart(trend) {
            const container = document.getElementById('trendChart');
            if (!container) return;

            if (!trend || trend.length === 0) {
                container.innerHTML = '<div class="empty-state">No trend data available</div>';
                return;
            }

            const max = Math.max(...trend.map(t => parseFloat(t.total)));

            let html = '<div class="trend-bars">';
            html += trend.map(t => {
                const h = (t.total / max) * 100;
                return `<div class="trend-bar" style="height: ${h};" data-value="${this.formatCurrency(parseInt(t.total))}"></div>`;
            }).join('');
            html += '</div><div class="trend-labels">';
            html += trend.map(t => `<span>${t.month}</span>`).join('');
            html += '</div>';

            container.innerHTML = html;
        }

        renderActivityFeed(activities) {
            const container = document.querySelector('.activity-list');
            if (!container) return;

            if (!activities || activities.length === 0) {
                container.innerHTML = '<div class="empty-state">No recent activity</div>';
                return;
            }

            const getIcon = (type, title) => {
                if (type === 'trip') return 'fa-suitcase';
                const t = (title || '').toLowerCase();
                if (t.includes('food') || t.includes('coffee')) return 'fa-utensils';
                if (t.includes('flight') || t.includes('plane')) return 'fa-plane';
                if (t.includes('hotel') || t.includes('stay')) return 'fa-hotel';
                if (t.includes('uber') || t.includes('taxi') || t.includes('cab')) return 'fa-car';
                return 'fa-receipt';
            };

            container.innerHTML = activities.map(item => `
            <div class="activity-item">
                <div class="activity-icon">
                    <i class="fas ${getIcon(item.type, item.title)}"></i>
                </div>
                <div class="activity-content">
                    <h4>${item.title}</h4>
                    <p class="activity-time">${new Date(item.date).toLocaleDateString()} &bull; ${item.type === 'trip' ? 'Journal' : 'Expense'}</p>
                </div>
                ${item.amount ? `<span class="activity-amount">${this.formatCurrency(item.amount)}</span>` : ''}
            </div>
        `).join('');
        }







        // Profile Management Methods
        async updateProfileInfo() {
            // Check dashboard vs modal inputs
            let newName = '';
            let upiId = null;

            const dashName = document.getElementById('updateNameInput');
            const cardName = document.getElementById('cardNameInput');
            const dashUpi = document.getElementById('updateUpiInput');
            const cardUpi = document.getElementById('cardUpiInput');

            if (document.getElementById('profileCardModal')) {
                // Modal context
                if (cardName) newName = cardName.value.trim();
                if (cardUpi) upiId = cardUpi.value.trim();
            } else {
                // Dashboard profile context
                if (dashName) newName = dashName.value.trim();
                if (dashUpi) upiId = dashUpi.value.trim();
            }

            if (newName.length < 2) {
                this.showToast('Name must be at least 2 characters', 'error');
                return;
            }

            const btn = document.getElementById('updateCardBtn') || document.getElementById('updateProfileBtn');
            const originalContent = btn ? btn.innerHTML : 'Update';
            if (btn) {
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
                btn.disabled = true;
            }

            try {
                const token = localStorage.getItem('token');
                const payload = { name: newName };
                if (upiId !== null) payload.upi_id = upiId;

                const res = await fetch('/api/auth/profile', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': token
                    },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.msg || 'Update failed');

                // Update local storage
                const user = JSON.parse(localStorage.getItem('user') || '{}');
                user.name = newName;
                if (upiId !== null) user.upi_id = upiId;
                localStorage.setItem('user', JSON.stringify(user));

                // Update UI
                document.querySelectorAll('.user-name').forEach(el => el.textContent = newName);
                document.querySelectorAll('.user-name-display').forEach(el => el.textContent = newName);

                // If in card, update the heading too
                const cardNameHeading = document.querySelector('#profileCardModal h2');
                if (cardNameHeading) cardNameHeading.textContent = newName;

                this.showToast('Profile updated successfully!', 'success');
            } catch (err) {
                console.error(err);
                this.showToast(err.message, 'error');
            } finally {
                if (btn) {
                    btn.innerHTML = originalContent;
                    btn.disabled = false;
                }
            }
        }

        async requestPasswordChange() {
            try {
                const token = localStorage.getItem('token');
                const res = await fetch('/api/auth/request-password-change', {
                    method: 'POST',
                    headers: { 'Authorization': token }
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.msg || 'Failed to send OTP');

                document.getElementById('passwordRequestStep').style.display = 'none';
                document.getElementById('passwordOTPStep').style.display = 'block';
                this.showToast('Verification code sent to your email', 'success');
            } catch (err) {
                this.showToast(err.message, 'error');
            }
        }

        async verifyPasswordChange() {
            const otp = document.getElementById('passwordOTP').value;
            const newPassword = document.getElementById('newPassword').value;

            if (!otp || otp.length !== 6) {
                this.showToast('Please enter a 6-digit code', 'warning');
                return;
            }
            if (newPassword.length < 6) {
                this.showToast('Password must be at least 6 characters', 'warning');
                return;
            }

            const btn = document.getElementById('verifyPwBtn');
            btn.disabled = true;
            btn.textContent = 'Verifying...';

            try {
                const token = localStorage.getItem('token');
                const res = await fetch('/api/auth/verify-password-change', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': token
                    },
                    body: JSON.stringify({ otp, newPassword })
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.msg || 'Verification failed');

                this.showToast('Password updated successfully!', 'success');
                document.getElementById('passwordOTPStep').style.display = 'none';
                document.getElementById('passwordRequestStep').style.display = 'block';
                document.getElementById('passwordOTP').value = '';
                document.getElementById('newPassword').value = '';
            } catch (err) {
                this.showToast(err.message, 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = 'Update Password';
            }
        }

        async requestAccountDeletion() {
            const confirmed = await this.showConfirm(
                'Account Deletion',
                'This will send a verification code to your email. Are you sure you want to proceed?',
                'Send Code',
                'Cancel'
            );
            if (!confirmed) return;

            try {
                const token = localStorage.getItem('token');
                const res = await fetch('/api/auth/request-account-deletion', {
                    method: 'POST',
                    headers: { 'Authorization': token }
                });

                const data = await res.json();
                if (!res.ok) throw new Error(data.msg || 'Failed to send OTP');

                document.getElementById('deleteRequestStep').style.display = 'none';
                document.getElementById('deleteOTPStep').style.display = 'block';
                this.showToast('Security code sent for account deletion', 'warning');
            } catch (err) {
                this.showToast(err.message, 'error');
            }
        }

        async confirmAccountDeletion() {
            const otp = document.getElementById('deleteOTP').value;
            if (!otp || otp.length !== 6) {
                this.showToast('Please enter the 6-digit security code', 'warning');
                return;
            }

            const btn = document.getElementById('confirmDelBtn');
            btn.disabled = true;
            btn.textContent = 'Deleting Account...';

            try {
                const token = localStorage.getItem('token');
                const res = await fetch('/api/auth/confirm-account-deletion', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': token
                    },
                    body: JSON.stringify({ otp })
                });

                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.msg || 'Deletion failed');
                }

                this.showToast('Account deleted. We are sorry to see you go.', 'info');
                localStorage.clear();
                setTimeout(() => window.location.href = 'index.html', 2000);
            } catch (err) {
                this.showToast(err.message, 'error');
                btn.disabled = false;
                btn.textContent = 'Confirm Deletion';
            }
        }

        async updateSetting(key, value) {
            try {
                const token = localStorage.getItem('token');
                const res = await fetch('/api/auth/profile', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': token
                    },
                    body: JSON.stringify({ [key]: value })
                });

                if (!res.ok) throw new Error('Failed to update setting');

                const data = await res.json();
                if (!res.ok) throw new Error(data.msg || 'Failed to update setting');

                // Merge updated data into local storage
                const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
                // Ensure key is updated even if backend doesn't return it
                const updatedUser = { ...currentUser, ...(data.user || data), [key]: value };
                localStorage.setItem('user', JSON.stringify(updatedUser));

                this.showToast('Setting updated successfully', 'success');

                // If currency changed, refresh data displays only (NOT init() - that adds duplicate listeners)
                if (key === 'preferred_currency') {
                    console.log('Currency changed to:', value);
                    // Only refresh data, not event listeners
                    if (this.isDashboard) {
                        await this.loadInitialData();
                        await this.updateRealTimeStats();
                        await this.updateAuthUI();
                        if (this.currentView === 'profile') {
                            this.loadProfileViewData();
                        }
                    }
                }
            } catch (err) {
                console.error(err);
                this.showToast('Error updating setting', 'error');
            }
        }

        loadProfileViewData() {
            const user = JSON.parse(localStorage.getItem('user') || '{}');
            const nameDisplay = document.querySelector('.user-name-display');
            const emailDisplay = document.querySelector('.user-email-display');
            const nameInput = document.getElementById('updateNameInput');
            const avatarImg = document.getElementById('profileViewAvatar');

            if (nameDisplay) nameDisplay.textContent = user.name || 'User';
            if (emailDisplay) emailDisplay.textContent = user.email || '';
            if (nameInput) nameInput.value = user.name || '';
            if (avatarImg && user.profile_picture) avatarImg.src = this.getImageUrl(user.profile_picture);


            // Initialize Toggles
            const emailToggle = document.getElementById('emailNotifToggle');
            const pushToggle = document.getElementById('pushNotifToggle');
            const privacyToggle = document.getElementById('profileVisToggle');
            const currencySelect = document.getElementById('profileCurrencySelect');

            if (emailToggle) emailToggle.checked = user.email_notifications !== false;
            if (pushToggle) pushToggle.checked = user.push_notifications !== false;
            if (privacyToggle) privacyToggle.checked = user.profile_visibility !== false;
            if (currencySelect && user.preferred_currency) currencySelect.value = user.preferred_currency;
        }
        showConfirmationModal(title, message, onConfirm, isDangerous = false) {
            const existingModal = document.getElementById('confirmationModal');
            if (existingModal) existingModal.remove();

            const modalHTML = `
        <div id="confirmationModal" style="display:flex; position:fixed; inset:0; z-index:9999999; align-items:center; justify-content:center; background:rgba(0,0,0,0.5); backdrop-filter:blur(4px); opacity:0; animation: fadeIn 0.2s forwards;">
            <div style="background:white; border-radius:20px; width:90%; max-width:400px; padding:1.5rem; box-shadow:0 20px 60px rgba(0,0,0,0.2); transform:scale(0.95); animation: popIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;">
                <div style="text-align:center; margin-bottom:1.5rem;">
                    <div style="width:60px; height:60px; background:${isDangerous ? '#fee2e2' : '#e0f2fe'}; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 1rem; color:${isDangerous ? '#dc2626' : '#0284c7'};">
                        <i class="fas ${isDangerous ? 'fa-exclamation-triangle' : 'fa-info-circle'}" style="font-size:1.5rem;"></i>
                    </div>
                    <h3 style="margin:0 0 0.5rem 0; color:#0f172a; font-size:1.25rem;">${title}</h3>
                    <p style="margin:0; color:#64748b; line-height:1.5;">${message}</p>
                </div>
                <div style="display:flex; gap:0.75rem;">
                    <button id="cancelConfirmBtn" style="flex:1; padding:0.75rem; border:1px solid #cbd5e1; background:white; color:#475569; border-radius:10px; font-weight:600; cursor:pointer; transition:all 0.2s;">Cancel</button>
                    <button id="confirmActionBtn" style="flex:1; padding:0.75rem; border:none; background:${isDangerous ? '#dc2626' : '#2a8faa'}; color:white; border-radius:10px; font-weight:600; cursor:pointer; transition:all 0.2s;">${isDangerous ? 'Delete' : 'Confirm'}</button>
                </div>
            </div>
            <style>
                @keyframes fadeIn { to { opacity: 1; } }
                @keyframes popIn { to { transform: scale(1); } }
                #cancelConfirmBtn:hover { background: #f1f5f9; }
                #confirmActionBtn:hover { filter: brightness(1.1); transform: translateY(-1px); }
            </style>
        </div>`;

            document.body.insertAdjacentHTML('beforeend', modalHTML);

            const modal = document.getElementById('confirmationModal');
            const cleanup = () => modal.remove();

            document.getElementById('cancelConfirmBtn').onclick = cleanup;
            modal.onclick = (e) => { if (e.target === modal) cleanup(); };

            document.getElementById('confirmActionBtn').onclick = async () => {
                const btn = document.getElementById('confirmActionBtn');
                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
                btn.disabled = true;
                await onConfirm();
                cleanup();
            };
        }

        // Modern Alert Modal (replaces alert())
        showAlert(title, message, type = "info") {
            const icons = {
                success: { icon: "✓", color: "#10b981", bg: "#d1fae5" },
                error: { icon: "✕", color: "#ef4444", bg: "#fee2e2" },
                info: { icon: "ℹ", color: "#3b82f6", bg: "#dbeafe" },
                warning: { icon: "⚠", color: "#f59e0b", bg: "#fef3c7" }
            };
            const style = icons[type] || icons.info;

            const modal = document.createElement('div');
            modal.style.cssText = `
                position: fixed; inset: 0; z-index: 999999;
                background: rgba(11, 59, 91, 0.5); backdrop-filter: blur(4px);
                display: flex; align-items: center; justify-content: center;
                animation: fadeIn 0.2s ease-out;
            `;

            modal.innerHTML = `
                <style>
                    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                    @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
                </style>
                <div style="background: white; border-radius: 16px; padding: 2rem; max-width: 400px; width: 90%; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); animation: slideUp 0.3s ease-out;">
                    <div style="width: 60px; height: 60px; background: ${style.bg}; color: ${style.color}; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem; font-size: 2rem; font-weight: bold;">
                        ${style.icon}
                    </div>
                    <h3 style="margin: 0 0 0.5rem 0; text-align: center; color: #0f172a; font-size: 1.25rem;">${title}</h3>
                    <p style="margin: 0 0 1.5rem 0; text-align: center; color: #64748b; font-size: 0.95rem; line-height: 1.5;">${message}</p>
                    <button id="alert-ok-btn" style="width: 100%; padding: 0.75rem; background: ${style.color}; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.95rem; transition: 0.2s;" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
                        OK
                    </button>
                </div>
            `;

            document.body.appendChild(modal);

            const cleanup = () => modal.remove();
            document.getElementById('alert-ok-btn').onclick = cleanup;
            modal.addEventListener('click', (e) => {
                if (e.target === modal) cleanup();
            });

            setTimeout(cleanup, 8000); // Auto-close after 8 seconds
        }

        // Modern Prompt Modal (replaces prompt())
        showPrompt(title, message, defaultValue = "", icon = "✎") {
            return new Promise((resolve) => {
                const isTimeInput = icon === "🕐";
                const modal = document.createElement('div');
                modal.style.cssText = `
                    position: fixed; inset: 0; z-index: 999999;
                    background: rgba(11, 59, 91, 0.5); backdrop-filter: blur(4px);
                    display: flex; align-items: center; justify-content: center;
                    animation: fadeIn 0.2s ease-out;
                `;

                const inputHTML = isTimeInput ? `
                    <div style="display: flex; gap: 1rem; align-items: center; justify-content: center; margin-bottom: 1rem;">
                        <div style="flex: 1;">
                            <label style="display: block; font-size: 0.75rem; color: #64748b; margin-bottom: 0.5rem; font-weight: 600;">Hour</label>
                            <select id="hour-input" style="width: 100%; padding: 0.75rem; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 1.1rem; font-weight: 600; color: #0B3B5B; background: white; cursor: pointer; transition: 0.2s;" onfocus="this.style.borderColor='#0891B2'" onblur="this.style.borderColor='#e2e8f0'">
                                ${Array.from({ length: 24 }, (_, i) => {
                    const h = String(i).padStart(2, '0');
                    const selected = defaultValue.split(':')[0] === h ? 'selected' : '';
                    return `<option value="${h}" ${selected}>${h}</option>`;
                }).join('')}
                            </select>
                        </div>
                        <div style="font-size: 2rem; color: #0B3B5B; font-weight: bold; padding-top: 1.5rem;">:</div>
                        <div style="flex: 1;">
                            <label style="display: block; font-size: 0.75rem; color: #64748b; margin-bottom: 0.5rem; font-weight: 600;">Minute</label>
                            <select id="minute-input" style="width: 100%; padding: 0.75rem; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 1.1rem; font-weight: 600; color: #0B3B5B; background: white; cursor: pointer; transition: 0.2s;" onfocus="this.style.borderColor='#0891B2'" onblur="this.style.borderColor='#e2e8f0'">
                                ${Array.from({ length: 60 }, (_, i) => {
                    const m = String(i).padStart(2, '0');
                    const selected = defaultValue.split(':')[1] === m ? 'selected' : '';
                    return `<option value="${m}" ${selected}>${m}</option>`;
                }).join('')}
                            </select>
                        </div>
                    </div>
                ` : `
                    <input type="text" id="prompt-input" value="${defaultValue}" style="width: 100%; padding: 0.75rem; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 0.95rem; margin-bottom: 1rem; box-sizing: border-box; transition: 0.2s;" onfocus="this.style.borderColor='#0891B2'" onblur="this.style.borderColor='#e2e8f0'">
                `;

                modal.innerHTML = `
                    <style>
                        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                        @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
                    </style>
                    <div style="background: white; border-radius: 16px; padding: 2rem; max-width: 450px; width: 90%; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); animation: slideUp 0.3s ease-out;">
                        <div style="width: 60px; height: 60px; background: linear-gradient(135deg, #0B3B5B 0%, #1A5F7A 100%); color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem; font-size: 1.75rem; box-shadow: 0 4px 12px rgba(11, 59, 91, 0.3);">
                            ${icon}
                        </div>
                        <h3 style="margin: 0 0 0.5rem 0; text-align: center; color: #0B3B5B; font-size: 1.25rem; font-weight: 700;">${title}</h3>
                        <p style="margin: 0 0 1rem 0; text-align: center; color: #64748b; font-size: 0.9rem;">${message}</p>
                        ${inputHTML}
                        <div style="display: flex; gap: 0.75rem;">
                            <button id="prompt-cancel" style="flex: 1; padding: 0.75rem; background: #f1f5f9; color: #475569; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.95rem; transition: 0.2s;" onmouseover="this.style.background='#e2e8f0'" onmouseout="this.style.background='#f1f5f9'">
                                Cancel
                            </button>
                            <button id="prompt-ok" style="flex: 1; padding: 0.75rem; background: linear-gradient(135deg, #0B3B5B 0%, #1A5F7A 100%); color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.95rem; transition: 0.2s; box-shadow: 0 4px 12px rgba(11, 59, 91, 0.4);" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
                                Confirm
                            </button>
                        </div>
                    </div>
                `;

                document.body.appendChild(modal);

                const okBtn = modal.querySelector('#prompt-ok');
                const cancelBtn = modal.querySelector('#prompt-cancel');

                if (isTimeInput) {
                    const hourInput = modal.querySelector('#hour-input');
                    const minuteInput = modal.querySelector('#minute-input');
                    hourInput.focus();

                    const getValue = () => `${hourInput.value}:${minuteInput.value}`;

                    const cleanup = (value) => {
                        modal.remove();
                        resolve(value);
                    };

                    okBtn.onclick = () => cleanup(getValue());
                    cancelBtn.onclick = () => cleanup(null);
                    modal.addEventListener('click', (e) => {
                        if (e.target === modal) cleanup(null);
                    });
                } else {
                    const inputElement = modal.querySelector('#prompt-input');
                    inputElement.focus();
                    inputElement.select();

                    const cleanup = (value) => {
                        modal.remove();
                        resolve(value);
                    };

                    okBtn.onclick = () => cleanup(inputElement.value);
                    cancelBtn.onclick = () => cleanup(null);
                    modal.addEventListener('click', (e) => {
                        if (e.target === modal) cleanup(null);
                    });
                    inputElement.addEventListener('keypress', (e) => {
                        if (e.key === 'Enter') cleanup(inputElement.value);
                        if (e.key === 'Escape') cleanup(null);
                    });
                }
            });
        }

        // Modern Confirm Modal (replaces confirm())
        showConfirm(title, message, confirmText = "Confirm", cancelText = "Cancel") {
            return new Promise((resolve) => {
                const modal = document.createElement('div');
                modal.style.cssText = `
                    position: fixed; inset: 0; z-index: 999999;
                    background: rgba(11, 59, 91, 0.5); backdrop-filter: blur(4px);
                    display: flex; align-items: center; justify-content: center;
                    animation: fadeIn 0.2s ease-out;
                `;

                modal.innerHTML = `
                    <style>
                        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                        @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
                    </style>
                    <div style="background: white; border-radius: 16px; padding: 2rem; max-width: 450px; width: 90%; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1); animation: slideUp 0.3s ease-out;">
                        <div style="width: 60px; height: 60px; background: #fef3c7; color: #f59e0b; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1rem; font-size: 2rem;">
                            ⚠
                        </div>
                        <h3 style="margin: 0 0 0.5rem 0; text-align: center; color: #0f172a; font-size: 1.25rem;">${title}</h3>
                        <p style="margin: 0 0 1.5rem 0; text-align: center; color: #64748b; font-size: 0.95rem; line-height: 1.5;">${message}</p>
                        <div style="display: flex; gap: 0.75rem;">
                            <button id="confirm-cancel" style="flex: 1; padding: 0.75rem; background: #f1f5f9; color: #475569; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.95rem; transition: 0.2s;" onmouseover="this.style.background='#e2e8f0'" onmouseout="this.style.background='#f1f5f9'">
                                ${cancelText}
                            </button>
                            <button id="confirm-ok" style="flex: 1; padding: 0.75rem; background: #ef4444; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.95rem; transition: 0.2s; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
                                ${confirmText}
                            </button>
                        </div>
                    </div>
                `;

                document.body.appendChild(modal);

                const okBtn = modal.querySelector('#confirm-ok');
                const cancelBtn = modal.querySelector('#confirm-cancel');

                const cleanup = (value) => {
                    modal.remove();
                    resolve(value);
                };

                okBtn.onclick = () => cleanup(true);
                cancelBtn.onclick = () => cleanup(false);
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) cleanup(false);
                });
            });
        }

        openPaymentGateway(expenseId, userId, amount, payerName, payerUpi) {
            const existing = document.getElementById('paymentGatewayModal');
            if (existing) existing.remove();

            const currencySymbol = this.getCurrencySymbol ? this.getCurrencySymbol() : '₹';
            const formattedAmount = `${currencySymbol}${parseFloat(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            const displayUpi = (payerUpi && payerUpi !== 'null' && payerUpi !== 'undefined') ? payerUpi : 'Not Provided';

            const html = `
            <div id="paymentGatewayModal" style="display:flex;position:fixed;inset:0;z-index:9999999;align-items:center;justify-content:center;background:rgba(10,18,40,0.75);backdrop-filter:blur(12px);padding:1rem;" onclick="if(event.target===this)this.remove()">
                <div style="background:white;border-radius:28px;width:100%;max-width:380px;overflow:hidden;animation:modalSlideIn 0.35s cubic-bezier(0.16,1,0.3,1);display:flex;flex-direction:column;box-shadow:0 40px 80px rgba(0,0,0,0.35);max-height:92vh;overflow-y:auto;">
                    <div style="background:linear-gradient(135deg, #0b3b5b, #2a8faa);padding:1.5rem 1.75rem;color:white;position:relative;flex-shrink:0;">
                        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                            <div>
                                <div style="font-size:0.65rem;font-weight:800;opacity:0.7;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:0.25rem;"><i class="fas fa-file-invoice-dollar" style="margin-right:4px;"></i>Payment Summary</div>
                                <div style="font-size:1.75rem;font-weight:900;letter-spacing:-0.03em;">${formattedAmount}</div>
                                <div style="font-size:0.8rem;opacity:0.85;margin-top:0.3rem;">For IntelliTrip Split</div>
                            </div>
                            <button onclick="document.getElementById('paymentGatewayModal').remove()" style="background:rgba(255,255,255,0.15);border:none;color:white;width:34px;height:34px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;transition:0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.25)'" onmouseout="this.style.background='rgba(255,255,255,0.15)'"><i class="fas fa-times"></i></button>
                        </div>
                    </div>

                    <div id="pg-panel-main" style="padding:1.5rem;">
                        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:16px; padding:1.25rem; margin-bottom:1.5rem;">
                            <div style="font-size:0.75rem; font-weight:800; color:#64748b; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:0.75rem;">Payee Details</div>
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.8rem;">
                                <span style="font-size:0.85rem; color:#374151; font-weight:600;">Name</span>
                                <span style="font-size:0.9rem; color:#0f172a; font-weight:800;">${payerName}</span>
                            </div>
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-size:0.85rem; color:#374151; font-weight:600;">UPI ID</span>
                                <span style="font-size:0.85rem; color:#0b3b5b; font-weight:700; font-family:monospace; background:#e0f2fe; padding:4px 8px; border-radius:6px; letter-spacing:0.5px;">${displayUpi}</span>
                            </div>
                        </div>

                        <button onclick="app._pgProcessPayment(${expenseId},'${userId}')" style="width:100%;padding:1rem;background:linear-gradient(135deg,#10b981,#059669);color:white;border:none;border-radius:14px;font-size:0.95rem;font-weight:800;cursor:pointer;box-shadow:0 4px 15px rgba(16,185,129,0.35); display:flex; justify-content:center; align-items:center; gap:0.5rem;" onmouseover="this.style.transform='translateY(-1px)'" onmouseout="this.style.transform=''"><i class="fas fa-lock"></i> Pay Securely</button>
                    </div>

                    <div id="pg-processing" style="display:none;padding:2.5rem 1.5rem;text-align:center;flex-direction:column;align-items:center;gap:1rem;">
                        <div id="pg-spinner" style="width:72px;height:72px;border-radius:50%;border:4px solid #e2e8f0;border-top-color:#2a8faa;animation:spin 0.8s linear infinite;margin:0 auto;"></div>
                        <div style="font-size:1.1rem;font-weight:800;color:#0f172a;" id="pg-processing-msg">Initiating payment...</div>
                        <div style="font-size:0.8rem;color:#64748b;">Please do not close this window</div>
                        <div style="width:100%;background:#f1f5f9;border-radius:10px;height:6px;overflow:hidden;margin-top:0.5rem;">
                            <div id="pg-progress-bar" style="height:100%;background:linear-gradient(to right,#2a8faa,#0b3b5b);border-radius:10px;width:0%;transition:width 0.5s ease;"></div>
                        </div>
                    </div>

                    <div id="pg-success" style="display:none;padding:2.5rem 1.5rem;text-align:center;flex-direction:column;align-items:center;gap:1rem;">
                        <div style="width:80px;height:80px;background:linear-gradient(135deg,#10b981,#34d399);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto;box-shadow:0 15px 30px rgba(16,185,129,0.35);animation:pgSuccessPop 0.5s cubic-bezier(0.16,1,0.3,1);">
                            <i class="fas fa-check" style="color:white;font-size:2rem;"></i>
                        </div>
                        <div>
                            <div style="font-size:1.4rem;font-weight:900;color:#0f172a;margin-bottom:0.25rem;">Payment Successful!</div>
                            <div style="font-size:0.85rem;color:#64748b;font-weight:600;">Your share has been settled</div>
                        </div>
                        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:16px;padding:1.25rem;width:100%;box-sizing:border-box;">
                            <div style="font-size:0.7rem;font-weight:800;color:#15803d;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.5rem;">Transaction Details</div>
                            <div style="display:flex;justify-content:space-between;margin-bottom:0.3rem;"><span style="font-size:0.8rem;color:#374151;font-weight:600;">Amount Paid</span><span style="font-size:0.8rem;color:#15803d;font-weight:800;">${formattedAmount}</span></div>
                            <div style="display:flex;justify-content:space-between;margin-bottom:0.3rem;"><span style="font-size:0.8rem;color:#374151;font-weight:600;">To</span><span style="font-size:0.8rem;color:#1e293b;font-weight:700;">${payerName}</span></div>
                            <div style="display:flex;justify-content:space-between;"><span style="font-size:0.8rem;color:#374151;font-weight:600;">Txn ID</span><span style="font-size:0.75rem;color:#2a8faa;font-weight:700;font-family:monospace;" id="pg-txn-id">IT-XXXX</span></div>
                        </div>
                        <button onclick="document.getElementById('paymentGatewayModal').remove(); window.location.reload();" style="width:100%;padding:0.9rem;background:linear-gradient(135deg,#10b981,#059669);color:white;border:none;border-radius:14px;font-size:0.95rem;font-weight:800;cursor:pointer;box-shadow:0 4px 15px rgba(16,185,129,0.35);">
                            <i class="fas fa-check-circle"></i> Done
                        </button>
                    </div>
                </div>
            </div>`;

            if (!document.getElementById('pgStyles')) {
                const style = document.createElement('style');
                style.id = 'pgStyles';
                style.textContent = `
                    @keyframes spin { to { transform: rotate(360deg); } }
                    @keyframes pgSuccessPop { 0%{transform:scale(0);opacity:0} 60%{transform:scale(1.2)} 100%{transform:scale(1);opacity:1} }
                    #paymentGatewayModal > div::-webkit-scrollbar { display: none; }
                    #paymentGatewayModal > div { -ms-overflow-style: none; scrollbar-width: none; }
                `;
                document.head.appendChild(style);
            }
            document.body.insertAdjacentHTML('beforeend', html);
        }

        async _pgProcessPayment(expenseId, userId) {
            const mainPanel = document.getElementById('pg-panel-main');
            if (mainPanel) mainPanel.style.display = 'none';

            const proc = document.getElementById('pg-processing');
            if (proc) proc.style.display = 'flex';

            const progressBar = document.getElementById('pg-progress-bar');
            const msgEl = document.getElementById('pg-processing-msg');

            try {
                // 1. Create Order via Backend
                msgEl.textContent = 'Initiating secured payment...';
                if (progressBar) progressBar.style.width = '25%';

                const token = localStorage.getItem('token');
                let amountToPay = this._manualSettleAmt || 0;

                if (expenseId) {
                    let expense = (this.allExpenses || []).find(e => e.id == expenseId);
                    if (!expense) {
                        const resExp = await fetch('/api/expenses', { headers: { 'Authorization': token } });
                        const expenses = await resExp.json();
                        expense = expenses.find(e => e.id == expenseId);
                    }

                    // Fetch members to correctly reconstruct the amount if needed
                    const membersRes = await fetch(`/api/trips/${expense.trip_id}/members`, {
                        headers: { 'Authorization': token }
                    });
                    const members = await membersRes.json();

                    let details = this.getReconstructedSplit(expense, members);
                    amountToPay = details[userId] || 0;
                }

                const orderRes = await fetch('/api/payments/create-order', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': token },
                    body: JSON.stringify({ amount: amountToPay, currency: 'INR' })
                });

                if (!orderRes.ok) throw new Error('Failed to create payment order');
                const orderData = await orderRes.json();

                msgEl.textContent = 'Connecting to Razorpay...';
                if (progressBar) progressBar.style.width = '50%';

                // 2. Open Razorpay Checkout
                const options = {
                    key: orderData.key_id,
                    amount: orderData.amount,
                    currency: orderData.currency,
                    name: "IntelliTrip",
                    description: "Expense Settlement",
                    order_id: orderData.id,
                    handler: async function (response) {
                        try {
                            if (progressBar) progressBar.style.width = '75%';
                            msgEl.textContent = 'Verifying signature...';

                            // 3. Verify Payment
                            const verifyRes = await fetch('/api/payments/verify-payment', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', 'Authorization': token },
                                body: JSON.stringify({
                                    razorpay_order_id: response.razorpay_order_id,
                                    razorpay_payment_id: response.razorpay_payment_id,
                                    razorpay_signature: response.razorpay_signature
                                })
                            });

                            const verifyData = await verifyRes.json();
                            if (!verifyData.success) throw new Error('Payment verification failed');

                            if (progressBar) progressBar.style.width = '100%';

                            await new Promise(r => setTimeout(r, 400));

                            if (proc) proc.style.display = 'none';
                            const successEl = document.getElementById('pg-success');
                            if (successEl) {
                                successEl.style.display = 'flex';
                                const txnEl = document.getElementById('pg-txn-id');
                                if (txnEl) txnEl.textContent = response.razorpay_payment_id;
                            }

                            // 4. Auto-mark settled in system
                            try { await app.toggleExpensePayment(expenseId, userId, null); } catch (e) { console.error(e); }

                        } catch (err) {
                            console.error('Verification error:', err);
                            app.showToast('Payment verification failed', 'error');
                            if (proc) proc.style.display = 'none';
                            if (mainPanel) mainPanel.style.display = 'block';
                        }
                    },
                    prefill: {
                        name: "IntelliTrip User",
                        email: "user@example.com",
                        contact: "9999999999"
                    },
                    theme: {
                        color: "#0b3b5b"
                    },
                    modal: {
                        ondismiss: function () {
                            if (proc) proc.style.display = 'none';
                            if (mainPanel) mainPanel.style.display = 'block';
                            app.showToast('Payment cancelled by user', 'info');
                        }
                    }
                };

                const rzp = new window.Razorpay(options);
                rzp.on('payment.failed', function (response) {
                    app.showToast('Payment Failed: ' + response.error.description, 'error');
                    if (proc) proc.style.display = 'none';
                    if (mainPanel) mainPanel.style.display = 'block';
                });
                rzp.open();

            } catch (err) {
                console.error('Payment Error:', err);
                app.showToast(err.message || 'Payment initiation failed', 'error');
                if (proc) proc.style.display = 'none';
                if (mainPanel) mainPanel.style.display = 'block';
            }
        }
    }


    // Initialize the application
    let app;

    document.addEventListener('DOMContentLoaded', () => {
        app = new IntelliTripApp();
        window.app = app;

        // Initialize Dashboard Data if on dashboard (removed duplicate call, handled by showView)
        // app.loadDashboardData();

        // Add loaded class for animations
        setTimeout(() => {
            document.body.classList.add('loaded');
        }, 100);
    });

    // Global functions for HTML onclick
    window.showView = (view) => app?.showView(view);
    window.closeModal = () => app?.closeModal();
    window.switchModalTab = (tabId) => app?.switchModalTab(tabId);
    window.logout = () => app?.logout();

    // Export app for debugging
    window.IntelliTripApp = IntelliTripApp;
}  // End of if (typeof IntelliTripApp !== 'undefined') check
