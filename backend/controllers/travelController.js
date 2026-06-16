const Amadeus = require('amadeus');
const dotenv = require('dotenv');
dotenv.config();

let amadeus;
if (process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET) {
    amadeus = new Amadeus({
        clientId: process.env.AMADEUS_CLIENT_ID,
        clientSecret: process.env.AMADEUS_CLIENT_SECRET
    });
}

const searchFlights = async (req, res) => {
    try {
        if (!amadeus) return res.status(500).json({ msg: 'Amadeus API not configured' });

        const { originSkyId, destinationSkyId, date, adults, cabinClass, currency } = req.query;
        const currencyCode = currency || 'INR'; // Default to INR

        // Map frontend "SkyID" (which are IATA codes like JFK) to Amadeus format
        const response = await amadeus.shopping.flightOffersSearch.get({
            originLocationCode: originSkyId,
            destinationLocationCode: destinationSkyId,
            departureDate: date,
            adults: adults || '1',
            travelClass: cabinClass ? cabinClass.toUpperCase() : 'ECONOMY',
            currencyCode: currencyCode,
            max: 10
        });

        // Transform Amadeus response to match what frontend expects
        const offers = response.data.map(offer => {
            const segment = offer.itineraries[0].segments[0];
            return {
                id: offer.id,
                price: { formatted: `${offer.price.currency === 'INR' ? '₹' : offer.price.currency === 'EUR' ? '€' : '₹'}${offer.price.total}` },
                legs: [{
                    departure: segment.departure.at,
                    arrival: segment.arrival.at,
                    durationInMinutes: parseInt(offer.itineraries[0].duration.replace(/[^0-9]/g, '')) || 120,
                    carriers: {
                        marketing: [{ name: segment.carrierCode, logoUrl: `https://pics.avs.io/200/200/${segment.carrierCode}.png` }]
                    },
                    origin: { displayCode: segment.departure.iataCode },
                    destination: { displayCode: segment.arrival.iataCode }
                }]
            };
        });

        res.json({ status: true, data: { itineraries: offers, context: { currency: currencyCode } } });

    } catch (error) {
        console.error('Amadeus Flight Search Error:', error.response ? error.response.result : error.message);
        res.status(500).json({ msg: 'Flight search failed', error: error.message });
    }
};

const getLocales = async (req, res) => {
    // Amadeus doesn't have a direct locales endpoint, returning default
    res.json([{ code: 'en-US', name: 'English (US)' }]);
};

// Autocomplete for airports
const searchAirports = async (req, res) => {
    try {
        if (!amadeus) return res.status(500).json({ msg: 'Amadeus API not configured' });

        const { query } = req.query;
        const response = await amadeus.referenceData.locations.get({
            keyword: query,
            subType: Amadeus.location.city,
            page: { limit: 5 }
        });

        const airports = response.data.map(loc => ({
            skyId: loc.iataCode,
            entityId: loc.id,
            presentation: {
                title: loc.name,
                suggestionTitle: `${loc.name} (${loc.iataCode})`,
                subtitle: loc.address.countryName
            }
        }));

        res.json({ status: true, data: airports });

    } catch (error) {
        console.error('Amadeus Airport Search Error:', error);
        res.status(500).json({ msg: 'Airport search failed' });
    }
};

module.exports = {
    searchFlights,
    getLocales,
    searchAirports
};
