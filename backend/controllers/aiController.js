const db = require('../config/db');
const { GoogleGenerativeAI } = require("@google/generative-ai");
// ...

// Smart Travel Tips - Master Intelligence Flow (DB-Aware)
const getSmartTips = async (req, res) => {
    try {
        const userId = req.user ? req.user.id : null;
        if (!userId) return res.status(401).json({ message: "User not authenticated" });

        const { refresh } = req.query;
        console.log(`Getting Smart Tips. Refresh: ${refresh}, User: ${userId}`);

        // 1. Fetch REAL Trip Data from DB
        const tripsResult = await db.query('SELECT * FROM trips WHERE user_id = $1 ORDER BY start_date ASC', [userId]);
        const trips = tripsResult.rows;

        const expensesResult = await db.query('SELECT SUM(amount) as total FROM expenses WHERE user_id = $1', [userId]);
        const totalSpent = expensesResult.rows[0].total || 0;

        const userResult = await db.query('SELECT preferred_currency FROM users WHERE id = $1', [userId]);
        const preferredCurrency = userResult.rows[0]?.preferred_currency || 'INR';

        const currencies = {
            'INR': '₹', 'USD': '$', 'EUR': '€', 'GBP': '£',
            'JPY': '¥', 'AUD': 'A$', 'CAD': 'C$', 'CHF': 'Fr',
            'CNY': '¥', 'SGD': 'S$'
        };
        const currencySymbol = currencies[preferredCurrency] || '₹';

        // 2. Disable caching for now if requested, or use time-based cache
        const cacheKey = `tips_user_${userId}_v2`;
        if (refresh !== 'true') {
            const cached = getCachedData(cacheKey);
            if (cached) {
                console.log('Serving CACHED smart tips');
                return res.json(cached);
            }
        } else {
            console.log('Refresh requested. Bypassing cache for Smart Tips.');
        }

        if (!groqApiKey && !geminiApiKey) return res.status(503).json({ message: 'AI Service Unavailable' });

        // 3. Construct Context
        const now = new Date();
        const currentTrips = trips.filter(t => new Date(t.start_date) <= now && new Date(t.end_date) >= now);
        const upcomingTrips = trips.filter(t => new Date(t.start_date) > now).slice(0, 3);

        let contextParts = [];

        if (currentTrips.length > 0) {
            const ongoing = currentTrips.map(t => `${t.destination} (Current, ends ${new Date(t.end_date).toDateString()})`).join(", ");
            contextParts.push(`User is CURRENTLY TRAVELING in: ${ongoing}.`);
        }

        if (upcomingTrips.length > 0) {
            const upcoming = upcomingTrips.map(t => `${t.destination} (Starts ${new Date(t.start_date).toDateString()})`).join(", ");
            contextParts.push(`User has UPCOMING trips to: ${upcoming}.`);
        }

        if (contextParts.length === 0) {
            contextParts.push("User has no active or upcoming trips. Provide general travel inspiration.");
        }

        const context = contextParts.join("\n");

        // --- BEST LOGIC: CONTEXTUAL THEME PRIORITIZATION ---
        let themes = [
            "Gastronomy & Local Flavors (specific restaurants, dishes, street food)",
            "Hidden Gems & Off-Path Secrets (places tourists miss)",
            "Adventure & Active Travel (hikes, viewpoints, activities)",
            "Culture, History & Etiquette (museums, local customs, politeness)",
            "Relaxation & Wellness (parks, spas, quiet spots)",
            "Nightlife & Entertainment (bars, live music, evening walks)",
            "Shopping & Souvenirs (local markets, artisan shops)"
        ];

        let selectedTheme = themes[Math.floor(Math.random() * themes.length)];
        let logicReason = "Providing diverse travel inspiration.";

        // Priority 1: Over-budget check (Urgent)
        if (trips.length > 0) {
            const currentTrip = currentTrips[0] || (upcomingTrips.length > 0 ? upcomingTrips[0] : null);
            if (currentTrip) {
                const tripExpResult = await db.query('SELECT SUM(amount) as total FROM expenses WHERE trip_id = $1', [currentTrip.id]);
                const tripSpent = parseFloat(tripExpResult.rows[0]?.total || 0);
                const tripBudget = parseFloat(currentTrip.budget || 0);

                if (tripBudget > 0 && tripSpent > (tripBudget * 0.8)) {
                    selectedTheme = "Smart Saving & Budget Hacks (How to maximize value under a tight budget)";
                    logicReason = `User is approaching budget limit for ${currentTrip.destination} (${Math.round((tripSpent / tripBudget) * 100)}% spent).`;
                }
                // Priority 2: Pre-departure (Under 3 days)
                else if (new Date(currentTrip.start_date) - now < (3 * 24 * 60 * 60 * 1000) && new Date(currentTrip.start_date) > now) {
                    selectedTheme = "Last-Minute Logistics & Gear (Packing, checklist, arrival essentials)";
                    logicReason = `Trip to ${currentTrip.destination} starts in less than 72 hours.`;
                }
                // Priority 3: Group Travel
                else {
                    const colabsResult = await db.query('SELECT COUNT(*) FROM trip_collaborators WHERE trip_id = $1 AND status = \'accepted\'', [currentTrip.id]);
                    if (parseInt(colabsResult.rows[0].count) > 0) {
                        themes.push("Group Dynamics & Shared Experiences (Tips for traveling together)");
                        if (Math.random() > 0.5) {
                            selectedTheme = "Group Dynamics & Shared Experiences (Split tracking, group dining, compromise)";
                            logicReason = `Shared trip detected for ${currentTrip.destination} with ${colabsResult.rows[0].count} collaborators.`;
                        }
                    }
                }
            }
        }

        console.log(`[AI Logic] Selected Focus: ${selectedTheme} | Reason: ${logicReason}`);

        const prompt = `
        Act as an Advanced Travel AI. Generate Ultra-Personalized Travel Tips.
        
        USER CONTEXT:
        ${context}
        Total Lifetime Travel Spend: ${totalSpent}
        
        LOGIC TRIGGER: **${logicReason}**
        CURRENT FOCUS THEME: **${selectedTheme}**
        
        TASK:
        Generate 10 HIGHLY SPECIFIC and VALUABLE travel tips.
        - LENGTH: **2 concise sentences per tip** (approx 20-30 words).
        - TITLES: Must be clear and descriptive (e.g., "Morning at Chandni Chowk", "Street Food Paradise").
        - STYLE: Informative but direct. No wasted words.
        - NO LONG PARAGRAPHS.
        - FOCUS: "${selectedTheme}".
        - CONTENT: Must include specific names (restaurants, spots, dishes) and *why* to go there.
        
        - FOR ONGOING TRIPS: "Places" & "Food" matching the theme.
        - FOR UPCOMING TRIPS: Practical "Travel" & "Budget" advice relative to those destinations.
        
        - CURRENCY: Use ${preferredCurrency} (${currencySymbol}) for all monetary values. DO NOT use other currency symbols.
        
        REQUIRED JSON SCHEMA (Array of objects):
        {
          "tips": [
            {
              "title": "Clear, descriptive title (3-5 words)",
              "category": "Personalized" | "Travel" | "Budget" | "Places",
              "icon": "plane" | "wallet" | "map-marker-alt" | "cloud-sun" | "lightbulb" | "camera" | "passport",
              "content": "Two sentences of specific advice. Include the 'what' and the 'why'. Ensure prices are in ${currencySymbol} (e.g., ${currencySymbol}500).",
              "tags": ["cityname", "theme"],
              "city": "Name of the destination city"
            }
          ]
        }
        
        - DISTRIBUTION: Provide approx 5 tips per category.
        
        Random Seed: ${Date.now()}
        `;

        // 4. Generate
        let tips = null;

        // Try Groq First
        if (groqApiKey) {
            console.log("Attempting AI generation with Groq...");
            const groqResult = await callGroq(prompt, "You are a JSON API. Output valid JSON only.", 0.9);
            tips = safeJsonParse(groqResult);
            if (tips) console.log("✅ Groq Generation Success");
            else console.warn("❌ Groq Generation Failed (Parse Error or Empty)");
        }

        // Fallback to Gemini if Groq failed or key missing
        if ((!tips || !tips.tips) && geminiApiKey) {
            console.log("Groq failed or key missing, switching to Gemini...");
            const modelsToTry = ["gemini-1.5-flash", "gemini-flash-latest"];

            for (const modelName of modelsToTry) {
                try {
                    const model = genAI.getGenerativeModel({ model: modelName });
                    const result = await model.generateContent(prompt + " \n\nIMPORTANT: Return ONLY valid JSON.");
                    const text = result.response.text();
                    tips = safeJsonParse(text);

                    if (tips && (Array.isArray(tips.tips) || Array.isArray(tips))) {
                        console.log(`✅ Gemini Success with ${modelName}`);
                        break;
                    }
                } catch (e) {
                    console.warn(`Gemini Attempt Failed (${modelName}):`, e.message.split('[')[0]);
                }
            }
        }

        // Normalize & Post-process for Location Integrity
        let finalTips = [];
        if (tips && Array.isArray(tips.tips)) finalTips = tips.tips;
        else if (tips && Array.isArray(tips)) finalTips = tips;

        // CRITICAL: Ensure every tip has a city for distance calculation
        finalTips = finalTips.map(t => {
            if (!t.city) {
                // Try to extract from tags or content as fallback
                const knownCities = ["Delhi", "Mumbai", "Bangalore", "Goa", "Kerala", "Jaipur", "Chennai", "Hyderabad", "Pune", "Paris", "London", "Tokyo", "Rome", "New York", "Dubai"];
                const cityMatch = knownCities.find(city =>
                    (t.tags && t.tags.some(tag => tag.toLowerCase().includes(city.toLowerCase()))) ||
                    (t.content && t.content.toLowerCase().includes(city.toLowerCase()))
                );
                t.city = cityMatch || "Unknown";
            }
            return t;
        });

        if (finalTips.length === 0) {
            console.log('⚠️ AI keys missing or failed. Generating fallback smart tips...');
            finalTips = getFallbackTips(selectedTheme, preferredCurrency, currencySymbol);
        }

        const responseData = {
            tips: finalTips,
            focus: selectedTheme,
            logic_trigger: logicReason
        };
        setCachedData(cacheKey, responseData);
        return res.json(responseData);
    } catch (error) {
        console.error("Smart Tips DB Error:", error.message);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};
const axios = require('axios');

const geminiApiKey = process.env.GEMINI_API_KEY;
const groqApiKey = process.env.GROQ_API_KEY;
const genAI = new GoogleGenerativeAI(geminiApiKey);

// Groq Helper - Faster & Higher Limits than Gemini Free
const callGroq = async (prompt, systemPrompt = "Act as an expert travel assistant. Return only valid JSON.", temperature = 0.1) => {
    if (!groqApiKey) return null;
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: prompt }
            ],
            temperature: temperature,
            response_format: { type: "json_object" }
        }, {
            headers: {
                'Authorization': `Bearer ${groqApiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000 // Increased to 60s
        });
        return response.data.choices[0].message.content;
    } catch (e) {
        console.warn(`Groq Error (${e.response?.status || 'Unknown'}): ${e.message}`);
        return null;
    }
};

// Helper for cleaning and parsing AI JSON responses
const safeJsonParse = (text) => {
    try {
        if (!text) return null;
        const cleanText = text.replace(/```json|```/g, '').trim();
        return JSON.parse(cleanText);
    } catch (e) {
        console.error("AI JSON Parse Error. Raw text:", text);
        return null;
    }
};

// Helper to determine if user has a preference for India
const isIndiaTraveler = (trips) => {
    if (!trips || !Array.isArray(trips)) return false;
    const indiaKeywords = ['india', 'mumbai', 'delhi', 'bangalore', 'goa', 'kerala', 'jaipur', 'chennai', 'hyderabad', 'pune', 'manali', 'leh', 'shimla'];
    return trips.some(t => {
        const dest = t.destination.toLowerCase();
        return indiaKeywords.some(key => dest.includes(key));
    });
};

// Global AI Cache to mitigate 429 Quota Exceeded errors
const aiCache = new Map();
const CACHE_TTL = 3600000; // 1 hour

const getCachedData = (key) => {
    const cached = aiCache.get(key);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        return cached.data;
    }
    return null;
};

const setCachedData = (key, data) => {
    aiCache.set(key, { data, timestamp: Date.now() });
};

const clearUserAICache = (userId) => {
    const keys = Array.from(aiCache.keys());
    keys.forEach(key => {
        if (key.includes(`user_${userId}`)) {
            aiCache.delete(key);
        }
    });
};

// Fallback Mock Cost Generator
const calculateMockCost = (destination, starting_point, days, travelers, style, preferredCurrency, currencySymbol) => {
    let baseDailyRate = 4000; // INR base
    let transRate = 6000;     // INR base
    
    if (style.toLowerCase() === 'economy') {
        baseDailyRate = 1500;
        transRate = 3000;
    } else if (style.toLowerCase() === 'luxury') {
        baseDailyRate = 15000;
        transRate = 20000;
    }
    
    const rates = {
        'INR': 1, 'USD': 0.012, 'EUR': 0.011, 'GBP': 0.0094,
        'JPY': 1.8, 'AUD': 0.018, 'CAD': 0.016, 'CHF': 0.011,
        'CNY': 0.086, 'SGD': 0.016
    };
    const exchange = rates[preferredCurrency] || 1;
    
    const accCost = Math.round(baseDailyRate * 0.45 * days * travelers * exchange);
    const foodCost = Math.round(baseDailyRate * 0.3 * days * travelers * exchange);
    const actCost = Math.round(baseDailyRate * 0.25 * days * travelers * exchange);
    const transportCost = Math.round(transRate * travelers * exchange);
    const totalCost = accCost + foodCost + actCost + transportCost;
    
    const minRange = Math.round(totalCost * 0.85);
    const maxRange = Math.round(totalCost * 1.15);
    
    const dailyPerPerson = Math.round(baseDailyRate * exchange);
    
    return {
        estimated_cost: totalCost,
        estimated_cost_range: `${currencySymbol}${minRange.toLocaleString()} - ${currencySymbol}${maxRange.toLocaleString()}`,
        currency: preferredCurrency,
        transit_time: "approx 6 hours total transit",
        suggested_transport: `Direct flight or express train from ${starting_point || 'origin'} to ${destination}`,
        breakdown: {
            per_day: `${currencySymbol}${dailyPerPerson.toLocaleString()} per person daily excluding transit`,
            accommodation: `${currencySymbol}${accCost.toLocaleString()} (Total for ${days} days)`,
            food: `${currencySymbol}${foodCost.toLocaleString()} (Total for ${days} days)`,
            activities: `${currencySymbol}${actCost.toLocaleString()} (Total for ${days} days)`,
            transport: `${currencySymbol}${transportCost.toLocaleString()} (Total including transit from ${starting_point || 'origin'})`
        },
        logistics: {
            total_hours: "6",
            best_route_type: style.toLowerCase() === 'economy' ? "Train" : "Flight",
            stop_count: "0"
        },
        advice: `A ${style} trip to ${destination} is highly recommended. For ${style} travel, plan to book your transportation and lodging at least 3 weeks in advance. Enjoy local points of interest and regional dining options.`,
        is_possible: true
    };
};

// Fallback Smart Tips Generator
const getFallbackTips = (theme, currency, symbol, destination = "your destination") => {
    return [
        {
            title: "Local Currency Prep",
            category: "Budget",
            icon: "wallet",
            content: `Always keep some local cash handy for small vendors. Use local ATMs for the best exchange rates in ${currency}.`,
            tags: ["budget", "finance"],
            city: "General"
        },
        {
            title: "Peak Travel Safety",
            category: "Travel",
            icon: "passport",
            content: "Keep digital copies of your passport and visa stored securely online. It is helpful to have them accessible from anywhere during your trip.",
            tags: ["safety", "documents"],
            city: "General"
        },
        {
            title: "Public Transit Option",
            category: "Places",
            icon: "map-marker-alt",
            content: `Leverage metro networks or city passes to save on transportation. Taxis can be significantly more expensive.`,
            tags: ["transit", "savings"],
            city: "General"
        },
        {
            title: "Regional Food Explorer",
            category: "Personalized",
            icon: "lightbulb",
            content: "Seek out highly-rated street food stalls or local diner hubs. They offer the most authentic cuisine at unbeatable prices.",
            tags: ["food", "dining"],
            city: "General"
        },
        {
            title: "Free Walking Tours",
            category: "Places",
            icon: "camera",
            content: "Join free local walking tours to get acquainted with the city quickly. They provide great historical insights from local guides.",
            tags: ["sightseeing", "tours"],
            city: "General"
        }
    ];
};

// Fallback Itinerary Generator
const getFallbackItinerary = (destination, currency, symbol, style) => {
    return [
        {
            type: "place",
            title: `Historic Landmarks Tour`,
            location: `Historic District, ${destination}`,
            description: `Visit the iconic heritage monuments and architectural highlights. Learn about local history and take panoramic photos.`,
            cost_estimate: `Free or low-cost entrance`,
            lat: 20.0,
            lng: 70.0
        },
        {
            type: "food",
            title: `Traditional Dining Experience`,
            location: `Old Town Center, ${destination}`,
            description: `Savor the region's signature dishes at a highly recommended local restaurant matching your ${style} preference.`,
            cost_estimate: `${symbol}${style.toLowerCase() === 'luxury' ? '5,000' : '800'} per person`,
            lat: 20.01,
            lng: 70.01
        },
        {
            type: "activity",
            title: `Scenic Nature Walk`,
            location: `Central Park / Botanical Garden, ${destination}`,
            description: `Stroll through lush gardens, enjoy serene lakeside views, and relax away from the busy city streets.`,
            cost_estimate: `Free`,
            lat: 20.02,
            lng: 70.02
        },
        {
            type: "shopping",
            title: `Local Craft & Souvenir Market`,
            location: `Bazaar Street, ${destination}`,
            description: `Shop for authentic handicrafts, spices, textiles, and unique local goods directly from native artisans.`,
            cost_estimate: `Varies`,
            lat: 20.03,
            lng: 70.03
        }
    ];
};

