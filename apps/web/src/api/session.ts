/**
 * Token storage. Access token (15 min) and refresh token (30 days) are kept in localStorage so the
 * admin PWA survives reloads; every storage access is guarded (private mode, blocked storage).
 */
const KEY = 'rf.session.v1';

type Stored = { access: string; refresh: string; orgId?: string };
type Listener = (reason: 'login' | 'logout' | 'expired' | 'refresh') => void;

function read(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

function write(s: Stored | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: session stays in memory */
  }
}

class Session {
  private s: Stored | null = read();
  private listeners = new Set<Listener>();

  get accessToken() {
    return this.s?.access ?? null;
  }
  get refreshToken() {
    return this.s?.refresh ?? null;
  }
  get orgId() {
    return this.s?.orgId ?? null;
  }
  get isAuthenticated() {
    return !!this.s?.refresh;
  }

  setTokens(access: string, refresh: string, reason: 'login' | 'refresh' = 'refresh') {
    this.s = { ...(this.s ?? {}), access, refresh };
    write(this.s);
    this.emit(reason);
  }

  setOrg(orgId: string) {
    if (!this.s) return;
    this.s = { ...this.s, orgId };
    write(this.s);
  }

  clear(reason: 'logout' | 'expired' = 'logout') {
    this.s = null;
    write(null);
    this.emit(reason);
  }

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  /** re-read storage (other tab) */
  reload() {
    this.s = read();
  }

  private emit(r: Parameters<Listener>[0]) {
    this.listeners.forEach((l) => l(r));
  }
}

export const session = new Session();
