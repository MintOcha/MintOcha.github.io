// App.jsx - MintChat Application
const { useState, useEffect, useCallback, useRef } = React;

function App() {
  const [currentPage, setCurrentPage] = useState('home'); // Track current page
  const [count, setCount] = useState(0);
  const [myMessage, setMyMessage] = useState('');
  const [chatMessage, setChatMessage] = useState('');
  const [connectToId, setConnectToId] = useState('');
  const [myPeerId, setMyPeerId] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [connectedUsers, setConnectedUsers] = useState([]); // List of connected users
  const [messages, setMessages] = useState([]); // Chat messages
  const [notifications, setNotifications] = useState([]); // Store active notifications

  // Refs for autoscroll
  const messagesEndRef = useRef(null);
  const userListRef = useRef(null);
  const chatInputRef = useRef(null);
  const fileInputRef = useRef(null);

  // Setup peer connection when component loads
  useEffect(() => {
    if (window.peerInstance) {
      window.peerInstance.init();
      
      // Set up listener for when peer ID is available
      const checkPeerID = setInterval(() => {
        if (window.myId) {
          setMyPeerId(window.myId);
          clearInterval(checkPeerID);
        }
      }, 100);
      
      // Cleanup interval on unmount
      return () => clearInterval(checkPeerID);
    }
  }, []);

  // Autoscroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Autoscroll function
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Notification system using React state
  const notify = (msg, duration = 3000, type = 'info') => {
    const id = Date.now() + Math.random(); // Unique ID
    const newNotification = {
      id,
      message: msg,
      type,
      timestamp: Date.now()
    };
    
    // Add notification to state
    setNotifications(prev => [...prev, newNotification]);
    
    // Auto remove after duration
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, duration);
  };

  // Remove notification manually
  const removeNotification = (id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  // Make notify function available globally
  window.notify = notify;

  // User management functions
  const addUser = (userId, isHost = false) => {
    const userName = userId.slice(0, 8);
    setConnectedUsers(prev => {
      const exists = prev.find(user => user.id === userId);
      if (!exists) {
        return [...prev, { 
          id: userId, 
          name: userName, 
          isHost: isHost,
          joinedAt: new Date().toLocaleTimeString()
        }];
      }
      return prev;
    });
  };

  const removeUser = (userId) => {
    setConnectedUsers(prev => prev.filter(user => user.id !== userId));
  };

  const clearUserList = () => {
    setConnectedUsers([]);
  };

  // Message management functions
  const addMessage = (content, senderId, senderName, messageType = 'text', mediaData = null) => {
    // Basic input validation and sanitization
    const sanitizeText = (text) => {
      if (typeof text !== 'string') return '';
      // React automatically escapes HTML, so we just need basic validation
      return text.trim();
    };

    const newMessage = {
      id: Date.now() + Math.random(),
      content: sanitizeText(content),
      senderId,
      senderName: sanitizeText(senderName || senderId.slice(0, 8)),
      timestamp: new Date().toLocaleTimeString(),
      isOwnMessage: senderId === window.myId,
      type: messageType, // 'text', 'system', 'image', 'video', 'file', etc.
      mediaData: mediaData // Contains base64Data, filename, mimeType, size for media messages
    };
    setMessages(prev => [...prev, newMessage]);
  };

  const clearMessages = () => {
    setMessages([]);
  };

  // Make user management functions available globally
  window.addUser = addUser;
  window.removeUser = removeUser;
  window.clearUserList = clearUserList;
  window.setConnectionStatus = setIsConnected;
  window.addMessage = addMessage;
  window.goHome = goHome;


  // Navigation functions
  const goToPage = (page) => {
    setCurrentPage(page);
  };

  const goHome = () => {
    // If leaving a chatroom, properly disconnect
    if (currentPage === 'chatroom' && window.peerInstance) {
      window.peerInstance.leaveChat();
    }
    setCurrentPage('home');
  };

  // Example of using individual components
  const handleMyMessage = () => {
    console.log('Individual textbox message:', myMessage);
    setMyMessage(''); 
  };

  const handleChatSend = useCallback(() => {
    if (chatMessage.trim()) {
      // Add message to local UI first
      addMessage(chatMessage, window.myId, 'You');
      
      // Send message through PeerJS
      if (window.peerInstance && isConnected) {
        window.peerInstance.sendMessage(chatMessage);
      }
      console.log('Chat message sent:', chatMessage);
      setChatMessage(''); 
    }
  }, [chatMessage, isConnected]);

  const handleFileUpload = useCallback((event) => {
    const file = event.target.files[0];
    if (file && window.peerInstance && isConnected) {
      window.peerInstance.sendMediaFile(file);
    }
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [isConnected]);

  const handleFileButtonClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };


  const handleHostChat = () => {
    if (window.peerInstance && window.myId) {
      window.peerInstance.hostChat();
      setRoomId(window.myId);
      setIsConnected(false); // Start as not connected, wait for first user
      clearUserList();
      clearMessages();
      addUser(window.myId, true); // Add host as first user
      setCurrentPage('chatroom'); 
    } else {
      notify('Please wait for peer connection to initialize...', 3000, 'warning');
    }
  };

  const handleConnectToPeer = () => {
    if (connectToId.trim() && window.peerInstance) {
      setRoomId(connectToId);
      setIsConnected(false); // Will be set to true when connection succeeds
      clearUserList();
      clearMessages();
      // Don't add users immediately - wait for successful connection
      setCurrentPage('chatroom'); 
      window.peerInstance.connectToPeer(connectToId);
    } else {
      notify('Please enter a valid Peer ID to connect.', 3000, 'warning');
    }
  };

  // HOME PAGE - Convert to render function
  const renderHomePage = () => (
    <div className="page">
      <div className="hero">
        <h1>🌿 MintChat</h1>
        <p>End-to-End Encrypted Chat Application</p>
        <p className="subtitle">The cutest way to chat securely!</p>
      </div>
      
      <div className="button-grid">
        <button 
          className="page-button host-btn"
          onClick={() => goToPage('host')}
        >
          <i className="fas fa-plus"></i>
          <div>
            <h3>Host Chat</h3>
            <p>Start a new chat room</p>
          </div>
        </button>
        
        <button 
          className="page-button join-btn"
          onClick={() => goToPage('join')}
        >
          <i className="fas fa-sign-in-alt"></i>
          <div>
            <h3>Join Chat</h3>
            <p>Connect to existing room</p>
          </div>
        </button>
      </div>
    </div>
  );

  // HOST PAGE - Convert to render function
  const renderHostPage = () => (
    <div className="page">
      <div className="page-header">
        <button className="back-btn" onClick={goHome}>
          <i className="fas fa-arrow-left"></i> Back
        </button>
        <h2>Host a New Chat</h2>
      </div>
      
      <div className="host-container">
        <InfoCard text={`Your unique code:\n${window.myId}`} display={window.myId ? 'block' : 'none'} />
        <button
          className="action-button host-action"
          onClick={handleHostChat}
        >
          <i className="fas fa-plus"></i> Create Chat Room
        </button>
      </div>
    </div>
  );

  // JOIN PAGE - Convert to render function
  const renderJoinPage = () => (
    <div className="page">
      <div className="page-header">
        <button className="back-btn" onClick={goHome}>
          <i className="fas fa-arrow-left"></i> Back
        </button>
        <h2>Join an Existing Chat</h2>
      </div>
      
      <div className="join-container">
        <div className="info-card">
          <i className="fas fa-info-circle"></i>
          <p>Enter the Peer ID that someone shared with you to join their chat room.</p>
        </div>
        
        <div className="input-group">
          <TextBox
            placeholder="Enter Peer ID (e.g., abc123def456)"
            value={connectToId}
            onChange={setConnectToId}
            onEnter={handleConnectToPeer}
            className="peer-id-input"
          />
          <SendButton
            onClick={handleConnectToPeer}
            disabled={!connectToId.trim()}
          />
        </div>
      </div>
    </div>
  );

  // CHAT ROOM PAGE - Convert to render function
  const renderChatRoomPage = () => (
    <div className="page chat-room-page">
      <div className="page-header">
        <button className="back-btn" onClick={goHome}>
          <i className="fas fa-arrow-left"></i> Back
        </button>
        <h2>Chat Room {roomId}</h2>
        <div className="connection-status">
          {isConnected ? (
            <span className="connected"><i className="fas fa-circle"></i> Connected</span>
          ) : (
            <span className="disconnected"><i className="fas fa-circle"></i> Connecting...</span>
          )}
        </div>
      </div>
      
      <div className="chat-container-desktop">
        <div className="chat-sidebar">
          <div className="chat-info">
            <h4><i className="fas fa-users"></i> Chat Info</h4>
            <p>Room ID: {roomId ? roomId.slice(0, 8) + '...' : 'Loading...'}</p>
            <p>Status: {isConnected ? 'Connected' : 'Waiting for connection...'}</p>
            <p>Users Online: {connectedUsers.length}</p>
          </div>
          
          <div className="user-list">
            <h4><i className="fas fa-user-friends"></i> Connected Users</h4>
            <div className="user-list-container" ref={userListRef}>
              {connectedUsers.length > 0 ? (
                connectedUsers.map((user, index) => (
                  <div key={user.id} className="user-item">
                    <div className="user-avatar">
                      <i className={user.isHost ? "fas fa-crown" : "fas fa-user"}></i>
                    </div>
                    <div className="user-info">
                      <span className="user-name">
                        {user.name}
                        {user.isHost && <span className="host-badge">Host</span>}
                        {user.id === window.myId && <span className="you-badge">You</span>}
                      </span>
                      <small className="user-joined">Joined: {user.joinedAt}</small>
                    </div>
                    <div className="user-status">
                      <i className="fas fa-circle online"></i>
                    </div>
                  </div>
                ))
              ) : (
                <div className="no-users">
                  <i className="fas fa-user-slash"></i>
                  <p>No users connected</p>
                </div>
              )}
            </div>
          </div>
          
          <div className="chat-actions">
            <button className="sidebar-btn" onClick={() => navigator.clipboard?.writeText(roomId)}>
              <i className="fas fa-copy"></i> Copy ID
            </button>
          </div>
        </div>
        
        <div className="chat-main">
          <div className="chat-messages-desktop">
            {messages.length > 0 ? (
              <div className="messages-container">
                {messages.map((message) => (
                  <div 
                    key={message.id} 
                    className={`message ${message.isOwnMessage ? 'own-message' : 'other-message'} ${message.type === 'system' ? 'system-message' : ''}`}
                  >
                    <div className="message-avatar">
                      {message.senderName.charAt(0).toUpperCase()}
                    </div>
                    <div className="message-content-wrapper">
                      <div className="message-header">
                        <span className="message-sender">{message.senderName}</span>
                        <span className="message-time">{message.timestamp}</span>
                        {message.type && message.type !== 'text' && (
                          <span className="message-type-badge">{message.type}</span>
                        )}
                      </div>
                      <div className="message-content">
                        {/* Render different content based on message type */}
                        {message.type === 'image' && message.mediaData ? (
                          <div className="media-message">
                            <p>{message.content}</p>
                            <img 
                              src={message.mediaData.base64Data} 
                              alt={message.mediaData.filename}
                              style={{ 
                                maxWidth: '300px', 
                                maxHeight: '300px', 
                                borderRadius: '8px',
                                cursor: 'pointer'
                              }}
                              onClick={() => window.open(message.mediaData.base64Data, '_blank')}
                              title={`${message.mediaData.filename} (${(message.mediaData.size / 1024 / 1024).toFixed(2)} MB)`}
                            />
                            <div className="file-attachment">
                              <i className="fas fa-download"></i>
                              <a 
                                href={message.mediaData.base64Data} 
                                download={message.mediaData.filename}
                                className="file-download"
                              >
                                Download {message.mediaData.filename} ({(message.mediaData.size / 1024).toFixed(1)} KB)
                              </a>
                            </div>
                          </div>
                        ) : message.type === 'video' && message.mediaData ? (
                          <div className="media-message">
                            <p>{message.content}</p>
                            <video 
                              controls 
                              style={{ 
                                maxWidth: '300px', 
                                maxHeight: '300px', 
                                borderRadius: '8px'
                              }}
                              title={`${message.mediaData.filename} (${(message.mediaData.size / 1024 / 1024).toFixed(2)} MB)`}
                            >
                              <source src={message.mediaData.base64Data} type={message.mediaData.mimeType} />
                              Your browser does not support the video element.
                            </video>
                            <div className="file-attachment">
                              <i className="fas fa-download"></i>
                              <a 
                                href={message.mediaData.base64Data} 
                                download={message.mediaData.filename}
                                className="file-download"
                              >
                                Download {message.mediaData.filename} ({(message.mediaData.size / 1024).toFixed(1)} KB)
                              </a>
                            </div>
                          </div>
                        ) : message.type === 'file' && message.mediaData ? (
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
                        ) : (
                          /* XSS-safe: React automatically escapes text content */
                          message.content
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            ) : (
              <div className="message-placeholder">
                <i className="fas fa-comments"></i>
                <p>Start chatting! Messages will appear here.</p>
                <small>Send your first message to begin the conversation</small>
              </div>
            )}
          </div>
          
          <div className="chat-input-desktop">
            <input
              ref={fileInputRef}
              type="file"
              accept="*/*"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            <button 
              className="file-upload-btn"
              onClick={handleFileButtonClick}
              disabled={!isConnected}
              title="Upload any file"
              style={{
                background: 'none',
                border: 'none',
                color: isConnected ? '#4CAF50' : '#ccc',
                fontSize: '20px',
                cursor: isConnected ? 'pointer' : 'not-allowed',
                padding: '8px',
                marginRight: '8px'
              }}
            >
              <i className="fas fa-paperclip"></i>
            </button>
            <input
              ref={chatInputRef}
              key="stable-chat-input"
              type="text"
              className="input-textbox chat-message-input-desktop"
              placeholder="Type your message here..."
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleChatSend();
                }
              }}
            />
            <SendButton 
              onClick={handleChatSend}
              disabled={!chatMessage.trim()}
            />
          </div>
        </div>
      </div>
    </div>
  );

  // DEMO PAGE - Convert to render function
  const renderDemoPage = () => (
    <div className="page">
      <div className="page-header">
        <button className="back-btn" onClick={goHome}>
          <i className="fas fa-arrow-left"></i> Back
        </button>
        <h2>Component Demo</h2>
      </div>
      
      <div className="demo-container">
        <div className="section">
          <h3>Complete Chat Demo:</h3>
          <ChatDemo />
        </div>
        
        <div className="section">
          <h3>Individual Components:</h3>
          <div style={{display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px'}}>
            <TextBox 
              placeholder="Just a simple textbox..." 
              value={myMessage}
              onChange={setMyMessage}
              onEnter={handleMyMessage}
            />
            <SendButton 
              onClick={handleMyMessage}
              disabled={!myMessage.trim()}
            />
            <EmojiButton 
              onClick={() => setMyMessage(myMessage + ' 🎉')}
            />
          </div>
          <p><small>↑ Mix and match components however you want!</small></p>
        </div>
      </div>
    </div>
  );

  // RENDER CURRENT PAGE - Use render functions instead of components
  const renderCurrentPage = () => {
    if (currentPage === 'home') {
      return renderHomePage();
    }
    if (currentPage === 'host') {
      return renderHostPage();
    }
    if (currentPage === 'join') {
      return renderJoinPage();
    }
    if (currentPage === 'chatroom') {
      return renderChatRoomPage();
    }
    if (currentPage === 'demo') {
      return renderDemoPage();
    }
    return renderHomePage();
  };



  return (
    <div className="app">
      {renderCurrentPage()}
      
      {/* Notification System */}
      <NotificationContainer 
        notifications={notifications} 
        onRemove={removeNotification} 
      />
    </div>
  );
}

// Make App available globally
window.App = App;
