// IntelliTrip Currency Service
// Supports 170+ world currencies with real-time exchange rates

class CurrencyService {
    constructor() {
        this.baseCurrency = 'INR'; // All values stored in INR in the DB
        this.rates = null;
        this.lastFetched = null;
        this.cacheExpiry = 3600000; // 1 hour cache
    }

    // Full list of world currency symbols
    getAllSymbols() {
        return {
            'AED': 'د.إ', 'AFN': '؋', 'ALL': 'L', 'AMD': '֏', 'ANG': 'ƒ',
            'AOA': 'Kz', 'ARS': '$', 'AUD': 'A$', 'AWG': 'ƒ', 'AZN': '₼',
            'BAM': 'KM', 'BBD': '$', 'BDT': '৳', 'BGN': 'лв', 'BHD': '.د.ب',
            'BIF': 'Fr', 'BMD': '$', 'BND': '$', 'BOB': 'Bs.', 'BRL': 'R$',
            'BSD': '$', 'BTN': 'Nu', 'BWP': 'P', 'BYN': 'Br', 'BZD': '$',
            'CAD': 'C$', 'CDF': 'Fr', 'CHF': 'Fr', 'CLP': '$', 'CNY': '¥',
            'COP': '$', 'CRC': '₡', 'CUP': '$', 'CVE': '$', 'CZK': 'Kč',
            'DJF': 'Fr', 'DKK': 'kr', 'DOP': '$', 'DZD': 'دج', 'EGP': '£',
            'ERN': 'Nfk', 'ETB': 'Br', 'EUR': '€', 'FJD': '$', 'FKP': '£',
            'GBP': '£', 'GEL': '₾', 'GHS': '₵', 'GIP': '£', 'GMD': 'D',
            'GNF': 'Fr', 'GTQ': 'Q', 'GYD': '$', 'HKD': 'HK$', 'HNL': 'L',
            'HRK': 'kn', 'HTG': 'G', 'HUF': 'Ft', 'IDR': 'Rp', 'ILS': '₪',
            'INR': '₹', 'IQD': 'ع.د', 'IRR': '﷼', 'ISK': 'kr', 'JMD': '$',
            'JOD': 'JD', 'JPY': '¥', 'KES': 'KSh', 'KGS': 'лв', 'KHR': '៛',
            'KMF': 'Fr', 'KPW': '₩', 'KRW': '₩', 'KWD': 'KD', 'KYD': '$',
            'KZT': '₸', 'LAK': '₭', 'LBP': '£', 'LKR': '₨', 'LRD': '$',
            'LSL': 'L', 'LYD': 'LD', 'MAD': 'MAD', 'MDL': 'L', 'MGA': 'Ar',
            'MKD': 'ден', 'MMK': 'K', 'MNT': '₮', 'MOP': 'P', 'MRU': 'UM',
            'MUR': '₨', 'MVR': 'Rf', 'MWK': 'MK', 'MXN': '$', 'MYR': 'RM',
            'MZN': 'MT', 'NAD': '$', 'NGN': '₦', 'NIO': 'C$', 'NOK': 'kr',
            'NPR': '₨', 'NZD': 'NZ$', 'OMR': '﷼', 'PAB': 'B/.', 'PEN': 'S/.',
            'PGK': 'K', 'PHP': '₱', 'PKR': '₨', 'PLN': 'zł', 'PYG': 'Gs',
            'QAR': '﷼', 'RON': 'lei', 'RSD': 'din', 'RUB': '₽', 'RWF': 'Fr',
            'SAR': '﷼', 'SBD': '$', 'SCR': '₨', 'SDG': 'ج.س.', 'SEK': 'kr',
            'SGD': 'S$', 'SHP': '£', 'SLL': 'Le', 'SOS': 'Sh', 'SRD': '$',
            'STN': 'Db', 'SVC': '₡', 'SYP': '£', 'SZL': 'L', 'THB': '฿',
            'TJS': 'SM', 'TMT': 'T', 'TND': 'DT', 'TOP': 'T$', 'TRY': '₺',
            'TTD': '$', 'TWD': 'NT$', 'TZS': 'Sh', 'UAH': '₴', 'UGX': 'Sh',
            'USD': '$', 'UYU': '$', 'UZS': 'лв', 'VES': 'Bs.S', 'VND': '₫',
            'VUV': 'Vt', 'WST': 'T', 'XAF': 'Fr', 'XCD': '$', 'XOF': 'Fr',
            'XPF': 'Fr', 'YER': '﷼', 'ZAR': 'R', 'ZMW': 'ZK', 'ZWL': '$'
        };
    }

