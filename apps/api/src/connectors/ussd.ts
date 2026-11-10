/**
 * USSD sessions for any aggregator (M5, EF-NOT-04, EF-NOT-05): input modes, paging of long screens
 * and rendering of the response in the format the connector describes. Pure functions, no I/O.
 */
import { UssdFlag, UssdSpec } from './connector.types';
import { render, renderText } from './template';

export const USSD_DEFAULTS = { max_chars: 160, session_ttl_s: 180, more_key: '0', more_label: 'Suite', separator: '*' } as const;

/** Options of one USSD entry point, resolved from the connector (or the defaults for /v1/inbound/ussd). */
export interface UssdOptions {
  text_mode: 'cumulative' | 'last';
  separator: string;
  max_chars: number;
  session_ttl_s: number;
  more_key: string;
  more_label: string;
}

export function ussdOptions(spec?: Pick<UssdSpec, 'inbound' | 'max_chars' | 'session_ttl_s' | 'more'>): UssdOptions {
  return {
    text_mode: spec?.inbound.text_mode ?? 'cumulative',
    separator: spec?.inbound.separator ?? USSD_DEFAULTS.separator,
    max_chars: spec?.max_chars ?? USSD_DEFAULTS.max_chars,
    session_ttl_s: spec?.session_ttl_s ?? USSD_DEFAULTS.session_ttl_s,
    more_key: spec?.more?.key ?? USSD_DEFAULTS.more_key,
    more_label: spec?.more?.label ?? USSD_DEFAULTS.more_label,
  };
}

/** One logical screen produced by the menu, before paging. */
export interface UssdScreen {
  text: string;
  end: boolean;
}

/** Server-side state of a session (Redis or PostgreSQL), short-lived. */
export interface UssdState {
  /** Business inputs of the session, "Suite" presses excluded. */
  inputs: string[];
  /** Last raw text received (cumulative mode): detects repeats and the new input. */
  raw: string;
  /** Pages of the current screen and the page shown. */
  pages: string[];
  page: number;
  end: boolean;
}

/**
 * Splits a screen into pages of at most `max` characters. Every page but the last ends with
 * "<key>. <label>"; lines are kept whole when possible.
 */
export function paginate(text: string, o: Pick<UssdOptions, 'max_chars' | 'more_key' | 'more_label'>): string[] {
  const more = `${o.more_key}. ${o.more_label}`;
  const capacity = o.max_chars - more.length - 1;
  const pages: string[] = [];
  let rest = text;
  while (rest.length > o.max_chars) {
    const window = rest.slice(0, capacity + 1);
    let cut = window.lastIndexOf('\n');
    if (cut <= 0) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = capacity;
    pages.push(`${rest.slice(0, cut).trimEnd()}\n${more}`);
    rest = rest.slice(cut).replace(/^[\n ]+/, '');
  }
  pages.push(rest);
  return pages;
}

/** Result of reading one hop: either the next page of the current screen, or the inputs to evaluate. */
export type UssdStep = { kind: 'page'; state: UssdState } | { kind: 'repeat'; state: UssdState } | { kind: 'evaluate'; inputs: string[]; raw: string };

/**
 * Reconstructs the inputs of a session from what the aggregator sent.
 * - cumulative: "1*2*4821" holds every input; with a stored state only the new part is read, and an
 *   identical text (aggregator retry) replays the last screen without running the action again;
 * - last: only the last input is sent; the stored state gives the previous ones. The first hop of a
 *   session always shows the main menu (some aggregators send the dialled code as text).
 * In both modes, the "Suite" key on a paged screen shows the next page.
 */
export function readHop(text: string, state: UssdState | null, o: Pick<UssdOptions, 'text_mode' | 'separator' | 'more_key'>): UssdStep {
  const input = text.trim();
  // `end` applies to the last page only: a long closing screen is still paged.
  const morePage = (s: UssdState): UssdState | null => (s.page < s.pages.length - 1 ? { ...s, page: s.page + 1 } : null);
  if (o.text_mode === 'last') {
    if (!state) return { kind: 'evaluate', inputs: [], raw: input };
    const next = input === o.more_key ? morePage(state) : null;
    if (next) return { kind: 'page', state: next };
    return { kind: 'evaluate', inputs: [...state.inputs, input], raw: input };
  }
  const parts = input ? input.split(o.separator) : [];
  if (!state) return { kind: 'evaluate', inputs: parts, raw: input };
  if (input === state.raw) return { kind: 'repeat', state };
  const prefix = state.raw ? `${state.raw}${o.separator}` : '';
  if (!input.startsWith(prefix)) return { kind: 'evaluate', inputs: parts, raw: input };
  const added = input.slice(prefix.length).split(o.separator);
  const next = added.length === 1 && added[0] === o.more_key ? morePage(state) : null;
  if (next) return { kind: 'page', state: { ...next, raw: input } };
  return { kind: 'evaluate', inputs: [...state.inputs, ...added], raw: input };
}

/** Text shown for the current page, and whether the session goes on. */
export function currentPage(state: UssdState): UssdScreen {
  const last = state.page >= state.pages.length - 1;
  return { text: state.pages[state.page] ?? '', end: last && state.end };
}

export interface UssdHttpResponse {
  contentType: 'text/plain' | 'application/json';
  body: unknown;
  headers: Record<string, string>;
}

/** Renders a screen in the format described by the connector (text with prefixes, or JSON template). */
export function renderUssdResponse(r: UssdSpec['response'], screen: UssdScreen, sessionId: string): UssdHttpResponse {
  const values: { continue: UssdFlag; end: UssdFlag } = r.continue_values ?? (r.type === 'text' ? { continue: 'CON', end: 'END' } : { continue: true, end: false });
  const flag = screen.end ? values.end : values.continue;
  const vars = { message: screen.text, continue: flag, session_id: sessionId };
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.headers ?? {})) headers[k] = renderText(v, vars);
  if (r.type === 'text') {
    const prefix = screen.end ? (r.end_prefix ?? 'END ') : (r.continue_prefix ?? 'CON ');
    return { contentType: 'text/plain', body: `${prefix}${screen.text}`, headers };
  }
  return { contentType: 'application/json', body: render(r.body, vars), headers };
}
