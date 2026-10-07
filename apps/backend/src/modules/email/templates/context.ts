import type { Footer } from './layout';
import { Brand, DEFAULT_BRAND } from './brand';
import { links, LinkBases, Links } from './urls';

export interface TemplateContext {
  links: Links;
  brand: Brand;
  /** True when SUPPORT_EMAIL is set, so "reply to this email" reaches a real inbox. */
  supportReplyTo: boolean;
  /** Footer for preference-gated customer emails (shipment updates); needs an unsubscribe token. */
  preferenceFooter(): Footer;
}

export function templateContext(options: {
  bases: LinkBases;
  supportReplyTo: boolean;
  unsubscribeToken?: string | null;
  brand?: Brand;
}): TemplateContext {
  const l = links(options.bases);
  return {
    links: l,
    brand: options.brand ?? DEFAULT_BRAND,
    supportReplyTo: options.supportReplyTo,
    preferenceFooter() {
      if (!options.unsubscribeToken) throw new Error('preference emails need an unsubscribe token');
      return { kind: 'preference', unsubscribeUrl: l.unsubscribe(options.unsubscribeToken), settingsUrl: l.clientSettings() };
    },
  };
}