    // Human-readable currency names for the dropdown
    getAllCurrencies() {
        return [
            { code: 'INR', name: 'Indian Rupee', flag: '🇮🇳' },
            { code: 'USD', name: 'US Dollar', flag: '🇺🇸' },
            { code: 'EUR', name: 'Euro', flag: '🇪🇺' },
            { code: 'GBP', name: 'British Pound', flag: '🇬🇧' },
            { code: 'JPY', name: 'Japanese Yen', flag: '🇯🇵' },
            { code: 'AUD', name: 'Australian Dollar', flag: '🇦🇺' },
            { code: 'CAD', name: 'Canadian Dollar', flag: '🇨🇦' },
            { code: 'CHF', name: 'Swiss Franc', flag: '🇨🇭' },
            { code: 'CNY', name: 'Chinese Yuan', flag: '🇨🇳' },
            { code: 'SGD', name: 'Singapore Dollar', flag: '🇸🇬' },
            { code: 'AED', name: 'UAE Dirham', flag: '🇦🇪' },
            { code: 'SAR', name: 'Saudi Riyal', flag: '🇸🇦' },
            { code: 'QAR', name: 'Qatari Riyal', flag: '🇶🇦' },
            { code: 'KWD', name: 'Kuwaiti Dinar', flag: '🇰🇼' },
            { code: 'BHD', name: 'Bahraini Dinar', flag: '🇧🇭' },
            { code: 'OMR', name: 'Omani Rial', flag: '🇴🇲' },
            { code: 'HKD', name: 'Hong Kong Dollar', flag: '🇭🇰' },
            { code: 'KRW', name: 'South Korean Won', flag: '🇰🇷' },
            { code: 'TWD', name: 'Taiwan Dollar', flag: '🇹🇼' },
            { code: 'MYR', name: 'Malaysian Ringgit', flag: '🇲🇾' },
            { code: 'THB', name: 'Thai Baht', flag: '🇹🇭' },
            { code: 'IDR', name: 'Indonesian Rupiah', flag: '🇮🇩' },
            { code: 'PHP', name: 'Philippine Peso', flag: '🇵🇭' },
            { code: 'VND', name: 'Vietnamese Dong', flag: '🇻🇳' },
            { code: 'BDT', name: 'Bangladeshi Taka', flag: '🇧🇩' },
            { code: 'PKR', name: 'Pakistani Rupee', flag: '🇵🇰' },
            { code: 'LKR', name: 'Sri Lankan Rupee', flag: '🇱🇰' },
            { code: 'NPR', name: 'Nepalese Rupee', flag: '🇳🇵' },
            { code: 'MMK', name: 'Myanmar Kyat', flag: '🇲🇲' },
            { code: 'KHR', name: 'Cambodian Riel', flag: '🇰🇭' },
            { code: 'NZD', name: 'New Zealand Dollar', flag: '🇳🇿' },
            { code: 'MXN', name: 'Mexican Peso', flag: '🇲🇽' },
            { code: 'BRL', name: 'Brazilian Real', flag: '🇧🇷' },
            { code: 'ARS', name: 'Argentine Peso', flag: '🇦🇷' },
            { code: 'COP', name: 'Colombian Peso', flag: '🇨🇴' },
            { code: 'CLP', name: 'Chilean Peso', flag: '🇨🇱' },
            { code: 'PEN', name: 'Peruvian Sol', flag: '🇵🇪' },
            { code: 'UYU', name: 'Uruguayan Peso', flag: '🇺🇾' },
            { code: 'ZAR', name: 'South African Rand', flag: '🇿🇦' },
            { code: 'EGP', name: 'Egyptian Pound', flag: '🇪🇬' },
            { code: 'NGN', name: 'Nigerian Naira', flag: '🇳🇬' },
            { code: 'KES', name: 'Kenyan Shilling', flag: '🇰🇪' },
            { code: 'GHS', name: 'Ghanaian Cedi', flag: '🇬🇭' },
            { code: 'ETB', name: 'Ethiopian Birr', flag: '🇪🇹' },
            { code: 'TZS', name: 'Tanzanian Shilling', flag: '🇹🇿' },
            { code: 'UGX', name: 'Ugandan Shilling', flag: '🇺🇬' },
            { code: 'DZD', name: 'Algerian Dinar', flag: '🇩🇿' },
            { code: 'MAD', name: 'Moroccan Dirham', flag: '🇲🇦' },
            { code: 'TND', name: 'Tunisian Dinar', flag: '🇹🇳' },
            { code: 'TRY', name: 'Turkish Lira', flag: '🇹🇷' },
            { code: 'ILS', name: 'Israeli Shekel', flag: '🇮🇱' },
            { code: 'JOD', name: 'Jordanian Dinar', flag: '🇯🇴' },
            { code: 'LBP', name: 'Lebanese Pound', flag: '🇱🇧' },
            { code: 'IQD', name: 'Iraqi Dinar', flag: '🇮🇶' },
            { code: 'IRR', name: 'Iranian Rial', flag: '🇮🇷' },
            { code: 'RUB', name: 'Russian Ruble', flag: '🇷🇺' },
            { code: 'UAH', name: 'Ukrainian Hryvnia', flag: '🇺🇦' },
            { code: 'PLN', name: 'Polish Zloty', flag: '🇵🇱' },
            { code: 'CZK', name: 'Czech Koruna', flag: '🇨🇿' },
            { code: 'HUF', name: 'Hungarian Forint', flag: '🇭🇺' },
            { code: 'RON', name: 'Romanian Leu', flag: '🇷🇴' },
            { code: 'BGN', name: 'Bulgarian Lev', flag: '🇧🇬' },
            { code: 'HRK', name: 'Croatian Kuna', flag: '🇭🇷' },
            { code: 'DKK', name: 'Danish Krone', flag: '🇩🇰' },
            { code: 'SEK', name: 'Swedish Krona', flag: '🇸🇪' },
            { code: 'NOK', name: 'Norwegian Krone', flag: '🇳🇴' },
            { code: 'ISK', name: 'Icelandic Króna', flag: '🇮🇸' },
            { code: 'GEL', name: 'Georgian Lari', flag: '🇬🇪' },
            { code: 'KZT', name: 'Kazakhstani Tenge', flag: '🇰🇿' },
            { code: 'UZS', name: 'Uzbekistani Som', flag: '🇺🇿' },
            { code: 'AZN', name: 'Azerbaijani Manat', flag: '🇦🇿' },
            { code: 'AMD', name: 'Armenian Dram', flag: '🇦🇲' },
            { code: 'MNT', name: 'Mongolian Tögrög', flag: '🇲🇳' },
            { code: 'MVR', name: 'Maldivian Rufiyaa', flag: '🇲🇻' },
            { code: 'BND', name: 'Brunei Dollar', flag: '🇧🇳' },
            { code: 'FJD', name: 'Fijian Dollar', flag: '🇫🇯' },
            { code: 'PGK', name: 'Papua New Guinea Kina', flag: '🇵🇬' },
            { code: 'WST', name: 'Samoan Tālā', flag: '🇼🇸' },
            { code: 'XCD', name: 'East Caribbean Dollar', flag: '🌍' },
            { code: 'XAF', name: 'Central African Franc', flag: '🌍' },
            { code: 'XOF', name: 'West African Franc', flag: '🌍' },
            { code: 'ZMW', name: 'Zambian Kwacha', flag: '🇿🇲' },
            { code: 'BWP', name: 'Botswana Pula', flag: '🇧🇼' },
            { code: 'MGA', name: 'Malagasy Ariary', flag: '🇲🇬' },
            { code: 'MUR', name: 'Mauritian Rupee', flag: '🇲🇺' },
            { code: 'SCR', name: 'Seychellois Rupee', flag: '🇸🇨' },
        ];
    }

