import { useState, useEffect } from 'react';
import { ContextBridgeDB } from '../shared/db';
import { ProjectContext } from '../shared/types';
import { estimateTokens } from '../shared/transfer';

export default function App() {
  const [projects, setProjects] = useState<ProjectContext[]>([]);
  const [isChatPage, setIsChatPage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectContext | null>(null);

  // 1. Fetch saved conversations and query current page type
  useEffect(() => {
    loadProjects();

    // Poll every 2 s while the popup is open to catch background saves
    const poll = setInterval(loadProjects, 2000);

    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (activeTab && activeTab.url) {
          const url = activeTab.url;
          const isClaudeChat = url.includes('claude.ai/chat/') || url.includes('claude.ai/new');
          const isChatGPTChat = url.includes('chatgpt.com/c/');
          if (isClaudeChat || isChatGPTChat) {
            setIsChatPage(true);
          }
        }
      });
    }

    return () => clearInterval(poll);
  }, []);

  const loadProjects = async () => {
    try {
      const list = await ContextBridgeDB.listProjects();
      // Sort: newest first
      setProjects(list.sort((a, b) => b.updatedAt - a.updatedAt));
    } catch (e) {
      console.error('Failed to load projects from DB:', e);
    }
  };

  const showStatus = (text: string, error = false) => {
    setStatusMessage({ text, error });
    setTimeout(() => setStatusMessage(null), 4000);
  };

  // 2. Extract conversation from active page
  const handleSaveCurrentChat = () => {
    if (typeof chrome === 'undefined' || !chrome.tabs) return;
    setLoading(true);
    showStatus('Scanning page for chat history...');

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab || !activeTab.id) {
        setLoading(false);
        showStatus('No active browser tab found.', true);
        return;
      }

      chrome.tabs.sendMessage(activeTab.id, { action: 'EXTRACT_CURRENT_CHAT' }, (response) => {
        setLoading(false);
        if (chrome.runtime.lastError) {
          showStatus('Error communicating with page. Please refresh the Claude page.', true);
          return;
        }

        if (response && response.success) {
          // Reload immediately then again at 500ms and 1500ms to catch async IndexedDB write
          loadProjects();
          setTimeout(loadProjects, 500);
          setTimeout(loadProjects, 1500);
          showStatus(`Saved: "${response.data.title}" (${response.source === 'network' ? 'API Intercepted' : 'DOM Scraped'})`);
        } else {
          showStatus(response?.error || 'Extraction failed.', true);
        }
      });
    });
  };

  // 3. Initiate Restoration Flow
  const handleRestore = (projectId: string, targetPlatform: string) => {
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      showStatus('Chrome Extension context not active.', true);
      return;
    }

    chrome.runtime.sendMessage({
      action: 'RESTORE_CONVERSATION',
      payload: { projectId, targetPlatform }
    }, (response) => {
      if (response && response.success) {
        showStatus(`Restoration started. Redirecting to new ${targetPlatform === 'chatgpt' ? 'ChatGPT' : 'Claude'} chat...`);
        setTimeout(() => window.close(), 1000); // Close popup after a short delay
      } else {
        showStatus(response?.error || 'Failed to start restoration.', true);
      }
    });
  };

  // 4. File Exporters
  const handleExportJSON = (project: ProjectContext) => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${project.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_backup.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportMarkdown = (project: ProjectContext) => {
    let md = `# ${project.title}\n\n`;
    md += `* **Source**: ${project.sourcePlatform}\n`;
    md += `* **Saved At**: ${new Date(project.createdAt).toLocaleString()}\n\n`;
    md += `---\n\n`;
    
    project.messages.forEach(msg => {
      const roleName = msg.role === 'user' ? 'USER' : msg.role === 'assistant' ? 'CLAUDE' : 'SYSTEM';
      md += `### [${roleName}]\n\n${msg.content}\n\n`;
      
      if (msg.attachments && msg.attachments.length > 0) {
        md += `*Attachments*:\n`;
        msg.attachments.forEach(att => {
          md += `- **${att.name}** (${att.type})\n`;
        });
        md += `\n`;
      }
      md += `---\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${project.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_backup.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 5. Delete project
  const handleDelete = async (id: string) => {
    await ContextBridgeDB.deleteProject(id);
    setDeleteTarget(null);
    loadProjects();
    showStatus('Backup deleted.');
  };

  const calculateTotalTokens = (project: ProjectContext): number => {
    return project.messages.reduce((acc, m) => acc + estimateTokens(m.content), 0);
  };

  return (
    <div className="popup-container">
      {/* Header */}
      <header className="popup-header">
        <div className="logo-container">
          <div className="logo-glow"></div>
          <h1>Context Bridge</h1>
        </div>
        <p className="subtitle">Local-First AI Conversation Backup</p>
      </header>

      {/* Action Area */}
      <section className="action-area">
        {isChatPage ? (
          <button 
            className="btn-primary" 
            onClick={handleSaveCurrentChat}
            disabled={loading}
          >
            {loading ? 'Processing...' : 'Backup Current Chat'}
          </button>
        ) : (
          <div className="notice-box">
            <span className="info-icon">ℹ️</span>
            <p>Navigate to an active Claude chat thread to save the conversation context.</p>
          </div>
        )}
      </section>

      {/* Notification Toast — in-flow, not absolute */}
      {statusMessage && (
        <div className={`status-toast ${statusMessage.error ? 'status-error' : 'status-success'}`}>
          {statusMessage.text}
        </div>
      )}

      {/* Custom delete confirmation modal */}
      {deleteTarget && (
        <div className="modal-backdrop">
          <div className="modal-box">
            <div className="modal-icon">🗑️</div>
            <div className="modal-title">Delete Backup?</div>
            <div className="modal-chat-name">{deleteTarget.title}</div>
            <div className="modal-subtitle">This removes the local backup permanently. The original chat on Claude is unaffected.</div>
            <div className="modal-buttons">
              <button className="modal-cancel" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="modal-delete" onClick={() => handleDelete(deleteTarget.id)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Dashboard Lists */}
      <main className="dashboard-content">
        <h2>Saved Contexts ({projects.length})</h2>

        {projects.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📭</div>
            <p>No backups saved yet.</p>
          </div>
        ) : (
          <div className="project-list">
            {projects.map((project) => {
              const tokens = calculateTotalTokens(project);
              return (
                <div key={project.id} className="project-card">
                  <div className="card-info">
                    <div className="card-top">
                      <div className="card-top-left" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className={`badge-platform platform-${project.sourcePlatform}`}>
                          {project.sourcePlatform}
                        </span>
                        <span className="card-date">
                          {new Date(project.updatedAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                      <div className="btn-group-right">
                        <button 
                          className="btn-card-icon" 
                          onClick={() => handleExportJSON(project)}
                          title="Export JSON"
                        >
                          {'{ }'}
                        </button>
                        <button 
                          className="btn-card-icon" 
                          onClick={() => handleExportMarkdown(project)}
                          title="Export Markdown (MD)"
                        >
                          📝
                        </button>
                        <button 
                          className="btn-card-icon btn-delete" 
                          onClick={() => setDeleteTarget(project)}
                          title="Delete local backup"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                    <h3>{project.title}</h3>
                    <p className="card-stats">
                      <span>💬 {project.messages.length} messages</span>
                      <span>•</span>
                      <span>⚡ {tokens.toLocaleString()} est. tokens</span>
                    </p>
                  </div>

                  <div className="card-actions" style={{ justifyContent: 'flex-start' }}>
                    <div className="continue-options">
                      <span className="continue-text">Continue in:</span>
                      <button 
                        className="btn-card btn-target"
                        onClick={() => handleRestore(project.id, 'claude')}
                        title="Restore to a new Claude chat"
                      >
                        <span className="platform-dot platform-claude"></span> Claude
                      </button>
                      <button 
                        className="btn-card btn-target"
                        onClick={() => handleRestore(project.id, 'chatgpt')}
                        title="Restore to a new ChatGPT chat"
                      >
                        <span className="platform-dot platform-chatgpt"></span> ChatGPT
                      </button>
                      <button 
                        className="btn-card btn-target"
                        onClick={() => handleRestore(project.id, 'gemini')}
                        title="Restore to a new Gemini chat"
                      >
                        <span className="platform-dot platform-gemini"></span> Gemini
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
