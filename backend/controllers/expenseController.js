const db = require('../config/db');
const emailService = require('../services/emailService');
const aiController = require('./aiController');

// Get expenses for a specific trip or all user expenses
exports.getExpenses = async (req, res) => {
    const { trip_id } = req.params;

    try {
        if (trip_id) {
            // Ensure user owns the trip OR is an accepted collaborator
            const tripCheck = await db.query(`
                SELECT id FROM trips WHERE id = $1 AND user_id = $2
                UNION
                SELECT trip_id FROM trip_collaborators WHERE trip_id = $1 AND user_id = $2 AND status = 'accepted'
            `, [trip_id, req.user.id]);

            if (tripCheck.rows.length === 0) {
                return res.status(403).json({ msg: 'Not authorized to view expenses for this trip' });
            }
            const query = `
                SELECT e.*, u.name as payer_name, u.profile_picture as payer_profile_picture, u.upi_id as payer_upi_id
                FROM expenses e
                JOIN users u ON e.payer_id = u.id
                WHERE e.trip_id = $1 
                ORDER BY e.date DESC
            `;
            const expenses = await db.query(query, [trip_id]);
            return res.json(expenses.rows);
        } else {
            // Get all expenses for user (all trips they are part of)
            const query = `
                SELECT e.*, u.name as payer_name, u.profile_picture as payer_profile_picture, u.upi_id as payer_upi_id
                FROM expenses e
                JOIN users u ON e.payer_id = u.id
                WHERE e.trip_id = $1 
                ORDER BY e.date DESC
            `;
            // Fix: The previous query was complex, let's simplify for "My Expenses" or adjust similarly
            // Actually, keep logic but add column
            const query2 = `
                SELECT e.*, u.name as payer_name, u.profile_picture as payer_profile_picture, u.upi_id as payer_upi_id
                FROM expenses e
                JOIN users u ON e.payer_id = u.id
                WHERE e.user_id = $1
                OR e.trip_id IN (
                    SELECT id FROM trips WHERE user_id = $1
                    UNION
                    SELECT trip_id FROM trip_collaborators WHERE user_id = $1 AND status = 'accepted'
                )
                ORDER BY e.date DESC
            `;
            const expenses = await db.query(query2, [req.user.id]);
            return res.json(expenses.rows);
        }
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server error fetching expenses' });
    }
};