// Fallback Full Day-wise Plan Generator
const getFallbackFullPlan = (destination, starting_point, days, travelers, style, preferredCurrency = 'INR', currencySymbol = '₹') => {
    const destLower = destination.toLowerCase();
    
    // Curated local schedules for popular destinations
    const itineraries = {
        goa: [
            // Day 1
            [
                { time: "09:00", type: "food", title: "Infantaria Cafe", description: "Start your day at this famous Calangute café. Enjoy delicious pancakes, croissants, and Goan sausage rolls.", cost: 350, lat: 15.5436, lng: 73.7624 },
                { time: "11:30", type: "sightseeing", title: "Fort Aguada", description: "Explore the 17th-century Portuguese lighthouse and fort, offering breathtaking panoramic sea views.", cost: 500, lat: 15.4925, lng: 73.7736 },
                { time: "14:30", type: "food", title: "Fisherman's Wharf", description: "Savor premium Goan fish curry and seafood by the riverside with warm traditional hospitality.", cost: 800, lat: 15.5650, lng: 73.7540 },
                { time: "16:30", type: "activity", title: "Calangute Beach Walk", description: "Stroll along Goa's busiest beach, soak in the sun, or try parasailing and jet-skiing.", cost: 1200, lat: 15.5494, lng: 73.7535 },
                { time: "20:00", type: "food", title: "Curlies Beach Shack", description: "Have dinner on the beach at Anjuna with live DJ music and an electric sea breeze.", cost: 1500, lat: 15.5727, lng: 73.7410 }
            ],
            // Day 2
            [
                { time: "09:00", type: "food", title: "Artjuna Cafe", description: "Enjoy a healthy Mediterranean breakfast in a beautiful garden setting in Anjuna.", cost: 400, lat: 15.5800, lng: 73.7432 },
                { time: "11:30", type: "sightseeing", title: "Chapora Fort", description: "Scale the famous 'Dil Chahta Hai' fort ruins, looking down on Vagator Beach.", cost: 0, lat: 15.6068, lng: 73.7360 },
                { time: "14:00", type: "food", title: "Gunpowder Restaurant", description: "Indulge in incredibly flavorful South Indian and fusion coastal dishes.", cost: 750, lat: 15.5975, lng: 73.7552 },
                { time: "16:30", type: "activity", title: "Fontainhas Latin Quarter", description: "Walk through the colorful Portuguese-style houses of Panaji, exploring art galleries.", cost: 100, lat: 15.4950, lng: 73.8180 },
                { time: "20:00", type: "food", title: "Thalassa", description: "Enjoy Greek dining at Vagator cliffs with a magnificent sunset view and fire dances.", cost: 2500, lat: 15.6022, lng: 73.7335 }
            ],
            // Day 3
            [
                { time: "09:00", type: "food", title: "Baba Au Rhum", description: "Relish fresh wood-fired pizzas and gourmet croissants at this lush green forest bakery.", cost: 450, lat: 15.5845, lng: 73.7570 },
                { time: "11:30", type: "sightseeing", title: "Basilica of Bom Jesus", description: "Visit the UNESCO World Heritage site in Old Goa holding the remains of St. Francis Xavier.", cost: 0, lat: 15.5009, lng: 73.9116 },
                { time: "14:00", type: "food", title: "Mum's Kitchen", description: "A famous Panaji culinary spot serving highly authentic Goan Hindu and Christian home recipes.", cost: 900, lat: 15.4988, lng: 73.8055 },
                { time: "16:30", type: "activity", title: "Mandovi River Cruise", description: "Enjoy a scenic sunset cruise with traditional Goan folk dances and music.", cost: 500, lat: 15.5020, lng: 73.8290 },
                { time: "20:00", type: "food", title: "Martin's Corner", description: "Dine at the legendary South Goa restaurant known for its seafood and frequent celebrity visits.", cost: 1800, lat: 15.3162, lng: 73.9100 }
            ],
            // Day 4
            [
                { time: "09:00", type: "food", title: "Eva Cafe", description: "A picturesque sea-facing café on Anjuna beach, perfect for morning shakshuka.", cost: 500, lat: 15.5815, lng: 73.7420 },
                { time: "11:00", type: "activity", title: "Dudhsagar Falls Trek", description: "Witness the magnificent four-tiered 'sea of milk' waterfall on the Mandovi river.", cost: 1500, lat: 15.3144, lng: 74.3142 },
                { time: "14:30", type: "food", title: "Spice Plantation Buffet", description: "Enjoy a traditional Goan buffet served on a banana leaf at a local spice farm.", cost: 600, lat: 15.4330, lng: 74.0250 },
                { time: "17:00", type: "sightseeing", title: "Mangueshi Temple", description: "Visit the stunning 450-year-old temple dedicated to Lord Manguesh, an incarnation of Shiva.", cost: 0, lat: 15.4438, lng: 73.9680 },
                { time: "20:00", type: "food", title: "Zeebop by the Sea", description: "A beautiful beachfront restaurant in Utorda serving fresh local catches under the stars.", cost: 1600, lat: 15.3340, lng: 73.8965 }
            ]
        ],
        paris: [
            // Day 1
            [
                { time: "09:00", type: "food", title: "Café de Flore", description: "A famous historic cafe in Saint-Germain-des-Prés, perfect for hot chocolate and croissants.", cost: 850, lat: 48.8542, lng: 2.3300 },
                { time: "11:00", type: "sightseeing", title: "Eiffel Tower", description: "Behold the globally iconic monument of Paris, offering stunning panoramas from the summit.", cost: 2200, lat: 48.8584, lng: 2.2945 },
                { time: "14:00", type: "food", title: "Le Relais de l'Entrecôte", description: "Experience their legendary single-menu steak frites with secret herb green sauce.", cost: 3000, lat: 48.8690, lng: 2.3025 },
                { time: "16:30", type: "activity", title: "Seine River Cruise", description: "Stroll or cruise along the historic banks of the Seine, observing the city's architectural monuments.", cost: 1500, lat: 48.8615, lng: 2.3250 },
                { time: "20:00", type: "food", title: "Chez L'Ami Jean", description: "Dine at this highly rated traditional bistro serving hearty, classic Basque-inspired dishes.", cost: 6500, lat: 48.8585, lng: 2.3075 }
            ],
            // Day 2
            [
                { time: "09:00", type: "food", title: "Angelina Paris", description: "Indulge in their world-famous thick hot chocolate and signature Mont-Blanc pastry.", cost: 1200, lat: 48.8650, lng: 2.3275 },
                { time: "10:30", type: "sightseeing", title: "Louvre Museum", description: "Visit the world's largest art museum, home to the Mona Lisa and Venus de Milo.", cost: 2000, lat: 48.8606, lng: 2.3376 },
                { time: "14:00", type: "food", title: "Bistrot Paul Bert", description: "A quintessential Paris bistro serving legendary steak frites and grand soufflés.", cost: 4000, lat: 48.8510, lng: 2.3830 },
                { time: "16:30", type: "activity", title: "Walk through Montmartre", description: "Explore the bohemian artists quarter, walking up to the Sacré-Cœur Basilica.", cost: 0, lat: 48.8867, lng: 2.3431 },
                { time: "20:00", type: "food", title: "Le Train Bleu", description: "A magnificent Belle Époque restaurant in Gare de Lyon station, serving high French cuisine.", cost: 8000, lat: 48.8448, lng: 2.3735 }
            ]
        ]
    };
    
    // Choose list based on destination
    let chosenItinerary = null;
    for (const key in itineraries) {
        if (destLower.includes(key)) {
            chosenItinerary = itineraries[key];
            break;
        }
    }
    
    const daysArray = [];
    
    for (let d = 1; d <= days; d++) {
        let dailyActivities = [];
        if (chosenItinerary) {
            // Get itinerary for the day (modulo if days exceeds array length)
            const idx = (d - 1) % chosenItinerary.length;
            dailyActivities = JSON.parse(JSON.stringify(chosenItinerary[idx])); // Deep copy
        } else {
            // Generate generic dynamic itinerary to avoid repetition
            dailyActivities = [
                {
                    time: "09:00",
                    type: "food",
                    title: `Day ${d} Breakfast Spot`,
                    description: `Enjoy a delicious morning breakfast at a popular local café in ${destination}.`,
                    cost: 350,
                    lat: 20.0 + (d * 0.01),
                    lng: 70.0 - (d * 0.01)
                },
                {
                    time: "11:30",
                    type: "sightseeing",
                    title: `Day ${d} Famous Landmark`,
                    description: `Visit one of the key heritage highlights and cultural landmarks of ${destination}.`,
                    cost: 500,
                    lat: 20.01 + (d * 0.01),
                    lng: 70.01 - (d * 0.01)
                },
                {
                    time: "14:00",
                    type: "food",
                    title: `Day ${d} Local Diner`,
                    description: `Stop for a traditional lunch featuring regional specialties and fresh ingredients.`,
                    cost: 700,
                    lat: 20.02 + (d * 0.01),
                    lng: 70.02 - (d * 0.01)
                },
                {
                    time: "16:30",
                    type: "activity",
                    title: `Day ${d} Scenic Experience`,
                    description: `Enjoy a scenic tour, outdoor walk, or engaging local workshop to experience the city.`,
                    cost: 1000,
                    lat: 20.03 + (d * 0.01),
                    lng: 70.03 - (d * 0.01)
                },
                {
                    time: "20:00",
                    type: "food",
                    title: `Day ${d} Dinner Shack`,
                    description: `End the day with a fantastic dinner matching your preferred ${style} standard.`,
                    cost: 1500,
                    lat: 20.04 + (d * 0.01),
                    lng: 70.04 - (d * 0.01)
                }
            ];
        }
        
        // Scale costs according to budget style and currency exchange
        const rates = {
            'INR': 1, 'USD': 0.012, 'EUR': 0.011, 'GBP': 0.0094,
            'JPY': 1.8, 'AUD': 0.018, 'CAD': 0.016, 'CHF': 0.011,
            'CNY': 0.086, 'SGD': 0.016
        };
        const exchange = rates[preferredCurrency] || 1;
        
        let multiplier = 1;
        if (style.toLowerCase() === 'economy') multiplier = 0.5;
        else if (style.toLowerCase() === 'luxury') multiplier = 4;
        
        dailyActivities = dailyActivities.map(act => {
            const finalCost = Math.round(act.cost * multiplier * exchange);
            return {
                ...act,
                cost: finalCost
            };
        });
        
        daysArray.push({
            day: d,
            city: destination,
            locality: chosenItinerary ? "Selected District" : "Downtown / Central Area",
            activities: dailyActivities
        });
    }
    
    return { days: daysArray };
};

