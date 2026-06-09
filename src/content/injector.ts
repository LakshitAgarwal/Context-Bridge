import { ClaudeTargetAdapter } from '../shared/adapters/claude';

const targetAdapter = new ClaudeTargetAdapter();
let overlayElement: HTMLDivElement | null = null;

interface RestorationSession {
  chunks: string[];
  currentIndex: number;
  title: string;
}

// 1. Render the premium, glassmorphic UI overlay on the Claude webpage
function createOverlay(session: RestorationSession) {
  if (overlayElement) {
    overlayElement.remove();
  }

  const chunkNum = session.currentIndex + 1;
  const total = session.chunks.length;
  const isLast = chunkNum === total;

  overlayElement = document.createElement('div');
  overlayElement.id = 'context-bridge-overlay';
  
  // Custom styles for a stunning modern dark glass UI
  Object.assign(overlayElement.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    width: '340px',
    padding: '20px',
    borderRadius: '16px',
    backgroundColor: 'rgba(28, 28, 30, 0.9)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
    color: '#ffffff',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    zIndex: '9999999',
    transition: 'all 0.3s ease',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  });

  const titleHeader = document.createElement('div');
  titleHeader.innerText = 'Context Bridge — Restoration';
  Object.assign(titleHeader.style, {
    fontSize: '12px',
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    color: '#10B981' // Accent Emerald Green
  });

  const chatTitle = document.createElement('div');
  chatTitle.innerText = session.title;
  Object.assign(chatTitle.style, {
    fontSize: '16px',
    fontWeight: '600',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: '#f4f4f5'
  });

  const progressText = document.createElement('div');
  progressText.innerText = `Ingesting: Chunk ${chunkNum} of ${total}`;
  Object.assign(progressText.style, {
    fontSize: '13px',
    color: '#a1a1aa'
  });

  // Visual Progress Bar
  const progressTrack = document.createElement('div');
  Object.assign(progressTrack.style, {
    height: '6px',
    borderRadius: '3px',
    backgroundColor: '#3f3f46',
    overflow: 'hidden'
  });

  const progressBar = document.createElement('div');
  Object.assign(progressBar.style, {
    height: '100%',
    width: `${(chunkNum / total) * 100}%`,
    backgroundColor: '#10B981',
    transition: 'width 0.4s ease'
  });
  progressTrack.appendChild(progressBar);

  const instructions = document.createElement('div');
  instructions.innerText = isLast
    ? 'This is the final chunk! Press Enter to send and complete the context upload.'
    : 'Press Enter to send this chunk, then click "Inject Next" once Claude finishes responding.';
  Object.assign(instructions.style, {
    fontSize: '12px',
    lineHeight: '1.4',
    color: '#e4e4e7',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    padding: '8px 12px',
    borderRadius: '8px',
    borderLeft: '3px solid #10B981'
  });

  const buttonContainer = document.createElement('div');
  Object.assign(buttonContainer.style, {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '8px',
    marginTop: '8px'
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.innerText = 'Cancel';
  Object.assign(cancelBtn.style, {
    flex: '1',
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    backgroundColor: 'transparent',
    color: '#f4f4f5',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'background-color 0.2s'
  });
  cancelBtn.addEventListener('mouseenter', () => cancelBtn.style.backgroundColor = 'rgba(255, 255, 255, 0.05)');
  cancelBtn.addEventListener('mouseleave', () => cancelBtn.style.backgroundColor = 'transparent');
  cancelBtn.addEventListener('click', () => {
    chrome.storage.local.remove('context_restoration_session', () => {
      if (overlayElement) overlayElement.remove();
    });
  });

  const nextBtn = document.createElement('button');
  nextBtn.innerText = isLast ? 'Finish' : 'Inject Next';
  Object.assign(nextBtn.style, {
    flex: '2',
    padding: '8px 12px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: '#10B981',
    color: '#09090b',
    fontSize: '13px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'opacity 0.2s'
  });
  nextBtn.addEventListener('mouseenter', () => nextBtn.style.opacity = '0.9');
  nextBtn.addEventListener('mouseleave', () => nextBtn.style.opacity = '1');
  nextBtn.addEventListener('click', () => {
    if (isLast) {
      // End session
      chrome.storage.local.remove('context_restoration_session', () => {
        if (overlayElement) overlayElement.remove();
        console.log('[Context Bridge] Restoration session successfully finalized.');
      });
    } else {
      // Proceed to next chunk
      session.currentIndex += 1;
      chrome.storage.local.set({ context_restoration_session: session }, () => {
        // Rerender overlay and inject the next chunk
        createOverlay(session);
        attemptInjection(session.chunks[session.currentIndex]);
      });
    }
  });

  buttonContainer.appendChild(cancelBtn);
  buttonContainer.appendChild(nextBtn);

  overlayElement.appendChild(titleHeader);
  overlayElement.appendChild(chatTitle);
  overlayElement.appendChild(progressText);
  overlayElement.appendChild(progressTrack);
  overlayElement.appendChild(instructions);
  overlayElement.appendChild(buttonContainer);

  document.body.appendChild(overlayElement);
}

// 2. Poll the DOM for Claude's text input box and run target adapter text filling
function attemptInjection(text: string, attempts = 0) {
  targetAdapter.isReady().then(ready => {
    if (ready) {
      targetAdapter.injectPrompt(text).then(success => {
        if (success) {
          console.log('[Context Bridge] Chunk successfully loaded into active prompt box.');
        } else {
          console.error('[Context Bridge] Failed to inject text into editor.');
        }
      });
    } else if (attempts < 15) {
      // Keep polling (editor can take time to load in React DOM lifecycle)
      setTimeout(() => attemptInjection(text, attempts + 1), 400);
    } else {
      console.warn('[Context Bridge] Timed out waiting for Claude editor input container.');
    }
  });
}

// 3. Page load initialization
function checkActiveSession() {
  chrome.storage.local.get('context_restoration_session', (result) => {
    const session = result.context_restoration_session as RestorationSession | undefined;
    if (session && session.chunks && session.chunks.length > 0) {
      console.log('[Context Bridge] Active context restoration session detected:', session.title);
      
      // Inject prompt content
      attemptInjection(session.chunks[session.currentIndex]);
      
      // Renders controller panel overlay
      createOverlay(session);
    }
  });
}

// Run checks once page loads
if (document.readyState === 'complete') {
  checkActiveSession();
} else {
  window.addEventListener('load', checkActiveSession);
}

// Listen for updates from background service worker in case a redirect triggered restoration
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'SESSION_UPDATED') {
    checkActiveSession();
  }
});
