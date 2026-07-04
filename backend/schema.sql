-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    profile_picture TEXT,
    otp TEXT,
    otp_expires TIMESTAMP WITH TIME ZONE,
    is_verified BOOLEAN DEFAULT FALSE,
    email_notifications BOOLEAN DEFAULT TRUE,
    push_notifications BOOLEAN DEFAULT TRUE,
    profile_visibility VARCHAR(20) DEFAULT 'public',
    preferred_currency VARCHAR(10) DEFAULT 'INR',
    upi_id VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Pending Registrations Table
CREATE TABLE IF NOT EXISTS pending_registrations (
    email VARCHAR(100) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    password VARCHAR(255) NOT NULL,
    otp TEXT,
    otp_expires TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Trips Table
CREATE TABLE IF NOT EXISTS trips (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    destination VARCHAR(255) NOT NULL,
    starting_point VARCHAR(255),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    budget DECIMAL(12, 2) DEFAULT 0,
    notes TEXT,
    collaborators TEXT,
    travelers INTEGER DEFAULT 1,
    travel_style VARCHAR(50) DEFAULT 'Balanced',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Trip Collaborators Table
CREATE TABLE IF NOT EXISTS trip_collaborators (
    trip_id INTEGER REFERENCES trips(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending',
    PRIMARY KEY (trip_id, user_id)
);

-- 5. Expenses Table
CREATE TABLE IF NOT EXISTS expenses (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    trip_id INTEGER REFERENCES trips(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    description TEXT,
    date TIMESTAMP WITH TIME ZONE NOT NULL,
    receipt_url TEXT,
    split_type VARCHAR(20) DEFAULT 'equal',
    split_details JSONB,
    payer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    settled_uids JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Itinerary Items Table
CREATE TABLE IF NOT EXISTS itinerary_items (
    id SERIAL PRIMARY KEY,
    trip_id INTEGER REFERENCES trips(id) ON DELETE CASCADE,
    day_number INTEGER NOT NULL,
    type VARCHAR(50),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    start_time VARCHAR(10),
    end_time VARCHAR(10),
    location VARCHAR(255),
    cost DECIMAL(12, 2) DEFAULT 0,
    latitude DECIMAL(9, 6),
    longitude DECIMAL(9, 6),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50),
    title VARCHAR(255) NOT NULL,
    message TEXT,
    link VARCHAR(255),
    trip_id INTEGER REFERENCES trips(id) ON DELETE CASCADE,
    is_read BOOLEAN DEFAULT FALSE,
    is_visible BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Saved AI Tips Table
CREATE TABLE IF NOT EXISTS saved_ai_tips (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    content TEXT,
    icon VARCHAR(50),
    tags TEXT[],
    city VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, title)
);
