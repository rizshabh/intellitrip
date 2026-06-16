const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const emailService = require('../services/emailService');

// Register User
// Register User
exports.register = async (req, res) => {
    const { name, email, password } = req.body;

    // Enhanced email validation
    const emailRegex = /^[a-zA-Z0-9._%+-]{3,}@[a-zA-Z0-9.-]{2,}\.[a-zA-Z]{2,10}$/;
    const trimmedEmail = email ? email.trim().toLowerCase() : '';
    const [local, domain] = trimmedEmail.split('@');
    const dPrefix = domain ? domain.split('.')[0] : '';

    if (!emailRegex.test(trimmedEmail) || local.length < 3 || domain.length < 4 || ['g', 'gm', 'gmai', 'y', 'yah', 'yaho'].includes(dPrefix)) {
        return res.status(400).json({ msg: 'Please provide a valid business or personal email address (e.g. user@gmail.com)' });
    }

    // Password validation: Alphanumeric (Upper, Lower, Number) + Special Char, Min 8
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>])[A-Za-z\d!@#$%^&*(),.?":{}|<>]{8,}$/;
    if (!passwordRegex.test(password)) {
        return res.status(400).json({
            msg: 'Password must be at least 8 characters long and include uppercase, lowercase, numbers, and a special character.'
        });
    }

    try {
        // Check if user already exists in MAIN table
        const userCheck = await db.query('SELECT * FROM users WHERE email = $1', [trimmedEmail]);

        if (userCheck.rows.length > 0) {
            return res.status(400).json({ msg: 'User already exists with this email' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Store in PENDING table (UPSERT to handle retry)
        await db.query(`
            INSERT INTO pending_registrations (email, name, password, otp, otp_expires)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (email) 
            DO UPDATE SET name = EXCLUDED.name, password = EXCLUDED.password, otp = EXCLUDED.otp, otp_expires = EXCLUDED.otp_expires;
        `, [trimmedEmail, name, hashedPassword, otp, otpExpires]);

        await emailService.sendOTPEmail(trimmedEmail, otp, 'signup verification');
        res.status(200).json({ msg: 'OTP sent to your email. Please verify to complete your registration.' });

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error during registration');
    }
};

// Verify Signup OTP
// Verify Signup OTP
exports.verifySignupOTP = async (req, res) => {
    const { email, otp } = req.body;
    const trimmedEmail = email ? email.trim().toLowerCase() : '';

    try {
        // Check PENDING registrations first
        const pendingUser = await db.query('SELECT * FROM pending_registrations WHERE email = $1', [trimmedEmail]);

        if (pendingUser.rows.length === 0) {
            // Fallback: Check if user is already verified (maybe verify called twice?)
            const existingUser = await db.query('SELECT * FROM users WHERE email = $1', [trimmedEmail]);
            if (existingUser.rows.length > 0 && existingUser.rows[0].is_verified) {
                return res.status(400).json({ msg: 'User is already verified. Please login.' });
            }
            return res.status(404).json({ msg: 'Registration request not found or expired.' });
        }

        const userData = pendingUser.rows[0];

        if (userData.otp !== otp) {
            return res.status(400).json({ msg: 'Invalid verification code' });
        }

        if (new Date(userData.otp_expires) < new Date()) {
            return res.status(400).json({ msg: 'Verification code has expired. Please register again.' });
        }

        // Move to USERS table
        const newUser = await db.query(
            'INSERT INTO users (name, email, password, is_verified, created_at) VALUES ($1, $2, $3, TRUE, CURRENT_TIMESTAMP) RETURNING *',
            [userData.name, userData.email, userData.password]
        );

        // Delete from pending
        await db.query('DELETE FROM pending_registrations WHERE email = $1', [trimmedEmail]);

        emailService.sendWelcomeEmail(trimmedEmail, userData.name);

        const verifiedUser = newUser.rows[0];
        const payload = { user: { id: verifiedUser.id } };

        jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: '5h' },
            (err, token) => {
                if (err) throw err;
                res.status(200).json({
                    token,
                    user: {
                        id: verifiedUser.id,
                        name: verifiedUser.name,
                        email: verifiedUser.email,
                        profile_picture: verifiedUser.profile_picture
                    },
                    msg: 'Account verified and created successfully'
                });
            }
        );
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error during verification');
    }
};

// Login User
exports.login = async (req, res) => {
    const { email, password } = req.body;
    console.log('🔐 Login attempt for:', email);

    // Enhanced email validation
    const emailRegex = /^[a-zA-Z0-9._%+-]{3,}@[a-zA-Z0-9.-]{2,}\.[a-zA-Z]{2,10}$/;
    const trimmedEmail = email ? email.trim().toLowerCase() : '';
    const [local, domain] = trimmedEmail.split('@');
    const dPrefix = domain ? domain.split('.')[0] : '';

    if (!emailRegex.test(trimmedEmail) || local.length < 3 || domain.length < 4 || ['g', 'gm', 'gmai', 'y', 'yah', 'yaho'].includes(dPrefix)) {
        return res.status(400).json({ msg: 'Please provide a valid email address' });
    }

    try {
        console.log('📊 Querying database for user...');
        const user = await db.query('SELECT * FROM users WHERE email = $1', [email]);

        if (user.rows.length === 0) {
            console.log('❌ User not found:', email);
            return res.status(400).json({ msg: 'User not found. Please sign up.' });
        }

        if (!user.rows[0].is_verified) {
            console.log('❌ User not verified:', email);
            return res.status(400).json({ msg: 'Please verify your email before logging in.' });
        }

        console.log('✅ User found, verifying password...');
        const isMatch = await bcrypt.compare(password, user.rows[0].password);

        if (!isMatch) {
            console.log('❌ Invalid password for:', email);
            return res.status(400).json({ msg: 'Invalid password. Please try again.' });
        }

        console.log('✅ Password verified, generating token...');
        const payload = { user: { id: user.rows[0].id } };

        jwt.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: '5h' },
            async (err, token) => {
                if (err) {
                    console.error('❌ JWT Error:', err);
                    throw err;
                }

                console.log('✅ Token generated, creating notification...');

                // Add a "Welcome Back" notification
                try {
                    await db.query(`
                        INSERT INTO notifications (user_id, type, title, message)
                        VALUES ($1, 'system', 'Welcome Back!', 'Glad to see you again! Check your upcoming trips.')
                    `, [user.rows[0].id]);
                    console.log('✅ Notification created');
                } catch (notiErr) {
                    console.error('⚠️  Error creating login notification:', notiErr);
                }

                console.log('✅ Sending response to client...');
                res.json({
                    token,
                    user: {
                        id: user.rows[0].id,
                        name: user.rows[0].name,
                        email: user.rows[0].email,
                        profile_picture: user.rows[0].profile_picture
                    }
                });
                console.log('✅ Login successful for:', email);
            }
        );

    } catch (err) {
        console.error('❌ Login error:', err.message);
        res.status(500).send('Server error during login');
    }
};

