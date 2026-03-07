import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';

export function mpClient() {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error('MERCADOPAGO_ACCESS_TOKEN no configurado');
  return new MercadoPagoConfig({ accessToken: token });
}

export async function createPreference({ orderId, items, payerEmail, userEmail }) {
  const client = mpClient();
  const preference = new Preference(client);
  const baseUrl = (process.env.FRONTEND_PUBLIC_URL || process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  const backendPublic = process.env.BACKEND_PUBLIC_URL || 'http://localhost:5050';
  const webhookPath = process.env.MP_WEBHOOK_PATH || '/api/mp/webhook';
  const notificationUrl = backendPublic.replace(/\/$/, '') + webhookPath;

  const encodedOrderId = encodeURIComponent(orderId);
  const body = {
    external_reference: orderId,
    metadata: { orderId },
    payer: payerEmail ? { email: payerEmail } : undefined,
    items: items.map(i => ({
      title: i.name,
      quantity: i.quantity,
      unit_price: Number(i.unit_price),
      currency_id: 'MXN'
    })),
    notification_url: notificationUrl,
    auto_return: 'approved',
    back_urls: {
      success: `${baseUrl}/frontend/index.html?mp=success&orderId=${encodedOrderId}`,
      pending: `${baseUrl}/frontend/index.html?mp=pending&orderId=${encodedOrderId}`,
      failure: `${baseUrl}/frontend/index.html?mp=failure&orderId=${encodedOrderId}`
    }
  };

  const res = await preference.create({ body });
  return res;
}

/**
 * Obtiene un pago por ID desde la API de Mercado Pago (para webhook).
 * @returns {Promise<{ id, status, external_reference, metadata }>} o null si falla
 */
export async function getPaymentById(paymentId) {
  const token = getMpToken();
  if (!token) return null;
  const url = `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!r.ok) {
    console.warn('[MP] getPaymentById', paymentId, r.status);
    return null;
  }
  return r.json();
}

export async function getPayment(paymentId) {
  const client = mpClient();
  const payment = new Payment(client);
  const res = await payment.get({ id: paymentId });
  return res;
}
