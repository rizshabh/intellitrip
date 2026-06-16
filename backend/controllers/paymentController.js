const Razorpay = require('razorpay');

let razorpayInstance = null;
try {
    razorpayInstance = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
} catch (e) {
    console.error("Razorpay setup failed", e);
}

exports.createOrder = async (req, res) => {
    try {
        if (!razorpayInstance) {
            return res.status(500).json({ error: 'Razorpay not configured' });
        }

        const { amount, currency = "INR" } = req.body;

        if (!amount) {
            return res.status(400).json({ error: 'Amount is required' });
        }

        const options = {
            amount: Math.round(amount * 100), // amount in smallest currency unit (paise)
            currency,
            receipt: 'receipt_' + Date.now(),
        };

        const order = await razorpayInstance.orders.create(options);

        if (!order) {
            return res.status(500).json({ error: 'Failed to create Razorpay order' });
        }

        res.json({
            ...order,
            key_id: process.env.RAZORPAY_KEY_ID // send key to client
        });
    } catch (error) {
        console.error('Error creating Razorpay order:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

exports.verifyPayment = async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        const crypto = require('crypto');
        const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
        hmac.update(razorpay_order_id + "|" + razorpay_payment_id);
        const generated_signature = hmac.digest('hex');

        if (generated_signature === razorpay_signature) {
            // Payment verified
            res.json({ success: true, message: "Payment verified successfully" });
        } else {
            res.status(400).json({ success: false, message: "Invalid payment signature" });
        }
    } catch (error) {
        console.error('Error verifying Razorpay payment:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
