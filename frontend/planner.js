/* Enhanced Planner Logic with INR, Location Info, More Links */
class TripPlanner {
    constructor(app, tripId) {
        this.app = app;
        this.tripId = tripId;
        this.trip = null;
        this.days = 5;
        this.itinerary = [];
        this.recommendations = [];
        this.usedRecommendationTitles = new Set();
        this.userLocation = null;
        this.locationRefreshed = false;
        this.baseUrl = 'http://localhost:5000/api';
        this.map = null;
        this.markers = [];
        this.routeLine = null;
        this.mapInitialized = false;
    }

    async _api(endpoint, method = 'GET', body = null) {
        const token = localStorage.getItem('token');
        const options = {
            method,
            headers: { 'Authorization': token, 'Content-Type': 'application/json' }
        };
        if (body) options.body = JSON.stringify(body);
        const res = await fetch(`${this.baseUrl}${endpoint}`, options);
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw { status: res.status, message: errData.message || 'API Error' };
        }
        return await res.json();
    }

    async init() {
        try {
            this.trip = this.app.allTrips.find(t => t.id == this.tripId);
            if (!this.trip) {
                console.error("Trip not found");
                return;
            }

            // Get user location for distance calculation
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (pos) => {
                        this.userLocation = {
                            lat: parseFloat(pos.coords.latitude),
                            lng: parseFloat(pos.coords.longitude)
                        };
                        console.log("[Planner] User location acquired:", this.userLocation);
                        this.loadItinerary();
                        this.renderAIRecommendations();
                    },
                    (err) => {
                        console.warn("[Planner] Geolocation failed:", err.message);
                        this.userLocation = false;
                        this.renderItineraryItems();
                        this.renderAIRecommendations();
                    },
                    { enableHighAccuracy: true, timeout: 10000 }
                );
            }

            const start = new Date(this.trip.start_date);
            const end = new Date(this.trip.end_date);
            this.days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

            this.renderLayout();
            await this.loadItinerary();
            this.recommendAI();
        } catch (e) {
            console.error("Planner init error:", e);
        }
    }

    close() {
        const overlay = document.getElementById('planner-overlay');
        const styles = document.getElementById('planner-styles');
        if (overlay) document.body.removeChild(overlay);
        if (styles) document.head.removeChild(styles);

        // If we are on the standalone planner page, go back to dashboard
        if (window.location.pathname.includes('planner.html')) {
            window.location.href = 'dashboard.html#trips';
        }
    }

    renderLayout() {
        const overlay = document.createElement('div');
        overlay.id = 'planner-overlay';
        overlay.className = 'planner-overlay show';

        // Add style tag for planner-specific modern UI
        const style = document.createElement('style');
        style.id = 'planner-styles';
        style.textContent = `
            #planner-overlay {
                position: fixed; inset: 0; background-color: #f8fafc; z-index: 2000;
                display: flex; flex-direction: column; opacity: 0; transition: opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            }
            #planner-overlay.show { opacity: 1; }
            #planner-overlay .planner-header {
                padding: 1.25rem 2.5rem; background: var(--white); border-bottom: 1px solid rgba(87, 193, 211, 0.15);
                display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 20px rgba(0,0,0,0.03);
            }
            #planner-overlay .planner-content {
                display: flex; flex: 1; overflow: hidden; background: #f1f5f9;
            }
            #planner-overlay .planner-sidebar {
                width: 400px; background: var(--white); border-right: 1px solid rgba(87, 193, 211, 0.15);
                display: flex; flex-direction: column; box-shadow: 10px 0 30px rgba(0,0,0,0.02); z-index: 10;
            }
            #planner-overlay .sidebar-header {
                padding: 2rem 1.5rem; background: var(--navy-900); color: var(--white);
                position: relative; overflow: hidden;
            }
            #planner-overlay .sidebar-header::after {
                content: ''; position: absolute; top: -50%; left: -50%; width: 200%; height: 200%;
                background: radial-gradient(circle, rgba(255,255,255,0.05) 0%, transparent 70%);
                pointer-events: none;
            }
            #planner-overlay .sidebar-body {
                flex: 1; overflow-y: auto; padding: 1.5rem; background: #f8fafc;
                scrollbar-width: thin; scrollbar-color: var(--blue-200) transparent;
                display: block;
            }
            #planner-overlay .planner-main {
                flex: 1; display: flex; gap: 2rem; padding: 2rem; overflow-x: auto;
                scroll-behavior: smooth; align-items: flex-start;
            }
            #planner-overlay .day-column {
                min-width: 340px; background: rgba(255, 255, 255, 0.7); backdrop-filter: blur(10px);
                border-radius: 20px; display: flex; flex-direction: column; height: 100%;
                box-shadow: 0 10px 25px rgba(0,0,0,0.04); border: 1px solid rgba(255,255,255,0.8);
                transition: transform 0.3s ease, box-shadow 0.3s ease;
            }
            #planner-overlay .day-column:hover { transform: translateY(-4px); box-shadow: 0 15px 35px rgba(0,0,0,0.08); }
            #planner-overlay .day-header {
                padding: 1.5rem; background: linear-gradient(135deg, var(--navy-900) 0%, #1e293b 100%);
                color: var(--white); border-radius: 20px 20px 0 0; text-align: left;
                position: relative;
            }
            #planner-overlay .day-header::after {
                content: ''; position: absolute; bottom: 0; left: 1.5rem; right: 1.5rem; height: 1px;
                background: rgba(255,255,255,0.1);
            }
            #planner-overlay .day-body { flex: 1; padding: 1.25rem; overflow-y: auto; display: flex; flex-direction: column; gap: 1.25rem; }
            #planner-overlay .drop-zone.drag-over { background: rgba(87, 193, 211, 0.08); border: 2px dashed var(--blue-400); border-radius: 16px; }
            
            #planner-overlay .itinerary-card {
                background: white; border-radius: 16px; padding: 1.25rem; border: 1px solid rgba(87, 193, 211, 0.1);
                box-shadow: 0 4px 12px rgba(0,0,0,0.02); position: relative; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            #planner-overlay .itinerary-card:hover { transform: scale(1.02); box-shadow: 0 12px 24px rgba(0,0,0,0.06); }
            
            #planner-overlay .btn-action-small {
                width: 32px; height: 32px; border-radius: 10px; border: none; cursor: pointer;
                display: flex; align-items: center; justify-content: center; font-size: 0.85rem;
                transition: all 0.2s ease; background: var(--gray-50); color: var(--gray-600);
            }
            #planner-overlay .btn-action-small:hover { transform: scale(1.1); background: var(--blue-50); color: var(--blue-600); }
            
            /* AI Pick Animation */
            @keyframes shimmer {
                0% { background-position: -200% 0; }
                100% { background-position: 200% 0; }
            }
            #planner-overlay .ai-pick-label {
                background: linear-gradient(90deg, #57c1d3, #0b3b5b, #57c1d3);
                background-size: 200% auto; animation: shimmer 3s linear infinite;
                -webkit-background-clip: text; -webkit-text-fill-color: transparent;
                font-weight: 800; font-size: 0.65rem; letter-spacing: 1px;
            }
            #planner-overlay .distance-badge {
                font-size: 0.7rem; color: var(--blue-600); font-weight: 700;
                background: rgba(87, 193, 211, 0.1); padding: 3px 8px; border-radius: 6px;
                display: flex; align-items: center; gap: 4px; white-space: nowrap;
            }
            #planner-overlay .error-card {
                background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.1);
                border-radius: 20px; padding: 2.5rem 1.5rem; text-align: center;
                backdrop-filter: blur(5px); display: flex; flex-direction: column; align-items: center;
                margin: auto 0;
            }
            #planner-overlay .error-card .btn-retry {
                background: var(--navy-900); color: white; border: none; padding: 1rem 2.5rem;
                border-radius: 16px; font-weight: 800; cursor: pointer; transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                display: flex; align-items: center; gap: 10px; font-size: 0.95rem;
                box-shadow: 0 8px 20px rgba(11, 59, 91, 0.25);
            }
            #planner-overlay .error-card .btn-retry:hover {
                transform: translateY(-3px); box-shadow: 0 12px 25px rgba(11, 59, 91, 0.35);
                background: #154e75;
            }
            #planner-overlay .btn-header-action {
                background: var(--white); color: var(--navy-900); border: 1px solid rgba(87, 193, 211, 0.2);
                padding: 0.75rem 1.5rem; border-radius: 14px; font-weight: 800; cursor: pointer;
                transition: 0.3s; display: flex; align-items: center; gap: 8px; font-size: 0.9rem;
                box-shadow: 0 4px 15px rgba(0,0,0,0.05);
            }
            #planner-overlay .btn-header-action:hover {
                background: var(--navy-900); color: var(--white); transform: translateY(-2px);
                box-shadow: 0 8px 20px rgba(11, 59, 91, 0.15);
            }
            #planner-overlay .btn-premium {
                background: var(--navy-900); color: white; border: none; padding: 1rem 2.5rem;
                border-radius: 16px; font-weight: 800; cursor: pointer; transition: 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                display: flex; align-items: center; gap: 10px; font-size: 1rem;
                box-shadow: 0 10px 25px rgba(11, 59, 91, 0.25);
            }
            #planner-overlay .btn-premium:hover {
                transform: translateY(-3px); box-shadow: 0 15px 35px rgba(11, 59, 91, 0.35);
                background: #154e75;
            }
            #planner-overlay .distance-badge {
                font-size: 0.72rem; color: var(--blue-700); font-weight: 800;
                background: rgba(87, 193, 211, 0.12); padding: 4px 10px; border-radius: 8px;
                display: flex; align-items: center; gap: 6px; border: 1px solid rgba(87, 193, 211, 0.1);
            }
            #planner-overlay .badge-pulse {
                animation: premium-pulse 2s infinite linear;
            }
            @keyframes premium-pulse {
                0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255,255,255,0.4); }
                50% { transform: scale(1.05); box-shadow: 0 0 0 10px rgba(255,255,255,0); }
                100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(255,255,255,0); }
            }
        `;
        document.head.appendChild(style);

        // Inject Leaflet CSS and JS dynamically
        if (!document.getElementById('leaflet-css')) {
            const lCss = document.createElement('link');
            lCss.id = 'leaflet-css';
            lCss.rel = 'stylesheet';
            lCss.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
            document.head.appendChild(lCss);
        }

        if (!document.getElementById('leaflet-js')) {
            const lJs = document.createElement('script');
            lJs.id = 'leaflet-js';
            lJs.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
            lJs.onload = () => { this.initMap(); };
            document.head.appendChild(lJs);
        } else {
            // If already loaded, just init map after a short delay to ensure DOM is ready
            setTimeout(() => this.initMap(), 500);
        }

        overlay.innerHTML = `
            <div class="planner-header">
                <div style="display:flex; align-items:center; gap:1.5rem;">
                    <button onclick="planner.close()" 
                            style="background:var(--gray-50); border:none; color:var(--navy-900); width:44px; height:44px; border-radius:14px; cursor:pointer; transition:0.3s; display:flex; align-items:center; justify-content:center;">
                        <i class="fas fa-arrow-left" style="font-size:1.1rem;"></i>
                    </button>
                    <div>
                        <h2 style="margin:0; font-size:1.4rem; color:var(--navy-900); font-family:'Poppins'; font-weight:800; letter-spacing:-0.5px;">Trip Planner</h2>
                        <div style="display:flex; align-items:center; gap:12px; margin-top:4px;">
                            <span style="font-size:0.8rem; color:var(--blue-600); font-weight:700; background:rgba(87, 193, 211, 0.1); padding:2px 8px; border-radius:6px;"><i class="fas fa-map-marker-alt"></i> ${this.trip.destination.toUpperCase()}</span>
                            <span style="font-size:0.8rem; color:var(--gray-500); font-weight:600;"><i class="fas fa-calendar-day"></i> ${this.days} DAYS JOURNEY</span>
                        </div>
                    </div>
                </div>
                <div style="display:flex; gap:1rem;">
                    <button class="btn-header-action" onclick="planner.magicallyAutoPlan()" style="background:linear-gradient(135deg, #6366f1, #a855f7); color:white; border:none; box-shadow: 0 8px 20px rgba(99, 102, 241, 0.3);">
                        <i class="fas fa-wand-magic-sparkles"></i> Magic Auto-Plan
                    </button>
                     <button class="btn-header-action" onclick="planner.toggleMap()" id="btn-toggle-map" style="background:var(--white); color:var(--navy-900);">
                        <i class="fas fa-map"></i> <span id="map-toggle-text">Show Map</span>
                    </button>
                    <button class="btn-header-action" onclick="planner.saveAll()" style="background:var(--navy-900); color:white; border:none; box-shadow: 0 10px 25px rgba(11, 59, 91, 0.25);">
                        <i class="fas fa-check-circle"></i> Save Changes
                    </button>
                </div>
            </div>
            <div class="planner-content" style="position:relative;">
                <div class="planner-sidebar">
                    <div class="sidebar-header">
                        <div style="display:flex; justify-content:space-between; align-items:center; position:relative; z-index:1; gap:40px;">
                            <div style="flex:1;">
                                <h3 style="margin:0; font-size:1.35rem; font-weight:800; display:flex; align-items:center; gap:12px; font-family:'Poppins';">
                                    AI Exploration
                                    <span id="rec-count-badge" class="badge-pulse" style="background:var(--success); color:white; padding:4px 14px; border-radius:50px; font-size:0.8rem; font-weight:700; border:1px solid rgba(255,255,255,0.2); display:none;">0</span>
                                </h3>
                                <p style="font-size:0.85rem; margin:6px 0 0 0; opacity:0.75; font-weight:500;">v2.2-PRO • Tailored gems for your trip</p>
                            </div>
                            <button onclick="planner.refreshRecommendations()" 
                                    style="background:rgba(255,255,255,1); color:var(--navy-900); border:none; border-radius:14px; width:44px; height:44px; cursor:pointer; transition:0.3s cubic-bezier(0.4, 0, 0.2, 1); display:flex; align-items:center; justify-content:center; box-shadow:0 8px 16px rgba(0,0,0,0.15); flex-shrink:0;"
                                    title="Refresh Recommendations"
                                    onmouseover="this.style.transform='rotate(45deg) scale(1.1)'"
                                    onmouseleave="this.style.transform='rotate(0) scale(1)'">
                                <i class="fas fa-sync-alt" id="refresh-icon" style="font-size:1rem;"></i>
                            </button>
                        </div>
                    </div>
                    <div class="sidebar-body" id="ai-recs-list">
                        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:5rem 2rem; color:var(--gray-400);">
                            <div style="width:70px; height:70px; background:rgba(87, 193, 211, 0.08); border-radius:24px; display:flex; align-items:center; justify-content:center; margin-bottom:1.5rem; transform: rotate(-5deg);">
                                <i class="fas fa-robot fa-spin" style="font-size:1.8rem; color:#0b3b5b;"></i>
                            </div>
                            <p style="text-align:center; font-weight:700; color:#0b3b5b; font-size:1rem; margin:0;">AI is Planning</p>
                            <p style="text-align:center; font-size:0.85rem; color:#64748b; margin-top:8px;">Finding unique spots for you...</p>
                        </div>
                    </div>
                </div>

                <div class="planner-main" id="planner-days">
                    ${this.renderDayColumns()}
                </div>

                 <div id="planner-map-container" style="width: 0; transition: width 0.3s ease; height: 100%; position: absolute; right: 0; top: 0; background: #e2e8f0; border-left: 1px solid rgba(0,0,0,0.1); z-index: 50; overflow: hidden;">
                    <div id="planner-map" style="width: 100%; height: 100%;"></div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        this.setupDragDrop();
    }

    renderDayColumns() {
        let cols = '';
        for (let i = 1; i <= this.days; i++) {
            const date = new Date(this.trip.start_date);
            date.setDate(date.getDate() + (i - 1));
            const dateStr = date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });

            cols += `
            <div class="day-column">
                <div class="day-header" style="padding: 1.25rem 1.5rem; background: var(--navy-900); border-radius: 20px 20px 0 0; position:relative;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <h4 style="margin:0; font-size:1.1rem; font-weight:800; font-family:'Poppins'; letter-spacing:-0.2px; color:white;">Day ${i}</h4>
                            <div style="color:rgba(255,255,255,0.6); font-size:0.75rem; font-weight:700; margin-top:2px;">${dateStr.toUpperCase()}</div>
                        </div>
                        <div id="day-cost-${i}" class="day-budget-badge" style="background:rgba(16, 185, 129, 0.15); color:#10b981; padding:6px 12px; border-radius:10px; font-size:0.85rem; font-weight:800; border:1px solid rgba(16, 185, 129, 0.2);">
                            ${this.app.getCurrencySymbol()}0
                        </div>
                    </div>
                </div>
                <div class="day-body drop-zone" data-day="${i}" ondragover="event.preventDefault(); this.classList.add('drag-over');" ondragleave="this.classList.remove('drag-over');" ondrop="planner.handleDrop(event, ${i})">
                </div>
            </div>`;
        }
        return cols;
    }

    async loadItinerary() {
        try {
            this.itinerary = await this._api(`/trips/${this.tripId}/itinerary`);
            // Seed usedRecommendationTitles from existing itinerary so AI never re-suggests them
            this.itinerary.forEach(item => {
                if (item.title) this.usedRecommendationTitles.add(item.title.toLowerCase());
            });
            this.renderItineraryItems();
            if (this.mapInitialized) this.updateMapMarkers();
        } catch (e) { console.error("Load Itinerary Failed", e); }
    }

    renderItineraryItems() {
        document.querySelectorAll('.day-body').forEach(d => {
            d.innerHTML = '';
            const dayNum = d.dataset.day;
            const costBadge = document.getElementById(`day-cost-${dayNum}`);
            if (costBadge) costBadge.textContent = this.app.getCurrencySymbol() + '0';
        });

        // Pro-Level: Sort by time for each day
        const sortedItinerary = [...this.itinerary].sort((a, b) => {
            const timeA = a.start_time || '09:00';
            const timeB = b.start_time || '09:00';
            return timeA.localeCompare(timeB);
        });

        const dayTotals = {};

        sortedItinerary.forEach((item, idx) => {
            const dayContainer = document.querySelector(`.day-body[data-day="${item.day_number}"]`);
            if (dayContainer) {
                dayContainer.innerHTML += this.createItemHTML(item, idx);

                // Track total cost per day
                const cost = parseFloat(item.cost) || 0;
                dayTotals[item.day_number] = (dayTotals[item.day_number] || 0) + cost;
            }
        });

        // Update day budget badges
        Object.keys(dayTotals).forEach(day => {
            const badge = document.getElementById(`day-cost-${day}`);
            if (badge) badge.textContent = this.app.formatCurrency(dayTotals[day]);
        });
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        lat1 = parseFloat(lat1); lon1 = parseFloat(lon1);
        lat2 = parseFloat(lat2); lon2 = parseFloat(lon2);
        if (isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) return null;
        const R = 6371; // km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return (R * c).toFixed(1);
    }

    _getDistanceBadgeHTML(lat, lng, title = '', desc = '') {
        // 1. Priority: GPS Distance (if coordinates exist)
        if (this.userLocation && lat != null && lng != null) {
            const dist = this.calculateDistance(this.userLocation.lat, this.userLocation.lng, lat, lng);
            if (dist && dist !== "NaN" && dist !== "0.0") {
                return `<div class="distance-badge"><i class="fas fa-location-arrow"></i> ${dist} km away</div>`;
            }
        }

        // 2. Logic Step: Find City via AI Smart Tip logic (Extraction)
        if (!lat || !lng) {
            const knownCities = ["Delhi", "Mumbai", "Bangalore", "Goa", "Kerala", "Jaipur", "Chennai", "Hyderabad", "Pune", "Paris", "London", "Tokyo", "Rome", "New York", "Dubai", "Manali", "Leh", "Shimla", "Agra", "Udaipur"];
            const combinedText = (title + ' ' + desc).toLowerCase();
            const cityMatch = knownCities.find(city => combinedText.includes(city.toLowerCase()));

            if (cityMatch) {
                return `<div class="distance-badge" style="background:rgba(8, 145, 178, 0.05); color:#0891b2; border:1px solid rgba(8, 145, 178, 0.1);"><i class="fas fa-map-marker-alt"></i> ${cityMatch}</div>`;
            }
        }

        // 3. Locating Pulse
        if (this.userLocation === null) {
            return `<div class="distance-badge" style="opacity:0.6; background:transparent; border-style:dashed;"><i class="fas fa-spinner fa-spin"></i> Locating...</div>`;
        }
        return '';
    }

    _getTypeIcon(type = '') {
        const t = type.toLowerCase();
        if (t === 'food' || t === 'dining') return 'utensils';
        if (t === 'activity' || t === 'trek' || t === 'hiking') return 'hiking';
        if (t === 'shopping') return 'shopping-bag';
        if (t === 'flight') return 'plane';
        if (t === 'hotel' || t === 'accommodation') return 'hotel';
        return 'map-marker-alt';
    }

    createItemHTML(item, idx) {
        const typeIcon = item.type === 'food' ? 'utensils' : (item.type === 'flight' ? 'plane' : 'map-marker-alt');
        const bgColor = item.type === 'food' ? 'rgba(239, 68, 68, 0.08)' : (item.type === 'flight' ? 'rgba(59, 130, 246, 0.08)' : 'rgba(87, 193, 211, 0.08)');
        const iconColor = item.type === 'food' ? '#ef4444' : (item.type === 'flight' ? '#3b82f6' : '#57c1d3');
        const startTime = item.start_time ? item.start_time.substring(0, 5) : '09:00';

        let distanceHtml = this._getDistanceBadgeHTML(item.latitude || item.lat, item.longitude || item.lng, item.title, item.description);

        const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.title + ' ' + (item.location || this.trip.destination))}`;

        return `
        <div class="itinerary-card" draggable="true" ondragstart="planner.handleDragStart(event, ${idx}, 'itinerary')"
             style="border-left: 4px solid ${iconColor};" id="item-${item.id}">
            <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:0.75rem;">
                <div style="display:flex; gap:12px; flex:1;">
                    <div style="width:40px; height:40px; background:${bgColor}; color:${iconColor}; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:1.1rem; flex-shrink:0;">
                        <i class="fas fa-${typeIcon}"></i>
                    </div>
                    <div>
                        <h5 style="margin:0; font-size:1.05rem; color:var(--navy-900); font-weight:800; font-family:'Poppins'; line-height:1.2;">${item.title}</h5>
                        <div style="display:flex; align-items:center; gap:8px; margin-top:4px; flex-wrap:wrap;">
                            <p style="margin:0; font-size:0.75rem; color:var(--gray-400); font-weight:700;"><i class="far fa-clock"></i> ${startTime}</p>
                            ${distanceHtml}
                        </div>
                    </div>
                </div>
                <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:6px; flex-shrink:0; padding:6px; background:var(--gray-50); border-radius:12px; align-self: center;">
                    <a href="${mapUrl}" target="_blank" class="btn-action-small" title="View Map" style="text-decoration:none;">
                        <i class="fas fa-map-marked-alt"></i>
                    </a>
                    <button class="btn-action-small" onclick="planner.editTime('${item.id}', '${startTime}')" title="Edit Time">
                        <i class="fas fa-clock"></i>
                    </button>
                    <button class="btn-action-small" onclick="planner.updateItemDesc('${item.id}', '${(item.description || '').replace(/"/g, '&quot;')}')" title="Edit Note">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="btn-action-small" onclick="planner.deleteItem('${item.id}')" title="Remove"><i class="fas fa-trash"></i></button>
                </div>
            </div>
            
            <p style="margin:0.5rem 0; font-size:0.85rem; color:var(--gray-600); line-height:1.6; font-weight:500;">${item.description || 'Exploring the local vibes and architectural marvels of ' + this.trip.destination}</p>
            
            <div style="margin-top:0.75rem; display:flex; justify-content:space-between; align-items:center; background:rgba(0,0,0,0.02); padding:8px 12px; border-radius:12px; border:1px solid rgba(0,0,0,0.03);">
                <span style="font-size:0.7rem; color:var(--gray-400); font-weight:800; letter-spacing:0.5px;">EXPENDITURE</span>
                <span style="font-size:0.9rem; color:${parseFloat(item.cost) > 0 ? 'var(--success)' : '#64748b'}; font-weight:800;">
                    ${parseFloat(item.cost) > 0 ? this.app.formatCurrency(item.cost) : '<i class="fas fa-leaf" style="font-size:0.7rem;"></i> FREE ENTRY'}
                </span>
            </div>
        </div>`;
    }

    async editTime(itemId, currentTime) {
        const newTime = await this.app.showPrompt("Edit Time", "Enter new time (HH:MM format):", currentTime, "🕐");
        if (!newTime || newTime === currentTime) return;

        if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(newTime)) {
            this.app.showAlert("Invalid Format", "Please use HH:MM format (e.g., 09:30)", "error");
            return;
        }

        try {
            await this._api(`/trips/${this.tripId}/itinerary/${itemId}`, 'PUT', { start_time: newTime });
            this.loadItinerary();
            this.app.showAlert("Success", "Time updated successfully!", "success");
        } catch (e) { console.error(e); this.app.showAlert("Error", "Failed to update time", "error"); }
    }

    async _fetchAIRecs(count = 20) {
        return await this._api('/ai/itinerary', 'POST', {
            destination: this.trip.destination,
            days: this.days,
            travelers: 'Default',
            style: 'Balanced',
            count: count
        });
    }

    async recommendAI() {
        const cont = document.getElementById('ai-recs-list');
        if (!cont) return;

        // Pro-Level: Render Shimmering Skeletons
        cont.innerHTML = Array(4).fill(0).map(() => `
            <div style="background:white; border-radius:18px; margin-bottom:1.5rem; height:200px; padding:1.5rem; border:1px solid rgba(0,0,0,0.05); overflow:hidden; position:relative;">
                <div style="display:flex; gap:14px; margin-bottom:1rem;">
                    <div style="width:48px; height:48px; border-radius:15px; background:#f1f5f9; animation: pulse 1.5s infinite;"></div>
                    <div style="flex:1;">
                        <div style="width:60%; height:14px; background:#f1f5f9; border-radius:4px; margin-bottom:8px; animation: pulse 1.5s infinite;"></div>
                        <div style="width:40%; height:10px; background:#f1f5f9; border-radius:4px; animation: pulse 1.5s infinite;"></div>
                    </div>
                </div>
                <div style="width:100%; height:12px; background:#f1f5f9; border-radius:4px; margin-bottom:8px; animation: pulse 1.5s infinite;"></div>
                <div style="width:90%; height:12px; background:#f1f5f9; border-radius:4px; margin-bottom:1.5rem; animation: pulse 1.5s infinite;"></div>
                <div style="display:flex; gap:10px;">
                    <div style="flex:1; height:35px; background:#f1f5f9; border-radius:10px; animation: pulse 1.5s infinite;"></div>
                    <div style="flex:1; height:35px; background:#f1f5f9; border-radius:10px; animation: pulse 1.5s infinite;"></div>
                </div>
                <style>
                    @keyframes pulse { 0% { opacity:0.6; } 50% { opacity:1; } 100% { opacity:0.6; } }
                </style>
            </div>
        `).join('');

        try {
            const data = await this._fetchAIRecs(15);
            const allRecs = data.recommendations || [];
            // Filter out places already in the itinerary
            this.recommendations = allRecs.filter(rec =>
                !this.usedRecommendationTitles.has(rec.title.toLowerCase())
            );
            this.renderAIRecommendations();
            cont.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (e) {
            this.showRecommendationError(e.message);
        }
    }

    showRecommendationError(status) {
        const cont = document.getElementById('ai-recs-list');
        if (!cont) return;
        cont.innerHTML = `
            <div class="error-card" style="padding: 3.5rem 2rem; border-color:rgba(59, 130, 246, 0.1); background:rgba(59, 130, 246, 0.05);">
                <div style="width:70px; height:70px; background:rgba(59, 130, 246, 0.1); color:var(--blue-600); border-radius:24px; display:flex; align-items:center; justify-content:center; margin-bottom:2rem; font-size:1.8rem; box-shadow: 0 10px 20px rgba(59, 130, 246, 0.1); transform: rotate(15deg);">
                    <i class="fas fa-cloud-moon"></i>
                </div>
                <h3 style="margin:0 0 1rem 0; font-family:'Poppins'; font-weight:800; color:var(--navy-900); font-size:1.4rem;">AI is Resting</h3>
                <p style="font-size:0.9rem; color:var(--gray-500); margin-bottom:2.5rem; line-height:1.7; max-width: 280px; font-weight: 500;">
                    ${status === '503' ? 'AI models are currently over capacity.' : ('Server: ' + status)}. 
                    We're gather the best secrets for ${this.trip.destination}.
                </p>
                <button onclick="planner.recommendAI()" class="btn-premium">
                    <i class="fas fa-magic"></i> Wake Up AI
                </button>
            </div>
        `;
    }

    async refreshRecommendations() {
        const icon = document.getElementById('refresh-icon');
        if (icon) icon.classList.add('fa-spin');
        this.app.showAlert('Refreshing', 'Fetching new AI suggestions...', 'info');

        this.recommendations = [];
        this.renderAIRecommendations();
        await this.fetchMoreRecommendations(25);
        if (icon) icon.classList.remove('fa-spin');
    }

    setupDragDrop() { }

    handleDragStart(e, id, source) {
        e.dataTransfer.setData('source', source);
        e.dataTransfer.setData('id', id);
    }

    async handleDrop(e, day) {
        e.preventDefault();
        const dropZone = e.target.closest('.day-body');
        if (dropZone) dropZone.classList.remove('drag-over');

        const source = e.dataTransfer.getData('source');
        const id = parseInt(e.dataTransfer.getData('id'));

        if (source === 'ai') {
            const rec = this.recommendations[id];
            if (!rec) return;

            // Parse cost_estimate into a numeric value for budget tracking
            const parsedCost = this._parseCostEstimate(rec.cost_estimate);

            this.app.showAlert('Adding Spot', `Syncing ${rec.title} with your schedule...`, 'info');

            await this.addItemToDB({
                trip_id: this.tripId,
                day_number: day,
                type: rec.type,
                title: rec.title,
                description: rec.description,
                start_time: '09:00',
                cost: parsedCost,
                latitude: parseFloat(rec.lat) || null,
                longitude: parseFloat(rec.lng) || null
            });

            this.usedRecommendationTitles.add(rec.title.toLowerCase());
            this.recommendations.splice(id, 1);
            this.renderAIRecommendations();

            // Reload itinerary to reflect new cost in day budget badge
            await this.loadItinerary();

            // Auto-sort this day
            await this.autoAdjustDayTimes(day);

            // Refill recommendations silently
            if (this.recommendations.length < 5) {
                this.fetchMoreRecommendations(3);
            }
        } else if (source === 'itinerary') {
            const item = this.itinerary[id];
            if (!item) return;
            await this.updateItemDay(item.id, day);
            await this.autoAdjustDayTimes(day);
        }
    }

    renderAIRecommendations() {
        const cont = document.getElementById('ai-recs-list');
        const badge = document.getElementById('rec-count-badge');
        if (badge) {
            badge.textContent = this.recommendations.length;
            badge.style.display = 'inline-block'; // Keep it visible for "0"
        }
        if (!cont) return;

        if (this.recommendations.length === 0) {
            cont.innerHTML = `
                <div style="text-align:center; padding:4rem 1.5rem; color:var(--gray-400);">
                    <div style="width:80px; height:80px; background:white; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 2rem; box-shadow:0 15px 35px rgba(0,0,0,0.05);">
                        <span style="font-size:2.5rem;">✨</span>
                    </div>
                    <h3 style="margin:0 0 0.75rem 0; color:var(--navy-900); font-family:'Poppins'; font-weight:800;">Explore ${this.trip.destination}</h3>
                    <p style="margin:0 0 2rem 0; font-size:0.9rem; line-height:1.6; color:var(--gray-500); font-weight:500;">Let our AI craft a world-class journey with hidden gems and local favorites just for you.</p>
                    <button onclick="planner.recommendAI()" class="btn-premium" style="margin:0 auto;">
                        <i class="fas fa-magic"></i> Craft Itinerary
                    </button>
                </div>
            `;
            return;
        }

        cont.innerHTML = this.recommendations.map((rec, idx) => {
            let distanceHtml = this._getDistanceBadgeHTML(rec.lat, rec.lng, rec.title, rec.description);

            const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(rec.title + ' ' + (rec.location || this.trip.destination))}`;
            const wikiUrl = `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(rec.title)}`;
            const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(rec.title + ' ' + (rec.location || this.trip.destination))}`;
            const costDisplay = rec.cost_estimate || 'Free Entry';

            return `
            <div class="recommendation-item" draggable="true" ondragstart="planner.handleDragStart(event, ${idx}, 'ai')" 
                 style="position:relative; background:#ffffff; border-radius:18px; margin-bottom:1.5rem; border:1px solid rgba(87, 193, 211, 0.15); box-shadow:0 12px 30px rgba(0,0,0,0.04); transition:0.3s cubic-bezier(0.4, 0, 0.2, 1); cursor:grab; overflow:hidden; width:100%; box-sizing:border-box;">
                
                <div style="padding:1.5rem;">
                    <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:1rem;">
                        <div style="display:flex; align-items:center; gap:14px; flex:1;">
                            <div style="width:48px; height:48px; background:linear-gradient(135deg, #57c1d3, #0b3b5b); color:white; border-radius:15px; display:flex; align-items:center; justify-content:center; font-size:1.2rem; flex-shrink:0; box-shadow:0 8px 15px rgba(87, 193, 211, 0.25);">
                                <i class="fas fa-${this._getTypeIcon(rec.type)}"></i>
                            </div>
                            <div style="flex:1;">
                                <h4 style="margin:0; font-size:1.15rem; color:#0b3b5b; font-weight:800; line-height:1.2; font-family:'Poppins';">${rec.title}</h4>
                                <p style="margin:4px 0 0 0; font-size:0.8rem; color:#57c1d3; font-weight:700;"><i class="fas fa-location-arrow"></i> ${rec.location || this.trip.destination}</p>
                                ${distanceHtml}
                            </div>
                        </div>
                    </div>
                    
                    <p style="margin:0 0 1.25rem 0; font-size:0.88rem; color:#475569; line-height:1.6; font-weight:500;">${rec.description}</p>
                    
                    <!-- Links row -->
                    <div style="display:flex; gap:0.65rem; margin-bottom:1rem;">
                        <a href="${mapUrl}" target="_blank" onclick="event.stopPropagation()" title="Directions" 
                           style="flex:1; background:#f8fafc; color:#0b3b5b; text-decoration:none; padding:10px; border-radius:12px; font-size:0.8rem; text-align:center; border:1px solid rgba(0,0,0,0.05); font-weight:700; transition:0.2s;">
                            <i class="fas fa-directions"></i> Maps
                        </a>
                        <a href="${wikiUrl}" target="_blank" onclick="event.stopPropagation()" title="Wikipedia"
                           style="flex:1; background:#f8fafc; color:#0b3b5b; text-decoration:none; padding:10px; border-radius:12px; font-size:0.8rem; text-align:center; border:1px solid rgba(0,0,0,0.05); font-weight:700; transition:0.2s;">
                            <i class="fab fa-wikipedia-w"></i> Wiki
                        </a>
                        <a href="${googleUrl}" target="_blank" onclick="event.stopPropagation()" title="Search"
                           style="flex:1; background:#f8fafc; color:#0b3b5b; text-decoration:none; padding:10px; border-radius:12px; font-size:0.8rem; text-align:center; border:1px solid rgba(0,0,0,0.05); font-weight:700; transition:0.2s;">
                            <i class="fab fa-google"></i> Search
                        </a>
                    </div>

                    <!-- Budget + Add row -->
                    <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(87, 193, 211, 0.04); padding:10px 14px; border-radius:14px; border:1px solid rgba(87, 193, 211, 0.08); gap:10px;">
                        <div>
                            <div style="font-size:0.65rem; color:#94a3b8; font-weight:700; letter-spacing:0.5px; margin-bottom:2px;">EST. COST</div>
                            <span style="color:#10b981; font-weight:800; font-size:0.95rem;">${costDisplay}</span>
                        </div>
                        <button onclick="event.stopPropagation(); planner.addRecommendationToDay(${idx})" 
                                style="background:var(--navy-900); color:white; border:none; padding:8px 16px; border-radius:10px; font-size:0.8rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:6px; transition:0.2s; white-space:nowrap;"
                                onmouseover="this.style.background='#154e75'" onmouseleave="this.style.background='var(--navy-900)'">
                            <i class="fas fa-plus"></i> Add to Day 1
                        </button>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    async fetchMoreRecommendations(count = 5) {
        try {
            const data = await this._fetchAIRecs(count);
            const newRecs = data.recommendations || [];
            const existingTitles = this.recommendations.map(r => r.title.toLowerCase());
            const uniqueNewRecs = newRecs.filter(rec => {
                const titleLower = rec.title.toLowerCase();
                // Filter out: already shown, already added to itinerary
                return !existingTitles.includes(titleLower) && !this.usedRecommendationTitles.has(titleLower);
            });
            this.recommendations.push(...uniqueNewRecs.slice(0, count));
            this.renderAIRecommendations();
        } catch (e) { console.error(e); }
    }

    // Parse cost_estimate string (e.g. "₹500", "Free Entry", "$20-$50") into a number
    _parseCostEstimate(costStr) {
        if (!costStr) return 0;
        const lower = costStr.toLowerCase();
        if (lower.includes('free') || lower === 'free entry') return 0;
        // Extract first number found (handles "₹500", "$20-$50", "500 INR", etc.)
        const match = costStr.match(/[\d,]+/);
        if (match) return parseFloat(match[0].replace(/,/g, '')) || 0;
        return 0;
    }

    // Add a recommendation to Day 1 (or current day) via the Add button
    async addRecommendationToDay(idx, day = 1) {
        const rec = this.recommendations[idx];
        if (!rec) return;
        const parsedCost = this._parseCostEstimate(rec.cost_estimate);

        this.app.showAlert('Adding Spot', `Adding ${rec.title} to Day ${day}...`, 'info');

        await this.addItemToDB({
            trip_id: this.tripId,
            day_number: day,
            type: rec.type,
            title: rec.title,
            description: rec.description,
            start_time: '09:00',
            cost: parsedCost,
            latitude: parseFloat(rec.lat) || null,
            longitude: parseFloat(rec.lng) || null
        });

        this.usedRecommendationTitles.add(rec.title.toLowerCase());
        this.recommendations.splice(idx, 1);
        this.renderAIRecommendations();
        await this.loadItinerary();
        await this.autoAdjustDayTimes(day);

        if (this.recommendations.length < 5) {
            this.fetchMoreRecommendations(3);
        }
    }

    async autoAdjustDayTimes(dayNumber) {
        const dayItems = this.itinerary.filter(item => item.day_number === dayNumber);
        if (dayItems.length === 0) return;

        dayItems.sort((a, b) => (a.start_time || '09:00').localeCompare(b.start_time || '09:00'));

        try {
            const data = await this._api('/ai/optimize-schedule', 'POST', {
                activities: dayItems.map(item => ({ id: item.id, title: item.title, type: item.type }))
            });
            const optimizedTimes = data.schedule || [];
            for (const timeSlot of optimizedTimes) {
                await this._api(`/trips/${this.tripId}/itinerary/${timeSlot.id}`, 'PUT', { start_time: timeSlot.time });
            }
            await this.loadItinerary();
            this.app.showAlert('Success', `Times auto-adjusted for Day ${dayNumber}!`, 'success');
        } catch (e) {
            console.warn("AI Optimization Offline, using fallback scheduling.");
            let currentTime = 9 * 60;
            for (const item of dayItems) {
                const title = (item.title || '').toLowerCase();
                const type = (item.type || '').toLowerCase();

                if (title.includes('sunrise') || title.includes('early morning')) currentTime = 6 * 60;
                else if (title.includes('breakfast')) currentTime = 8 * 60 + 30;
                else if (title.includes('lunch')) currentTime = 13 * 60;
                else if (title.includes('sunset') || title.includes('evening walk')) currentTime = 17 * 60 + 45;
                else if (title.includes('dinner')) currentTime = 20 * 60;
                else if (title.includes('nightlife') || title.includes('party')) currentTime = 22 * 60;
                else if (type === 'hotel' || title.includes('check-in')) currentTime = 15 * 60;

                const hours = Math.floor(currentTime / 60);
                const minutes = currentTime % 60;
                const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

                await this._api(`/trips/${this.tripId}/itinerary/${item.id}`, 'PUT', { start_time: timeStr });

                if (title.includes('dinner') || title.includes('nightlife')) currentTime += 0;
                else if (title.includes('breakfast')) currentTime += 90;
                else if (title.includes('lunch')) currentTime += 120;
                else if (type === 'food') currentTime += 60;
                else currentTime += 120;
            }
            await this.loadItinerary();
        }
    }

    async magicallyAutoPlan() {
        const confirm = await this.app.showConfirm(
            "Magic Auto-Plan",
            "This will create a world-class, day-wise itinerary with hidden gems, geolocated routes, and logical transitions. Any existing items will be replaced. Proceed?",
            "✨ Generate Plan",
            "cancel"
        );
        if (!confirm) return;

        this.app.showAlert("AI is Planning", "Crafting your premium itinerary with geographic clustering and logical flow...", "info");

        // Show full screen loader if possible, or just a toast
        const plannerDays = document.getElementById('planner-days');
        if (plannerDays) {
            plannerDays.style.opacity = '0.5';
            plannerDays.style.pointerEvents = 'none';
        }

        try {
            const data = await this._api('/ai/full-plan', 'POST', {
                destination: this.trip.destination,
                starting_point: this.trip.starting_point,
                days: this.days,
                travelers: this.trip.travelers || 'Default',
                style: this.trip.travel_style || 'Balanced'
            });

            if (!data || !data.days) throw new Error("AI returned an invalid plan format.");

            // 1. CLEAR existing itinerary in DB for this trip
            await this._api(`/trips/${this.tripId}/itinerary`, 'DELETE');

            // 2. ADD new items from AI
            for (const day of data.days) {
                if (!day.activities || !Array.isArray(day.activities)) continue;
                for (const act of day.activities) {
                    await this.addItemToDB({
                        trip_id: this.tripId,
                        day_number: day.day,
                        type: act.type,
                        title: act.title,
                        description: act.description,
                        start_time: act.time || '09:00',
                        cost: act.cost || 0,
                        latitude: parseFloat(act.lat) || null,
                        longitude: parseFloat(act.lng) || null
                    });
                }
            }

            // 3. REFRESH UI
            await this.loadItinerary();
            this.app.showAlert("Success!", `Generated a ${this.days}-day elite plan for ${this.trip.destination}!`, "success");

        } catch (e) {
            console.error("Magic Auto Plan Failed:", e);
            this.app.showAlert("AI Error", e.message || "Failed to generate plan. Please try again.", "error");
        } finally {
            if (plannerDays) {
                plannerDays.style.opacity = '1';
                plannerDays.style.pointerEvents = 'all';
            }
        }
    }

    // --- Interactive Map Logic ---

    toggleMap() {
        const mapContainer = document.getElementById('planner-map-container');
        const btnText = document.getElementById('map-toggle-text');

        if (!mapContainer) return;

        if (mapContainer.style.width === '0px' || mapContainer.style.width === '0') {
            mapContainer.style.width = '40%';
            btnText.textContent = 'Hide Map';
            if (this.map) {
                setTimeout(() => {
                    this.map.invalidateSize();
                    this.updateMapMarkers();
                }, 350);
            }
        } else {
            mapContainer.style.width = '0';
            btnText.textContent = 'Show Map';
        }
    }

    initMap() {
        if (this.mapInitialized) return;

        const mapEl = document.getElementById('planner-map');
        if (!mapEl || !window.L) return;

        // Default to trip destination logic later, for now generic view
        this.map = L.map('planner-map').setView([20.5937, 78.9629], 5); // India

        // Google Maps-like Street View (Esri World Street Map)
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri &mdash; <a href="https://www.esri.com/">Esri</a>',
            maxZoom: 19
        }).addTo(this.map);

        this.mapInitialized = true;
        this.updateMapMarkers();
    }

    updateMapMarkers() {
        if (!this.map || !this.mapInitialized) return;

        // Clear existing markers
        this.markers.forEach(m => this.map.removeLayer(m));
        this.markers = [];
        if (this.routeLine) {
            this.map.removeLayer(this.routeLine);
            this.routeLine = null;
        }

        const points = [];

        // Loop through itinerary and plot
        this.itinerary.forEach((item, index) => {
            if (item.latitude && item.longitude) {
                const lat = parseFloat(item.latitude);
                const lng = parseFloat(item.longitude);
                if (isNaN(lat) || isNaN(lng)) return;

                const marker = L.marker([lat, lng])
                    .addTo(this.map)
                    .bindPopup(`<b>${item.title}</b><br>Day ${item.day_number} • ${item.start_time || ''}`);

                this.markers.push(marker);
                points.push([lat, lng]);
            }
        });

        // Draw Route
        if (points.length > 1) {
            this.routeLine = L.polyline(points, {
                color: '#4285F4', // Google Blue
                weight: 3,
                opacity: 0.7,
                dashArray: '10, 10',
                lineCap: 'round'
            }).addTo(this.map);
        }

        // Fit Bounds
        if (points.length > 0) {
            const group = new L.featureGroup(this.markers);
            this.map.fitBounds(group.getBounds().pad(0.2));
        } else {
            // Fallback: try to geocode destination simply (or just zoom out)
            // For now, we rely on items having extracted coords from AI
        }
    }


    async addItemToDB(itemData) {
        try {
            await this._api(`/trips/${this.tripId}/itinerary`, 'POST', itemData);
            this.loadItinerary();
        } catch (e) { console.error(e); }
    }

    async updateItemDay(itemId, newDay) {
        try {
            await this._api(`/trips/${this.tripId}/itinerary/${itemId}`, 'PUT', { day_number: newDay });
            this.loadItinerary();
        } catch (e) { console.error(e); }
    }

    async updateItemDesc(itemId, currentDesc) {
        const newDesc = await this.app.showPrompt("Update Notes", "Enter your notes:", currentDesc || '', "✎");
        if (newDesc === null) return;
        try {
            await this._api(`/trips/${this.tripId}/itinerary/${itemId}`, 'PUT', { description: newDesc });
            this.loadItinerary();
            this.app.showAlert("Success", "Notes updated successfully!", "success");
        } catch (e) { console.error(e); }
    }

    async deleteItem(id) {
        const confirmed = await this.app.showConfirm('Remove Item', 'Are you sure you want to remove this item?', 'Remove', 'Cancel');
        if (!confirmed) return;
        try {
            await this._api(`/trips/${this.tripId}/itinerary/${id}`, 'DELETE');
            this.loadItinerary();
        } catch (e) { console.error(e); }
    }

    async saveAll() {
        const btn = document.querySelector('.btn-header-action');
        if (btn) {
            const originalContent = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Finalizing...';
            btn.style.opacity = '0.8';
            btn.disabled = true;

            // Artificial delay for tactile feedback
            await new Promise(r => setTimeout(r, 800));

            btn.innerHTML = '<i class="fas fa-check"></i> Saved!';
            btn.style.background = 'var(--success)';
            btn.style.color = 'white';

            this.app.showAlert('Saved', 'Your itinerary has been fully synchronized!', 'success');

            setTimeout(() => {
                btn.innerHTML = originalContent;
                btn.style.background = 'var(--navy-900)';
                btn.style.opacity = '1';
                btn.disabled = false;
            }, 2000);
        }
    }
}

// Global hook
window.openTripPlanner = async (tripId) => {
    const trip = window.app.allTrips?.find(t => t.id == tripId);
    if (trip) {
        await window.app.detectAndSetTripCurrency(trip.destination);
    }
    window.planner = new TripPlanner(window.app, tripId);
    window.planner.init();
};
