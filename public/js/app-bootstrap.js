function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${src}"]`);
    if (existingScript) {
      if (existingScript.dataset.loaded === 'true') {
        resolve();
        return;
      }

      existingScript.addEventListener('load', resolve, { once: true });
      existingScript.addEventListener('error', reject, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function waitForCodeMirror(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (window.CodeMirror) {
      resolve(window.CodeMirror);
      return;
    }

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (window.CodeMirror) {
        window.clearInterval(timer);
        resolve(window.CodeMirror);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(timer);
        reject(new Error('CodeMirror core did not load before addon bootstrap.'));
      }
    }, 50);
  });
}

async function loadDeferredCodeMirrorModes() {
  try {
    await waitForCodeMirror();
    await loadScript('/cdn/codemirror-javascript.min.js');
    await loadScript('/cdn/codemirror-css.min.js');
    await loadScript('/cdn/codemirror-xml.min.js');
  } catch (error) {
    console.error('[AppBootstrap] Deferred CodeMirror mode load failed:', error);
  }
}

window.addEventListener('load', () => {
  window.setTimeout(() => {
    void loadDeferredCodeMirrorModes();
  }, 3000);
});

if ('requestIdleCallback' in window) {
  requestIdleCallback(() => {
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = window.location.origin;
    document.head.appendChild(link);
  });
}
