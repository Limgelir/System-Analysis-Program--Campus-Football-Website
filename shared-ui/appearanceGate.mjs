const sameSession = (a, b) => a?.token === b?.token && a?.role === b?.role;

// Keep preparation separate from commit: cancelled or stale navigation must
// never replace a live form, and a response for one account cannot enable another.
export function createAppearanceGate({ getSession, request, load, apply, preview = false }) {
  const plans = new WeakMap();
  let sequence = 0;
  let initialized = false;
  let active = { enabled: false };
  return {
    async prepare(to, from) {
      if (initialized && from?.path === to.path && sameSession(getSession(to), active.session)) return;
      const current = ++sequence;
      const session = getSession(to);
      let plan = { enabled: false, session };
      try {
        if (preview && to.path !== '/glass-preview') {
          plan = { enabled: true, session, key: 'local-preview', localPreview: true };
        } else if (!preview && session?.token) {
          const decision = await request(session);
          if (decision?.enabled === true && decision.account?.role === session.role &&
              Number.isSafeInteger(decision.account.id) && decision.account.id > 0) {
            plan = { enabled: true, session, key: `${decision.account.role}:${decision.account.id}`, localPreview: false };
          }
        }
        if (plan.enabled && current === sequence && sameSession(session, getSession(to))) await load();
      } catch { plan = { enabled: false, session }; }
      if (current === sequence && sameSession(session, getSession(to))) plans.set(to, { ...plan, sequence: current });
    },
    commit(to, failure) {
      const plan = plans.get(to);
      plans.delete(to);
      if (failure || !plan || plan.sequence !== sequence) return;
      if (!sameSession(plan.session, getSession(to))) return this.reset();
      active = plan;
      initialized = true;
      apply(plan);
    },
    checkSession(to) {
      if (!sameSession(getSession(to), active.session)) this.reset();
    },
    reset() {
      sequence++;
      active = { enabled: false };
      initialized = false;
      apply(active);
    }
  };
}

export async function requestAppearance(session, { base = '', fetcher = fetch, timeoutMs = 2000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(`${base.replace(/\/+$/, '')}/api/appearance`, {
      headers: { Authorization: `Bearer ${session.token}` },
      cache: 'no-store', credentials: 'omit', signal: controller.signal
    });
    if (!response.ok) return { enabled: false };
    const body = await response.json();
    return body?.success === true ? body.data : { enabled: false };
  } finally { clearTimeout(timer); }
}
