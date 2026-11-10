import { currentPage, paginate, readHop, renderUssdResponse, ussdOptions, UssdState } from './ussd';

const o = ussdOptions();

function state(partial: Partial<UssdState>): UssdState {
  return { inputs: [], raw: '', pages: ['x'], page: 0, end: false, ...partial };
}

describe('USSD options (M5)', () => {
  it('defaults to cumulative input, 160 characters, 180 s and "0. Suite"', () => {
    expect(o).toEqual({ text_mode: 'cumulative', separator: '*', max_chars: 160, session_ttl_s: 180, more_key: '0', more_label: 'Suite' });
    expect(
      ussdOptions({ inbound: { session_id: 's', phone: 'p', text: 't', text_mode: 'last', separator: '#' }, max_chars: 182, session_ttl_s: 60, more: { key: '99', label: 'Plus' } }),
    ).toEqual({ text_mode: 'last', separator: '#', max_chars: 182, session_ttl_s: 60, more_key: '99', more_label: 'Plus' });
  });
});

describe('paginate (screens <= max_chars)', () => {
  it('keeps a short screen whole', () => {
    expect(paginate('RecallFarm\n1. Rappels', o)).toEqual(['RecallFarm\n1. Rappels']);
    expect(paginate('a'.repeat(160), o)).toEqual(['a'.repeat(160)]);
  });

  it('cuts long screens at line ends, adds "0. Suite" and never exceeds the limit', () => {
    const lines = Array.from({ length: 12 }, (_, i) => `${i + 1}. Newcastle Lot poulets ${i + 1} (code ${4800 + i})`);
    const pages = paginate(lines.join('\n'), o);
    expect(pages.length).toBeGreaterThan(1);
    pages.forEach((p) => expect(p.length).toBeLessThanOrEqual(160));
    pages.slice(0, -1).forEach((p) => expect(p.endsWith('\n0. Suite')).toBe(true));
    expect(pages[pages.length - 1].endsWith('0. Suite')).toBe(false);
    // Every line is shown once, whole.
    const shown = pages.map((p) => p.replace(/\n0\. Suite$/, '')).join('\n').split('\n');
    expect(shown).toEqual(lines);
  });

  it('cuts a long line at a space, or anywhere when there is none', () => {
    const words = paginate(`${'mot '.repeat(60)}fin`, { max_chars: 60, more_key: '0', more_label: 'Suite' });
    words.forEach((p) => expect(p.length).toBeLessThanOrEqual(60));
    expect(words.join(' ').replace(/\n0\. Suite/g, '').replace(/\s+/g, ' ')).toBe(`${'mot '.repeat(60)}fin`);
    const blob = paginate('x'.repeat(130), { max_chars: 60, more_key: '0', more_label: 'Suite' });
    blob.forEach((p) => expect(p.length).toBeLessThanOrEqual(60));
    expect(blob.map((p) => p.replace('\n0. Suite', '')).join('')).toBe('x'.repeat(130));
  });
});

describe('readHop: cumulative mode', () => {
  it('reads every input without a stored session', () => {
    expect(readHop('', null, o)).toEqual({ kind: 'evaluate', inputs: [], raw: '' });
    expect(readHop('2*4821', null, o)).toEqual({ kind: 'evaluate', inputs: ['2', '4821'], raw: '2*4821' });
  });

  it('reads only the new part, and replays the last screen on an identical retry', () => {
    const s = state({ inputs: ['3'], raw: '3' });
    expect(readHop('3*1', s, o)).toEqual({ kind: 'evaluate', inputs: ['3', '1'], raw: '3*1' });
    expect(readHop('3', s, o)).toEqual({ kind: 'repeat', state: s });
    expect(readHop('9*9', s, o)).toEqual({ kind: 'evaluate', inputs: ['9', '9'], raw: '9*9' });
    expect(readHop('1', state({ raw: '' }), o)).toEqual({ kind: 'evaluate', inputs: ['1'], raw: '1' });
  });

  it('turns the page on "0" when the screen has more pages, otherwise "0" is an input', () => {
    const paged = state({ inputs: ['1'], raw: '1', pages: ['p1', 'p2', 'p3'], page: 0, end: true });
    const step = readHop('1*0', paged, o);
    expect(step).toEqual({ kind: 'page', state: { ...paged, raw: '1*0', page: 1 } });
    if (step.kind !== 'page') throw new Error('page attendu');
    expect(currentPage(step.state)).toEqual({ text: 'p2', end: false });
    const last = { ...paged, raw: '1*0*0', page: 2 };
    expect(currentPage(last)).toEqual({ text: 'p3', end: true });
    expect(readHop('3*1*0', state({ inputs: ['3', '1'], raw: '3*1' }), o)).toEqual({ kind: 'evaluate', inputs: ['3', '1', '0'], raw: '3*1*0' });
  });
});

describe('readHop: last-input mode', () => {
  const last = { ...o, text_mode: 'last' as const };

  it('starts every new session on the main menu, whatever the text', () => {
    expect(readHop('*123*7#', null, last)).toEqual({ kind: 'evaluate', inputs: [], raw: '*123*7#' });
  });

  it('appends the last input to the stored ones (the confirmation code is not read as a menu choice)', () => {
    expect(readHop('4821', state({ inputs: ['2'], raw: '2' }), last)).toEqual({ kind: 'evaluate', inputs: ['2', '4821'], raw: '4821' });
  });

  it('turns the page on "0" only when there is a next page', () => {
    const paged = state({ inputs: ['1'], pages: ['a', 'b'], page: 0 });
    expect(readHop('0', paged, last)).toEqual({ kind: 'page', state: { ...paged, page: 1 } });
    expect(readHop('0', { ...paged, page: 1 }, last)).toEqual({ kind: 'evaluate', inputs: ['1', '0'], raw: '0' });
  });
});

describe('renderUssdResponse (free response format)', () => {
  const cont = { text: 'Menu', end: false };
  const end = { text: 'Merci', end: true };

  it('writes text with the default or configured prefixes', () => {
    expect(renderUssdResponse({ type: 'text' }, cont, 's1')).toEqual({ contentType: 'text/plain', body: 'CON Menu', headers: {} });
    expect(renderUssdResponse({ type: 'text' }, end, 's1').body).toBe('END Merci');
    const plain = renderUssdResponse({ type: 'text', continue_prefix: '', end_prefix: '', headers: { Freeflow: '{{continue}}' }, continue_values: { continue: 'FC', end: 'FB' } }, end, 's1');
    expect(plain).toEqual({ contentType: 'text/plain', body: 'Merci', headers: { Freeflow: 'FB' } });
  });

  it('fills a JSON template with booleans by default, or the configured values', () => {
    const body = { message: '{{message}}', continue: '{{continue}}', session: '{{session_id}}' };
    expect(renderUssdResponse({ type: 'json', body }, cont, 's1').body).toEqual({ message: 'Menu', continue: true, session: 's1' });
    expect(renderUssdResponse({ type: 'json', body }, end, 's1').body).toEqual({ message: 'Merci', continue: false, session: 's1' });
    const actions = { type: 'json' as const, body: { Type: '{{continue}}', Message: '{{message}}' }, continue_values: { continue: 'Response', end: 'Release' } };
    expect(renderUssdResponse(actions, end, 's1')).toEqual({ contentType: 'application/json', body: { Type: 'Release', Message: 'Merci' }, headers: {} });
    expect(renderUssdResponse({ ...actions, continue_values: { continue: 1, end: 0 } }, cont, 's1').body).toEqual({ Type: 1, Message: 'Menu' });
  });
});