// AI Cost Prediction
const predictTripCost = async (req, res) => {
    console.log('💰 AI Cost Prediction Request received for:', req.body.destination);
    try {
        const { destination, starting_point, days, travelers, style, budget } = req.body;
        const userId = req.user.id;

        const userResult = await db.query('SELECT preferred_currency FROM users WHERE id = $1', [userId]);
        const preferredCurrency = userResult.rows[0]?.preferred_currency || 'INR';

        const currencies = {
            'INR': '₹', 'USD': '$', 'EUR': '€', 'GBP': '£',
            'JPY': '¥', 'AUD': 'A$', 'CAD': 'C$', 'CHF': 'Fr',
            'CNY': '¥', 'SGD': 'S$'
        };
        const currencySymbol = currencies[preferredCurrency] || '₹';

        // Budget Analysis for "Too Low" Warning
        let lowBudgetWarning = null;
        if (budget && days > 0 && travelers > 0) {
            const perPersonPerDay = (budget / travelers) / days;
            const lowMin = preferredCurrency === 'INR' ? 800 : 10;
            if (perPersonPerDay < lowMin) {
                lowBudgetWarning = `Note: A budget of ${currencySymbol}${Math.round(perPersonPerDay)}/day in ${destination} is exceptionally low. While we are creating your trip to help you track expenses, please be aware this might not cover basic daily needs in this location.`;
            }
        }

        const prompt = `
        TASK: EXPLICIT COST & LOGISTICS PREDICTION FOR A ${destination.toUpperCase()} TRIP
        STARTING POINT: ${starting_point || 'Not specified (assume major hub)'}
        ROUTE: ${destination} (Note: If multiple destinations are shown with arrows like 'A → B → C', plan as a multi-city circuit).
        PARAMETERS: ${days} days, ${travelers} travelers.
        MANDATORY STYLE: ${style} (CRITICAL: Every cost MUST reflect a ${style} standard of living).
        
        TRANSPORTATION REQUIREMENT:
        - Analyze the route from ${starting_point || 'origin'} to ${destination}.
        - Estimate costs for FLIGHTS (if dist > 500km) or TRAINS (if dist < 500km or for scenic routes).
        - For multi-destination trips (e.g. Delhi → Jaipur → Udaipur), include inter-city transport.
        - Predict roughly the travel time (total hours spent in transit).
        
        STRICT COST RATIOS FOR ${style}:
        - If Economy: Hostels, street food, trains (Sleeper/3AC), and free public hubs.
        - If Balanced: 3/4-star hotels, mix of dining, flights (Economy) or trains (2AC/1AC).
        - If Luxury: 5-star resorts, fine dining, flights (Business/First) and private chauffeurs.
        
        USER BUDGET REFERENCE: ${currencySymbol}${budget || 'Not specified'}.
        
        REQUIRED JSON SCHEMA:
        {
            "estimated_cost": 50000,
            "estimated_cost_range": "${currencySymbol}X - ${currencySymbol}Y",
            "currency": "${preferredCurrency}",
            "transit_time": "approx X hours total transit",
            "suggested_transport": "e.g. Flight to Delhi, then AC Train circuit",
            "breakdown": {
                "per_day": "per person daily excluding transit",
                "accommodation": "Total for ${days} days",
                "food": "Total for ${days} days",
                "activities": "Total for ${days} days",
                "transport": "Total including inter-city transit from ${starting_point || 'origin'}"
            },
            "logistics": {
                "total_hours": "Approx hours in transit",
                "best_route_type": "Flight/Train/Bus/Self-Drive",
                "stop_count": "Number of stops detected"
            },
            "advice": "3-4 sentence expert travel pathing advice for ${destination}. Mention specific local tips for ${style} style.",
            "is_possible": true
        }
        `;

        let data = null;

        // 4. Generate
        if (groqApiKey) {
            const groqResult = await callGroq(prompt, "Return strictly valid JSON.", 0.5);
            data = safeJsonParse(groqResult);
        }

        // Fallback to Gemini
        if (!data && geminiApiKey) {
            const modelsToTry = ["gemini-1.5-flash", "gemini-flash-latest"];
            for (const modelName of modelsToTry) {
                try {
                    const model = genAI.getGenerativeModel({ model: modelName });
                    const result = await model.generateContent(prompt + " Return only valid JSON.");
                    data = safeJsonParse(result.response.text());
                    if (data) break;
                } catch (e) {
                    console.warn(`Gemini Cost Fallback Failed (${modelName})`);
                }
            }
        }

        if (!data) {
            console.log('⚠️ AI keys missing or failed. Generating realistic mock cost prediction...');
            data = calculateMockCost(destination, starting_point, days, travelers, style, preferredCurrency, currencySymbol);
        }

        if (lowBudgetWarning) data.warning = lowBudgetWarning;
        return res.json(data);
    } catch (error) {
        console.error('AI Cost Error:', error.message);
        res.status(500).json({ message: 'AI service currently busy. Please try again in a moment.' });
    }
};

