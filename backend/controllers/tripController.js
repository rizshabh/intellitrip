const db = require('../config/db');
const emailService = require('../services/emailService');
const aiController = require('./aiController');

// Get all trips for the logged-in user with calculated fields
exports.getTrips = async (req, res) => {
    try {
        // Fetch trips with all calculated fields using IST timezone
        const query = `
            SELECT 
                t.*,
                CASE 
                    WHEN t.user_id = $1 THEN 'owner'
                    ELSE 'collaborator'
                END as role,
                
                -- Calculate total duration in days (inclusive)
                (DATE(t.end_date) - DATE(t.start_date) + 1) as total_days,
                
                -- Calculate trip status (using IST timezone)
                CASE
                    WHEN (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date > DATE(t.end_date) THEN 'completed'
                    WHEN (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date >= DATE(t.start_date) AND (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date <= DATE(t.end_date) THEN 'ongoing'
                    ELSE 'upcoming'
                END as status,
                
                -- Calculate days elapsed (for ongoing trips)
                CASE
                    WHEN (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date >= DATE(t.start_date) AND (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date <= DATE(t.end_date) 
                    THEN ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date - DATE(t.start_date) + 1)
                    ELSE NULL
                END as days_elapsed,
                
                -- Calculate journey progress percentage (for ongoing trips)
                CASE
                    WHEN (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date >= DATE(t.start_date) AND (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date <= DATE(t.end_date) 
                    THEN ROUND((((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date - DATE(t.start_date) + 1)::numeric / NULLIF((DATE(t.end_date) - DATE(t.start_date) + 1), 0)) * 100)
                    ELSE NULL
                END as journey_progress_pct,
                
                -- Calculate total spent from expenses
                COALESCE((
                    SELECT SUM(amount)
                    FROM expenses
                    WHERE trip_id = t.id
                ), 0) as total_spent,
                
                -- Calculate budget spent percentage
                CASE 
                    WHEN t.budget > 0 THEN 
                        ROUND((COALESCE((
                            SELECT SUM(amount)
                            FROM expenses
                            WHERE trip_id = t.id
                        ), 0) / t.budget) * 100)
                    ELSE 0
                END as budget_spent_pct
                
            FROM trips t
            WHERE t.user_id = $1 
            OR t.id IN (SELECT trip_id FROM trip_collaborators WHERE user_id = $1 AND status = 'accepted')
            ORDER BY t.start_date DESC
        `;
        const trips = await db.query(query, [req.user.id]);
        res.json(trips.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server error fetching trips' });
    }
};

// Create a new trip
exports.createTrip = async (req, res) => {
    const { destination, starting_point, start_date, end_date, budget, notes, collaborators, travelers, travel_style } = req.body;

    if (!destination || !start_date || !end_date) {
        return res.status(400).json({ msg: 'Please provide destination, start date, and end date' });
    }

    if (new Date(start_date) > new Date(end_date)) {
        return res.status(400).json({ msg: 'Start date cannot be after end date' });
    }

    try {
        const newTrip = await db.query(
            'INSERT INTO trips (user_id, destination, starting_point, start_date, end_date, budget, notes, collaborators, travelers, travel_style) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *',
            [req.user.id, destination, starting_point || null, start_date, end_date, budget || 0, notes, collaborators || null, travelers || 1, travel_style || 'Balanced']
        );

        const tripId = newTrip.rows[0].id;

        // Fetch user email and name for notification
        const userRes = await db.query('SELECT email, name FROM users WHERE id = $1', [req.user.id]);
        const ownerName = userRes.rows[0].name || 'A user';
        const ownerEmail = userRes.rows[0].email;

        // --- HANDLE COLLABORATOR INVITES ---
        if (collaborators && collaborators.trim().length > 0) {
            const emails = collaborators.split(',').map(e => e.trim().toLowerCase()).filter(e => e && e !== ownerEmail.toLowerCase());

            for (const email of emails) {
                try {
                    const inviteeRes = await db.query('SELECT id, name FROM users WHERE email = $1', [email]);
                    if (inviteeRes.rows.length > 0) {
                        const inviteeId = inviteeRes.rows[0].id;

                        // Add to collaborators table
                        await db.query(`
                            INSERT INTO trip_collaborators (trip_id, user_id, status) 
                            VALUES ($1, $2, 'pending')
                            ON CONFLICT (trip_id, user_id) DO NOTHING
                        `, [tripId, inviteeId]);

                        // Send invite email
                        emailService.sendInvitationEmail(email, ownerName, destination);

                        // Send in-app notification
                        await db.query(`
                            INSERT INTO notifications (user_id, type, title, message, link, trip_id)
                            VALUES ($1, 'invite', 'New Trip Invitation', $2, '/dashboard.html#trips', $3)
                        `, [inviteeId, `${ownerName} invited you to join "${destination}"`, tripId]);
                    }
                } catch (collabErr) {
                    console.error(`Error inviting ${email}:`, collabErr.message);
                }
            }
        }

        if (userRes.rows.length > 0) {
            // Generate smart tips
            const tips = [
                `Pack light for your trip to ${destination}!`,
                "Don't forget to check the local weather forecast.",
                "Keep a digital copy of your important documents.",
                "Try out the local cuisine!",
                "Use IntelliTrip to split expenses with your group!"
            ];

            // Send notification for owner
            const tripDataWithUser = { ...newTrip.rows[0], userName: ownerName };
            emailService.sendTripCreatedEmail(ownerEmail, tripDataWithUser, tips)
                .catch(err => console.error("Failed to send trip email:", err));
        }

        // Clear AI Cache so new tips reflect this trip immediately
        aiController.clearUserAICache(req.user.id);

        res.json(newTrip.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server error creating trip' });
    }
};

// Update a trip
exports.updateTrip = async (req, res) => {
    const { id } = req.params;
    const { destination, start_date, end_date, budget, notes } = req.body;

    if (start_date && end_date && new Date(start_date) > new Date(end_date)) {
        return res.status(400).json({ msg: 'Start date cannot be after end date' });
    }

    try {
        // Verify ownership
        const trip = await db.query('SELECT * FROM trips WHERE id = $1 AND user_id = $2', [id, req.user.id]);
        if (trip.rows.length === 0) {
            return res.status(404).json({ msg: 'Trip not found or unauthorized' });
        }

        const updatedTrip = await db.query(
            'UPDATE trips SET destination = COALESCE($1, destination), start_date = COALESCE($2, start_date), end_date = COALESCE($3, end_date), budget = COALESCE($4, budget), notes = COALESCE($5, notes) WHERE id = $6 RETURNING *',
            [destination, start_date, end_date, budget, notes, id]
        );

        // Clear AI Cache
        aiController.clearUserAICache(req.user.id);

        res.json(updatedTrip.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server error updating trip' });
    }
};

// Delete a trip
exports.deleteTrip = async (req, res) => {
    const { id } = req.params;
    try {
        const deleteOp = await db.query('DELETE FROM trips WHERE id = $1 AND user_id = $2 RETURNING *', [id, req.user.id]);
        if (deleteOp.rows.length === 0) {
            return res.status(404).json({ msg: 'Trip not found or unauthorized' });
        }
        // Clear AI Cache
        aiController.clearUserAICache(req.user.id);

        res.json({ msg: 'Trip deleted successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server error deleting trip' });
    }
};

// Add Collaborator Logic

exports.addCollaborator = async (req, res) => {
    const { tripId, email } = req.body;
    try {
        // 1. Verify ownership (only owner can add)
        const tripCheck = await db.query('SELECT * FROM trips WHERE id = $1 AND user_id = $2', [tripId, req.user.id]);
        if (tripCheck.rows.length === 0) {
            return res.status(403).json({ msg: 'Not authorized to add members to this trip' });
        }

        // 2. Find user by email
        const userRes = await db.query('SELECT id, name, email FROM users WHERE email = $1', [email]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ msg: 'User with this email not found on IntelliTrip' });
        }
        const invitee = userRes.rows[0];

        if (invitee.id === req.user.id) {
            return res.status(400).json({ msg: 'You cannot invite yourself' });
        }

        // 3. Get inviter's name from database
        const inviterRes = await db.query('SELECT name FROM users WHERE id = $1', [req.user.id]);
        const inviterName = inviterRes.rows.length > 0 ? inviterRes.rows[0].name : 'A user';

        // 4. Add to collaborators table
        await db.query(
            `INSERT INTO trip_collaborators (trip_id, user_id, status) VALUES ($1, $2, 'pending')
             ON CONFLICT (trip_id, user_id) DO NOTHING`,
            [tripId, invitee.id]
        );

        // 5. Send Notification & Email
        try {
            // Email
            emailService.sendInvitationEmail(invitee.email, inviterName, tripCheck.rows[0].destination);

            // Dashboard Notification for Invitee
            await db.query(`
                INSERT INTO notifications (user_id, type, title, message, link, trip_id)
                VALUES ($1, 'invite', 'New Trip Invitation', $2, '/dashboard.html#trips', $3)
            `, [invitee.id, `${inviterName} invited you to join "${tripCheck.rows[0].destination}"`, tripId]);
        } catch (err) {
            console.error('Notification/Email Error:', err);
        }

        res.json({ msg: `Invitation sent to ${invitee.name}`, collaborator: invitee });

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server error adding collaborator' });
    }
};

exports.respondToInvite = async (req, res) => {
    const { tripId, status } = req.body; // status: 'accepted' or 'rejected'
    try {
        if (!['accepted', 'rejected'].includes(status)) {
            return res.status(400).json({ msg: 'Invalid status' });
        }

        const result = await db.query(
            `UPDATE trip_collaborators SET status = $1 WHERE trip_id = $2 AND user_id = $3 RETURNING *`,
            [status, tripId, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ msg: 'Invite not found' });
        }

        // Mark notification as read
        await db.query(
            "UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND trip_id = $2 AND type = 'invite'",
            [req.user.id, tripId]
        );

        // Create notification for the owner
        try {
            const tripOwner = await db.query('SELECT user_id, destination FROM trips WHERE id = $1', [tripId]);
            if (tripOwner.rows.length > 0) {
                const ownerId = tripOwner.rows[0].user_id;
                const tripName = tripOwner.rows[0].destination;

                // Fetch the responder's name from the database
                const responderQuery = await db.query('SELECT name FROM users WHERE id = $1', [req.user.id]);
                const responderName = responderQuery.rows.length > 0 ? responderQuery.rows[0].name : 'A user';

                await db.query(`
                    INSERT INTO notifications (user_id, type, title, message)
                    VALUES ($1, 'system', 'Invite Update', $2)
                `, [ownerId, `${responderName} has ${status} your invitation to join "${tripName}"`]);
            }
        } catch (notiErr) {
            console.error('Error Notify Member Response:', notiErr);
        }

        res.json({ msg: `Trip invitation ${status}`, tripId: tripId });

    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server error responding to invite' });
    }
};

