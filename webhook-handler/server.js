#!/usr/bin/env node
/**
 * Shore Drop — Stripe Webhook Handler
 * 
 * Listens for Stripe payment.succeeded events and sends email notification
 * to mistertichenor@gmail.com with order details.
 * 
 * Deployment options:
 *   A) Local (with stripe listen forwarding) — for testing
 *   B) Vercel serverless function (see webhook-handler/api/webhook.js)
 *   C) Any VPS/server with Node.js
 * 
 * Setup:
 *   1. npm install
 *   2. Set env vars (see .env.example)
 *   3. node server.js
 *   4. In Stripe Dashboard → Developers → Webhooks → Add endpoint
 *      URL: https://your-server.com/webhook
 *      Events: payment_intent.succeeded, checkout.session.completed
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT || 3001;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const NOTIFICATION_EMAIL = 'mistertichenor@gmail.com';
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;

// ── Email sender (SendGrid) ──────────────────────────────────────

async function sendEmail({ to, subject, text, html }) {
  if (!SENDGRID_API_KEY) {
    console.log('📧 EMAIL (no SendGrid key — printing instead):');
    console.log(`   To: ${to}`);
    console.log(`   Subject: ${subject}`);
    console.log(`   Body:\n${text}`);
    return;
  }

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: 'orders@shoredrop.delivery', name: 'Shore Drop Orders' },
      subject,
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html', value: html || `<pre>${text}</pre>` },
      ],
    });

    const options = {
      hostname: 'api.sendgrid.com',
      path: '/v3/mail/send',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      res.on('data', () => {});
      res.on('end', () => {
        if (res.statusCode < 300) resolve({ ok: true });
        else reject(new Error(`SendGrid error: ${res.statusCode}`));
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Stripe signature verification ────────────────────────────────

function verifyStripeSignature(payload, sigHeader, secret) {
  if (!secret) return true; // skip in dev mode
  const timestamp = sigHeader.split(',').find(p => p.startsWith('t=')).slice(2);
  const signature = sigHeader.split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  const signed = `${timestamp}.${payload}`;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  return signature.some(s => crypto.timingSafeEqual(Buffer.from(s, 'hex'), Buffer.from(expected, 'hex')));
}

// ── Format order notification email ──────────────────────────────

function formatOrderEmail(session) {
  const meta = session.metadata || {};
  const customFields = session.custom_fields || [];
  const dropZone = customFields.find(f => f.key === 'drop_zone')?.text?.value || 'Not specified';
  const notes = customFields.find(f => f.key === 'delivery_notes')?.text?.value || 'None';

  const amount = ((session.amount_total || 0) / 100).toFixed(2);
  const customerName = session.customer_details?.name || 'Unknown';
  const customerEmail = session.customer_details?.email || 'N/A';
  const customerPhone = session.customer_details?.phone || 'N/A';

  // Get line items from session (simplified — expand in production)
  const product = session.line_items?.data?.[0]?.description || 'Shore Drop Order';

  const now = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    dateStyle: 'full',
    timeStyle: 'short',
  });

  const text = `
🚁 NEW SHORE DROP ORDER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Time:       ${now}
Order:      ${product}
Amount:     $${amount}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CUSTOMER
  Name:     ${customerName}
  Email:    ${customerEmail}
  Phone:    ${customerPhone}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DELIVERY
  Drop Zone:  ${dropZone}
  Notes:      ${notes}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Stripe session: ${session.id}

Action: Launch drone! Text ${customerPhone} when en route.
  `.trim();

  const html = `
<div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
  <h2 style="color: #0077b6;">🚁 New Shore Drop Order!</h2>
  <table style="border-collapse: collapse; width: 100%;">
    <tr><td style="padding: 8px; color: #666;">Product</td><td style="padding: 8px; font-weight: bold;">${product}</td></tr>
    <tr style="background:#f0f9ff;"><td style="padding: 8px; color: #666;">Amount</td><td style="padding: 8px; font-weight: bold; color: #0077b6;">$${amount}</td></tr>
    <tr><td style="padding: 8px; color: #666;">Customer</td><td style="padding: 8px;">${customerName}</td></tr>
    <tr style="background:#f0f9ff;"><td style="padding: 8px; color: #666;">Phone</td><td style="padding: 8px;"><a href="tel:${customerPhone}">${customerPhone}</a></td></tr>
    <tr><td style="padding: 8px; color: #666;">Email</td><td style="padding: 8px;">${customerEmail}</td></tr>
    <tr style="background:#f0f9ff;"><td style="padding: 8px; color: #666;">Drop Zone</td><td style="padding: 8px; font-weight: bold;">${dropZone}</td></tr>
    <tr><td style="padding: 8px; color: #666;">Notes</td><td style="padding: 8px;">${notes}</td></tr>
  </table>
  <div style="margin-top: 20px; padding: 16px; background: #fef9c3; border-radius: 8px;">
    <strong>👉 Action:</strong> Launch drone! Text <a href="tel:${customerPhone}">${customerPhone}</a> with your ETA.
  </div>
  <p style="color: #999; font-size: 12px; margin-top: 20px;">Stripe session: ${session.id}</p>
</div>
  `.trim();

  return { text, html };
}

// ── HTTP Server ───────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Shore Drop webhook server running ✓');
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'shoredrop-webhook' }));
    return;
  }

  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  // Collect body
  let body = '';
  req.on('data', (chunk) => { body += chunk.toString(); });
  req.on('end', async () => {
    const sigHeader = req.headers['stripe-signature'];

    // Verify signature
    if (STRIPE_WEBHOOK_SECRET && sigHeader) {
      if (!verifyStripeSignature(body, sigHeader, STRIPE_WEBHOOK_SECRET)) {
        console.warn('⚠️  Invalid Stripe signature');
        res.writeHead(400);
        res.end('Invalid signature');
        return;
      }
    }

    let event;
    try {
      event = JSON.parse(body);
    } catch (e) {
      res.writeHead(400);
      res.end('Invalid JSON');
      return;
    }

    console.log(`📨 Webhook: ${event.type}`);

    // Handle checkout.session.completed — the main event
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const { text, html } = formatOrderEmail(session);

      console.log(text);

      try {
        await sendEmail({
          to: NOTIFICATION_EMAIL,
          subject: `🚁 Shore Drop Order — ${session.customer_details?.name || 'New Customer'}`,
          text,
          html,
        });
        console.log('✅ Notification sent to', NOTIFICATION_EMAIL);
      } catch (err) {
        console.error('❌ Email send failed:', err.message);
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ received: true }));
  });
});

server.listen(PORT, () => {
  console.log(`🚁 Shore Drop webhook server running on port ${PORT}`);
  console.log(`   POST /webhook — Stripe events`);
  console.log(`   GET  /health  — health check`);
  if (!STRIPE_WEBHOOK_SECRET) console.warn('⚠️  STRIPE_WEBHOOK_SECRET not set — signature verification disabled');
  if (!SENDGRID_API_KEY) console.warn('⚠️  SENDGRID_API_KEY not set — emails will print to console only');
});
