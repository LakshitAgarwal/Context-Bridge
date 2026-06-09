(function() {
  // Save original fetch
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const requestInput = args[0];
    const url = (typeof requestInput === 'string') 
      ? requestInput 
      : (requestInput as any).url || (requestInput as any).href || '';
    
    const response = await originalFetch.apply(this, args);
    
    // Intercept conversation API targets
    if (url && (url.includes('chat_conversations') || url.includes('org'))) {
      const cloned = response.clone();
      try {
        const json = await cloned.json();
        const event = new CustomEvent('ContextBridge_NetworkEvent', {
          detail: { url, data: json, type: 'fetch' }
        });
        window.dispatchEvent(event);
      } catch (e) {
        try {
          const text = await cloned.text();
          const event = new CustomEvent('ContextBridge_NetworkEvent', {
            detail: { url, data: text, type: 'fetch_stream' }
          });
          window.dispatchEvent(event);
        } catch (err) {}
      }
    }
    return response;
  };

  // Intercept XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method: string, url: string | URL, ...rest: any[]) {
    (this as any)._url = typeof url === 'string' ? url : (url instanceof URL ? url.href : '');
    return originalOpen.apply(this, [method, url, ...rest] as any);
  };

  XMLHttpRequest.prototype.send = function(body?: any) {
    this.addEventListener('load', () => {
      const url = (this as any)._url;
      if (url && (url.includes('chat_conversations') || url.includes('org'))) {
        try {
          const json = JSON.parse(this.responseText);
          const event = new CustomEvent('ContextBridge_NetworkEvent', {
            detail: { url, data: json, type: 'xhr' }
          });
          window.dispatchEvent(event);
        } catch (e) {
          const event = new CustomEvent('ContextBridge_NetworkEvent', {
            detail: { url, data: this.responseText, type: 'xhr_text' }
          });
          window.dispatchEvent(event);
        }
      }
    });
    return originalSend.apply(this, [body] as any);
  };

  console.log('[Context Bridge] Network hooks installed.');
})();
export {};
