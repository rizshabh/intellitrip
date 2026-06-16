const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        let uploadDir = path.join(__dirname, '../uploads');

        // Decide subfolder based on fieldname
        if (file.fieldname === 'profile_picture') {
            uploadDir = path.join(uploadDir, 'profile-pictures');
        } else if (file.fieldname === 'receipt') {
            uploadDir = path.join(uploadDir, 'receipts');
        }

        // Ensure directory exists
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const prefix = file.fieldname === 'profile_picture' ? 'user-' : 'receipt-';
        const id = req.user ? req.user.id : 'anon';
        cb(null, prefix + id + '-' + uniqueSuffix + ext);
    }
});

// File filter - only images
const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'));
    }
};

// Multer upload configuration
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB max
    },
    fileFilter: fileFilter
});

module.exports = upload;

