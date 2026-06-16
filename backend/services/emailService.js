const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const logFile = path.join(__dirname, 'server.log');

function log(message) {
    const timestamp = new Date().toISOString();
    const logMsg = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(logFile, logMsg);
    console.log(message);
}

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
    });
};

// Helper for dynamic destination images
const getDestinationImage = (destination) => {
    const dest = destination.toLowerCase();
    const images = {
        'andaman': 'https://images.unsplash.com/photo-1589308078059-be1415eab4c3?w=800&q=80',
        'bali': 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=800&q=80',
        'paris': 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=800&q=80',
        'london': 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=800&q=80',
        'dubai': 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=800&q=80',
        'new york': 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=800&q=80',
        'tokyo': 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=800&q=80',
        'maldives': 'https://images.unsplash.com/photo-1514282401047-d79a71a590e8?w=800&q=80',
        'switzerland': 'https://images.unsplash.com/photo-1530122037265-a5f1f91d3b99?w=800&q=80',
        'goa': 'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?w=800&q=80',
        'kerala': 'https://images.unsplash.com/photo-1602216056096-3b40cc0c9944?w=800&q=80',
        'iceland': 'https://images.unsplash.com/photo-1476610182048-b716b8518aae?w=800&q=80'
    };

    // Check if any keyword matches
    for (const key in images) {
        if (dest.includes(key)) return images[key];
    }

    // Default high-quality travel image
    return 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=800&q=80';
};

// Common Template Wrapper
const emailTemplate = (content, title, headerImage = null) => {
    const bgImage = headerImage ? `background: linear-gradient(135deg, rgba(42, 143, 170, 0.85), rgba(87, 193, 211, 0.85)), url('${headerImage}') center/cover;` : `background: linear-gradient(135deg, #2A8FAA, #57C1D3);`;

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
    <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(42,143,170,0.15)">
        <div style="padding:48px 40px; text-align:center; ${bgImage}">
            <h1 style="margin:0;font-size:24px;font-weight:700;color:#fff;letter-spacing:-0.5px;text-shadow:0 2px 4px rgba(0,0,0,0.1)">IntelliTrip</h1>
            <p style="margin:8px 0 0;font-size:14px;color:rgba(255,255,255,0.95);font-weight:500">${title}</p>
        </div>
        <div style="padding:40px">
            ${content}
        </div>
        <div style="padding:24px 40px;background:#f8fafc;text-align:center;border-top:1px solid #e2e8f0">
            <p style="margin:0;font-size:12px;color:#94a3b8;font-weight:500">&copy; ${new Date().getFullYear()} IntelliTrip Inc. All rights reserved.</p>
            <p style="margin:4px 0 0;font-size:11px;color:#cbd5e1">Smart Travel Management Platform</p>
        </div>
    </div>
</body>
</html>`;
};

exports.sendOTPEmail = async (email, otp, context = 'verification') => {
    try {
        console.log(`📨 Sending OTP to ${email}`);
        const content = `
            <h2 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#0B3B5B">Security Verification</h2>
            <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#475569">We've received a request to verify your identity for <strong style="color:#2A8FAA">${context}</strong>. Use the code below to proceed securely.</p>
            <div style="background:linear-gradient(135deg,#f0f9ff,#e0f2fe);border:2px solid #B8E7ED;border-radius:12px;padding:32px;text-align:center;margin-bottom:28px">
                <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#2A8FAA;text-transform:uppercase;letter-spacing:1.5px">Verification Code</p>
                <div style="font-family:'SF Mono',Monaco,monospace;font-size:42px;font-weight:800;color:#2A8FAA;letter-spacing:10px">${otp}</div>
                <p style="margin:16px 0 0;font-size:13px;color:#57C1D3;font-weight:600">Valid for 10 minutes</p>
            </div>
            <div style="background:#FFF9F0;border-left:4px solid #F59E0B;padding:16px 20px;border-radius:8px;margin-bottom:24px">
                <p style="margin:0;font-size:13px;color:#92400E;line-height:1.5"><strong>Security Alert:</strong> If you didn't request this, please ignore this email and secure your account.</p>
            </div>
            <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.5">This is an automated security message from IntelliTrip.</p>
        `;

        await transporter.sendMail({
            from: `"IntelliTrip" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Your Verification Code - IntelliTrip',
            html: emailTemplate(content, 'Authentication Service')
        });
        log('✅ OTP Email sent');
        return true;
    } catch (error) {
        log('❌ Email Error: ' + error.message);
        return false;
    }
};

