// panel-core — the Streamer.bot transport every theme panel loads.
//
// Serve this file at /shared/panel-core.js and any StreamScoreboard-style theme panel
// works unchanged — panels load "/shared/panel-core.js" by an absolute path and then
// listen for the two window CustomEvents this dispatches (the same contract as
// StreamScoreboard's stock panel-core, so themes port both ways):
//
//   scoreboard:sync   — full state    (detail = the state object)
//   scoreboard:update — per-change     (detail = { player1, player2, header,
//                        subheader, fields, fieldsEnabled, animate, fullPayload })
//
// The transport is Streamer.bot-native: instead of a dedicated scoreboard server's
// ws://<host>/overlay, this speaks Streamer.bot's
// WebSocket protocol with a raw browser WebSocket (no @streamerbot/client / CDN,
// so it works offline in the OBS CEF browser source). It subscribes to
// General.Custom and unwraps every broadcast whose data.type is 'scoreboard:update'
// (or 'sync') into those same events.
//
// Streamer.bot has no state-on-connect replay. We recreate it: after the Subscribe is
// acknowledged we fire a DoAction naming the push action, which re-broadcasts the
// current scoreboard — so a source added mid-match paints immediately instead of
// staying blank.
//
// Config (set a window global before this loads, or — only when served over http://
// — pass a URL query; file:// OBS sources cannot take query params):
//   window.__SB_WS_URL      — SB WebSocket Server URL (default ws://127.0.0.1:8080/)
//   ?sbport=<n>             — shorthand for ws://127.0.0.1:<n>/  (http:// sources only)
//   window.__SB_SYNC_ACTION — action to DoAction on connect (default 'Scoreboard Push'; '' to skip)
//   window.__SB_DEBUG / ?sbdebug=1 — log the connection + message flow

(() => {
  'use strict';

  const q = (() => { try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(''); } })();
  const WS_URL = window.__SB_WS_URL
    || (q.get('sbport') ? `ws://127.0.0.1:${q.get('sbport')}/` : 'ws://127.0.0.1:8080/');
  const SYNC_ACTION = (typeof window.__SB_SYNC_ACTION === 'string')
    ? window.__SB_SYNC_ACTION
    : 'Scoreboard Push';
  const DEBUG = /[?&]sbdebug=1/.test(location.search) || !!window.__SB_DEBUG;
  const RECONNECT_BASE_MS = 2000;
  const RECONNECT_MAX_MS = 15000;
  const SYNC_FALLBACK_MS = 400; // fire the sync DoAction even if the ack shape isn't recognized

  let ws = null;
  let reconnectDelay = RECONNECT_BASE_MS;
  let msgId = 0;

  const log = (...a) => { if (DEBUG) console.log('[panel-core-sb]', ...a); };

  // Offline indicator — mirrors the stock core (themes may style body.offline).
  const setOffline = (off) => { if (document.body) document.body.classList.toggle('offline', off); };

  // Map an unwrapped Streamer.bot payload to the theme-facing CustomEvents. The
  // detail shapes match StreamScoreboard's stock panel-core, so its themes render
  // with zero changes.
  function dispatch(d) {
    if (!d || typeof d.type !== 'string') return;
    if (d.type === 'sync' && d.scoreboard) {
      window.dispatchEvent(new CustomEvent('scoreboard:sync', { detail: d.scoreboard }));
    } else if (d.type === 'scoreboard:update') {
      window.dispatchEvent(new CustomEvent('scoreboard:update', {
        detail: {
          player1: d.player1,
          player2: d.player2,
          header: d.header,
          subheader: d.subheader,
          fields: d.fields ?? {},
          fieldsEnabled: d.fieldsEnabled ?? {},
          animate: d.animate === true,
          fullPayload: d,
        },
      }));
    }
  }

  function connect() {
    log('connecting to', WS_URL);
    ws = new WebSocket(WS_URL);

    let subId = null;
    let syncFired = false;
    let syncTimer = null;

    function fireSync() {
      if (syncFired) return;
      syncFired = true;
      if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
      if (!SYNC_ACTION) return;
      log('requesting state via DoAction', JSON.stringify(SYNC_ACTION));
      ws.send(JSON.stringify({
        request: 'DoAction',
        id: String(++msgId),
        action: { name: SYNC_ACTION },
        args: { reason: 'overlay-connect' },
      }));
    }

    ws.onopen = () => {
      reconnectDelay = RECONNECT_BASE_MS;
      setOffline(false);

      // The event-SOURCE key is LOWERCASE ('general') in the Subscribe request even
      // though delivered events carry a capitalized source ('General'). This
      // asymmetry is per Streamer.bot's docs; capital 'General' here silently
      // receives nothing.
      subId = String(++msgId);
      ws.send(JSON.stringify({ request: 'Subscribe', id: subId, events: { general: ['Custom'] } }));
      log('sent Subscribe (id', subId + '); waiting for ack before sync');

      syncTimer = setTimeout(fireSync, SYNC_FALLBACK_MS);
    };

    ws.onmessage = (evt) => {
      let m;
      try { m = JSON.parse(evt.data); } catch { return; }

      // Subscribe acknowledgement (response carrying our id, not an event) → now
      // safe to ask for the state re-broadcast.
      if (m && m.id && m.id === subId && !m.event) {
        log('Subscribe ack:', m.status || '(no status field)');
        fireSync();
        return;
      }

      // The payload we care about: General.Custom broadcasts.
      if (m && m.event && m.event.source === 'General' && m.event.type === 'Custom') {
        let d = m.data;
        if (typeof d === 'string') { try { d = JSON.parse(d); } catch { /* leave as string */ } }
        if (!d || typeof d !== 'object' || !d.type) { log('General.Custom with no data.type — ignored'); return; }
        log('General.Custom →', d.type);
        dispatch(d);
        return;
      }
    };

    ws.onclose = () => { setOffline(true); log('closed; reconnecting'); scheduleReconnect(); };
    ws.onerror = () => { log('WebSocket error — is SB\'s WebSocket Server enabled on', WS_URL, 'with authentication OFF?'); };
  }

  function scheduleReconnect() {
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 1.5, RECONNECT_MAX_MS);
      connect();
    }, reconnectDelay);
  }

  function init() { setOffline(true); connect(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
