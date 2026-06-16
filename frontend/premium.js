// Premium Trip Management Extensions

IntelliTripApp.prototype.showToast = function (message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const bgColor = type === 'success' ? '#10b981' : (type === 'error' ? '#ef4444' : '#3b82f6');
    toast.style.cssText = `
        background:${bgColor}; color:white; padding:12px 24px; border-radius:12px; 
        box-shadow:0 10px 15px -3px rgba(0,0,0,0.1); display:flex; align-items:center; gap:12px;
        font-weight:600; min-width:250px; animation: toastSlideIn 0.3s ease-out;
        border: 1px solid rgba(255,255,255,0.1); z-index:99999999;
    `;

    const icon = type === 'success' ? 'fa-check-circle' : (type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle');
    toast.innerHTML = `<i class="fas ${icon}"></i> <span>${message}</span>`;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastSlideOut 0.3s ease-in forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

// --- New AI Audit Features ---

IntelliTripApp.prototype.auditTrip = async function (tripId) {
    try {
        // Find existing trip data
        const trip = this.allTrips ? this.allTrips.find(t => t.id === tripId) : null;
        if (!trip) {
            this.showToast('Trip data not found', 'error');
            return;
        }

        // Fetch expenses for calculation
        let expenses = [];

        // Use cached expenses if available, otherwise fetch
        if (this.allExpenses && this.allExpenses.length > 0) {
            expenses = this.allExpenses;
        } else {
            try {
                const token = localStorage.getItem('token');
                // Fetch all expenses since backend might not support query param or returns array
                const res = await fetch(`http://localhost:5000/api/expenses`, {
                    headers: { 'Authorization': token }
                });
                if (res.ok) {
                    expenses = await res.json();
                }
            } catch (e) {
                console.warn("Could not fetch expenses for audit", e);
            }
        }

        // Filter expenses for THIS trip (Backend returns all or array)
        // Ensure accurate filtering regardless of API structure
        const tripExpenses = Array.isArray(expenses)
            ? expenses.filter(e => e.trip_id === tripId || e.trip_id === trip.id)
            : [];

        // Calculate Stats
        const totalSpent = tripExpenses.reduce((sum, exp) => sum + parseFloat(exp.amount), 0);
        const budget = parseFloat(trip.budget);
        const daysTotal = Math.ceil((new Date(trip.end_date) - new Date(trip.start_date)) / (1000 * 60 * 60 * 24)) + 1;

        // --- DEEP INTELLIGENCE UPGRADE: Call Backend AI Audit ---
        let aiAuditData = null;
        try {
            const token = localStorage.getItem('token');
            const auditRes = await fetch(`/api/ai/audit?destination=${encodeURIComponent(trip.destination)}&totalSpent=${totalSpent}&duration=${daysTotal}&style=balanced`, {
                headers: { 'Authorization': token }
            });
            if (auditRes.ok) aiAuditData = await auditRes.json();
        } catch (e) { console.warn("AI Audit fetch failed, using local logic fallback"); }

        const percentUsed = budget > 0 ? (totalSpent / budget) * 100 : 0;

        // Use AI status if available, fallback to local
        const status = aiAuditData?.budget_audit?.status || (percentUsed > 90 ? 'Critical' : (percentUsed > 75 ? 'Warning' : 'On Track'));
        const analysis = aiAuditData?.budget_audit?.analysis || `You have used ${percentUsed.toFixed(1)}% of your budget.`;
        const savingTip = aiAuditData?.budget_audit?.top_saving_tip || "Consider street food to save on dining costs.";

        let statusClass = 'status-on-track';
        let statusIcon = 'fa-check-circle';
        if (status === 'Critical') { statusClass = 'status-critical'; statusIcon = 'fa-exclamation-triangle'; }
        else if (status === 'Warning') { statusClass = 'status-warning'; statusIcon = 'fa-exclamation-circle'; }

        // Render AI-generated 'Perfect Places' if available
        let perfectPlacesHtml = '';
        if (aiAuditData?.perfect_places?.length > 0) {
            perfectPlacesHtml = `
                <div style="margin-top:1.5rem;">
                    <h5 style="color:#0b3b5b; margin-bottom:0.75rem;"><i class="fas fa-magic" style="color:#2a8faa;"></i> AI-Curated For You</h5>
                    <div style="display:flex; flex-direction:column; gap:0.75rem;">
                        ${aiAuditData.perfect_places.slice(0, 2).map(p => `
                            <div style="background:#f8fafc; padding:0.85rem; border-radius:12px; border:1px solid #e2e8f0;">
                                <div style="font-weight:700; color:#1e293b; font-size:0.85rem; margin-bottom:2px;">${p.name}</div>
                                <div style="font-size:0.75rem; color:#64748b;">${p.description}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // Destination Image
        const tripImg = await this.getDestinationImage(trip.destination);

        // Build Modal HTML
        let modal = document.getElementById('premiumAuditModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'premiumAuditModal';
            modal.className = 'modal-premium';
            modal.style.alignItems = 'flex-start';
            modal.style.overflowY = 'auto';
            document.body.appendChild(modal);
        }

        modal.innerHTML = `
            <div class="modal-card" style="max-width: 650px; width: 95%; margin: 2rem auto; text-align: left; padding:0; overflow:hidden;">
                <div style="background: linear-gradient(135deg, #0B3B5B 0%, #2A8FAA 100%); padding: 1.5rem; color:white;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <h2 style="margin:0; font-size:1.25rem; font-weight:800;"><i class="fas fa-robot"></i> Advanced Trip Audit</h2>
                        <button onclick="app.closeAuditModal()" style="background:rgba(255,255,255,0.2); border:none; color:white; width:30px; height:30px; border-radius:50%; cursor:pointer;"><i class="fas fa-times"></i></button>
                    </div>
                    <p style="margin:0.5rem 0 0 0; opacity:0.8; font-size:0.85rem;">Intelligent analysis of your ${trip.destination} journey</p>
                </div>

                <div style="padding: 1.5rem;">
                    <div class="audit-status-banner ${statusClass}" style="margin-bottom:1.5rem;">
                        <i class="fas ${statusIcon}"></i>
                        <span>${status.toUpperCase()} – ${this.formatCurrency(totalSpent)} SPENT</span>
                    </div>

                    <div class="audit-grid" style="display:grid; grid-template-columns: 1fr 1fr; gap:1.5rem;">
                        <div class="left-col">
                            <div class="audit-analysis-card" style="background:#f8fafc; padding:1.25rem; border-radius:16px; border:1px solid #e2e8f0;">
                                <h5 style="color:#0b3b5b; margin-bottom:0.75rem; font-size:0.9rem;">Intelligence Report</h5>
                                <p style="font-size:0.85rem; line-height:1.5; color:#334155;">${analysis}</p>
                                
                                <div style="margin-top:1.25rem;">
                                    <div style="display:flex; justify-content:space-between; font-size:0.75rem; margin-bottom:0.4rem; font-weight:700; color:#64748b; text-transform:uppercase;">
                                        <span>Budget Health</span>
                                        <span>${Math.round(percentUsed)}%</span>
                                    </div>
                                    <div style="height:10px; background:#e2e8f0; border-radius:5px; overflow:hidden;">
                                        <div style="width:${Math.min(percentUsed, 100)}%; height:100%; background:${statusClass === 'status-critical' ? '#ef4444' : (statusClass === 'status-warning' ? '#f59e0b' : '#10b981')}; transition:width 1s ease;"></div>
                                    </div>
                                </div>
                            </div>
                            ${perfectPlacesHtml}
                        </div>

                        <div class="right-col">
                             <div class="saving-tip-box" style="background:#fff7ed; border-left:4px solid #f97316; padding:1rem; border-radius:0 12px 12px 0;">
                                <h5 style="color:#9a3412; margin:0 0 0.4rem 0; font-size:0.85rem; font-weight:800;"><i class="fas fa-lightbulb"></i> MASTER SAVING TIP</h5>
                                <p style="margin:0; font-size:0.8rem; color:#7c2d12; line-height:1.4;">${savingTip}</p>
                             </div>
                             
                             <div style="margin-top:1.25rem; background:#f1f5f9; padding:1.25rem; border-radius:16px;">
                                <h5 style="color:#0f172a; margin-bottom:0.75rem; font-size:0.85rem; font-weight:800;">QUICK AUDIT STATS</h5>
                                <div style="display:grid; grid-template-columns:1fr; gap:0.6rem;">
                                    <div style="display:flex; align-items:center; justify-content:space-between; font-size:0.8rem;">
                                        <span style="color:#64748b;">Duration</span>
                                        <span style="font-weight:700; color:#1e293b;">${daysTotal} Days</span>
                                    </div>
                                    <div style="display:flex; align-items:center; justify-content:space-between; font-size:0.8rem;">
                                        <span style="color:#64748b;">Expenses</span>
                                        <span style="font-weight:700; color:#1e293b;">${tripExpenses.length} Records</span>
                                    </div>
                                    <div style="display:flex; align-items:center; justify-content:space-between; font-size:0.8rem;">
                                        <span style="color:#64748b;">Left to Spend</span>
                                        <span style="font-weight:700; color:${budget - totalSpent < 0 ? '#ef4444' : '#16a34a'};">${this.formatCurrency(Math.max(0, budget - totalSpent))}</span>
                                    </div>
                                </div>
                             </div>
                        </div>
                    </div>
                </div>

                <div style="padding:1rem 1.5rem; background:#f8fafc; border-top:1px solid #e2e8f0; text-align:right;">
                    <button class="btn-primary" onclick="app.closeAuditModal()" style="padding: 0.6rem 2rem; border-radius:10px;">Close Audit</button>
                </div>
            </div>
        `;

        modal.classList.add('show');

    } catch (e) {
        console.error("Audit Error:", e);
        this.showToast('Available only for premium users', 'error');
    }
};

IntelliTripApp.prototype.closeAuditModal = function () {
    const modal = document.getElementById('premiumAuditModal');
    if (modal) modal.classList.remove('show');
};

console.log('✅ Premium trip management loaded');
