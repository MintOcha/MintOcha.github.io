// UI.jsx - Reusable Chat UI Components
const { useState, useCallback, memo } = React;

// TextBox Component - A reusable input field
const TextBox = memo(function TextBox({ placeholder = "Type here...", value, onChange, onEnter}) {
  const handleKeyPress = useCallback((e) => {
    if (e.key === 'Enter' && onEnter) {
      onEnter();
    }
  }, [onEnter]);

  const handleChange = useCallback((e) => {
    onChange(e.target.value);
  }, [onChange]);

  return (
    <input
      type="text"
      className={`input-textbox`}
      placeholder={placeholder}
      value={value}
      onChange={handleChange}
      onKeyPress={handleKeyPress}
    />
  );
});

// SendButton Component - A reusable send button
function SendButton({ onClick, disabled = false, className = "" }) {
  return (
    <button 
      className={`send-button ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      <i className="fas fa-paper-plane"></i>
    </button>
  );
}

// EmojiButton Component - A reusable emoji button
function EmojiButton({ onClick, className = "" }) {
  return (
    <button 
      className={`emoji-button ${className}`}
      onClick={onClick}
    >
      <i className="fas fa-smile"></i>
    </button>
  );
}

// ChatMessage Component - A reusable message component
function ChatMessage({ 
  message, 
  showProfileAndName = true,
  isOwnMessage = false,
  isSystemMessage = false 
}) {
  const renderMessageContent = () => {
    // Render different content based on message type
    if (message.type === 'image' && message.mediaData) {
      return (
        <div className="media-message">
          <p>{message.content}</p>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <img 
              src={message.mediaData.base64Data} 
              alt={message.mediaData.filename}
              className="responsive-media"
              onClick={() => {
                if (window.openImageOverlay) {
                  window.openImageOverlay({
                    src: message.mediaData.base64Data,
                    filename: message.mediaData.filename
                  });
                }
              }}
              title={`${message.mediaData.filename} (${(message.mediaData.size / 1024 / 1024).toFixed(2)} MB)`}
            />
            <button
              className="image-download-btn"
              onClick={(e) => {
                e.stopPropagation();
                const link = document.createElement('a');
                link.href = message.mediaData.base64Data;
                link.download = message.mediaData.filename;
                link.click();
              }}
              title="Download image"
            >
              <i className="fas fa-download"></i>
            </button>
          </div>
        </div>
      );
    } else if (message.type === 'video' && message.mediaData) {
      return (
        <div className="media-message">
          <p>{message.content}</p>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <video 
              controls 
              className="responsive-media"
              title={`${message.mediaData.filename} (${(message.mediaData.size / 1024 / 1024).toFixed(2)} MB)`}
            >
              <source src={message.mediaData.base64Data} type={message.mediaData.mimeType} />
              Your browser does not support the video element.
            </video>
            <button
              className="image-download-btn"
              onClick={(e) => {
                e.stopPropagation();
                const link = document.createElement('a');
                link.href = message.mediaData.base64Data;
                link.download = message.mediaData.filename;
                link.click();
              }}
              title="Download video"
            >
              <i className="fas fa-download"></i>
            </button>
          </div>
        </div>
      );
    } else if (message.type === 'file' && message.mediaData) {
      return (
        <div className="media-message">
          <p>{message.content}</p>
          <div className="file-attachment">
            <i className="fas fa-file"></i>
            <span className="file-info">
              <strong>{message.mediaData.filename}</strong>
              <br />
              <small>
                {message.mediaData.mimeType || 'Unknown type'} • 
                {message.mediaData.size > 1024 * 1024 
                  ? `${(message.mediaData.size / 1024 / 1024).toFixed(2)} MB`
                  : `${(message.mediaData.size / 1024).toFixed(1)} KB`
                }
              </small>
            </span>
            <a 
              href={message.mediaData.base64Data} 
              download={message.mediaData.filename}
              className="file-download-btn"
            >
              <i className="fas fa-download"></i> Download
            </a>
          </div>
        </div>
      );
    } else {
      // XSS-safe: React automatically escapes text content
      return message.content;
    }
  };

  return (
    <div 
      className={`message ${isOwnMessage ? 'own-message' : 'other-message'} ${isSystemMessage ? 'system-message' : ''} ${!showProfileAndName && !isSystemMessage ? 'no-avatar' : ''}`}
    >
      {(showProfileAndName || isSystemMessage) && (
        <div className="message-avatar">
          {isSystemMessage ? (
            <i className="fas fa-info-circle"></i>
          ) : (
            message.senderName.charAt(0).toUpperCase()
          )}
        </div>
      )}
      <div className="message-content-wrapper">
        {(showProfileAndName || isSystemMessage) && (
          <div className="message-header">
            <span className="message-sender">
              {isSystemMessage ? 'System' : message.senderName}
            </span>
            <span className="message-time">{message.timestamp}</span>
            {message.type && message.type !== 'text' && message.type !== 'system' && (
              <span className="message-type-badge">{message.type}</span>
            )}
            {isSystemMessage && (
              <span className="message-type-badge system-badge">System</span>
            )}
          </div>
        )}
        <div className="message-content">
          {renderMessageContent()}
        </div>
      </div>
    </div>
  );
}

// Simple overlay container attached to body root via portal-like global helpers
(function initImageOverlayHelpers(){
  if (window.__imageOverlayInitialized) return;
  const overlay = document.createElement('div');
  overlay.className = 'image-overlay';
  overlay.innerHTML = `
    <div class="overlay-content">
      <img alt="preview" />
      <div class="overlay-actions">
        <button class="overlay-btn" data-action="download"><i class="fas fa-download"></i> Save</button>
        <button class="overlay-btn" data-action="close"><i class="fas fa-times"></i> Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const img = overlay.querySelector('img');
  const btnDownload = overlay.querySelector('[data-action="download"]');
  const btnClose = overlay.querySelector('[data-action="close"]');

  function openImageOverlay({src, filename}){
    img.src = src;
    img.dataset.filename = filename || 'image';
    overlay.classList.add('open');
  }
  function closeImageOverlay(){
    overlay.classList.remove('open');
    img.src = '';
    delete img.dataset.filename;
  }
  overlay.addEventListener('click', (e)=>{
    if (e.target === overlay) closeImageOverlay();
  });
  btnClose.addEventListener('click', closeImageOverlay);
  btnDownload.addEventListener('click', ()=>{
    const a = document.createElement('a');
    a.href = img.src;
    a.download = img.dataset.filename || 'image';
    a.click();
  });

  window.openImageOverlay = openImageOverlay;
  window.closeImageOverlay = closeImageOverlay;
  window.__imageOverlayInitialized = true;
})();

// ChatDemo Component - Example of how to use the components together
function ChatDemo() {
  const [message, setMessage] = useState('');

  const handleSend = () => {
    if (message.trim()) {
      console.log('Hello! Message sent:', message);
      setMessage(''); // Clear the textbox after sending
    }
  };

  const addEmoji = () => {
    setMessage(message + ' 😊');
  };

  return (
    <div className="chat-demo">
      <h3><i className="fas fa-comments"></i> Chat Demo</h3>
      
      <div className="message-input-container">
        <TextBox
          placeholder="Type your message here..."
          value={message}
          onChange={setMessage}
          onEnter={handleSend}
          className="message-input"
        />
        
        <SendButton
          onClick={handleSend}
          disabled={!message.trim()}
        />
        
        <EmojiButton
          onClick={addEmoji}
        />
      </div>
      
      <div className="demo-info">
        <p><i className="fas fa-info-circle"></i> Individual components you can reuse!</p>
      </div>
    </div>
  );
}

function TextButton({onClick, disabled = false, className = "", children = "Text Button"}) {
    return (
        <button 
            className={`text-button ${className}`} 
            onClick={onClick} 
            disabled={disabled}
        >
            {children}
        </button>
    );
}

function InfoCard({text = "", icon = "fas fa-info-circle", display = 'block'}) {
    return (
        <div className="info-card" style={{ display }}>
            <i className={icon}></i>
            <p>{text}</p>
        </div>
    );
}

function NotificationBox({ 
  message = "", 
  type = "info", 
  onClose = null,
  id = null 
}) {
  const getIcon = () => {
    switch(type) {
      case 'success': return 'fas fa-check-circle';
      case 'error': return 'fas fa-exclamation-circle';
      case 'warning': return 'fas fa-exclamation-triangle';
      default: return 'fas fa-info-circle';
    }
  };

  const getBgColor = () => {
    switch(type) {
      case 'success': return 'linear-gradient(135deg, #4CAF50 0%, #45a049 100%)';
      case 'error': return 'linear-gradient(135deg, #f44336 0%, #d32f2f 100%)';
      case 'warning': return 'linear-gradient(135deg, #ff9800 0%, #f57c00 100%)';
      default: return 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    }
  };

  return (
    <div 
      className="notification-box" 
      style={{ 
        background: getBgColor(),
        position: 'fixed',
        top: '20px',
        right: '20px',
        zIndex: 1000,
        minWidth: '300px',
        maxWidth: '400px',
        borderRadius: '8px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '16px',
        margin: '8px 0',
        animation: 'slideInRight 0.3s ease'
      }}
    >
      <i className={getIcon()} style={{ fontSize: '20px', flexShrink: 0 }}></i>
      <span style={{ flex: 1, fontWeight: '500' }}>{message}</span>
      {onClose && (
        <button 
          onClick={() => onClose(id)}
          style={{
            background: 'none',
            border: 'none',
            color: 'white',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '4px',
            transition: 'background 0.2s'
          }}
          onMouseOver={(e) => e.target.style.background = 'rgba(255,255,255,0.1)'}
          onMouseOut={(e) => e.target.style.background = 'none'}
        >
          <i className="fas fa-times"></i>
        </button>
      )}
    </div>
  );
}

function NotificationContainer({ notifications = [], onRemove = null }) {
  return (
    <div 
      className="notification-container"
      style={{
        position: 'fixed',
        top: '20px',
        right: '20px',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        pointerEvents: 'none'
      }}
    >
      {notifications.map((notification, index) => (
        <div 
          key={notification.id}
          style={{
            transform: `translateY(${index * 8}px)`,
            pointerEvents: 'all'
          }}
        >
          <NotificationBox
            message={notification.message}
            type={notification.type}
            id={notification.id}
            onClose={onRemove}
          />
        </div>
      ))}
    </div>
  );
}

// Make all components available globally
window.TextBox = TextBox;
window.SendButton = SendButton;
window.EmojiButton = EmojiButton;
window.ChatMessage = ChatMessage;
window.ChatDemo = ChatDemo;
window.TextButton = TextButton;
window.InfoCard = InfoCard;
window.NotificationBox = NotificationBox;
window.NotificationContainer = NotificationContainer;