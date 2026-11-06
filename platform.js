'use strict';

const platform = (() => {
  let sdk;
  let playing = false;
  const local = new URLSearchParams(location.search).has('local') || location.protocol === 'file:';
  const ready = local ? Promise.resolve() : new Promise(resolve => {
    const script = document.createElement('script');
    script.src = 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js';
    const timeout = setTimeout(resolve, 4000);
    function finish() {
      clearTimeout(timeout);
      resolve();
    }
    script.onload = async () => {
      try {
        const candidate = window.PokiSDK;
        await candidate.init();
        sdk = candidate;
      } catch {
        // The game remains playable if the SDK cannot initialize.
      } finally {
        finish();
      }
    };
    script.onerror = finish;
    document.head.append(script);
  });

  function signal(event) {
    try {
      sdk?.[event]();
    } catch {
      // SDK failures must not interrupt a match.
    }
  }

  return {
    ready,
    loaded() { signal('gameLoadingFinished'); },
    start() {
      if (playing) return;
      playing = true;
      signal('gameplayStart');
    },
    stop() {
      if (!playing) return;
      playing = false;
      signal('gameplayStop');
    },
    async commercialBreak() {
      try {
        await sdk?.commercialBreak();
      } catch {
        // Resume play if an ad cannot load.
      }
    }
  };
})();
