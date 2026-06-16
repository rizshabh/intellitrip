const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();

// Middleware - Enhanced CORS configuration
app.use(cors({
    origin: '*', // Allow all origins
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
app.use(express.json({ limit: '50mb' })); // Body parser with increased limit for Base64 images

// Request Logger
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// DEBUG ROUTE: Check if this gets hit
app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

const db = require('./config/db');

// Disable caching for frontend files
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});

// 1. API Routes (Registered BEFORE static to prevent interference)
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/trips', require('./routes/tripRoutes'));
app.use('/api/expenses', require('./routes/expenseRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));
app.use('/api/ai', require('./routes/aiRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/payments', require('./routes/paymentRoutes'));

// DEBUG ROUTE
app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// 2. Serve static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, '../frontend')));

// Explicitly serve landing page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

const PORT = process.env.PORT || 5000;

// Debugging: Prevent unexpected exits and log them
setInterval(() => {
    // Keep-alive loop
}, 5000 * 60);

const originalExit = process.exit;
process.exit = (code) => {
    console.error(`Process exit called with code: ${code}`);
    console.trace('Exit trace');
    originalExit(code);
};

app.listen(PORT, async () => {
    console.log(`Server started on port ${PORT}`);

    // Verify frontend path
    const frontendPath = path.join(__dirname, '../frontend');
    const indexPath = path.join(frontendPath, 'index.html');
    const fs = require('fs');
    console.log('Serving frontend from:', frontendPath);
    if (fs.existsSync(indexPath)) {
        console.log('index.html found at:', indexPath);
    } else {
        console.error('CRITICAL ERROR: index.html NOT found at:', indexPath);
    }

    // Auto-open browser
    const { exec } = require('child_process');
    const url = `http://localhost:${PORT}`;
    const start = (process.platform == 'darwin' ? 'open' : process.platform == 'win32' ? 'start' : 'xdg-open');
    exec(`${start} ${url}`, (error) => {
        if (error) {
            console.error('Failed to open browser:', error);
        }
    });

    try {
        const res = await db.query('SELECT NOW()');
        console.log('Database connection verified at:', res.rows[0].now);
    } catch (err) {
        console.error('Database connection failed on startup:', err);
    }
});

// Global Error Handlers to prevent silent exits
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION:', reason);
});