// Add an expense (File Storage)
exports.createExpense = async (req, res) => {
    let { trip_id, category, amount, description, date, split_type, split_details, payer_id } = req.body;

    // Multer (multipart/form-data) makes everything a string, so we need to parse if necessary
    if (typeof split_details === 'string' && split_details.trim() !== '') {
        try { split_details = JSON.parse(split_details); } catch (e) { }
    }

    if (!trip_id || !category || !amount || !date) {
        return res.status(400).json({ msg: 'Please provide trip ID, category, amount, and date' });
    }

    const receipt_url = req.file ? `/uploads/receipts/${req.file.filename}` : null;

    if (amount <= 0) {
        return res.status(400).json({ msg: 'Amount must be greater than zero' });
    }


    try {
        // Verify trip ownership OR collaborator status
        const tripCheck = await db.query(`
            SELECT id, destination FROM trips WHERE id = $1 AND user_id = $2
            UNION
            SELECT tc.trip_id as id, t.destination FROM trip_collaborators tc
            JOIN trips t ON tc.trip_id = t.id
            WHERE tc.trip_id = $1 AND tc.user_id = $2 AND tc.status = 'accepted'
        `, [trip_id, req.user.id]);

        if (tripCheck.rows.length === 0) {
            return res.status(403).json({ msg: 'You are not authorized to add expenses to this trip' });
        }

        const tripName = tripCheck.rows[0].destination;
        let finalSplitDetails = split_details;

        // If split_type is equal, auto-calculate and populate split_details
        if (split_type === 'equal') {
            const members = await db.query(`
                SELECT user_id FROM trip_collaborators WHERE trip_id = $1 AND status = 'accepted'
                UNION
                SELECT user_id FROM trips WHERE id = $1
            `, [trip_id]);

            const participantCount = members.rows.length;
            const share = parseFloat(amount) / participantCount;
            const details = {};
            members.rows.forEach(m => {
                details[m.user_id] = share;
            });
            finalSplitDetails = details;
        } else if (split_type === 'full') {
            finalSplitDetails = { [payer_id || req.user.id]: parseFloat(amount) };
        }

        const newExpense = await db.query(
            `INSERT INTO expenses (trip_id, user_id, category, amount, description, date, receipt_url, split_type, split_details, payer_id) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [
                trip_id,
                req.user.id,
                category,
                amount,
                description || '',
                date,
                receipt_url || null,
                split_type || 'equal',
                finalSplitDetails,
                payer_id || req.user.id
            ]
        );

        // Notify other members
        try {
            const uCheck = await db.query('SELECT name FROM users WHERE id = $1', [req.user.id]);
            const creatorName = uCheck.rows.length ? uCheck.rows[0].name : 'A member';

            const members = await db.query(`
                SELECT user_id FROM trip_collaborators WHERE trip_id = $1 AND status = 'accepted'
                UNION
                SELECT user_id FROM trips WHERE id = $1
            `, [trip_id]);

            const notifyPromises = members.rows
                .filter(m => m.user_id !== req.user.id)
                .map(m => {
                    return db.query(`
                        INSERT INTO notifications (user_id, type, title, message, trip_id)
                        VALUES ($1, 'expense', 'New Expense Added', $2, $3)
                    `, [m.user_id, `${creatorName} added Rs.${amount} for ${category} in "${tripName}"`, trip_id]);
                });

            await Promise.all(notifyPromises);
        } catch (notiErr) {
            console.error('Notification Error:', notiErr);
        }

        // Clear AI Cache so tips reflect new spending
        aiController.clearUserAICache(req.user.id);

        res.json(newExpense.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server error creating expense' });
    }
};

// Delete an expense
exports.deleteExpense = async (req, res) => {
    const { id } = req.params;
    try {
        const deleteOp = await db.query('DELETE FROM expenses WHERE id = $1 AND user_id = $2 RETURNING *', [id, req.user.id]);
        if (deleteOp.rows.length === 0) {
            return res.status(404).json({ msg: 'Expense not found or unauthorized' });
        }
        // Clear AI Cache
        aiController.clearUserAICache(req.user.id);

        res.json({ msg: 'Expense deleted successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server error deleting expense' });
    }
};
// Update an expense (File Storage)
exports.updateExpense = async (req, res) => {
    const { id } = req.params;
    let { category, amount, description, date, split_type, split_details, payer_id } = req.body;

    // Multer (multipart/form-data) makes everything a string
    if (typeof split_details === 'string' && split_details.trim() !== '') {
        try { split_details = JSON.parse(split_details); } catch (e) { }
    }


    try {
        // Allow BOTH the creator AND the payer to update the expense
        const expenseCheck = await db.query('SELECT * FROM expenses WHERE id = $1 AND (user_id = $2 OR payer_id = $2)', [id, req.user.id]);
        if (expenseCheck.rows.length === 0) {
            return res.status(404).json({ msg: 'Expense not found or unauthorized' });
        }

        const expense = expenseCheck.rows[0];
        const currentSplitType = split_type || expense.split_type;
        const currentAmount = amount || expense.amount;
        const currentPayerId = payer_id || expense.payer_id;
        let finalSplitDetails = split_details || expense.split_details;

        if (currentSplitType === 'equal') {
            const members = await db.query(`
                SELECT user_id FROM trip_collaborators WHERE trip_id = $1 AND status = 'accepted'
                UNION
                SELECT user_id FROM trips WHERE id = $1
            `, [expense.trip_id]);

            const participantCount = members.rows.length;
            const share = parseFloat(currentAmount) / participantCount;
            const details = {};
            members.rows.forEach(m => {
                details[m.user_id] = share;
            });
            finalSplitDetails = details;
        } else if (currentSplitType === 'full') {
            finalSplitDetails = { [currentPayerId]: parseFloat(currentAmount) };
        }

        const updatedExpense = await db.query(
            `UPDATE expenses 
             SET category = $1, amount = $2, description = $3, date = $4, receipt_url = $5, split_type = $6, split_details = $7, payer_id = $8, updated_at = CURRENT_TIMESTAMP
             WHERE id = $9 RETURNING *`,
            [
                category || expense.category,
                currentAmount,
                description !== undefined ? description : expense.description,
                date || expense.date,
                req.file ? `/uploads/receipts/${req.file.filename}` : expense.receipt_url,
                currentSplitType,

                finalSplitDetails,
                currentPayerId,
                id
            ]
        );
        // Clear AI Cache
        aiController.clearUserAICache(req.user.id);

        res.json(updatedExpense.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server error updating expense' });
    }
};

// Settle a share of an expense
exports.settleExpenseShare = async (req, res) => {
    const { id } = req.params;
    const { userId } = req.body; // The user who paid/is settling

    try {
        // Only the payer (creater/owner of expense) can mark someone as paid
        // OR the person themselves? Usually the receiver acknowledges payment.
        // Let's assume the Creator/Payer marks it.

        const expenseCheck = await db.query('SELECT * FROM expenses WHERE id = $1', [id]);
        if (expenseCheck.rows.length === 0) return res.status(404).json({ msg: 'Expense not found' });

        const expense = expenseCheck.rows[0];

        // Authorization: Use loose equality (!=) to safely compare DB integers with JWT string IDs
        if (expense.user_id != req.user.id && expense.payer_id != req.user.id && userId != req.user.id) {
            return res.status(403).json({ msg: 'Only the payer, expense owner, or the debtor can mark status' });
        }

        const userIdStr = userId.toString();
        // settled_uids is stored as a JSON string in DB — must parse before using as array
        let settledRaw = expense.settled_uids;
        if (typeof settledRaw === 'string') {
            try { settledRaw = JSON.parse(settledRaw); } catch (e) { settledRaw = []; }
        }
        let settled = (settledRaw || []).map(uid => uid.toString()); // Normalize all to strings
        if (settled.includes(userIdStr)) {
            settled = settled.filter(uid => uid !== userIdStr); // Unsettle
        } else {
            settled.push(userIdStr); // Settle

            // Only send notification if the person settling isn't the receiver
            const receiverId = expense.payer_id || expense.user_id;
            if (req.user.id !== receiverId && userIdStr === req.user.id.toString()) {
                try {
                    const settlerRes = await db.query('SELECT name FROM users WHERE id = $1', [req.user.id]);
                    const settlerName = settlerRes.rows.length ? settlerRes.rows[0].name : 'A member';

                    const receiverRes = await db.query('SELECT name, email FROM users WHERE id = $1', [receiverId]);
                    if (receiverRes.rows.length > 0) {
                        const receiver = receiverRes.rows[0];
                        const expDesc = expense.description || expense.category;

                        let settledAmount = 0;
                        try {
                            const splitData = typeof expense.split_details === 'string' ? JSON.parse(expense.split_details) : expense.split_details;
                            if (splitData && splitData[userIdStr]) {
                                settledAmount = parseFloat(splitData[userIdStr]);
                            }
                        } catch (e) { }

                        await db.query(`
                            INSERT INTO notifications (user_id, type, title, message, trip_id)
                            VALUES ($1, 'payment', 'Payment Received', $2, $3)
                        `, [receiverId, `${settlerName} paid their share for "${expDesc}".`, expense.trip_id]);

                        await emailService.sendPaymentReceivedEmail(receiver.email, receiver.name, settlerName, settledAmount, expDesc);
                    }
                } catch (notifErr) {
                    console.error('Settle Notification Error:', notifErr);
                }
            }
        }

        const updated = await db.query(
            'UPDATE expenses SET settled_uids = $1 WHERE id = $2 RETURNING *',
            [JSON.stringify(settled), id]
        );

        res.json(updated.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server error settling expense' });
    }
};

// --- BEST IN BUSINESS: GROUP DEBT SIMPLIFICATION ---
exports.getBalances = async (req, res) => {
    const { trip_id } = req.params;

    try {
        // 1. Get all expenses for this trip
        const expensesRes = await db.query('SELECT * FROM expenses WHERE trip_id = $1', [trip_id]);
        const expenses = expensesRes.rows;

        // 2. Get all members of the trip
        const membersRes = await db.query(`
            SELECT u.id, u.name, u.profile_picture, u.upi_id 
            FROM users u
            WHERE u.id IN (
                SELECT user_id FROM trip_collaborators WHERE trip_id = $1 AND status = 'accepted'
                UNION
                SELECT user_id FROM trips WHERE id = $1
            )
        `, [trip_id]);
        const members = membersRes.rows;

        const balances = {};
        members.forEach(m => {
            balances[m.id] = {
                id: m.id,
                name: m.name,
                avatar: m.profile_picture,
                upi: m.upi_id,
                net: 0,
                paid: 0,
                owed: 0
            };
        });

        // 3. Calculate net balance for each member
        expenses.forEach(exp => {
            const payerId = exp.payer_id;
            const amount = parseFloat(exp.amount);
            const splitDetails = typeof exp.split_details === 'string' ? JSON.parse(exp.split_details) : exp.split_details;
            const settledUids = (typeof exp.settled_uids === 'string' ? JSON.parse(exp.settled_uids || '[]') : exp.settled_uids || []).map(String);

            if (balances[payerId]) {
                balances[payerId].paid += amount;
                balances[payerId].net += amount;
            }

            for (const [userId, share] of Object.entries(splitDetails || {})) {
                if (balances[userId]) {
                    const shareAmt = parseFloat(share);
                    balances[userId].owed += shareAmt;
                    balances[userId].net -= shareAmt;

                    // If this specific share is already settled, we adjust the net
                    // Actually, for "Total Balance", we usually want the current standing.
                    // If shared is settled, the debt no longer exists.
                    if (settledUids.includes(userId.toString())) {
                        // Debt was repaid, so it doesn't count towards current 'net'
                        balances[userId].net += shareAmt;
                        balances[payerId].net -= shareAmt;
                    }
                }
            }
        });

        // 4. TRANSACTION MINIMIZATION ALGORITHM (Greedy Heuristic)
        const debtors = [];
        const creditors = [];

        Object.values(balances).forEach(b => {
            if (b.net < -0.01) debtors.push({ id: b.id, name: b.name, net: Math.abs(b.net) });
            else if (b.net > 0.01) creditors.push({ id: b.id, name: b.name, net: b.net });
        });

        const suggestedPayments = [];
        let d = 0, c = 0;

        while (d < debtors.length && c < creditors.length) {
            const debtor = debtors[d];
            const creditor = creditors[c];
            const payment = Math.min(debtor.net, creditor.net);

            suggestedPayments.push({
                fromId: debtor.id,
                fromName: debtor.name,
                toId: creditor.id,
                toName: creditor.name,
                toUpi: balances[creditor.id].upi,
                amount: parseFloat(payment.toFixed(2))
            });

            debtor.net -= payment;
            creditor.net -= payment;

            if (debtor.net < 0.01) d++;
            if (creditor.net < 0.01) c++;
        }

        res.json({
            balances: Object.values(balances),
            suggestedPayments
        });
    } catch (err) {
        console.error('Balance Error:', err.message);
        res.status(500).json({ msg: 'Server error calculating balances' });
    }
};