exports.sendWelcomeEmail = async (email, name) => {
    try {
        const userName = name || 'Traveler';
        const content = `
            <h2 style="margin:0 0 12px;font-size:24px;font-weight:700;color:#0B3B5B">Welcome aboard, ${userName}!</h2>
            <p style="margin:0 0 28px;font-size:15px;line-height:1.7;color:#475569">We're thrilled to have you join IntelliTrip. Our platform is built to help you plan smarter, track better, and travel further.</p>
            
            <div style="background:#f0f9ff;border-left:4px solid #2A8FAA;padding:20px;border-radius:8px;margin-bottom:32px">
                <p style="margin:0;font-size:14px;color:#334155;line-height:1.6"><strong>Pro Tip:</strong> Start by creating your first trip and inviting your travel partners to share expenses in real-time.</p>
            </div>

            <div style="display:grid;gap:16px;margin-bottom:32px">
                <div style="padding:18px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0">
                    <p style="margin:0 0 4px;font-size:15px;color:#0B3B5B;font-weight:700">Expense Tracking</p>
                    <p style="margin:0;font-size:14px;color:#64748b;line-height:1.5">Auto-split costs and keep your budget on track effortlessly.</p>
                </div>
                <div style="padding:18px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0">
                    <p style="margin:0 0 4px;font-size:15px;color:#0B3B5B;font-weight:700">AI Analytics</p>
                    <p style="margin:0;font-size:14px;color:#64748b;line-height:1.5">Get personalized spending insights for every destination.</p>
                </div>
            </div>

            <div style="text-align:center">
                <a href="http://localhost:5500/dashboard.html" style="display:inline-block;background:linear-gradient(135deg,#2A8FAA,#57C1D3);color:#fff;padding:16px 40px;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;box-shadow:0 4px 12px rgba(42,143,170,0.3)">Go to Dashboard</a>
            </div>
        `;

        await transporter.sendMail({
            from: `"IntelliTrip" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: `Welcome to IntelliTrip, ${userName}`,
            html: emailTemplate(content, 'Getting Started')
        });
        return true;
    } catch (error) {
        console.error('❌ Welcome Email Error:', error);
        return false;
    }
};

exports.sendTripCreatedEmail = async (email, tripData, tips) => {
    try {
        const userName = tripData.userName || 'Traveler';
        const destination = tripData.destination || 'Your Destination';
        const budget = tripData.budget || 0;
        const headerImg = getDestinationImage(destination);

        const tipsHtml = tips.map(tip => `
            <div style="padding:14px 0;border-bottom:1px solid #f1f5f9;display:flex;align-items:start">
                <span style="color:#2A8FAA;margin-right:12px;font-size:18px">•</span>
                <p style="margin:0;font-size:14px;color:#475569;line-height:1.6">${tip}</p>
            </div>`).join('');

        const content = `
            <p style="margin:0 0 28px;font-size:15px;color:#64748b">Hi ${userName}, your journey is confirmed. Here's your trip overview.</p>
            
            <div style="background: linear-gradient(rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0.85)), url('${headerImg}') center/cover; border: 2px solid #B8E7ED; border-radius: 16px; padding: 40px 20px; text-align: center; margin-bottom: 32px;">
                <p style="margin: 0 0 10px; font-size: 11px; font-weight: 700; color: #2A8FAA; text-transform: uppercase; letter-spacing: 2px;">Destination</p>
                <h2 style="margin: 0; font-size: 36px; font-weight: 800; color: #0B3B5B;">${destination}</h2>
            </div>

            <div style="background:linear-gradient(135deg,#f0f9ff,#e0f2fe);border:1px solid #B8E7ED;border-radius:12px;padding:28px;margin-bottom:32px">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">
                    <div>
                        <p style="margin:0 0 6px;font-size:11px;color:#2A8FAA;font-weight:700;text-transform:uppercase;letter-spacing:1px">Start Date</p>
                        <p style="margin:0;font-size:16px;color:#0B3B5B;font-weight:600">${formatDate(tripData.start_date)}</p>
                    </div>
                    <div>
                        <p style="margin:0 0 6px;font-size:11px;color:#2A8FAA;font-weight:700;text-transform:uppercase;letter-spacing:1px">End Date</p>
                        <p style="margin:0;font-size:16px;color:#0B3B5B;font-weight:600">${formatDate(tripData.end_date)}</p>
                    </div>
                </div>
                <div style="border-top:1px solid rgba(42,143,170,0.1);padding-top:20px">
                    <p style="margin:0 0 6px;font-size:11px;color:#2A8FAA;font-weight:700;text-transform:uppercase;letter-spacing:1px">Trip Budget</p>
                    <p style="margin:0;font-size:24px;color:#2A8FAA;font-weight:800">&#8377;${budget.toLocaleString('en-IN')}</p>
                </div>
            </div>

            <h3 style="margin:0 0 16px;font-size:13px;font-weight:700;color:#0B3B5B;text-transform:uppercase;letter-spacing:1px">Smart Travel Tips</h3>
            <div style="border-top:1px solid #e2e8f0;margin-bottom:32px">
                ${tipsHtml}
            </div>

            <div style="text-align:center">
                <a href="http://localhost:5500/dashboard.html" style="display:inline-block;background:linear-gradient(135deg,#2A8FAA,#57C1D3);color:#fff;padding:16px 40px;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;box-shadow:0 4px 12px rgba(42,143,170,0.3)">View Full Itinerary</a>
            </div>
        `;

        await transporter.sendMail({
            from: `"IntelliTrip" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: `Confirmed: Your Trip to ${destination}`,
            html: emailTemplate(content, 'Trip Confirmation', headerImg)
        });
        log('✅ Trip Email sent');
        return true;
    } catch (error) {
        log('❌ Trip Email Error: ' + error.message);
        return false;
    }
};

