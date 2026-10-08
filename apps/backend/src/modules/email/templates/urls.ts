// Links in emails are built only from configured base URLs plus encoded path segments and query values.

export interface LinkBases {
  client: string; // CLIENT_FRONTEND_URL
  admin: string; // ADMIN_FRONTEND_URL
  api: string; // API_PUBLIC_URL
}

/** Normalises a configured base URL to its origin (+ optional path prefix) without a trailing slash; throws if not http(s). */
export function normaliseBase(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`${name} must be an absolute http(s) URL`);
  if (url.search || url.hash) throw new Error(`${name} must not contain a query string or fragment`);
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export function buildUrl(base: string, segments: string[], query: Record<string, string> = {}): string {
  const path = segments.map((s) => encodeURIComponent(s)).join('/');
  const qs = Object.entries(query)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${base}/${path}${qs ? `?${qs}` : ''}`;
}

/** Every link an email can contain. */
export function links(bases: LinkBases) {
  return {
    // Client app routes (client/src/App.tsx)
    verifyEmail: (token: string) => buildUrl(bases.client, ['verify-email'], { token }),
    resetPassword: (token: string) => buildUrl(bases.client, ['reset-password'], { token }),
    forgotPassword: () => buildUrl(bases.client, ['forgot-password']),
    tracking: (orderId: string) => buildUrl(bases.client, ['dashboard', 'tracking'], { order: orderId }),
    clientMail: () => buildUrl(bases.client, ['dashboard', 'mail']),
    clientSettings: () => buildUrl(bases.client, ['dashboard', 'settings']),
    // Admin app routes (admin/app/src/router/index.tsx)
    adminShipment: (shipmentId: string) => buildUrl(bases.admin, ['admin', 'shipments', shipmentId]),
    adminInvoices: () => buildUrl(bases.admin, ['admin', 'invoices']),
    adminCustomers: () => buildUrl(bases.admin, ['admin', 'customers']),
    adminCommunications: (customerId: string) => buildUrl(bases.admin, ['admin', 'communications'], { selected: customerId }),
    adminAcceptInvite: (token: string) => buildUrl(bases.admin, ['admin', 'accept-invite'], { token }),
    adminLogin: () => buildUrl(bases.admin, ['admin', 'login']),
    adminNotificationSettings: () => buildUrl(bases.admin, ['admin', 'settings'], { tab: 'notifications' }),
    // API
    unsubscribe: (token: string) => buildUrl(bases.api, ['api', 'email', 'unsubscribe'], { token }),
  };
}

export type Links = ReturnType<typeof links>;
