const axios = require('axios');
const NodeCache = require('node-cache');
const logger = require('../config/logger');

const cache = new NodeCache({ stdTTL: 60, checkperiod: 30 });
const PRICE_KEY = 'gold_price';
const LOCK_PREFIX = 'price_lock_';

// Fallback price when API is unavailable
const FALLBACK = { xauUsd: 3314.40, perGram: 106.55, stale: true };

async function fetchLivePrice() {
  try {
    // Try metals.dev first (simple REST API)
    if (process.env.METALS_API_KEY) {
      const { data } = await axios.get('https://api.metals.dev/v1/latest', {
        params: { api_key: process.env.METALS_API_KEY, currency: 'USD', unit: 'troy_oz' },
        timeout: 5000,
      });
      const xauUsd = data?.metals?.gold;
      if (xauUsd) {
        const perGram = xauUsd / 31.1035;
        return { xauUsd: +xauUsd.toFixed(2), perGram: +perGram.toFixed(4), stale: false };
      }
    }

    // Fallback: Alpha Vantage
    if (process.env.METALS_API_KEY) {
      const { data } = await axios.get('https://www.alphavantage.co/query', {
        params: {
          function: 'CURRENCY_EXCHANGE_RATE',
          from_currency: 'XAU',
          to_currency: 'USD',
          apikey: process.env.METALS_API_KEY,
        },
        timeout: 5000,
      });
      const rate = data?.['Realtime Currency Exchange Rate']?.['5. Exchange Rate'];
      if (rate) {
        const xauUsd = parseFloat(rate);
        return { xauUsd: +xauUsd.toFixed(2), perGram: +(xauUsd / 31.1035).toFixed(4), stale: false };
      }
    }
  } catch (err) {
    logger.warn(`Gold price fetch failed: ${err.message}`);
  }

  // Return last cached value or fallback
  const last = cache.get(PRICE_KEY);
  if (last) return { ...last, stale: true };
  return { ...FALLBACK, updatedAt: new Date().toISOString() };
}

async function getGoldPrice() {
  const cached = cache.get(PRICE_KEY);
  if (cached) return cached;

  const price = await fetchLivePrice();
  const result = { ...price, updatedAt: new Date().toISOString() };
  cache.set(PRICE_KEY, result);
  return result;
}

// Lock the price for a user for 30 seconds during a buy/sell
function lockPriceForUser(userId, priceData) {
  cache.set(`${LOCK_PREFIX}${userId}`, priceData, 30);
}

function getLockedPrice(userId) {
  return cache.get(`${LOCK_PREFIX}${userId}`);
}

function clearLockedPrice(userId) {
  cache.del(`${LOCK_PREFIX}${userId}`);
}

// Refresh price in background every 60 seconds
setInterval(async () => {
  try {
    const price = await fetchLivePrice();
    cache.set(PRICE_KEY, { ...price, updatedAt: new Date().toISOString() });
  } catch (err) {
    logger.error('Gold price refresh error:', err);
  }
}, 60 * 1000);

module.exports = { getGoldPrice, lockPriceForUser, getLockedPrice, clearLockedPrice };
