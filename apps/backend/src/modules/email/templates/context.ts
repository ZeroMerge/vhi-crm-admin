import type { Footer } from './layout';
import { links, LinkBases, Links } from './urls';

export interface TemplateContext {
  links: Links;
  /** True when SUPPORT_EMAIL is set, so "reply to this email" reaches a real inbox. */
  supportReplyTo: boolean;
  /** Footer for preference-gated customer emails (shipment updates); needs an unsubscribe token. */
  preferenceFooter(): Footer;
}

export function templateContext(options: { bases: LinkBases; supportReplyTo: boolean; unsubscribeToken?: string | null }): TemplateContext {
  const l = links(options.bases);
  return {
    links: l,
    supportReplyTo: options.supportReplyTo,
    preferenceFooter() {
      if (!options.unsubscribeToken) throw new Error('preference emails need an unsubscribe token');
      return { kind: 'preference', unsubscribeUrl: l.unsubscribe(options.unsubscribeToken), settingsUrl: l.clientSettings() };
    },
  };
}