// Smart Travel Tips - Master Intelligence Flow (DB-Aware) - Moved to top
// ... (Already updated in previous step)


// Premium Feature: Perfect Places & Expense Auditor
const getTripAudit = async (req, res) => {
    try {
        const { destination, totalSpent, duration, style, refresh } = req.query;
        const userId = req.user.id;

        const userResult = await db.query('SELECT preferred_currency FROM users WHERE id = $1', [userId]);
        const preferredCurrency = userResult.rows[0]?.preferred_currency || 'INR';

        const currencies = {
            'INR': '₹', 'USD': '$', 'EUR': '€', 'GBP': '£',
            'JPY': '¥', 'AUD': 'A$', 'CAD': 'C$', 'CHF': 'Fr',
            'CNY': '¥', 'SGD': 'S$'
        };
        const currencySymbol = currencies[preferredCurrency] || '₹';

        const cacheKey = `audit_${destination}_${totalSpent}_${duration}_${style}`;

        if (refresh !== 'true') {
            const cached = getCachedData(cacheKey);
            if (cached) return res.json(cached);
        }

        if (!groqApiKey && !geminiApiKey) return res.status(503).json({ message: 'AI Service Offline' });

        const prompt = `
        Audit trip: ${destination}, ${duration} days, ${style} style, spent ${currencySymbol}${totalSpent}.
        
        REQUIRED JSON SCHEMA:
        {
            "perfect_places": [
                {
                    "name": "Place Name",
                    "description": "Why it fits the style",
                    "activity_type": "Sightseeing/Adventure/Food"
                }
            ],
            "budget_audit": {
                "status": "On Track" | "Warning" | "Critical",
                "analysis": "Brief analysis of spending vs average. Use ${currencySymbol} for all currency mentions.",
                "top_saving_tip": "One actionable saving tip using ${currencySymbol}."
            }
        }
        `;

        // 1. Try Groq (Primary)
        if (groqApiKey) {
            const groqResult = await callGroq(prompt, "Act as a travel expert. Return valid JSON only.", 0.7);
            const groqData = safeJsonParse(groqResult);
            if (groqData && groqData.perfect_places) {
                setCachedData(cacheKey, groqData);
                return res.json(groqData);
            }
        }

        // 2. Fallback to Gemini
        if (geminiApiKey) {
            const modelsToTry = ["gemini-1.5-flash", "gemini-flash-latest", "gemini-pro"];
            for (const modelName of modelsToTry) {
                try {
                    const model = genAI.getGenerativeModel({ model: modelName });
                    const result = await model.generateContent(prompt + " No markdown. JSON only.");
                    const data = safeJsonParse(result.response.text());
                    if (data) {
                        setCachedData(cacheKey, data);
                        return res.json(data);
                    }
                } catch (e) {
                    console.warn(`Audit Fallback triggered for ${modelName}: ${e.message}`);
                }
            }
        }

        res.json({ perfect_places: [], budget_audit: { status: 'Service Limited', analysis: 'AI is currently busy due to high demand. Showing cached patterns if available.' } });
    } catch (err) {
        console.error('Audit Logic Error:', err);
        res.status(500).json({ status: 'error' });
    }
};

