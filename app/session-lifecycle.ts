export type SessionState = "checking" | "active" | "signed-out" | "unavailable";
const SESSION_EVENT = "dealerSettlement:sessionEvent";

export function clearSessionState(win: Window) {
  try {
    for (const key of Object.keys(win.sessionStorage)) {
      if (key.startsWith("dealerSettlement:")) win.sessionStorage.removeItem(key);
    }
  } catch { /* Storage may be disabled; authentication still happens on the server. */ }
}

export function createSessionLifecycle(win: Window, onState: (state: SessionState) => void) {
  let identity: string | null = null;
  let sequence = 0;
  let stopped = false;
  let disposed = false;
  let request: AbortController | null = null;
  let inFlight: Promise<void> | null = null;
  let active = false;
  let lastVerifiedAt = 0;
  const hide = () => { win.document.documentElement.dataset.sessionHidden = "true"; };
  const announce = (type: "logout" | "login", key?: string) => {
    try { win.localStorage.setItem(SESSION_EVENT, JSON.stringify({ type, key, nonce: Date.now() + Math.random() })); }
    catch { /* Focus and page restoration checks also protect tabs without storage. */ }
  };
  const cancel = () => { sequence++; request?.abort(); request = null; inFlight = null; };
  const signOut = () => {
    stopped = true;
    active = false;
    cancel();
    hide();
    clearSessionState(win);
    onState("signed-out");
  };
  const check = (force = false): Promise<void> => {
    if (stopped || disposed || win.document.visibilityState === "hidden") return Promise.resolve();
    // Focus, visibility and pageshow often arrive together. Share the same
    // request, and ignore a duplicate focus immediately after it completes.
    if (inFlight) return inFlight;
    if (!force && active && Date.now() - lastVerifiedAt < 1000) return Promise.resolve();
    const version = ++sequence;
    const controller = new AbortController();
    request = controller;
    if (!active) { hide(); onState("checking"); }
    const task = Promise.resolve().then(async () => {
      try {
        const response = await win.fetch("/api/session", {
          cache: "no-store", credentials: "same-origin", redirect: "error", signal: controller.signal,
        });
        if (version !== sequence || disposed || stopped) return;
        if (response.status === 401 || response.status === 403) { signOut(); return; }
        if (!response.ok) throw new Error("Session verification failed");
        const session = await response.json() as { userId?: string; role?: string; dealerId?: number | null };
        if (version !== sequence || disposed || stopped) return;
        if (!session.userId || !["admin", "dealer", "viewer"].includes(session.role ?? "")) throw new Error("Invalid session");
        const key = JSON.stringify([session.userId, session.role, session.dealerId]);
        if (identity !== null && identity !== key) {
          stopped = true;
          active = false;
          hide();
          clearSessionState(win);
          win.location.replace("/");
          return;
        }
        const firstVerification = identity === null;
        identity = key;
        active = true;
        lastVerifiedAt = Date.now();
        if (firstVerification) announce("login", key);
        onState("active");
        delete win.document.documentElement.dataset.sessionHidden;
      } catch {
        if (version === sequence && !disposed && !stopped) {
          active = false;
          hide();
          onState("unavailable");
        }
      } finally {
        if (version === sequence) { request = null; inFlight = null; }
      }
    });
    inFlight = task;
    return task;
  };
  const onPageHide = () => { cancel(); hide(); };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) { cancel(); hide(); win.location.reload(); }
    else void check();
  };
  const onVisibility = () => {
    if (win.document.visibilityState === "hidden") cancel();
    else void check(true);
  };
  const onFocus = () => { void check(); };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== SESSION_EVENT || !event.newValue) return;
    try {
      const message = JSON.parse(event.newValue) as { type: string; key?: string };
      if (message.type === "logout") signOut();
      else if (message.type === "login" && identity !== null && message.key !== identity) {
        cancel(); hide(); stopped = true; clearSessionState(win); win.location.replace("/");
      }
    } catch { /* Ignore unrelated or malformed storage messages. */ }
  };
  win.addEventListener("pagehide", onPageHide);
  win.addEventListener("pageshow", onPageShow);
  win.addEventListener("focus", onFocus);
  win.addEventListener("storage", onStorage);
  win.document.addEventListener("visibilitychange", onVisibility);
  void check();
  return {
    retry: () => check(true),
    logout() { signOut(); announce("logout"); win.location.replace("/cdn-cgi/access/logout"); },
    dispose() {
      disposed = true; cancel();
      win.removeEventListener("pagehide", onPageHide);
      win.removeEventListener("pageshow", onPageShow);
      win.removeEventListener("focus", onFocus);
      win.removeEventListener("storage", onStorage);
      win.document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
