/** The sign-in screen the gate shows instead of the app. Self-contained: no scripts or styles from the app bundle. */
export function loginPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#070a12">
<title>Sign in · The Media League</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏆</text></svg>">
<style>
  :root { color-scheme: dark; --bg: #070a12; --panel: #10172a; --line: rgba(214,224,255,.16); --text: #f3f5fa; --muted: #9aa3b8; --gold: #e9b949; --gold-hi: #f9dc82; --gold-lo: #b4802a; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px;
    background: radial-gradient(70% 50% at 50% 0%, rgba(233,185,73,.12), transparent 70%), var(--bg);
    color: var(--text); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { width: min(380px, 100%); text-align: center; }
  svg { color: var(--gold); filter: drop-shadow(0 4px 16px rgba(233,185,73,.45)); }
  h1 { margin: 12px 0 4px; font: 800 2rem/1 "Arial Narrow", "Roboto Condensed", system-ui, sans-serif; text-transform: uppercase; letter-spacing: .01em; }
  p { margin: 0 0 24px; color: var(--muted); }
  form { display: grid; gap: 12px; padding: 24px; border: 1px solid var(--line); border-radius: 16px; background: var(--panel); text-align: left; }
  label { font-size: .875rem; color: var(--muted); }
  input { width: 100%; height: 48px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--line); background: #0c1120; color: var(--text); font-size: 1rem; }
  input:focus { outline: 2px solid var(--gold); outline-offset: 1px; }
  button { height: 48px; border: 0; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 1rem; color: #241703;
    background: linear-gradient(180deg, var(--gold-hi), var(--gold) 55%, var(--gold-lo)); }
  button:disabled { opacity: .6; cursor: wait; }
  .error { min-height: 1.5em; margin: 0; font-size: .875rem; color: #ff9a9d; }
</style>
</head>
<body>
<main>
  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
  <h1>The Media League</h1>
  <p>Enter your password to see your leagues.</p>
  <form id="f">
    <label for="pw">Password</label>
    <input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
    <p class="error" id="err" role="alert"></p>
    <button id="go">Sign in</button>
  </form>
</main>
<script>
  const f = document.getElementById('f'), err = document.getElementById('err'), go = document.getElementById('go');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    go.disabled = true; err.textContent = '';
    try {
      const res = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: f.password.value }) });
      if (res.ok) { location.reload(); return; }
      const body = await res.json().catch(() => ({}));
      err.textContent = body.error || 'Sign-in failed. Try again.';
    } catch {
      err.textContent = 'Could not reach the server. Check your connection and try again.';
    }
    go.disabled = false; f.password.select();
  });
</script>
</body>
</html>`;
}

/** Shown on Vercel when APP_PASSWORD hasn't been set, so the site never opens without a password. */
export function setupPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Setup needed · The Media League</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#070a12;color:#f3f5fa;font:16px/1.6 system-ui,sans-serif}main{max-width:520px}h1{font-size:1.5rem}code{background:#10172a;padding:2px 6px;border-radius:4px;color:#f9dc82}p{color:#9aa3b8}</style></head>
<body><main><h1>Almost there: set a password</h1>
<p>This site is locked until it has a password. In your Vercel project, open <strong>Settings → Environment Variables</strong>, add <code>APP_PASSWORD</code> with a password of your choice, then redeploy.</p></main></body></html>`;
}
