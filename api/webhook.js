/**
 * Shore Drop — Vercel Serverless Webhook Handler
 * 
 * Deploy to Vercel: this file auto-becomes an API endpoint at /api/webhook
 * 
 * Stripe Dashboard → Developers → Webhooks → Add endpoint:
 *   URL: https://shoredrop.vercel.app/api/webhook
 *   Events: checkout.session.completed
 * 
 * Required Vercel env vars (set in dashboard):
 *   STRIPE_WEBHOOK_SECRET — from Stripe webhook settings
 *   SENDGRID_API_KEY      — from sendgrid.com (free tier: 100 emails/day)
 */

const crypto = require('crypto');
const https = require('https');

const NOTIFICATION_EMAIL = 'mistertichenor@gmail.com';
const RESEND_API_KEY = process.env.RESEND_API_KEY;

function verifyStripeSignature(payload, sigHeader, secret) {
  try {
    const timestamp = sigHeader.split(',').find(p => p.startsWith('t=')).slice(2);
    const sigs = sigHeader.split(',').filter(p => p.startsWith('v1=')).map(p => p.slice(3));
    const signed = `${timestamp}.${payload}`;
    const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
    return sigs.some(s => {
      try { return crypto.timingSafeEqual(Buffer.from(s, 'hex'), Buffer.from(expected, 'hex')); }
      catch { return false; }
    });
  } catch { return false; }
}

function sendEmail({ to, subject, text, html }) {
  const key = RESEND_API_KEY;
  if (!key) {
    console.log('Email (no Resend key):', subject);
    console.log(text);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      from: 'Shore Drop Orders <onboarding@resend.dev>',
      to: [to],
      subject,
      text,
      html,
    });
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode < 300) resolve(JSON.parse(body));
        else reject(new Error(`Resend ${res.statusCode}: ${body}`));
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function formatEmail(session) {
  const fields = session.custom_fields || [];
  const dropZone = fields.find(f => f.key === 'drop_zone')?.text?.value || 'Not specified';
  const notes = fields.find(f => f.key === 'delivery_notes')?.text?.value || 'None';
  const amount = ((session.amount_total || 0) / 100).toFixed(2);
  const name = session.customer_details?.name || 'Unknown';
  const phone = session.customer_details?.phone || 'N/A';
  const email = session.customer_details?.email || 'N/A';
  const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

  const text = `🚁 NEW SHORE DROP ORDER — ${now}\nProduct: $${amount}\nCustomer: ${name}\nPhone: ${phone}\nDrop Zone: ${dropZone}\nNotes: ${notes}\n\nLaunch drone! Text ${phone} with ETA.`;
  const html = `<h2>🚁 New Shore Drop Order — $${amount}</h2><p><strong>Customer:</strong> ${name}<br><strong>Phone:</strong> <a href="tel:${phone}">${phone}</a><br><strong>Email:</strong> ${email}<br><strong>Drop Zone:</strong> ${dropZone}<br><strong>Notes:</strong> ${notes}</p><p style="background:#fef9c3;padding:12px;border-radius:8px"><strong>Action:</strong> Launch drone! Text ${phone} with ETA.</p>`;

  return { text, html };
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', service: 'shoredrop-webhook' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Read raw body
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString();

  // Verify Stripe signature
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers['stripe-signature'];
  if (secret && sig && !verifyStripeSignature(rawBody, sig, secret)) {
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let event;
  try { event = JSON.parse(rawBody); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { text, html } = formatEmail(session);
    try {
      await sendEmail({
        to: NOTIFICATION_EMAIL,
        subject: `🚁 Shore Drop Order — ${session.customer_details?.name || 'New Customer'} — $${((session.amount_total||0)/100).toFixed(2)}`,
        text,
        html,
      });
      console.log('Order notification sent');
    } catch (err) {
      console.error('Email failed:', err.message);
    }
  }

  return res.status(200).json({ received: true });
};