    // ---------------------------------------------------------------
    // COUNTRY → CURRENCY MAPPING
    // Covers 190+ countries/territories using ISO 3166-1 alpha-2 codes
    // ---------------------------------------------------------------
    getCountryCurrencyMap() {
        return {
            'AF': 'AFN', 'AL': 'ALL', 'DZ': 'DZD', 'AD': 'EUR', 'AO': 'AOA',
            'AG': 'XCD', 'AR': 'ARS', 'AM': 'AMD', 'AU': 'AUD', 'AT': 'EUR',
            'AZ': 'AZN', 'BS': 'BSD', 'BH': 'BHD', 'BD': 'BDT', 'BB': 'BBD',
            'BY': 'BYN', 'BE': 'EUR', 'BZ': 'BZD', 'BJ': 'XOF', 'BT': 'BTN',
            'BO': 'BOB', 'BA': 'BAM', 'BW': 'BWP', 'BR': 'BRL', 'BN': 'BND',
            'BG': 'BGN', 'BF': 'XOF', 'BI': 'BIF', 'CV': 'CVE', 'KH': 'KHR',
            'CM': 'XAF', 'CA': 'CAD', 'CF': 'XAF', 'TD': 'XAF', 'CL': 'CLP',
            'CN': 'CNY', 'CO': 'COP', 'KM': 'KMF', 'CD': 'CDF', 'CG': 'XAF',
            'CR': 'CRC', 'HR': 'EUR', 'CU': 'CUP', 'CY': 'EUR', 'CZ': 'CZK',
            'DK': 'DKK', 'DJ': 'DJF', 'DM': 'XCD', 'DO': 'DOP', 'EC': 'USD',
            'EG': 'EGP', 'SV': 'USD', 'GQ': 'XAF', 'ER': 'ERN', 'EE': 'EUR',
            'ET': 'ETB', 'FJ': 'FJD', 'FI': 'EUR', 'FR': 'EUR', 'GA': 'XAF',
            'GM': 'GMD', 'GE': 'GEL', 'DE': 'EUR', 'GH': 'GHS', 'GR': 'EUR',
            'GD': 'XCD', 'GT': 'GTQ', 'GN': 'GNF', 'GW': 'XOF', 'GY': 'GYD',
            'HT': 'HTG', 'HN': 'HNL', 'HK': 'HKD', 'HU': 'HUF', 'IS': 'ISK',
            'IN': 'INR', 'ID': 'IDR', 'IR': 'IRR', 'IQ': 'IQD', 'IE': 'EUR',
            'IL': 'ILS', 'IT': 'EUR', 'JM': 'JMD', 'JP': 'JPY', 'JO': 'JOD',
            'KZ': 'KZT', 'KE': 'KES', 'KI': 'AUD', 'KP': 'KPW', 'KR': 'KRW',
            'KW': 'KWD', 'KG': 'KGS', 'LA': 'LAK', 'LV': 'EUR', 'LB': 'LBP',
            'LS': 'LSL', 'LR': 'LRD', 'LY': 'LYD', 'LI': 'CHF', 'LT': 'EUR',
            'LU': 'EUR', 'MO': 'MOP', 'MG': 'MGA', 'MW': 'MWK', 'MY': 'MYR',
            'MV': 'MVR', 'ML': 'XOF', 'MT': 'EUR', 'MH': 'USD', 'MR': 'MRU',
            'MU': 'MUR', 'MX': 'MXN', 'FM': 'USD', 'MD': 'MDL', 'MC': 'EUR',
            'MN': 'MNT', 'ME': 'EUR', 'MA': 'MAD', 'MZ': 'MZN', 'MM': 'MMK',
            'NA': 'NAD', 'NR': 'AUD', 'NP': 'NPR', 'NL': 'EUR', 'NZ': 'NZD',
            'NI': 'NIO', 'NE': 'XOF', 'NG': 'NGN', 'MK': 'MKD', 'NO': 'NOK',
            'OM': 'OMR', 'PK': 'PKR', 'PW': 'USD', 'PA': 'PAB', 'PG': 'PGK',
            'PY': 'PYG', 'PE': 'PEN', 'PH': 'PHP', 'PL': 'PLN', 'PT': 'EUR',
            'QA': 'QAR', 'RO': 'RON', 'RU': 'RUB', 'RW': 'RWF', 'KN': 'XCD',
            'LC': 'XCD', 'VC': 'XCD', 'WS': 'WST', 'SM': 'EUR', 'ST': 'STN',
            'SA': 'SAR', 'SN': 'XOF', 'RS': 'RSD', 'SC': 'SCR', 'SL': 'SLL',
            'SG': 'SGD', 'SK': 'EUR', 'SI': 'EUR', 'SB': 'SBD', 'SO': 'SOS',
            'ZA': 'ZAR', 'SS': 'SDG', 'ES': 'EUR', 'LK': 'LKR', 'SD': 'SDG',
            'SR': 'SRD', 'SE': 'SEK', 'CH': 'CHF', 'SY': 'SYP', 'TW': 'TWD',
            'TJ': 'TJS', 'TZ': 'TZS', 'TH': 'THB', 'TL': 'USD', 'TG': 'XOF',
            'TO': 'TOP', 'TT': 'TTD', 'TN': 'TND', 'TR': 'TRY', 'TM': 'TMT',
            'TV': 'AUD', 'UG': 'UGX', 'UA': 'UAH', 'AE': 'AED', 'GB': 'GBP',
            'US': 'USD', 'UY': 'UYU', 'UZ': 'UZS', 'VU': 'VUV', 'VE': 'VES',
            'VN': 'VND', 'YE': 'YER', 'ZM': 'ZMW', 'ZW': 'ZWL'
        };
    }

