(function () {
  'use strict';

  // ── Network interception ──────────────────────────────────────────────────
  const _fetch = window.fetch;
  window.fetch = async function (...args: Parameters<typeof fetch>) {
    const input = args[0];
    const url = typeof input === 'string' ? input : (input as Request).url ?? '';
    const response = await _fetch.apply(this, args);

    if (url && (url.includes('chat_conversations') || url.includes('/org'))) {
      const clone = response.clone();
      try {
        const json = await clone.json();
        window.dispatchEvent(new CustomEvent('ContextBridge_NetworkEvent', {
          detail: { url, data: json, type: 'fetch' },
        }));
      } catch {
        try {
          const text = await clone.text();
          window.dispatchEvent(new CustomEvent('ContextBridge_NetworkEvent', {
            detail: { url, data: text, type: 'fetch_stream' },
          }));
        } catch { /* ignore */ }
      }
    }
    return response;
  };

  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method: string, url: string | URL, ...rest: any[]) {
    (this as any)._cbUrl = typeof url === 'string' ? url : url instanceof URL ? url.href : '';
    return _open.apply(this, [method, url, ...rest] as any);
  };

  XMLHttpRequest.prototype.send = function (body?: any) {
    this.addEventListener('load', () => {
      const url: string = (this as any)._cbUrl ?? '';
      if (url && (url.includes('chat_conversations') || url.includes('/org'))) {
        try {
          const json = JSON.parse(this.responseText);
          window.dispatchEvent(new CustomEvent('ContextBridge_NetworkEvent', {
            detail: { url, data: json, type: 'xhr' },
          }));
        } catch {
          window.dispatchEvent(new CustomEvent('ContextBridge_NetworkEvent', {
            detail: { url, data: this.responseText, type: 'xhr_text' },
          }));
        }
      }
    });
    return _send.apply(this, [body] as any);
  };

  // ── Restoration handler ───────────────────────────────────────────────────
  interface RestorePayload {
    fileContent: string;
    fileName: string;
    promptText: string;
  }

  window.addEventListener('ContextBridge_RestoreEvent', (e: Event) => {
    const { fileContent, fileName, promptText } = (e as CustomEvent).detail as RestorePayload;
    console.log('[CB Hook] RestoreEvent received for file:', fileName);
    
    if (window.location.hostname.includes('chatgpt.com')) {
      waitForChatGPTEditorThenRestore(fileContent, fileName, promptText);
    } else {
      waitForEditorThenRestore(fileContent, fileName, promptText);
    }
  });

  // ── Claude Injection Flow (UNTOUCHED) ──────────────────────────────────────
  function getEditor(): HTMLElement | null {
    return document.querySelector<HTMLElement>('div[contenteditable="true"]');
  }

  function injectPromptText(editor: HTMLElement, text: string) {
    editor.focus();
    editor.innerHTML = '';
    const ok = document.execCommand('insertText', false, text);
    if (!ok) {
      editor.innerText = text;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function tryFileInject(file: File, editor: HTMLElement): boolean {
    // Search every input[type=file] on the page and try each one
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
    if (inputs.length === 0) return false;

    for (const inp of inputs) {
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        inp.files = dt.files;
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        inp.dispatchEvent(new Event('input', { bubbles: true }));

        // Also fire a drop on the editor — some React handlers listen for this
        editor.dispatchEvent(new DragEvent('drop', {
          bubbles: true, cancelable: true, dataTransfer: dt,
        }));

        console.log('[CB Hook] File injected via input element:', inp);
        return true;
      } catch (err) {
        console.warn('[CB Hook] File inject attempt failed on input:', err);
      }
    }
    return false;
  }

  function waitForEditorThenRestore(
    fileContent: string, fileName: string, promptText: string, attempt = 0
  ) {
    const editor = getEditor();

    if (!editor) {
      if (attempt < 30) {
        setTimeout(() => waitForEditorThenRestore(fileContent, fileName, promptText, attempt + 1), 400);
      } else {
        console.warn('[CB Hook] Editor never appeared — giving up.');
      }
      return;
    }

    const file = new File([fileContent], fileName, { type: 'text/markdown' });
    const fileInjected = tryFileInject(file, editor);

    if (fileInjected) {
      // Give React time to process the file upload, then inject the prompt
      setTimeout(() => {
        const ed = getEditor(); // re-query in case DOM changed
        if (ed) injectPromptText(ed, promptText);
        window.dispatchEvent(new CustomEvent('ContextBridge_RestoreDone'));
        console.log('[CB Hook] File + prompt injected successfully.');
      }, 800);
    } else {
      // No file input found — inject full text directly as fallback
      console.warn('[CB Hook] No file input found — falling back to text injection.');
      injectPromptText(editor, `${fileContent}\n\n---\n\n${promptText}`);
      window.dispatchEvent(new CustomEvent('ContextBridge_RestoreDone'));
    }
  }

  // ── ChatGPT Injection Flow (NEW & ISOLATED) ──────────────────────────────────
  function getChatGPTEditor(): HTMLElement | null {
    return document.querySelector<HTMLElement>('#prompt-textarea');
  }

  function injectChatGPTText(editor: HTMLElement, text: string) {
    editor.focus();
    editor.innerHTML = '';
    const ok = document.execCommand('insertText', false, text);
    if (!ok) {
      editor.innerText = text;
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function tryChatGPTFileInject(file: File): boolean {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]'));
    if (inputs.length === 0) return false;

    for (const inp of inputs) {
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        inp.files = dt.files;
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        inp.dispatchEvent(new Event('input', { bubbles: true }));

        console.log('[CB Hook] ChatGPT file injected via input element:', inp);
        return true;
      } catch (err) {
        console.warn('[CB Hook] ChatGPT file inject attempt failed on input:', err);
      }
    }
    return false;
  }

  function waitForChatGPTEditorThenRestore(
    fileContent: string, fileName: string, promptText: string, attempt = 0
  ) {
    const editor = getChatGPTEditor();

    if (!editor) {
      if (attempt < 30) {
        setTimeout(() => waitForChatGPTEditorThenRestore(fileContent, fileName, promptText, attempt + 1), 400);
      } else {
        console.warn('[CB Hook] ChatGPT editor never appeared — giving up.');
      }
      return;
    }

    const file = new File([fileContent], fileName, { type: 'text/markdown' });
    const fileInjected = tryChatGPTFileInject(file);

    if (fileInjected) {
      // Allow ChatGPT to parse the file upload, then inject the restore prompt
      setTimeout(() => {
        const ed = getChatGPTEditor();
        if (ed) injectChatGPTText(ed, promptText);
        window.dispatchEvent(new CustomEvent('ContextBridge_RestoreDone'));
        console.log('[CB Hook] ChatGPT File + prompt injected successfully.');
      }, 1200);
    } else {
      console.warn('[CB Hook] ChatGPT no file input found — falling back to text-only injection.');
      injectChatGPTText(editor, `${fileContent}\n\n---\n\n${promptText}`);
      window.dispatchEvent(new CustomEvent('ContextBridge_RestoreDone'));
    }
  }

  console.log('[CB Hook] Installed. Network hooks active.');
})();
export {};
