let overlayElement: HTMLDivElement | null = null;

interface RestorationSession {
  fileContent: string;
  fileName: string;
  title: string;
  promptText: string;
  targetPlatform?: string;
}

// ── Overlay ───────────────────────────────────────────────────────────────────
function createOverlay(session: RestorationSession, status: 'loading' | 'ready' | 'error') {
  const old = document.getElementById('context-bridge-overlay');
  if (old) old.remove();

  // Inject one-time keyframes
  if (!document.getElementById('cb-kf')) {
    const s = document.createElement('style');
    s.id = 'cb-kf';
    s.textContent = [
      '@keyframes cb-in  { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:translateY(0) } }',
      '@keyframes cb-out { from { opacity:1; transform:translateY(0)   } to { opacity:0; transform:translateY(6px) } }',
      '@keyframes cb-dot { 0%,100%{ opacity:.35; transform:scale(.8) } 50%{ opacity:1; transform:scale(1.1) } }',
    ].join(' ');
    document.head.appendChild(s);
  }

  overlayElement = document.createElement('div');
  overlayElement.id = 'context-bridge-overlay';

  const isLoading = status === 'loading';

  Object.assign(overlayElement.style, {
    position:        'fixed',
    bottom:          '28px',
    left:            '50%',
    transform:       'translateX(-50%) translateY(12px)',
    display:         'inline-flex',
    alignItems:      'center',
    gap:             '10px',
    padding:         '10px 18px',
    borderRadius:    '100px',
    background:      'rgba(12, 12, 14, 0.88)',
    backdropFilter:  'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border:          '1px solid rgba(255,255,255,0.07)',
    boxShadow:       '0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.04)',
    fontFamily:      '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize:        '13px',
    fontWeight:      '500',
    color:           '#e4e4e7',
    whiteSpace:      'nowrap',
    zIndex:          '2147483647',
    opacity:         '0',
    animation:       'cb-in 0.35s cubic-bezier(0.16,1,0.3,1) forwards',
    userSelect:      'none',
    pointerEvents:   'none',
  });

  // Dot
  const dot = document.createElement('span');
  Object.assign(dot.style, {
    display:         'inline-block',
    width:           '6px',
    height:          '6px',
    borderRadius:    '50%',
    backgroundColor: isLoading ? '#52525b' : '#10b981',
    flexShrink:      '0',
    animation:       isLoading ? 'cb-dot 1s ease-in-out infinite' : 'none',
    boxShadow:       isLoading ? 'none' : '0 0 8px #10b981aa',
  });

  // Text
  const text = document.createElement('span');
  // Truncate long titles to keep pill narrow
  const maxLen = 36;
  const title = session.title.length > maxLen
    ? session.title.slice(0, maxLen) + '…'
    : session.title;
  text.innerText = isLoading ? 'Restoring context…' : title;
  Object.assign(text.style, {
    letterSpacing: '-0.01em',
  });

  // Hint (only on ready state)
  const hint = document.createElement('span');
  hint.innerText = 'Enter ↑';
  Object.assign(hint.style, {
    fontSize:   '11px',
    color:      '#52525b',
    marginLeft: '2px',
    display:    isLoading ? 'none' : 'inline',
  });

  overlayElement.append(dot, text, hint);
  overlayElement.dataset.title = session.title; // used by RestoreDone handler
  document.body.appendChild(overlayElement);
}

// Update to ready state + auto-dismiss
window.addEventListener('ContextBridge_RestoreDone', () => {
  if (!overlayElement) return;

  const [dot, text, hint] = overlayElement.children as any;

  // Dot → green glow
  dot.style.backgroundColor = '#10b981';
  dot.style.boxShadow = '0 0 8px #10b981aa';
  dot.style.animation = 'none';

  // Text → chat title (stored in session, pull from overlay's data attr)
  // We re-read from the stored title on the element itself
  const rawTitle = overlayElement.dataset.title || '';
  const maxLen = 36;
  text.innerText = rawTitle.length > maxLen ? rawTitle.slice(0, maxLen) + '…' : rawTitle;

  // Show hint
  hint.style.display = 'inline';

  // Subtle green glow on border
  overlayElement.style.border = '1px solid rgba(16,185,129,0.2)';
  overlayElement.style.boxShadow = '0 4px 24px rgba(0,0,0,0.4), 0 0 16px rgba(16,185,129,0.12)';

  chrome.storage.local.remove('context_restoration_session');

  // Auto-dismiss after 4 s
  setTimeout(() => {
    if (!overlayElement) return;
    overlayElement.style.animation = 'cb-out 0.35s ease forwards';
    setTimeout(() => { overlayElement?.remove(); overlayElement = null; }, 380);
  }, 4000);
});

// ── Session check ─────────────────────────────────────────────────────────────
function checkActiveSession() {
  chrome.storage.local.get('context_restoration_session', (result) => {
    if (chrome.runtime.lastError) {
      console.warn('[CB Injector] Storage error:', chrome.runtime.lastError.message);
      return;
    }

    const session = result['context_restoration_session'] as RestorationSession | undefined;
    if (!session?.fileContent) return;

    // Only restore on new-chat pages of the target platform
    const href = window.location.href;
    const host = window.location.hostname;
    const targetPlatform = session.targetPlatform || 'claude';

    let matchesPlatform = false;
    let isNewChat = false;

    if (targetPlatform === 'chatgpt') {
      matchesPlatform = host.includes('chatgpt.com');
      const path = window.location.pathname;
      // Accept / or query params, but exclude chat rooms, settings, share links, etc.
      isNewChat = path === '/' || path === '' || path.startsWith('/?');
    } else {
      matchesPlatform = host.includes('claude.ai');
      isNewChat = href.includes('claude.ai/new') || /claude\.ai\/?(\?.*)?$/.test(href);
    }

    if (!matchesPlatform || !isNewChat) {
      console.log('[CB Injector] Existing chat page or incorrect platform — skipping restore.');
      return;
    }

    console.log('[CB Injector] Pending session found:', session.title);

    // Show the overlay immediately so the user knows something is happening
    createOverlay(session, 'loading');

    // Use a handshake to guarantee networkHook.js is ready before firing
    let fired = false;
    const fireEvent = () => {
      if (fired) return;
      fired = true;
      console.log('[CB Injector] Hook ready. Dispatching ContextBridge_RestoreEvent…');
      window.dispatchEvent(new CustomEvent('ContextBridge_RestoreEvent', {
        detail: {
          fileContent: session.fileContent,
          fileName:    session.fileName,
          promptText:  session.promptText,
        },
      }));
    };

    window.addEventListener('ContextBridge_HookReady', fireEvent);

    const pingInterval = setInterval(() => {
      if (fired) {
        clearInterval(pingInterval);
      } else {
        window.dispatchEvent(new CustomEvent('ContextBridge_PingHook'));
      }
    }, 100);

    // Fallback if ping fails for 3 seconds
    setTimeout(() => {
      if (!fired) {
        console.warn('[CB Injector] Handshake timed out, firing event anyway.');
        clearInterval(pingInterval);
        fireEvent();
      }
    }, 3000);
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
// Run immediately — content scripts are injected at document_end so the DOM
// and chrome APIs are already available.
checkActiveSession();

// Re-check if the background worker signals a new session (e.g. navigation)
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'SESSION_UPDATED') {
    checkActiveSession();
  }
});

export {};
