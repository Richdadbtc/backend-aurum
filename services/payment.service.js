const axios = require('axios');
const crypto = require('crypto');
const logger = require('../config/logger');

const PAYSTACK_BASE = 'https://api.paystack.co';

const paystackApi = axios.create({
  baseURL: PAYSTACK_BASE,
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 10000,
});

async function initializePayment({ email, amount, reference, metadata = {} }) {
  // Paystack expects amount in minor units (cents) for USD
  const { data } = await paystackApi.post('/transaction/initialize', {
    email,
    amount: Math.round(amount * 100),
    reference,
    currency: 'USD',
    metadata,
    callback_url: `${process.env.CLIENT_URL}/api/payment/verify/${reference}`,
  });
  return data.data;
}

async function verifyPayment(reference) {
  const { data } = await paystackApi.get(`/transaction/verify/${reference}`);
  return data.data;
}

async function getBankList() {
  const country = (process.env.PAYSTACK_BANK_COUNTRY || 'nigeria').toLowerCase();
  const { data } = await paystackApi.get(`/bank?country=${encodeURIComponent(country)}`);
  return data.data;
}

async function resolveAccount(accountNumber, bankCode) {
  const { data } = await paystackApi.get(
    `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`
  );
  return data.data;
}

async function initiateTransfer({ amount, recipientCode, reference, reason }) {
  const { data } = await paystackApi.post('/transfer', {
    source: 'balance',
    amount: Math.round(amount * 100),
    recipient: recipientCode,
    reference,
    reason,
  });
  return data.data;
}

async function createTransferRecipient({ name, accountNumber, bankCode }) {
  const recipientType = process.env.PAYSTACK_RECIPIENT_TYPE || 'nuban';
  const { data } = await paystackApi.post('/transferrecipient', {
    type: recipientType,
    name,
    account_number: accountNumber,
    bank_code: bankCode,
    currency: 'USD',
  });
  return data.data;
}

function verifyWebhookSignature(rawBody, signature) {
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest('hex');
  return hash === signature;
}

module.exports = {
  initializePayment,
  verifyPayment,
  getBankList,
  resolveAccount,
  initiateTransfer,
  createTransferRecipient,
  verifyWebhookSignature,
};