exports.getTripMembers = async (req, res) => {
    const { id } = req.params;
    try {
        // Anyone in the trip (owner or accepted collaborator) can view members
        const members = await db.query(`
            SELECT u.id, u.name, u.email, u.profile_picture, 
                   CASE WHEN t.user_id = u.id THEN 'owner' ELSE tc.status END as role
            FROM users u
            JOIN trip_collaborators tc ON u.id = tc.user_id
            JOIN trips t ON t.id = tc.trip_id
            WHERE t.id = $1
            UNION
            SELECT u.id, u.name, u.email, u.profile_picture, 'owner' as role
            FROM users u
            JOIN trips t ON u.id = t.user_id
            WHERE t.id = $1
        `, [id]);

        res.json(members.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server error fetching members' });
    }
};

exports.removeMember = async (req, res) => {
    const { id, userId } = req.params;
    try {
        const tripCheck = await db.query('SELECT * FROM trips WHERE id = $1', [id]);
        if (tripCheck.rows.length === 0) return res.status(404).json({ msg: 'Trip not found' });

        const trip = tripCheck.rows[0];
        if (trip.user_id !== req.user.id && parseInt(userId) !== req.user.id) {
            return res.status(403).json({ msg: 'Only owner can remove members' });
        }

        await db.query('DELETE FROM trip_collaborators WHERE trip_id = $1 AND user_id = $2', [id, userId]);
        res.json({ msg: 'Member removed' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Server error removing member' });
    }
};

// Itinerary Operations
exports.getItinerary = async (req, res) => {
    try {
        const { id } = req.params;
        const access = await checkTripAccess(req.user.id, id);
        if (!access) return res.status(403).json({ msg: 'Unauthorized' });

        const items = await db.query(
            'SELECT * FROM itinerary_items WHERE trip_id = $1 ORDER BY day_number ASC, start_time ASC',
            [id]
        );
        res.json(items.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Error fetching itinerary' });
    }
};

exports.addItineraryItem = async (req, res) => {
    try {
        const { id } = req.params;
        const { day_number, type, title, description, start_time, end_time, location, cost, latitude, longitude } = req.body;

        const access = await checkTripAccess(req.user.id, id);
        if (!access) return res.status(403).json({ msg: 'Unauthorized' });

        const newItem = await db.query(
            `INSERT INTO itinerary_items (trip_id, day_number, type, title, description, start_time, end_time, location, cost, latitude, longitude)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [id, day_number, type, title, description, start_time, end_time, location, cost, latitude, longitude]
        );
        res.json(newItem.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Error adding item' });
    }
};

exports.updateItineraryItem = async (req, res) => {
    try {
        const { id, itemId } = req.params;
        const { day_number, type, title, description, start_time, end_time, location, cost, latitude, longitude } = req.body;

        const access = await checkTripAccess(req.user.id, id);
        if (!access) return res.status(403).json({ msg: 'Unauthorized' });

        const updatedItem = await db.query(
            `UPDATE itinerary_items 
             SET day_number = COALESCE($1, day_number),
                 type = COALESCE($2, type),
                 title = COALESCE($3, title),
                 description = COALESCE($4, description),
                 start_time = COALESCE($5, start_time), 
                 end_time = COALESCE($6, end_time),
                 location = COALESCE($7, location),
                 cost = COALESCE($8, cost),
                 latitude = COALESCE($9, latitude),
                 longitude = COALESCE($10, longitude)
             WHERE id = $11 AND trip_id = $12
             RETURNING *`,
            [day_number, type, title, description, start_time, end_time, location, cost, latitude, longitude, itemId, id]
        );

        if (updatedItem.rows.length === 0) {
            return res.status(404).json({ msg: 'Itinerary item not found' });
        }

        res.json(updatedItem.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Error updating item' });
    }
};

exports.deleteItineraryItem = async (req, res) => {
    try {
        const { id, itemId } = req.params;
        const access = await checkTripAccess(req.user.id, id);
        if (!access) return res.status(403).json({ msg: 'Unauthorized' });

        await db.query('DELETE FROM itinerary_items WHERE id = $1 AND trip_id = $2', [itemId, id]);
        res.json({ msg: 'Item deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Error deleting item' });
    }
};

exports.clearItinerary = async (req, res) => {
    try {
        const { id } = req.params;
        const access = await checkTripAccess(req.user.id, id);
        if (!access) return res.status(403).json({ msg: 'Unauthorized' });

        await db.query('DELETE FROM itinerary_items WHERE trip_id = $1', [id]);
        res.json({ msg: 'Itinerary cleared successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Error clearing itinerary' });
    }
};

// Helper
async function checkTripAccess(userId, tripId) {
    const res = await db.query(`
        SELECT 1 FROM trips WHERE id = $1 AND user_id = $2
        UNION
        SELECT 1 FROM trip_collaborators WHERE trip_id = $1 AND user_id = $2 AND status = 'accepted'
    `, [tripId, userId]);
    return res.rows.length > 0;
}
