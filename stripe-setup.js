#!/usr/bin/env node
/**
 * Shore Drop — Stripe Payment Link Generator
 * 
 * Run this once with your Stripe SECRET KEY to create payment links for all products.
 * It will update index.html automatically with the real payment link URLs.
 * 
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_xxxxx node stripe-setup.js
 * 
 * Or set it in your environment first:
 *   export STRIPE_SECRET_KEY=sk_live_xxxxx
 *   node stripe-setup.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_KEY) {
  console.error('❌  STRIPE_SECRET_KEY env var is required');
  console.error('    Run: STRIPE_SECRET_KEY=sk_live_xxxxx node stripe-setup.js');
  process.exit(1);
}

// Shore Drop products
const PRODUCTS = [
  {
    id: 'snack_pack',
    name: 'Snack Pack',
    description: 'Chips, 2× cold drinks, SPF 30 sunscreen — delivered to the sand.',
    amount: 1500, // $15.00 in cents
    htmlPlaceholder: 'STRIPE_SNACK_PACK_LINK',
  },
  {
    id: 'bait_drop',
    name: 'Bait Drop',
    description: 'Live or cut bait + ice pack delivered to your fishing spot on the NSB beach.',
    amount: 2500, // $25.00
    htmlPlaceholder: 'STRIPE_BAIT_DROP_LINK',
  },
  {
    id: 'beach_essentials',
    name: 'Beach Essentials',
    description: 'Beach towel, SPF 50 sunscreen, 4× water bottles — the starter pack.',
    amount: 3500, // $35.00
    htmlPlaceholder: 'STRIPE_BEACH_ESSENTIALS_LINK',
  },
  {
    id: 'photo_pass',
    name: 'Photo Pass',
    description: 'Aerial drone photo session — 5 high-res shots of your group, texted to you within minutes.',
    amount: 4000, // $40.00
    htmlPlaceholder: 'STRIPE_PHOTO_PASS_LINK',
  },
  {
    id: 'custom_drop',
    name: 'Custom Drop',
    description: 'You specify the items. We source and deliver. Base price $50 — final price confirmed before flight.',
    amount: 5000, // $50.00
    htmlPlaceholder: 'STRIPE_CUSTOM_DROP_LINK',
  },
];

// ── Stripe API helpers ──────────────────────────────────────────────

function stripePost(endpoint, data) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(data).toString();
    const options = {
      hostname: 'api.stripe.com',
      path: endpoint,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(parsed.error.message));
          else resolve(parsed);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log('🚁 Shore Drop — Stripe Setup\n');
  console.log(`Using key: ${STRIPE_KEY.slice(0, 12)}...`);
  console.log(`Mode: ${STRIPE_KEY.startsWith('sk_live') ? '🟢 LIVE' : '🟡 TEST'}\n`);

  const results = {};

  for (const product of PRODUCTS) {
    try {
      process.stdout.write(`Creating "${product.name}"... `);

      // 1. Create the product
      const stripeProduct = await stripePost('/v1/products', {
        name: product.name,
        description: product.description,
      });

      // 2. Create the price
      const stripePrice = await stripePost('/v1/prices', {
        product: stripeProduct.id,
        unit_amount: product.amount,
        currency: 'usd',
      });

      // 3. Create the payment link
      const paymentLink = await stripePost('/v1/payment_links', {
        'line_items[0][price]': stripePrice.id,
        'line_items[0][quantity]': 1,
        'after_completion[type]': 'redirect',
        'after_completion[redirect][url]': 'https://c0rne1ius.github.io/shoredrop/?ordered=1',
        'allow_promotion_codes': true,
        // Collect customer name and phone for delivery coordination
        'phone_number_collection[enabled]': true,
        // Custom fields for drop zone / delivery instructions
        'custom_fields[0][key]': 'drop_zone',
        'custom_fields[0][label][type]': 'custom',
        'custom_fields[0][label][custom]': 'Drop Zone (e.g. DZ-1 Flagler Ave)',
        'custom_fields[0][type]': 'text',
        'custom_fields[0][optional]': false,
        'custom_fields[1][key]': 'delivery_notes',
        'custom_fields[1][label][type]': 'custom',
        'custom_fields[1][label][custom]': 'Landmark / Notes (e.g. "red umbrella near lifeguard")',
        'custom_fields[1][type]': 'text',
        'custom_fields[1][optional]': true,
      });

      results[product.htmlPlaceholder] = paymentLink.url;
      console.log(`✅ ${paymentLink.url}`);

    } catch (err) {
      console.log(`❌ Error: ${err.message}`);
      results[product.htmlPlaceholder] = '#error-contact-shoredrop';
    }
  }

  // ── Update index.html ──────────────────────────────────────────
  const htmlPath = path.join(__dirname, 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

  for (const [placeholder, url] of Object.entries(results)) {
    html = html.replaceAll(placeholder, url);
    console.log(`\n📝 Replaced ${placeholder}`);
  }

  fs.writeFileSync(htmlPath, html);
  console.log('\n✅ index.html updated with real Stripe payment links!');

  // ── Save results ──────────────────────────────────────────────
  const outputPath = path.join(__dirname, 'stripe-links.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`📋 Links saved to stripe-links.json`);

  console.log('\n🚀 Next steps:');
  console.log('  1. git add -A && git commit -m "Add real Stripe payment links"');
  console.log('  2. git push origin main');
  console.log('  3. GitHub Pages will update in ~60 seconds');
  console.log('\n💌 To enable email notifications, set up a Stripe webhook pointing to your handler.');
  console.log('   See webhook-handler/ directory for the Node.js server.');
}

main().catch(console.error);