// Seasonal Suggestions
const getSeasonSuggestions = async (req, res) => {
    try {
        const { destination } = req.query;
        const prompt = `Best time to visit ${destination}. Return valid JSON only: {"destination": "${destination}", "best_time": "...", "reason": "...", "events": ["..."]}`;

        if (groqApiKey) {
            const groqResult = await callGroq(prompt);
            const data = safeJsonParse(groqResult);
            if (data) return res.json(data);
        }

        if (geminiApiKey) {
            const modelsToTry = ["gemini-1.5-flash", "gemini-flash-latest", "gemini-pro"];
            for (const modelName of modelsToTry) {
                try {
                    const model = genAI.getGenerativeModel({ model: modelName });
                    const result = await model.generateContent(prompt + " No markdown. JSON only.");
                    const data = safeJsonParse(result.response.text());
                    if (data) return res.json(data);
                } catch (e) {
                    console.warn(`Season AI Fallback failed for ${modelName}`);
                }
            }
        }

        throw new Error("AI failed");
    } catch (error) {
        console.error("Season AI failed:", error.message);
        res.status(503).json(null);
    }
};

// Climate-based Destination Recommendations
const getClimateRecommendations = async (req, res) => {
    try {
        const { isIndia: isIndiaParam, refresh } = req.query;
        const isIndia = isIndiaParam === 'true';

        console.log(`Getting Climate Recs. Refresh: ${refresh}, isIndia: ${isIndia}`);

        const month = new Date().toLocaleString('default', { month: 'long' });
        const cacheKey = `recs_${isIndia}_${month}`;

        if (refresh !== 'true') {
            const cached = getCachedData(cacheKey);
            if (cached) {
                console.log('Serving CACHED climate recs');
                return res.json(cached);
            }
        } else {
            console.log('Refresh requested. Bypassing cache for Climate Recs.');
        }

        if (!groqApiKey && !geminiApiKey) return res.json([]);

        let destinationContext = isIndia ? 'Top 5 destinations LOCATED IN INDIA' : 'Top 5 Global destinations';
        const prompt = `
        Recommend 5 DIVERSE and UNIQUE destinations for: ${month} (${isIndia ? 'India Only' : 'Global'}).
        Based on perfect weather/climate.
        IMPORTANT: Vary the recommendations significantly. Do not always stick to the most obvious capitals. Mix hidden gems with popular spots.
        Random Seed: ${Date.now()}
        
        REQUIRED JSON SCHEMA:
        {
            "recommendations": [
                {
                    "name": "City, Country",
                    "climate": "e.g. Sunny 25°C",
                    "reason": "Why it's great now",
                    "budget_level": "Budget" | "Mid" | "Luxury"
                }
            ]
        }
        `;

        // 1. Try Groq (Primary) - Use high temp for variety
        const groqResult = await callGroq(prompt, "Act as a travel expert. Return valid JSON only.", 0.9);
        const groqData = safeJsonParse(groqResult);
        if (groqData && groqData.recommendations) {
            setCachedData(cacheKey, groqData.recommendations);
            return res.json(groqData.recommendations);
        }

        // 2. Try Gemini (Fallback)
        const modelsToTry = ["gemini-2.0-flash", "gemini-flash-latest"];
        for (const modelName of modelsToTry) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName }, { apiVersion: 'v1beta' });
                const result = await model.generateContent(prompt + " Only JSON.");
                const data = safeJsonParse(result.response.text());
                const finalRecs = data?.recommendations || data;
                if (finalRecs && Array.isArray(finalRecs)) {
                    setCachedData(cacheKey, finalRecs);
                    return res.json(finalRecs);
                }
            } catch (e) {
                console.warn(`AI Recs Warning (${modelName}): ${e.message}`);
                // If it's a safety error or quota error, we want to know why
                if (e.message.includes('429')) console.log('Advice: You have hit the Gemini Free Tier rate limit. Wait 1 minute.');
            }
        }
        throw new Error("AI Recs Failed");
    } catch (error) {
        res.json([]);
    }
};

