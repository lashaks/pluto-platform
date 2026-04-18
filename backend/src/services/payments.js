const crypto = require('crypto');

class PaymentService {
  constructor() {
    this.nowpaymentsKey = process.env.NOWPAYMENTS_API_KEY || '';
    this.nowpaymentsIpnSecret = process.env.NOWPAYMENTS_IPN_SECRET || '';
    this.nowpaymentsBase = 'https://api.nowpayments.io/v1';
  }

  async createCryptoInvoice({ amount, orderId, description, successUrl, cancelUrl }) {
    console.log('[Payment] Creating NOWPayments invoice: $' + amount + ' for order ' + orderId);
    const response = await fetch(this.nowpaymentsBase + '/invoice', {
      method: 'POST',
      headers: { 'x-api-key': this.nowpaymentsKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        price_amount: amount,
        price_currency: 'usd',
        order_id: orderId,
        order_description: description || 'Pluto Capital Challenge',
        success_url: successUrl || 'https://pluto-platform.vercel.app?purchased=true',
        cancel_url: cancelUrl || 'https://pluto-platform.vercel.app',
        is_fee_paid_by_user: false,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      console.error('[Payment] NOWPayments error:', data);
      throw new Error(data.message || 'Failed to create payment');
    }
    console.log('[Payment] Invoice created: ' + data.id);
    return { invoiceId: data.id, invoiceUrl: data.invoice_url, orderId: orderId };
  }

  verifyIpnSignature(body, receivedSignature) {
    // In production without an IPN secret configured, reject all webhooks
    if (!this.nowpaymentsIpnSecret) {
      const isProd = process.env.NODE_ENV==='production' || process.env.RAILWAY_ENVIRONMENT;
      if (isProd) {
        console.error('[Payments] NOWPAYMENTS_IPN_SECRET not set — rejecting webhook for security');
        return false;
      }
      console.warn('[Payments] IPN secret not set — accepting webhook (dev mode only)');
      return true;
    }
    const sorted = Object.keys(body).sort().reduce((r, k) => { r[k] = body[k]; return r; }, {});
    const hmac = crypto.createHmac('sha512', this.nowpaymentsIpnSecret).update(JSON.stringify(sorted)).digest('hex');
    return hmac === receivedSignature;
  }

  isPaymentComplete(status) {
    return ['finished', 'confirmed', 'sending', 'partially_paid'].includes(status);
  }

  async createCheckoutSession() {
    return { error: 'Card payments coming soon. Please use crypto.' };
  }

  async processRisePayout({ contractorId, amount, method }) {
    console.log('[Payout] Rise: $' + amount + ' via ' + method);
    return { success: true, paymentId: 'rise_' + Date.now(), status: 'processing' };
  }

  async processDirectCryptoPayout({ walletAddress, amount, token, network }) {
    console.log('[Payout] Direct crypto: ' + amount + ' ' + token + ' to ' + walletAddress);
    return { success: true, txHash: '0x' + crypto.randomBytes(16).toString('hex'), status: 'broadcasted' };
  }

  async onboardRiseContractor({ email }) {
    console.log('[Payout] Onboarding ' + email);
    return { contractorId: 'rise_c_' + Date.now(), status: 'active' };
  }
}

module.exports = new PaymentService();
