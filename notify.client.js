// Runs in the browser: the "Notifiche" card. Signs this phone up for popup notifications
// (saved in Supabase through a token-checked function) or explains what is missing.
(function () {
  var CFG = JSON.parse(document.getElementById('push-config').textContent);
  var box = document.getElementById('notif');
  if (!box) return;
  var supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  function rpc(fn, args) {
    return fetch(CFG.url + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: { apikey: CFG.key, Authorization: 'Bearer ' + CFG.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function save(sub) {
    var j = sub.toJSON();
    return rpc('holyexam_save_subscription', { p_token: CFG.token, p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth })
      .then(function (ok) { if (!ok) throw new Error('rifiutato'); });
  }
  function keyBytes(text) {
    var b = (text + '==='.slice((text.length + 3) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(b), function (c) { return c.charCodeAt(0); });
  }
  var reg = supported && CFG ? navigator.serviceWorker.register('sw.js') : null;
  if (reg) reg.catch(function () {});
  function current() { return reg ? reg.then(function (r) { return r.pushManager.getSubscription(); }) : Promise.resolve(null); }

  function view(state, msg) {
    var html = '<div class="notif-head"><span class="bell">🔔</span><b>Notifiche</b></div>';
    var info = '<small class="muted">Un avviso per ogni nuovo voto e la sera prima di una verifica. Il voto non compare nella notifica.</small>';
    if (!CFG) html += '<small class="muted">Non disponibili in questa versione.</small>';
    else if (state === 'install') html += '<p>Su iPhone funzionano solo dall\'app: in Safari tocca <b>Condividi</b> <span class="share">⬆︎</span> e poi <b>«Aggiungi alla schermata Home»</b>, poi apri «Voti» dalla Home.</p>' + info;
    else if (state === 'unsupported') html += '<small class="muted">Questo browser non supporta le notifiche.</small>';
    else if (state === 'denied') html += '<p>Le notifiche sono bloccate. Riattivale in <b>Impostazioni › Notifiche › Voti</b>.</p>';
    else if (state === 'on') html += '<p class="good">Attive su questo telefono.</p><button class="btn ghost" data-act="off">Disattiva</button>';
    else html += info + '<button class="btn" data-act="on">Attiva notifiche</button>';
    if (msg) html += '<p class="bad small">' + msg + '</p>';
    box.innerHTML = html;
    var b = box.querySelector('button');
    if (b) b.addEventListener('click', b.dataset.act === 'on' ? enable : disable);
  }
  function state() {
    if (!supported) return Promise.resolve(ios && !installed ? 'install' : 'unsupported');
    if (Notification.permission === 'denied') return Promise.resolve('denied');
    if (Notification.permission !== 'granted') return Promise.resolve('off');
    return current().then(function (s) { return s ? 'on' : 'off'; });
  }
  // Must start straight from the tap: iPhones only show the permission prompt in response to one.
  function enable() {
    Notification.requestPermission().then(function (p) {
      if (p !== 'granted') return view(p === 'denied' ? 'denied' : 'off');
      return reg.then(function (r) {
        return r.pushManager.getSubscription().then(function (s) {
          return s || r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(CFG.vapid) });
        });
      }).then(save).then(function () { view('on'); })
        .catch(function () { view('off', 'Non è stato possibile attivarle. Riprova.'); });
    });
  }
  function disable() {
    current().then(function (s) {
      if (!s) return;
      return rpc('holyexam_remove_subscription', { p_token: CFG.token, p_endpoint: s.endpoint }).catch(function () {}).then(function () { return s.unsubscribe(); });
    }).then(function () { view('off'); });
  }
  state().then(function (s) {
    view(s);
    // Phones sometimes renew their sign-up: re-send it on every start.
    if (s === 'on') current().then(function (sub) { if (sub) save(sub).catch(function () {}); });
  });
})();