// Real-time Weather Prediction/Fetching
const getDestinationWeather = async (req, res) => {
    try {
        const { destination } = req.query;
        const apiKey = process.env.OPENWEATHER_API_KEY;

        if (!apiKey) {
            return res.status(500).json({ message: 'Weather API key missing' });
        }

        if (!destination || destination.trim() === '' || destination.toLowerCase() === 'undefined') {
            return res.json({ temp: '--', main: 'Unknown', description: 'No destination set', icon: '01d', humidity: '--', wind: '--' });
        }

        // Clean destination: Take everything before the first delimiter (comma or arrow)
        let cleanDest = destination.split(/[,\u2192]/)[0].trim();

        // Remove common suffixes that confuse OWM
        const suffixes = [/ trip$/i, / journey$/i, / trek$/i, / visit$/i, / vacation$/i, / tour$/i, / hill$/i, / fort$/i];
        suffixes.forEach(s => { cleanDest = cleanDest.replace(s, '').trim(); });

        const fetchWeatherData = async (city) => {
            const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&units=metric&appid=${apiKey}`;
            const response = await axios.get(weatherUrl);
            const data = response.data;
            return {
                temp: Math.round(data.main.temp),
                main: data.weather[0].main,
                description: data.weather[0].description,
                icon: data.weather[0].icon,
                humidity: data.main.humidity,
                wind: data.wind.speed
            };
        };

        try {
            const weatherData = await fetchWeatherData(cleanDest);
            return res.json(weatherData);
        } catch (err) {
            // Handle City Not Found (404) with AI Fallback
            if (err.response && err.response.status === 404) {
                // Manual Mapping for common trekking/remote spots (Priority Fallback)
                const manualMap = {
                    'harishchandragad': 'Ahmednagar',
                    'kalsubai': 'Igatpuri',
                    'rajmachi': 'Lonavala',
                    'sinhagad': 'Pune',
                    'lohagad': 'Lonavala',
                    'torna': 'Pune',
                    'raigad': 'Mahad'
                };

                const mappedCity = manualMap[cleanDest.toLowerCase()];

                try {
                    let resolvedCity = mappedCity;

                    if (!resolvedCity && (groqApiKey || geminiApiKey)) {
                        const aiPrompt = `
                        Find nearest major city with a weather station for: "${destination}" (Landmark/Trek/Remote).
                        REQUIRED JSON SCHEMA: {"city": "City Name"}
                        `;

                        // 1. Try Groq (Fast)
                        const groqRes = await callGroq(aiPrompt);
                        const groqData = safeJsonParse(groqRes);
                        resolvedCity = groqData?.city;

                        // 2. Try Gemini (Fallback)
                        if (!resolvedCity && geminiApiKey) {
                            const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });
                            const result = await model.generateContent(aiPrompt + " Only JSON.");
                            const geminiData = safeJsonParse(result.response.text());
                            resolvedCity = geminiData?.city || result.response.text().replace(/[^a-zA-Z\s]/g, '').trim();
                        }
                    }

                    if (resolvedCity && resolvedCity.toLowerCase() !== cleanDest.toLowerCase()) {
                        console.log(`Weather Resolve: "${cleanDest}" -> "${resolvedCity}"`);
                        const weatherData = await fetchWeatherData(resolvedCity);
                        return res.json({
                            ...weatherData,
                            description: `${weatherData.description} (near ${cleanDest})`
                        });
                    }
                } catch (fallbackErr) {
                    console.warn(`Weather Fallback failed for "${cleanDest}": ${fallbackErr.message}`);
                }
            }

            // Silently handle city not found or API errors, return a placeholder
            if (err.response && err.response.status === 404) {
                // Less verbose log for 404
                console.warn(`Weather not found for "${cleanDest}"`);
            } else {
                console.error(`Weather API Error for "${cleanDest}":`, err.message);
            }

            res.json({
                temp: '--',
                main: 'N/A',
                description: 'Weather unavailable',
                icon: '50d',
                humidity: '--',
                wind: '--'
            });
        }
    } catch (error) {
        console.error('Weather logic error:', error.message);
        res.status(500).json({ message: 'Internal weather logic error' });
    }
};

// Smart Itinerary Generation
const generateTripItinerary = async (req, res) => {
    try {
        const { destination, days, travelers, style, count } = req.body;
        const requestedCount = Math.min(count || 15, 15);
        const userId = req.user.id;

        const userResult = await db.query('SELECT preferred_currency FROM users WHERE id = $1', [userId]);
        const preferredCurrency = userResult.rows[0]?.preferred_currency || 'INR';

        const currencies = {
            'INR': '₹', 'USD': '$', 'EUR': '€', 'GBP': '£',
            'JPY': '¥', 'AUD': 'A$', 'CAD': 'C$', 'CHF': 'Fr',
            'CNY': '¥', 'SGD': 'S$'
        };
        const currencySymbol = currencies[preferredCurrency] || '₹';

        const prompt = `
        Plan a world-class ${days}-day trip itinerary for ${destination}.
        Travelers: ${travelers || 'Default'}, Style: ${style || 'Balanced'}.
        
        Provide ${requestedCount} HIGHLY DIVERSE and UNIQUE recommendations. 
        MANDATORY: You must cover all these categories extensively:
        - "sightseeing": Historical sites, monuments, architectural wonders.
        - "food": Restaurants, cafes, must-try local street food, breakfast spots, dinner with views.
        - "activity": Parks, adventure, interactive classes, local experiences.
        - "shopping": Markets, malls, artisan boutiques, hidden local alleys.
        
        REQUIRED JSON SCHEMA:
        {
            "recommendations": [
                {
                    "type": "place|food|activity|shopping",
                    "title": "Specific Name (e.g. Amber Fort)",
                    "location": "Neighborhood or Landmark, ${destination}",
                    "description": "Engaging 2-sentence description about why someone should go there.",
                    "cost_estimate": "Estimated price in ${preferredCurrency} (${currencySymbol})",
                    "lat": 26.9855,
                    "lng": 75.8513
                }
            ]
        }
        
        Return ONLY valid JSON. Focus on variety and premium quality.
        `;

        if (groqApiKey) {
            const groqRes = await callGroq(prompt, "Return valid JSON only.", 0.8);
            const data = safeJsonParse(groqRes);
            if (data && data.recommendations) {
                console.log(`[AI Itinerary] Success with Groq: ${data.recommendations.length} items`);
                return res.json(data);
            }
        }

        if (geminiApiKey) {
            try {
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                const result = await model.generateContent(prompt + " Return only valid JSON.");
                const data = safeJsonParse(result.response.text());
                if (data && data.recommendations) {
                    console.log(`[AI Itinerary] Success with Gemini: ${data.recommendations.length} items`);
                    return res.json(data);
                }
            } catch (e) {
                console.warn("Gemini Itinerary Generation Failed:", e.message);
            }
        }

        console.log('⚠️ AI keys missing or failed. Generating fallback itinerary recommendations...');
        const fallbackData = {
            recommendations: getFallbackItinerary(destination, preferredCurrency, currencySymbol, style)
        };
        return res.json(fallbackData);
    } catch (error) {
        console.error("Itinerary Gen Error:", error.message);
        res.status(500).json({ message: "Internal server error during recommendation generation." });
    }
};

// Full Day-Wise Plan Generation (High Intelligence)
const generateFullPlan = async (req, res) => {
    try {
        const { destination, starting_point, days, travelers, style } = req.body;
        const userId = req.user.id;

        const userResult = await db.query('SELECT preferred_currency FROM users WHERE id = $1', [userId]);
        const preferredCurrency = userResult.rows[0]?.preferred_currency || 'INR';

        const currencies = {
            'INR': '₹', 'USD': '$', 'EUR': '€', 'GBP': '£',
            'JPY': '¥', 'AUD': 'A$', 'CAD': 'C$', 'CHF': 'Fr',
            'CNY': '¥', 'SGD': 'S$'
        };
        const currencySymbol = currencies[preferredCurrency] || '₹';

        const prompt = `
        Act as an Elite Travel Planner. Create a HIGHLY INTELLIGENT, day-by-day itinerary for ${destination.toUpperCase()}.
        STARTING POINT: ${starting_point || 'Nearest major hub'}
        Trip Details: ${days} days, ${travelers} travelers, ${style} style.

        PLANNING PRINCIPLES (CRITICAL):
        1. MULTI-DESTINATION HANDLING: If destination is a route (e.g. A → B → C), allocate days proportionately (e.g. Day 1-2 in A, Day 3 in B, etc.).
        2. CITY TRANSITIONS: On transition days, include a "transport" type activity (e.g., "08:00 Flight to Jaipur" or "09:00 AC Train to Udaipur") with estimated costs.
        3. REALISTIC DURATIONS: Do NOT pack too much. A hike (like Chandrashila or Triund) takes 6-8 hours; it should be the MAIN activity of that day. 
        4. GEOGRAPHICAL CLUSTERING: Activities within a city must be close to each other.
        5. LOGICAL FLOW: Every day must start with Breakfast and end with Dinner/Nightlife.
        6. REALISM: Use realistic coordinates (lat/lng) and costs in ${preferredCurrency} (${currencySymbol}).

        REQUIRED JSON SCHEMA:
        {
            "days": [
                {
                    "day": 1,
                    "city": "Current City Name",
                    "locality": "Name of the neighborhood/district",
                    "activities": [
                        {
                            "time": "09:00",
                            "type": "food|sightseeing|activity|shopping|transport",
                            "title": "Specific Place Name or Travel Mode",
                            "description": "Engaging description including duration and wait times if applicable.",
                            "cost": 500,
                            "lat": 26.9855,
                            "lng": 75.8513
                        }
                    ]
                }
            ]
        }

        - Total activities: Plan 3-5 high-quality activities per day. 
        - Hiking/Exploration duration: Ensure that if a major activity is chosen, it occupies the bulk of the day's schedule.
        - Style Matching: Ensure the "cost" and "title" match the ${style} style.
        - Local Accuracy: Ensure coordinates are reasonably accurate for ${destination}.
        - LANGUAGE: Return ONLY valid JSON.
        `;

        let data = null;

        // Try Groq (Smartest & Fastest)
        if (groqApiKey) {
            const groqRes = await callGroq(prompt, "You are a Master Travel Planner. Return valid JSON only.", 0.7);
            data = safeJsonParse(groqRes);
        }

        // Fallback to Gemini
        if (!data && geminiApiKey) {
            try {
                const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                const result = await model.generateContent(prompt + " Only JSON.");
                data = safeJsonParse(result.response.text());
            } catch (e) {
                console.warn("Gemini Full Plan Generation Failed:", e.message);
            }
        }

        if (!data || !data.days) {
            console.log('⚠️ AI keys missing or failed. Generating fallback full day-wise plan...');
            data = getFallbackFullPlan(destination, starting_point, days, travelers, style, preferredCurrency, currencySymbol);
        }

        console.log(`[AI Full Plan] Created ${data.days.length} day plan for ${destination}`);
        return res.json(data);
    } catch (error) {
        console.error("Full Plan Error:", error.message);
        res.status(500).json({ message: "Internal server error." });
    }
};

const saveAITip = async (req, res) => {
    try {
        const { title, category, content, icon, tags, city } = req.body;
        const userId = req.user.id;
        console.log(`[saveAITip] Saving tip for user ${userId}:`, { title, category });

        const result = await db.query(
            `INSERT INTO saved_ai_tips (user_id, title, category, content, icon, tags, city) 
             VALUES ($1, $2, $3, $4, $5, $6, $7) 
             ON CONFLICT (user_id, title) DO NOTHING 
             RETURNING *`,
            [userId, title, category, content, icon, tags, city]
        );

        console.log(`[saveAITip] Success:`, result.rowCount > 0 ? 'Inserted' : 'Already exists');
        res.json({ success: true, tip: result.rows[0] });
    } catch (error) {
        console.error("Save Tip Error:", error.message);
        res.status(500).json({ message: "Server Error" });
    }
};

const getSavedAITips = async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await db.query(
            "SELECT * FROM saved_ai_tips WHERE user_id = $1 ORDER BY created_at DESC",
            [userId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error("Get Saved Tips Error:", error.message);
        res.status(500).json({ message: "Server Error" });
    }
};

const removeSavedAITip = async (req, res) => {
    try {
        const { title } = req.body;
        const userId = req.user.id;
        await db.query(
            "DELETE FROM saved_ai_tips WHERE user_id = $1 AND title = $2",
            [userId, title]
        );
        res.json({ success: true });
    } catch (error) {
        console.error("Remove Tip Error:", error.message);
        res.status(500).json({ message: "Server Error" });
    }
};

const optimizeSchedule = async (req, res) => {
    try {
        const { activities } = req.body;

        if (!activities || activities.length === 0) {
            return res.json({ schedule: [] });
        }

        const prompt = `
        You are an expert travel itinerary optimizer. Given a list of activities for a single day, assign the most logical start times.
        
        Activities: ${JSON.stringify(activities)}
        
        TIME ASSIGNMENT RULES (STRICT):
        - Sunrise/Early Morning spots: 06:00 - 07:30
        - Breakfast: 08:00 - 09:30
        - Morning Sightseeing/Activities: 10:00 - 12:30
        - Lunch: 13:00 - 14:30
        - Afternoon Activities/Shopping: 15:00 - 17:00
        - Sunset Spots: 17:30 - 19:00 (MANDATORY for titles containing "Sunset")
        - Dinner: 19:30 - 21:00
        - Nightlife/Shows/Evening Walks: 21:30 - 23:00
        
        FLOW LOGIC:
        - If a title contains "Sunset", it MUST be scheduled between 17:30 and 19:00.
        - If a title contains "Breakfast", it MUST be in the morning.
        - If multiple activities exist, space them at least 1-2 hours apart.
        
        Return ONLY valid JSON:
        {
            "schedule": [
                {"id": "activity_id", "time": "HH:MM"}
            ]
        }
        `;

        if (groqApiKey) {
            const groqRes = await callGroq(prompt, "Return only valid JSON.", 0.7);
            const data = safeJsonParse(groqRes);
            if (data && data.schedule) {
                console.log(`[AI Schedule] Optimized ${data.schedule.length} activities`);
                return res.json(data);
            }
        }

        if (geminiApiKey) {
            const models = ["gemini-1.5-flash", "gemini-pro"];
            for (const modelName of models) {
                try {
                    const model = genAI.getGenerativeModel({ model: modelName });
                    const result = await model.generateContent(prompt + " Return only valid JSON.");
                    const data = safeJsonParse(result.response.text());
                    if (data && data.schedule) {
                        console.log(`[AI Schedule] Optimized ${data.schedule.length} activities via ${modelName}`);
                        return res.json(data);
                    }
                } catch (e) { console.warn(`Gemini Schedule Failed (${modelName})`); }
            }
        }

        // Fallback: Simple rule-based scheduling
        const schedule = [];
        let currentTime = 9 * 60; // 9:00 AM in minutes

        for (const activity of activities) {
            const type = (activity.type || '').toLowerCase();
            const title = (activity.title || '').toLowerCase();

            // Keyword-based time override (Fallback Logic)
            if (title.includes('sunrise')) {
                currentTime = 6 * 60; // 6:00 AM
            } else if (title.includes('breakfast')) {
                currentTime = 8 * 60; // 8:00 AM
            } else if (title.includes('lunch')) {
                currentTime = 13 * 60; // 1:00 PM
            } else if (title.includes('sunset')) {
                currentTime = 17 * 60 + 45; // 5:45 PM
            } else if (title.includes('dinner')) {
                currentTime = 20 * 60; // 8:00 PM
            } else if (type === 'hotel') {
                currentTime = 15 * 60; // 3:00 PM
            }

            const hours = Math.floor(currentTime / 60);
            const minutes = currentTime % 60;
            const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

            schedule.push({ id: activity.id, time: timeStr });

            // Space next activity
            if (title.includes('dinner')) currentTime += 0; // End of day
            else if (type === 'food' || title.includes('breakfast')) currentTime += 90;
            else currentTime += 120;
        }

        res.json({ schedule });
    } catch (error) {
        console.error('Optimize Schedule Error:', error.message);
        res.status(500).json({ message: 'Internal Schedule Error' });
    }
};

// Voice Command Handler (Placeholder - feature pending implementation)
const processVoiceCommand = async (req, res) => {
    try {
        const { command } = req.body;
        if (!command) return res.status(400).json({ message: 'No voice command provided' });

        // Placeholder response until voice AI is implemented
        return res.status(501).json({ message: 'Voice command processing is coming soon.', received: command });
    } catch (error) {
        console.error('Voice Command Error:', error.message);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

module.exports = {
    getSmartTips,
    predictTripCost,
    getTripAudit,
    getSeasonSuggestions,
    getClimateRecommendations,
    getDestinationWeather,
    generateTripItinerary,
    generateFullPlan,
    saveAITip,
    getSavedAITips,
    removeSavedAITip,
    clearUserAICache,
    optimizeSchedule,
    processVoiceCommand
};
