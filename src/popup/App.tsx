import { useState, useEffect } from 'react';
import { ContextBridgeDB } from '../shared/db';
import { ProjectContext } from '../shared/types';
import { estimateTokens } from '../shared/transfer';

export default function App() {
  const [projects, setProjects] = useState<ProjectContext[]>([]);
  const [isChatPage, setIsChatPage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; error: boolean } | null>(null);

  // 1. Fetch saved conversations and query current page type
  useEffect(() => {
    loadProjects();

    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (activeTab && activeTab.url && activeTab.url.includes('claude.ai/chat/')) {
          setIsChatPage(true);
        }
      });
    }
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
          loadProjects();
          showStatus(`Successfully saved: "${response.data.title}" (${response.source === 'network' ? 'Network Intercepted' : 'DOM Scraped'})`);
        } else {
          showStatus(response?.error || 'Extraction failed.', true);
        }
      });
    });
  };

  // 3. Initiate Restoration Flow
  const handleRestore = (projectId: string) => {
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      showStatus('Chrome Extension context not active.', true);
      return;
    }

    chrome.runtime.sendMessage({
      action: 'RESTORE_CONVERSATION',
      payload: { projectId }
    }, (response) => {
      if (response && response.success) {
        showStatus('Restoration session started. Redirecting to new Claude chat...');
        window.close(); // Close popup
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
    if (confirm('Are you sure you want to delete this backup from local storage?')) {
      await ContextBridgeDB.deleteProject(id);
      loadProjects();
      showStatus('Backup deleted.');
    }
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

      {/* Notification Toast */}
      {statusMessage && (
        <div className={`status-toast ${statusMessage.error ? 'status-error' : 'status-success'}`}>
          {statusMessage.text}
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
                      <span className="badge-platform">{project.sourcePlatform}</span>
                      <span className="card-date">
                        {new Date(project.createdAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                    <h3>{project.title}</h3>
                    <p className="card-stats">
                      <span>💬 {project.messages.length} messages</span>
                      <span>•</span>
                      <span>⚡ {tokens.toLocaleString()} est. tokens</span>
                    </p>
                  </div>

                  <div className="card-actions">
                    <button 
                      className="btn-card btn-continue" 
                      onClick={() => handleRestore(project.id)}
                      title="Inject context into a new Claude chat"
                    >
                      🚀 Continue
                    </button>
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
                        onClick={() => handleDelete(project.id)}
                        title="Delete local backup"
                      >
                        🗑️
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