    // Lookup currency code for a 2-letter ISO country code
    getCurrencyForCountry(countryCode) {
        if (!countryCode) return null;
        const map = this.getCountryCurrencyMap();
        return map[countryCode.toUpperCase()] || null;
    }

    // Force-invalidate cache (called when user changes currency)
    invalidateCache() {
        this.rates = null;
        this.lastFetched = null;
        localStorage.removeItem('currencyRates');
        console.log('🔄 Currency cache invalidated, will fetch fresh rates.');
    }

    async getRates() {
        // Use cached rates if still valid
        if (this.rates && this.lastFetched && (Date.now() - this.lastFetched < this.cacheExpiry)) {
            return this.rates;
        }

        // Try multiple free APIs in case one goes down
        const apiUrls = [
            `https://api.exchangerate-api.com/v4/latest/${this.baseCurrency}`,
            `https://open.er-api.com/v6/latest/${this.baseCurrency}`,
        ];

        for (const url of apiUrls) {
            try {
                console.log(`🌍 Fetching real-time rates from: ${url}`);
                const response = await fetch(url);
                if (!response.ok) continue;
                const data = await response.json();

                // Handle both API formats
                this.rates = data.rates || data.conversion_rates;
                this.lastFetched = Date.now();

                // Persist to localStorage
                localStorage.setItem('currencyRates', JSON.stringify({
                    rates: this.rates,
                    lastFetched: this.lastFetched
                }));

                console.log(`✅ Fetched rates for ${Object.keys(this.rates).length} currencies`);
                return this.rates;
            } catch (error) {
                console.warn(`⚠️ API failed: ${url}`, error);
            }
        }

        // Try to load from localStorage as fallback
        const cached = localStorage.getItem('currencyRates');
        if (cached) {
            const parsed = JSON.parse(cached);
            this.rates = parsed.rates;
            this.lastFetched = parsed.lastFetched;
            console.warn('⚠️ Using cached rates as fallback');
            return this.rates;
        }

        // Hardcoded defaults if everything fails
        console.error('❌ All rate sources failed, using hardcoded defaults');
        return {
            'INR': 1, 'USD': 0.012, 'EUR': 0.011, 'GBP': 0.0094,
            'JPY': 1.78, 'AUD': 0.019, 'CAD': 0.017, 'CHF': 0.011,
            'CNY': 0.087, 'SGD': 0.016, 'AED': 0.044, 'SAR': 0.045
        };
    }

    async convert(amount, toCurrency) {
        if (!toCurrency || toCurrency === this.baseCurrency) return amount;

        const rates = await this.getRates();
        const rate = rates[toCurrency];

        if (!rate) {
            console.warn(`⚠️ Rate for ${toCurrency} not found`);
            return amount;
        }

        return amount * rate;
    }

    getSymbol(currencyCode) {
        const symbols = this.getAllSymbols();
        return symbols[currencyCode] || currencyCode;
    }

    async format(amount, toCurrency, includeSymbol = true) {
        const converted = await this.convert(amount, toCurrency);
        const symbol = this.getSymbol(toCurrency);
        const formatted = parseFloat(converted).toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        });
        return includeSymbol ? `${symbol}${formatted}` : formatted;
    }
}

window.currencyService = new CurrencyService();

// Pre-fetch rates on page load
window.currencyService.getRates().catch(console.warn);
