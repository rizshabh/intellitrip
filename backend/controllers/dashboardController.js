const db = require('../config/db');

exports.getDashboardStats = async (req, res) => {
    try {
        const userId = req.user.id;
        const pool = db; // Assuming db is the pool object

        // Helper to get allowed trip IDs
        const tripIdsRes = await db.query(`
            SELECT id FROM trips WHERE user_id = $1
            UNION
            SELECT trip_id FROM trip_collaborators WHERE user_id = $1 AND status = 'accepted'
        `, [userId]);
        const allowedTripIds = tripIdsRes.rows.map(r => r.id);

        // 1. Overall Stats
        const totalTrips = allowedTripIds.length;

        // Total Spent (on all allowed trips)
        let totalSpent = 0;
        if (allowedTripIds.length > 0) {
            const spentRes = await db.query('SELECT SUM(amount) FROM expenses WHERE trip_id = ANY($1)', [allowedTripIds]);
            totalSpent = parseFloat(spentRes.rows[0].sum) || 0;
        }

        // Total Budget (on all allowed trips)
        let totalBudget = 0;
        if (allowedTripIds.length > 0) {
            const budgetRes = await db.query('SELECT SUM(budget) FROM trips WHERE id = ANY($1)', [allowedTripIds]);
            totalBudget = parseFloat(budgetRes.rows[0].sum) || 0;
        }

        const rating = 4.8;
        let savings = 0;
        if (totalBudget > 0) savings = totalBudget - totalSpent;

        // 2. Upcoming Trips (Top 3)
        const upcomingRes = await db.query(
            `SELECT id, destination, start_date, end_date, budget, 
            (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE trip_id = t.id) as spent
            FROM trips t
            WHERE (user_id = $1 OR id IN (SELECT trip_id FROM trip_collaborators WHERE user_id = $1 AND status = 'accepted')) 
            AND end_date >= CURRENT_DATE 
            ORDER BY start_date ASC LIMIT 3`,
            [userId]
        );

        // 3. Expense Breakdown by Category
        const categoryRes = await db.query(
            `SELECT category, SUM(amount) as total 
             FROM expenses 
             WHERE trip_id = ANY($1) 
             GROUP BY category 
             ORDER BY total DESC`,
            [allowedTripIds.length > 0 ? allowedTripIds : [-1]]
        );

        // 4. Monthly Spending Trend (Last 6 Months)
        const trendRes = await db.query(
            `SELECT TO_CHAR(date, 'Mon') as month, SUM(amount) as total
             FROM expenses
             WHERE trip_id = ANY($1) AND date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '5 months')
             GROUP BY TO_CHAR(date, 'Mon'), DATE_TRUNC('month', date)
             ORDER BY DATE_TRUNC('month', date) ASC`,
            [allowedTripIds.length > 0 ? allowedTripIds : [-1]]
        );

        // 5. Recent Activity
        const activityRes = await db.query(
            `(SELECT 'trip' as type, destination as title, 'Trip updated' as description, created_at as date, budget as amount, id 
              FROM trips WHERE id = ANY($1))
             UNION ALL
             (SELECT 'expense' as type, description as title, category as description, created_at as date, amount, id
              FROM expenses WHERE trip_id = ANY($1))
             ORDER BY date DESC LIMIT 5`,
            [allowedTripIds.length > 0 ? allowedTripIds : [-1]]
        );

        // 6. Advanced Stats for Analytics & Expenses View
        // a. Expenses This Month
        const thisMonthRes = await db.query(
            `SELECT SUM(amount) FROM expenses 
             WHERE trip_id = ANY($1) AND date >= DATE_TRUNC('month', CURRENT_DATE)`,
            [allowedTripIds.length > 0 ? allowedTripIds : [-1]]
        );
        const expensesThisMonth = parseFloat(thisMonthRes.rows[0].sum) || 0;

        // b. Travel Days (Sum of actual travel days)
        const tripsRes = await db.query(
            `SELECT start_date, end_date FROM trips WHERE id = ANY($1)`,
            [allowedTripIds.length > 0 ? allowedTripIds : [-1]]
        );

        let travelDays = 0;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        tripsRes.rows.forEach(t => {
            const start = new Date(t.start_date);
            const end = new Date(t.end_date);

            if (today >= start) {
                // Trip has started or is in the past
                const effectiveEnd = today < end ? today : end;
                const diffTime = Math.abs(effectiveEnd - start);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                travelDays += (diffDays > 0 ? diffDays : 1);
            }
            // If trip is in the future, it contributes 0 days to the average daily spend calculation
        });

        // c. Unique Destinations
        const destRes = await db.query(
            `SELECT COUNT(DISTINCT destination) FROM trips WHERE id = ANY($1)`,
            [allowedTripIds.length > 0 ? allowedTripIds : [-1]]
        );
        const uniqueDestinations = parseInt(destRes.rows[0].count) || 0;

        // d. Average Daily Spend
        const avgDailySpend = travelDays > 0 ? (totalSpent / travelDays) : 0;


        // Total Expenses Count (on all allowed trips)
        let totalExpensesCount = 0;
        if (allowedTripIds.length > 0) {
            const expensesCountRes = await db.query('SELECT COUNT(*) FROM expenses WHERE trip_id = ANY($1)', [allowedTripIds]);
            totalExpensesCount = parseInt(expensesCountRes.rows[0].count);
        }

        // 6. Real Notifications System - Ensure Dynamic Notis exist in DB for persistence

        // a. Trip Invites (Sync to DB if missing)
        const invitesRes = await db.query(
            `SELECT tc.trip_id, t.destination, u.name as owner_name, tc.created_at
             FROM trip_collaborators tc
             JOIN trips t ON tc.trip_id = t.id
             JOIN users u ON t.user_id = u.id
             WHERE tc.user_id = $1 AND tc.status = 'pending'`,
            [userId]
        );

        for (const invite of invitesRes.rows) {
            const check = await db.query(
                "SELECT id FROM notifications WHERE user_id = $1 AND type = 'invite' AND trip_id = $2",
                [userId, invite.trip_id]
            );
            if (check.rows.length === 0) {
                await db.query(
                    "INSERT INTO notifications (user_id, type, title, message, trip_id) VALUES ($1, 'invite', 'Trip Invitation', $2, $3)",
                    [userId, `${invite.owner_name} invited you to join "${invite.destination}"`, invite.trip_id]
                );
            }
        }

        // b. AI Smart Tips (Sync to DB)
        const catRes = await db.query(
            `SELECT category FROM expenses WHERE user_id = $1 GROUP BY category ORDER BY SUM(amount) DESC LIMIT 1`,
            [userId]
        );
        if (catRes.rows.length > 0) {
            const topCat = catRes.rows[0].category;
            const tipTitle = 'Smart Saving Tip';
            const tipMsg = `You spend a lot on ${topCat}. Try "Happy Hour" deals or local options to save on your next trip!`;

            // Check if this specific tip msg exists for user (avoid spamming same tip, allows deleting it permanently)
            const checkTip = await db.query(
                "SELECT id FROM notifications WHERE user_id = $1 AND type = 'active_tip' AND message = $2",
                [userId, tipMsg]
            );

            if (checkTip.rows.length === 0) {
                await db.query(
                    "INSERT INTO notifications (user_id, type, title, message) VALUES ($1, 'active_tip', $2, $3)",
                    [userId, tipTitle, tipMsg]
                );
            }
        }

        // c. Upcoming Trip Alerts (Sync to DB)
        const upcomingSoon = upcomingRes.rows.filter(t => {
            const days = Math.ceil((new Date(t.start_date) - new Date()) / (1000 * 60 * 60 * 24));
            return days >= 0 && days <= 3;
        });

        for (const t of upcomingSoon) {
            const days = Math.ceil((new Date(t.start_date) - new Date()) / (1000 * 60 * 60 * 24));
            const alertMsg = `Your trip to ${t.destination} starts in ${days} days!`;

            // Check if alert exists
            const checkAlert = await db.query(
                "SELECT id FROM notifications WHERE user_id = $1 AND type = 'trip_alert' AND trip_id = $2 AND message = $3",
                [userId, t.id, alertMsg]
            );

            if (checkAlert.rows.length === 0) {
                await db.query(
                    "INSERT INTO notifications (user_id, type, title, message, trip_id) VALUES ($1, 'trip_alert', 'Adventure Awaits', $2, $3)",
                    [userId, alertMsg, t.id]
                );
            }
        }

        // 7. FETCH ALL NOTIFICATIONS (Now includes persistent dynamic ones, but only visible ones)
        const notifications = [];
        const dbNotis = await db.query(
            'SELECT * FROM notifications WHERE user_id = $1 AND is_visible = TRUE ORDER BY created_at DESC LIMIT 20',
            [userId]
        );

        dbNotis.rows.forEach(n => {
            notifications.push({
                id: n.id,
                type: n.type,
                title: n.title,
                message: n.message,
                time: n.created_at,
                link: n.link,
                read: n.is_read,
                tripId: n.trip_id
            });
        });

        res.json({
            stats: {
                trips: totalTrips,
                spent: totalSpent,
                savings: savings,
                rating: rating.toFixed(1),
                expensesCount: totalExpensesCount,
                expensesThisMonth: expensesThisMonth,
                travelDays: travelDays,
                uniqueDestinations: uniqueDestinations,
                avgDailySpend: avgDailySpend.toFixed(0),
                notifications: notifications, // Send full array
                notificationCount: notifications.length
            },
            upcoming: upcomingRes.rows,
            categories: categoryRes.rows,
            trend: trendRes.rows,
            activity: activityRes.rows
        });

    } catch (err) {
        console.error('Dashboard Error:', err.message);
        res.status(500).json({ msg: 'Server error fetching dashboard data' });
    }
};
