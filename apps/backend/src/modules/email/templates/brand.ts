// Email branding: colour, optional logo and the company postal address shown in every footer.
// Read from EMAIL_BRAND_COLOR / EMAIL_LOGO_URL / EMAIL_COMPANY_ADDRESS at startup (email config). Invalid values never stop the
// server: they log a warning and fall back to the default, because branding is cosmetic.

export interface Brand {
  /** Buttons, header rule, links. White text sits on it, so it must keep ≥ 4.5:1 contrast with white. */
  color: string;
  /** Absolute https URL of a logo image (shown instead of the "VHI" wordmark), or null. */
  logoUrl: string | null;
  /** Postal address lines for the footer (commercial email rules); empty = no address line. */
  companyAddress: string[];
}

export const DEFAULT_BRAND: Brand = { color: '#7B2D8B', logoUrl: null, companyAddress: [] };
export const MIN_CONTRAST_WITH_WHITE = 4.5;

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG contrast ratio between #RRGGBB and white. */
export function contrastWithWhite(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  return 1.05 / (lum + 0.05);
}

export function brandFromEnv(env: NodeJS.ProcessEnv, production: boolean, warnings: string[]): Brand {
  const brand: Brand = { ...DEFAULT_BRAND, companyAddress: [] };

  const color = env.EMAIL_BRAND_COLOR?.trim();
  if (color) {
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      warnings.push(`EMAIL_BRAND_COLOR must be a #RRGGBB colour; using ${DEFAULT_BRAND.color}.`);
    } else if (contrastWithWhite(color) < MIN_CONTRAST_WITH_WHITE) {
      warnings.push(`EMAIL_BRAND_COLOR ${color} is too light for white button text (contrast ${contrastWithWhite(color).toFixed(2)}:1, needs ${MIN_CONTRAST_WITH_WHITE}:1); using ${DEFAULT_BRAND.color}.`);
    } else {
      brand.color = color.toUpperCase();
    }
  }

  const logo = env.EMAIL_LOGO_URL?.trim();
  if (logo) {
    let ok = false;
    try {
      const url = new URL(logo);
      ok = url.protocol === 'https:' || (!production && url.protocol === 'http:');
    } catch {
      ok = false;
    }
    if (ok) brand.logoUrl = logo;
    else warnings.push('EMAIL_LOGO_URL must be an absolute https URL; showing the "VHI" wordmark instead.');
  }

  // One line per "|" (env values cannot easily hold newlines); blank parts dropped.
  const address = env.EMAIL_COMPANY_ADDRESS?.trim();
  if (address) brand.companyAddress = address.split('|').map((l) => l.trim()).filter(Boolean).slice(0, 5);
  else if (production) warnings.push('EMAIL_COMPANY_ADDRESS is not set: shipment update emails should carry a postal address.');

  return brand;
}
