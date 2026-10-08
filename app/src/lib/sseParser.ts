// Server-Sent Events parser as a pure reducer (no imports, no I/O).
// This file is byte-identical in admin/app/src/lib/ and client/src/lib/; the backend test runner checks it.
// Follows the WHATWG event-stream rules: `event`, `data` (multi-line), `id`, comments (`:`), LF / CR / CRLF line
// endings, and lines or CRLF pairs split across chunks.

export interface SseMessage {
  event: string;
  data: string;
  lastEventId: string;
}

export interface SseParserState {
  // Incomplete line carried over to the next chunk.
  buffer: string;
  // The previous chunk ended with CR: a leading LF in the next chunk belongs to that line ending.
  pendingCR: boolean;
  eventType: string;
  dataLines: string[];
  lastEventId: string;
}

export const initialSseState: SseParserState = {
  buffer: '',
  pendingCR: false,
  eventType: '',
  dataLines: [],
  lastEventId: '',
};

export function parseSse(state: SseParserState, chunk: string): { state: SseParserState; messages: SseMessage[] } {
  let text = chunk;
  if (state.pendingCR && text.startsWith('\n')) text = text.slice(1);
  text = state.buffer + text;

  let eventType = state.eventType;
  let dataLines = state.dataLines;
  let lastEventId = state.lastEventId;
  const messages: SseMessage[] = [];

  let start = 0;
  let pendingCR = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== '\n' && ch !== '\r') continue;
    const line = text.slice(start, i);
    if (ch === '\r') {
      if (i + 1 < text.length) {
        if (text[i + 1] === '\n') i++;
      } else {
        pendingCR = true;
      }
    }
    start = i + 1;

    if (line === '') {
      // Blank line: dispatch (only when there is data), then reset the event type and data.
      if (dataLines.length > 0) {
        messages.push({ event: eventType || 'message', data: dataLines.join('\n'), lastEventId });
      }
      eventType = '';
      dataLines = [];
      continue;
    }
    if (line.startsWith(':')) continue; // comment, e.g. heartbeat ": ping"

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') eventType = value;
    else if (field === 'data') dataLines = [...dataLines, value];
    else if (field === 'id' && !value.includes('\u0000')) lastEventId = value;
    // `retry` and unknown fields are ignored.
  }

  return {
    state: { buffer: text.slice(start), pendingCR, eventType, dataLines, lastEventId },
    messages,
  };
}
