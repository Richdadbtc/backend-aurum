const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const logger = require('../config/logger');

const hasSmtp = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const hasSendgrid = !!process.env.SENDGRID_API_KEY;

const smtpHost = process.env.SMTP_HOST || 'smtp.sendgrid.net';
const smtpPort = parseInt(process.env.SMTP_PORT, 10) || 587;
const smtpSecure = String(process.env.SMTP_SECURE).toLowerCase() === 'true';

const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpSecure,
  auth: {
    user: process.env.SMTP_USER || 'apikey',
    pass: (hasSmtp ? process.env.SMTP_PASS : process.env.SENDGRID_API_KEY) || '',
  },
  connectionTimeout: parseInt(process.env.SMTP_CONNECTION_TIMEOUT_MS, 10) || 20000,
  greetingTimeout: parseInt(process.env.SMTP_GREETING_TIMEOUT_MS, 10) || 20000,
  socketTimeout: parseInt(process.env.SMTP_SOCKET_TIMEOUT_MS, 10) || 20000,
  tls: {
    servername: smtpHost,
  },
});

function loadTemplate(name) {
  const filePath = path.join(__dirname, `../views/emails/${name}.html`);
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    logger.warn(`Email template not found: ${name}`);
    return '<p>{{body}}</p>';
  }
}

function renderTemplate(name, vars) {
  let html = loadTemplate(name);
  for (const [key, val] of Object.entries(vars)) {
    html = html.replace(new RegExp(`{{${key}}}`, 'g'), val);
  }
  return html;
}

async function sendEmail({ to, subject, templateName, vars = {}, text = '' }) {
  if (!hasSmtp && !hasSendgrid && process.env.NODE_ENV !== 'test') {
    logger.info(`[DEV EMAIL] To: ${to} | Subject: ${subject} | Vars: ${JSON.stringify(vars)}`);
    return;
  }

  const html = renderTemplate(templateName, vars);

  await transporter.sendMail({
    from: `"Aurum Vault" <${process.env.EMAIL_FROM || 'noreply@aurumvault.com'}>`,
    to,
    subject,
    html,
    text: text || subject,
  });
}

const sendWelcomeEmail = (user) =>
  sendEmail({ to: user.email, subject: 'Welcome to Aurum Vault', templateName: 'welcome', vars: { firstName: user.firstName } });

const sendVerifyEmail = (user, token) =>
  sendEmail({
    to: user.email, subject: 'Verify your email — Aurum Vault', templateName: 'verify-email',
    vars: { firstName: user.firstName, link: `${process.env.CLIENT_URL}/api/auth/verify-email/${token}` },
  });

const sendEmailOtp = (email, otp) =>
  sendEmail({
    to: email,
    subject: 'Your Aurum Vault verification code',
    templateName: 'email-otp',
    vars: { otp: String(otp) },
    text: `Your Aurum Vault verification code is: ${otp}`,
  });

const sendPasswordResetEmail = (user, token) =>
  sendEmail({
    to: user.email, subject: 'Reset your password — Aurum Vault', templateName: 'reset-password',
    vars: { firstName: user.firstName, link: `${process.env.CLIENT_URL}/reset-password?token=${token}` },
  });

const sendBuyReceipt = (user, tx, holding) =>
  sendEmail({
    to: user.email, subject: `Gold purchase confirmed — Aurum Vault`, templateName: 'buy-receipt',
    vars: {
      firstName: user.firstName,
      amount: `$${tx.amount.toFixed(2)}`,
      grams: tx.gramsGold.toFixed(4),
      pricePerGram: `$${tx.pricePerGram.toFixed(2)}`,
      fee: `$${tx.fee.toFixed(2)}`,
      total: `$${(tx.amount + tx.fee).toFixed(2)}`,
      totalGrams: holding.gramsHeld.toFixed(4),
      date: new Date(tx.createdAt).toLocaleString(),
    },
  });

const sendSellReceipt = (user, tx) =>
  sendEmail({
    to: user.email, subject: `Gold sale confirmed — Aurum Vault`, templateName: 'sell-receipt',
    vars: {
      firstName: user.firstName,
      grams: tx.gramsGold.toFixed(4),
      proceeds: `$${tx.amount.toFixed(2)}`,
      fee: `$${tx.fee.toFixed(2)}`,
      net: `$${tx.netAmount.toFixed(2)}`,
      date: new Date(tx.createdAt).toLocaleString(),
    },
  });

const sendKycApprovedEmail = (user) =>
  sendEmail({ to: user.email, subject: 'KYC Approved — Aurum Vault', templateName: 'kyc-approved', vars: { firstName: user.firstName } });

const sendKycRejectedEmail = (user, reason) =>
  sendEmail({
    to: user.email, subject: 'KYC Update — Aurum Vault', templateName: 'kyc-rejected',
    vars: { firstName: user.firstName, reason: reason || 'Please resubmit with valid documents.' },
  });

module.exports = {
  sendWelcomeEmail, sendVerifyEmail, sendPasswordResetEmail,
  sendBuyReceipt, sendSellReceipt, sendKycApprovedEmail, sendKycRejectedEmail,
  sendEmailOtp,
};