exports.sendInvitationEmail = async (toEmail, inviterName, tripName) => {
    try {
        const safeInviterName = inviterName || 'A friend';
        const headerImg = getDestinationImage(tripName);

        const content = `
            <h2 style="margin:0 0 12px;font-size:24px;font-weight:700;color:#0B3B5B">You're Invited!</h2>
            <p style="margin:0 0 28px;font-size:15px;line-height:1.7;color:#475569"><strong style="color:#2A8FAA">${safeInviterName}</strong> has invited you to join their trip. Experience seamless planning and expense management together.</p>
            
            <div style="background: linear-gradient(rgba(255, 255, 255, 0.85), rgba(255, 255, 255, 0.85)), url('${headerImg}') center/cover; border: 2px solid #B8E7ED; border-radius: 16px; padding: 40px 20px; text-align: center; margin-bottom: 32px;">
                <p style="margin: 0 0 10px; font-size: 11px; font-weight: 700; color: #2A8FAA; text-transform: uppercase; letter-spacing: 2px;">Destination</p>
                <h2 style="margin: 0; font-size: 36px; font-weight: 800; color: #0B3B5B;">${tripName}</h2>
            </div>

            <div style="background:#f8fafc;padding:24px;border-radius:12px;border:1px solid #e2e8f0;margin-bottom:32px">
                <p style="margin:0 0 16px;font-size:14px;color:#0B3B5B;font-weight:700">Why Join?</p>
                <ul style="margin:0;padding-left:0;list-style:none;font-size:14px;color:#475569;line-height:1.8">
                    <li style="margin-bottom:8px;display:flex;align-items:center"><span style="color:#2A8FAA;margin-right:10px">✓</span> Real-time expense splitting</li>
                    <li style="margin-bottom:8px;display:flex;align-items:center"><span style="color:#2A8FAA;margin-right:10px">✓</span> Collaborative trip planning</li>
                    <li style="margin-bottom:8px;display:flex;align-items:center"><span style="color:#2A8FAA;margin-right:10px">✓</span> Digital receipt management</li>
                </ul>
            </div>

            <div style="text-align:center">
                <a href="http://localhost:5500/dashboard.html#trips" style="display:inline-block;background:linear-gradient(135deg,#2A8FAA,#57C1D3);color:#fff;padding:16px 40px;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;box-shadow:0 4px 12px rgba(42,143,170,0.3)">Join the Trip</a>
            </div>
        `;

        await transporter.sendMail({
            from: `"IntelliTrip" <${process.env.EMAIL_USER}>`,
            to: toEmail,
            subject: `${safeInviterName} invited you to join a trip to ${tripName}`,
            html: emailTemplate(content, 'Collaboration Invite', headerImg)
        });
        return true;
    } catch (error) {
        console.error('❌ Invite Email Error:', error);
        return false;
    }
};

exports.sendPaymentReceivedEmail = async (toEmail, receiverName, payerName, amount, description) => {
    try {
        const safeReceiverName = receiverName || 'User';
        const safePayerName = payerName || 'A member';

        const content = `
            <h2 style="margin:0 0 12px;font-size:24px;font-weight:700;color:#0B3B5B">Payment Received!</h2>
            <p style="margin:0 0 28px;font-size:15px;line-height:1.7;color:#475569"><strong style="color:#2A8FAA">${safePayerName}</strong> has just settled their share for <strong style="color:#2A8FAA">${description}</strong>.</p>
            
            <div style="background:#f8fafc;padding:24px;border-radius:12px;border:1px solid #e2e8f0;margin-bottom:32px;text-align:center;">
                <p style="margin:0 0 8px;font-size:12px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:1px">Amount Settled</p>
                <div style="font-size:32px;font-weight:800;color:#10b981;">₹${(amount || 0).toLocaleString('en-IN')}</div>
            </div>

            <div style="text-align:center">
                <a href="http://localhost:5500/dashboard.html" style="display:inline-block;background:linear-gradient(135deg,#2A8FAA,#57C1D3);color:#fff;padding:16px 40px;text-decoration:none;border-radius:8px;font-size:15px;font-weight:600;box-shadow:0 4px 12px rgba(42,143,170,0.3)">View Dashboard</a>
            </div>
        `;

        await transporter.sendMail({
            from: `"IntelliTrip" <${process.env.EMAIL_USER}>`,
            to: toEmail,
            subject: `Payment Received from ${safePayerName}`,
            html: emailTemplate(content, 'Expense Settlement')
        });
        return true;
    } catch (error) {
        console.error('❌ Payment Email Error:', error);
        return false;
    }
};

