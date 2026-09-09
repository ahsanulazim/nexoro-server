let cachedRate = null;
let lastFetchedTime = 0;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Fetch current USD to BDT exchange rate with in-memory caching
 * @returns {Promise<number>} BDT exchange rate
 */
export const getBdtExchangeRate = async () => {
  const now = Date.now();
  if (cachedRate && now - lastFetchedTime < CACHE_TTL_MS) {
    return cachedRate;
  }

  try {
    const apiUrl = process.env.EXCHANGE_RATE_API_URL;
    if (!apiUrl) {
      console.warn("EXCHANGE_RATE_API_URL is not configured in .env, fallback to default rate 120");
      return cachedRate || 120;
    }

    const res = await fetch(apiUrl);
    const data = await res.json();
    const rate = Math.round(data?.conversion_rates?.BDT);

    if (rate && !isNaN(rate)) {
      cachedRate = rate;
      lastFetchedTime = now;
      return rate;
    }

    return cachedRate || 120;
  } catch (error) {
    console.error("Failed to fetch exchange rate:", error);
    return cachedRate || 120;
  }
};

/**
 * Convert USD price to BDT (rounded to nearest integer)
 * @param {number|string} usdAmount 
 * @returns {Promise<number>} Converted BDT amount
 */
export const convertToBDT = async (usdAmount) => {
  const amount = Number(usdAmount) || 0;
  if (amount <= 0) return 0;
  const rate = await getBdtExchangeRate();
  return Math.round(amount * rate);
};
