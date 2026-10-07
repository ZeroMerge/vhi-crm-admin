// Grouped message emails: which of the stored messages are shown, and how their times are written.

export interface MessageEntry {
  /** ISO timestamp taken when the message was queued. */
  sentAt: string;
  subject: string;
  body: string;
}

/** At most this many messages are stored per grouped email (the upsert keeps the newest) and shown. */
export const MESSAGE_GROUP_MAX = 10;
/** Total characters of message text shown in one email. */
export const MESSAGE_GROUP_MAX_CHARS = 10_000;

/**
 * Newest messages that fit both caps, returned oldest first, plus how many earlier messages are left out.
 * `total` is the number of messages in the group (it can exceed the stored list, which keeps only the newest ones).
 */
export function selectMessages(messages: MessageEntry[], total: number): { shown: MessageEntry[]; earlier: number } {
  const shown: MessageEntry[] = [];
  let chars = 0;
  for (let i = messages.length - 1; i >= 0 && shown.length < MESSAGE_GROUP_MAX; i--) {
    const length = Array.from(messages[i].body).length;
    // The newest message is always shown (bodies are capped at 10,000 characters by the send routes).
    if (shown.length > 0 && chars + length > MESSAGE_GROUP_MAX_CHARS) break;
    shown.unshift(messages[i]);
    chars += length;
  }
  return { shown, earlier: Math.max(0, Math.max(total, messages.length) - shown.length) };
}

const FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

/** "6 Oct 2026, 14:05 UTC": fixed time zone, so the same row always renders the same text (idempotent retries). */
export function formatSentAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : `${FORMAT.format(date)} UTC`;
}