// Get User Profile
exports.getProfile = async (req, res) => {
    try {
        const user = await db.query('SELECT id, name, email, profile_picture, email_notifications, push_notifications, profile_visibility, preferred_currency, upi_id, created_at FROM users WHERE id = $1', [req.user.id]);
        res.json(user.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
};

// Upload Profile Picture (File Storage)
exports.uploadProfilePicture = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ msg: 'No image file provided' });
        }

        const filePath = `/uploads/profile-pictures/${req.file.filename}`;

        // Update database with file path
        await db.query('UPDATE users SET profile_picture = $1 WHERE id = $2', [filePath, req.user.id]);

        res.json({ profile_picture: filePath, msg: 'Profile picture updated successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server error: ' + err.message });
    }
};


// Update Profile Settings
exports.updateProfile = async (req, res) => {
    const { name, email_notifications, push_notifications, profile_visibility, preferred_currency, upi_id } = req.body;

    try {
        // Handle Name Update
        if (typeof name !== 'undefined') {
            if (name.trim().length < 2) {
                return res.status(400).json({ msg: 'Name must be at least 2 characters' });
            }
            await db.query('UPDATE users SET name = $1 WHERE id = $2', [name.trim(), req.user.id]);
        }

        // Handle Settings Updates
        if (typeof email_notifications !== 'undefined') {
            await db.query('UPDATE users SET email_notifications = $1 WHERE id = $2', [email_notifications, req.user.id]);
        }
        if (typeof push_notifications !== 'undefined') {
            await db.query('UPDATE users SET push_notifications = $1 WHERE id = $2', [push_notifications, req.user.id]);
        }
        if (typeof profile_visibility !== 'undefined') {
            await db.query('UPDATE users SET profile_visibility = $1 WHERE id = $2', [profile_visibility, req.user.id]);
        }
        if (typeof preferred_currency !== 'undefined') {
            await db.query('UPDATE users SET preferred_currency = $1 WHERE id = $2', [preferred_currency, req.user.id]);
        }
        if (typeof upi_id !== 'undefined') {
            await db.query('UPDATE users SET upi_id = $1 WHERE id = $2', [upi_id, req.user.id]);
        }

        // Fetch updated user data
        const user = await db.query('SELECT id, name, email, profile_picture, email_notifications, push_notifications, profile_visibility, preferred_currency, upi_id FROM users WHERE id = $1', [req.user.id]);
        res.json({ user: user.rows[0], msg: 'Profile updated successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ msg: 'Server error updating profile' });
    }
};

// Request Password Change OTP
exports.requestPasswordChange = async (req, res) => {
    try {
        const user = await db.query('SELECT email, name FROM users WHERE id = $1', [req.user.id]);
        if (user.rows.length === 0) {
            return res.status(404).json({ msg: 'User not found' });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expires = new Date(Date.now() + 10 * 60 * 1000);

        await db.query('UPDATE users SET otp = $1, otp_expires = $2 WHERE id = $3', [otp, expires, req.user.id]);

        await emailService.sendOTPEmail(user.rows[0].email, otp, 'password change');

        res.json({ msg: 'OTP sent to your email' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
};

// Verify OTP and Change Password
exports.verifyPasswordChange = async (req, res) => {
    const { otp, newPassword } = req.body;

    try {
        const user = await db.query('SELECT otp, otp_expires FROM users WHERE id = $1', [req.user.id]);

        if (user.rows.length === 0) {
            return res.status(404).json({ msg: 'User not found' });
        }

        const storedOtp = user.rows[0].otp;
        const storedExpires = new Date(user.rows[0].otp_expires);

        if (!storedOtp || storedOtp !== otp) {
            return res.status(400).json({ msg: 'Invalid OTP' });
        }

        if (storedExpires < new Date()) {
            return res.status(400).json({ msg: 'OTP has expired' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        await db.query('UPDATE users SET password = $1, otp = NULL, otp_expires = NULL WHERE id = $2', [hashedPassword, req.user.id]);

        res.json({ msg: 'Password changed successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
};

// Request Account Deletion OTP
exports.requestAccountDeletion = async (req, res) => {
    try {
        const user = await db.query('SELECT email, name FROM users WHERE id = $1', [req.user.id]);
        if (user.rows.length === 0) {
            return res.status(404).json({ msg: 'User not found' });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expires = new Date(Date.now() + 10 * 60 * 1000);

        await db.query('UPDATE users SET otp = $1, otp_expires = $2 WHERE id = $3', [otp, expires, req.user.id]);

        await emailService.sendOTPEmail(user.rows[0].email, otp, 'account deletion');

        res.json({ msg: 'Verification code sent to your email' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
};

// Confirm Account Deletion
exports.confirmAccountDeletion = async (req, res) => {
    const { otp } = req.body;

    try {
        const user = await db.query('SELECT otp, otp_expires FROM users WHERE id = $1', [req.user.id]);

        if (user.rows.length === 0) {
            return res.status(404).json({ msg: 'User not found' });
        }

        const storedOtp = user.rows[0].otp;
        const storedExpires = new Date(user.rows[0].otp_expires);

        if (!storedOtp || storedOtp !== otp) {
            return res.status(400).json({ msg: 'Invalid OTP' });
        }

        if (storedExpires < new Date()) {
            return res.status(400).json({ msg: 'OTP has expired' });
        }

        // Delete user account
        await db.query('DELETE FROM users WHERE id = $1', [req.user.id]);

        res.json({ msg: 'Account deleted successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
};

// Forgot Password
exports.forgotPassword = async (req, res) => {
    const { email } = req.body;

    const emailRegex = /^[a-zA-Z0-9._%+-]{3,}@[a-zA-Z0-9.-]{2,}\.[a-zA-Z]{2,10}$/;
    const trimmedEmail = email ? email.trim().toLowerCase() : '';
    const [local, domain] = trimmedEmail.split('@');
    const dPrefix = domain ? domain.split('.')[0] : '';

    if (!emailRegex.test(trimmedEmail) || local.length < 3 || domain.length < 4 || ['g', 'gm', 'gmai', 'y', 'yah', 'yaho'].includes(dPrefix)) {
        return res.status(400).json({ msg: 'Please provide a valid email address' });
    }

    try {
        console.log(`🔐 Password reset requested for: ${email}`);
        const user = await db.query('SELECT id, email, name FROM users WHERE email = $1', [email]);

        if (user.rows.length === 0) {
            console.log(`⚠️  No account found for: ${email}`);
            return res.status(404).json({ msg: 'No account found with this email' });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expires = new Date(Date.now() + 10 * 60 * 1000);

        await db.query('UPDATE users SET otp = $1, otp_expires = $2 WHERE email = $3', [otp, expires, email]);

        console.log(`📧 Sending OTP to ${email}...`);

        try {
            await emailService.sendOTPEmail(email, otp, 'password reset');
            console.log(`✅ OTP sent successfully to ${email}`);
            res.json({ msg: 'OTP sent to your email. Please check your inbox.' });
        } catch (emailError) {
            console.error('❌ Email Error:', emailError);
            return res.status(500).json({ msg: 'Failed to send OTP. Please try again later.' });
        }

    } catch (err) {
        console.error('❌ Forgot password error:', err.message);
        res.status(500).json({ msg: 'Server error processing request' });
    }
};

// Verify Reset OTP (Intermediate Step)
exports.verifyResetOTP = async (req, res) => {
    const { email, otp } = req.body;

    try {
        const user = await db.query('SELECT otp, otp_expires FROM users WHERE email = $1', [email]);

        if (user.rows.length === 0) {
            return res.status(404).json({ msg: 'User not found' });
        }

        const storedOtp = user.rows[0].otp;
        const storedExpires = new Date(user.rows[0].otp_expires);

        if (!storedOtp || storedOtp !== otp) {
            return res.status(400).json({ msg: 'Invalid OTP' });
        }

        if (storedExpires < new Date()) {
            return res.status(400).json({ msg: 'OTP has expired' });
        }

        res.json({ msg: 'OTP verified successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server error');
    }
};

// Reset Password
exports.resetPassword = async (req, res) => {
    const { email, otp, newPassword, confirmPassword } = req.body;

    if (!email || !otp || !newPassword || !confirmPassword) {
        return res.status(400).json({ msg: 'All fields are required' });
    }

    if (newPassword !== confirmPassword) {
        return res.status(400).json({ msg: 'Passwords do not match' });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ msg: 'Password must be at least 6 characters' });
    }

    try {
        console.log(`🔐 Password reset attempt for: ${email}`);
        const user = await db.query('SELECT id, email, otp, otp_expires FROM users WHERE email = $1', [email]);

        if (user.rows.length === 0) {
            return res.status(404).json({ msg: 'User not found' });
        }

        const storedOtp = user.rows[0].otp;
        const storedExpires = new Date(user.rows[0].otp_expires);

        if (!storedOtp || storedOtp !== otp) {
            console.log(`❌ Invalid OTP for ${email}`);
            return res.status(400).json({ msg: 'Invalid OTP' });
        }

        if (storedExpires < new Date()) {
            console.log(`⏰ OTP expired for ${email}`);
            return res.status(400).json({ msg: 'OTP has expired. Please request a new one.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        await db.query('UPDATE users SET password = $1, otp = NULL, otp_expires = NULL WHERE email = $2', [hashedPassword, email]);

        console.log(`✅ Password reset successful for ${email}`);
        res.json({ msg: 'Password reset successful! You can now login with your new password.' });

    } catch (err) {
        console.error('❌ Reset password error:', err.message);
        res.status(500).json({ msg: 'Server error resetting password' });
    }
};
