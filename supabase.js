// ============================================
// ILIOS72 — Supabase Integration
// ============================================

const SUPABASE_URL = 'https://xbetqhmzwolivitmsuyn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhiZXRxaG16d29saXZpdG1zdXluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwMDc1MzQsImV4cCI6MjA5OTU4MzUzNH0.pczWb6c_ayGNBIJQZIYdIjNw2oFWglrB0g4Li7bxYoo';

// ============================================
// SUPABASE CLIENT (vanilla JS, no npm needed)
// ============================================
class SupabaseClient {
  constructor(url, key) {
    this.url = url;
    this.key = key;
    this.token = null;
    this.user = null;
    this.profile = null;
  }

  headers(extra = {}) {
    const h = {
      'Content-Type': 'application/json',
      'apikey': this.key,
      'Authorization': `Bearer ${this.token || this.key}`,
      ...extra
    };
    return h;
  }

  // Pulls the best available error message out of any GoTrue/PostgREST
  // error response shape (they aren't all consistent).
  _extractError(data, fallback) {
    if (!data) return fallback;
    return data.error_description || data.msg || data.message || data.error || fallback;
  }

  // ── AUTH ──────────────────────────────────
  async signIn(email, password) {
    const r = await fetch(`${this.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': this.key },
      body: JSON.stringify({ email, password })
    });
    const data = await r.json().catch(() => ({}));

    // IMPORTANT: check r.ok AND that we actually got a token back.
    // Older code only checked data.error / data.error_description, which
    // misses newer GoTrue error shapes (e.g. { msg, error_code }) and
    // caused a raw "Cannot read properties of undefined (reading 'id')"
    // crash instead of a real message.
    if (!r.ok || !data.access_token) {
      throw new Error(this._extractError(data, 'Login failed. Please check your email and password.'));
    }

    this.token = data.access_token;
    this.user  = data.user;
    localStorage.setItem('i72_sb_token', this.token);
    localStorage.setItem('i72_sb_user',  JSON.stringify(this.user));
    await this.loadProfile();
    return data;
  }

  async signUp(email, password, fullName) {
    const r = await fetch(`${this.url}/auth/v1/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': this.key },
      body: JSON.stringify({ email, password, data: { full_name: fullName } })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(this._extractError(data, 'Could not create account.'));
    return data;
  }

  async signOut() {
    if (this.token) {
      await fetch(`${this.url}/auth/v1/logout`, {
        method: 'POST', headers: this.headers()
      }).catch(() => {});
    }
    this.token = null; this.user = null; this.profile = null;
    localStorage.removeItem('i72_sb_token');
    localStorage.removeItem('i72_sb_user');
  }

  async restoreSession() {
    const token = localStorage.getItem('i72_sb_token');
    const user  = localStorage.getItem('i72_sb_user');
    if (!token || !user) return false;
    this.token = token;
    this.user  = JSON.parse(user);
    try { await this.loadProfile(); return true; }
    catch(e) { await this.signOut(); return false; }
  }

  async loadProfile() {
    const data = await this.from('profiles').select('*').eq('id', this.user.id).single();
    this.profile = data;
    return data;
  }

  isCompany() { return this.profile?.role === 'company'; }
  isClient()  { return this.profile?.role === 'client';  }

  // ── PASSWORD RESET ────────────────────────
  // Step 1: request the reset email. redirectTo should point at
  // reset-password.html on this same site so the link the user
  // receives actually lands somewhere that can handle it.
  async resetPasswordForEmail(email, redirectTo) {
    const url = `${this.url}/auth/v1/recover` +
      (redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '');
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': this.key },
      body: JSON.stringify({ email })
    });
    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      const code = data.code || data.error_code;
      if (code === 'over_email_send_rate_limit') {
        throw new Error('Too many reset attempts. Supabase limits this to a few emails per hour on the default plan — please wait and try again shortly.');
      }
      throw new Error(this._extractError(data, 'Could not send reset email. Please try again.'));
    }
    return true;
  }

  // Step 2: once the user clicks the email link and lands back on
  // reset-password.html with a recovery access_token, use that token
  // (NOT this.token) to actually set the new password.
  async updatePasswordWithRecoveryToken(accessToken, newPassword) {
    const r = await fetch(`${this.url}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'apikey': this.key,
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({ password: newPassword })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(this._extractError(data, 'Could not update password. The reset link may have expired — request a new one.'));
    }
    return data;
  }

  // ── DATABASE ──────────────────────────────
  from(table) { return new QueryBuilder(this, table); }

  async rpc(fn, params = {}) {
    const r = await fetch(`${this.url}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: this.headers(),
      body: JSON.stringify(params)
    });
    return r.json();
  }
}

class QueryBuilder {
  constructor(client, table) {
    this.client = client;
    this.table  = table;
    this._select = '*';
    this._filters = [];
    this._order   = null;
    this._limit   = null;
    this._single  = false;
    this._method  = 'GET';
    this._body    = null;
    this._prefer  = '';
  }

  select(cols) { this._select = cols; return this; }
  eq(col, val) { this._filters.push(`${col}=eq.${encodeURIComponent(val)}`); return this; }
  neq(col, val){ this._filters.push(`${col}=neq.${encodeURIComponent(val)}`); return this; }
  like(col,val){ this._filters.push(`${col}=like.${encodeURIComponent(val)}`); return this; }
  order(col, { ascending = true } = {}) { this._order = `${col}.${ascending?'asc':'desc'}`; return this; }
  limit(n)     { this._limit = n; return this; }
  single()     { this._single = true; this._limit = 1; return this; }

  insert(data, opts = {}) {
    this._method = 'POST';
    this._body   = JSON.stringify(Array.isArray(data) ? data : [data]);
    this._prefer = opts.returning === false ? '' : 'return=representation';
    return this;
  }

  upsert(data, opts = {}) {
    this._method = 'POST';
    this._body   = JSON.stringify(Array.isArray(data) ? data : [data]);
    this._prefer = 'resolution=merge-duplicates,return=representation';
    return this;
  }

  update(data) {
    this._method = 'PATCH';
    this._body   = JSON.stringify(data);
    this._prefer = 'return=representation';
    return this;
  }

  delete() { this._method = 'DELETE'; return this; }

  async then(resolve, reject) {
    try {
      let url = `${this.client.url}/rest/v1/${this.table}?select=${this._select}`;
      this._filters.forEach(f => url += `&${f}`);
      if (this._order) url += `&order=${this._order}`;
      if (this._limit) url += `&limit=${this._limit}`;

      const headers = this.client.headers();
      if (this._prefer) headers['Prefer'] = this._prefer;
      if (this._single) headers['Accept'] = 'application/vnd.pgrst.object+json';

      const r = await fetch(url, {
        method: this._method,
        headers,
        body: this._body || undefined
      });

      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: r.statusText }));
        throw new Error(err.message || err.details || r.statusText);
      }

      const text = await r.text();
      const data = text ? JSON.parse(text) : null;
      resolve(data);
    } catch(e) { reject(e); }
  }
}

// Global instance
const sb = new SupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY);
