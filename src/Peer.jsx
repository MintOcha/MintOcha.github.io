// Peer.jsx - PeerJS functionality for MintChat
// SECURITY NOTE: Sender verification is handled by using the PeerJS connection as source of truth
// Clients cannot spoof sender IDs because each connection has a verified peer ID from PeerJS
const primeMod = 0xffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7edee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3dc2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f83655d23dca3ad961c62f356208552bb9ed529077096966d670c354e4abc9804f1746c08ca18217c32905e462e36ce3be39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9de2bcbf6955817183995497cea956ae515d2261898fa051015728e5a8aaac42dad33170d04507a33a85521abdf1cba64ecfb850458dbef0a8aea71575d060c7db3970f85a6e1e4c7abf5ae8cdb0933d71e8c94e04a25619dcee3d2261ad2ee6bf12ffa06d98a0864d87602733ec86a64521f2b18177b200cbbe117577a615d6c770988c0bad946e208e24fa074e5ab3143db5bfce0fd108e4b82d120a92108011a723c12a787e6d788719a10bdba5b2699c327186af4e23c1a946834b6150bda2583e9ca2ad44ce8dbbbc2db04de8ef92e8efc141fbecaa6287c59474e6bc05d99b2964fa090c3a2233ba186515be7ed1f612970cee2d7afb81bdd762170481cd0069127d5b05aa993b4ea988d8fddc186ffb7dc90a6c08f4df435c934063199ffffffffffffffffn;
let base = 2n;
let peer;
window.myId = '';
let currentRoomId = '';
let connections = [];

// Simple 2-party Diffie-Hellman state
let myPrivateKey = BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
let myPublicKey;
let finalKey;

function setCurrentRoomId(id) {
    currentRoomId = id;
    myPublicKey = modularExponentiation(BigInt(base), BigInt(myPrivateKey), BigInt(primeMod));
}

// Message types for JSON communication
const MESSAGE_TYPES = {
    TEXT: 'text',
    SYSTEM: 'system',
    PUBLIC_KEY: 'publicKey',
    USER_JOIN: 'userJoin',
    USER_LEAVE: 'userLeave',
    ENCRYPTED: 'encrypted',
    IMAGE: 'image',
    VIDEO: 'video',
    FILE: 'file'
};

// 2-party Diffie-Hellman functions
function createKeyExchangeMessage() {
    return {
        type: MESSAGE_TYPES.PUBLIC_KEY,
        timestamp: Date.now(),
        data: {
            publicKey: myPublicKey.toString()
        }
    };
}

function modularExponentiation(base, exponent, modulus) {
    if (modulus === 1n) return 0n;
    let result = 1n;
    base = base % modulus;
    while (exponent > 0n) {
        if (exponent % 2n === 1n) {
            result = (result * base) % modulus;
        }
        exponent = exponent / 2n; // BigInt division
        base = (base * base) % modulus;
    }
    return result;
}

// Media utility functions
function getMediaType(file) {
    const type = file.type.toLowerCase();
    if (type.startsWith('image/')) {
        return MESSAGE_TYPES.IMAGE;
    } else if (type.startsWith('video/')) {
        return MESSAGE_TYPES.VIDEO;
    } else {
        // All other files are treated as downloadable files
        return MESSAGE_TYPES.FILE;
    }
}

async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

class PeerFuncs {
    monitorConnectionState(connection) {
        if (!connection || !connection.peerConnection) {
            return;
        }

        connection.peerConnection.onconnectionstatechange = () => {
            if (!connection || !connection.peerConnection) return;

            const state = connection.peerConnection.connectionState;
            console.log(`connectionStateChanged to: ${state} for peer ${connection.peer}`);

            switch (state) {
                case 'disconnected':
                case 'failed':
                case 'closed':
                    this.handleDisconnect(connection);
                    break;
                case 'connected':
                    // Connection is healthy
                    window.setConnectionStatus && window.setConnectionStatus(true);
                    break;
            }
        };
    }

    init() {
        peer = new Peer(undefined, {
        config: {
            iceServers: [
            {
                urls: "stun:stun.relay.metered.ca:80",
            },
            {
                urls: "turn:global.relay.metered.ca:80",
                username: "cb658ce6eafa2545cd570d9b",
                credential: "zrdCefkSKBk7E6/h",
            },
            {
                urls: "turn:global.relay.metered.ca:80?transport=tcp",
                username: "cb658ce6eafa2545cd570d9b",
                credential: "zrdCefkSKBk7E6/h",
            },
            {
                urls: "turn:global.relay.metered.ca:443",
                username: "cb658ce6eafa2545cd570d9b",
                credential: "zrdCefkSKBk7E6/h",
            },
            {
                urls: "turns:global.relay.metered.ca:443?transport=tcp",
                username: "cb658ce6eafa2545cd570d9b",
                credential: "zrdCefkSKBk7E6/h",
            },
        ]
        }
    });
        peer.on('open', id => {
            window.myId = id;
        });

        peer.on('connection', newConnection => {
            connections.push(newConnection);
            console.log(`New connection from ${newConnection.peer}`);

            newConnection.on('open', () => {
                this.monitorConnectionState(newConnection);
                // Send system message about user joining
                this.sendSystemMessage(`[${newConnection.peer.slice(0, 6)}] has joined.`, newConnection.peer);
                
                // Add user to the list
                window.addUser && window.addUser(newConnection.peer, false);
                window.setConnectionStatus && window.setConnectionStatus(true);

                // Trigger key exchange with new participant
                this.initiateKeyExchange();
            });

            // Event: When we receive data from this specific connection
            newConnection.on('data', async rawData => {
                try {
                    const messageData = JSON.parse(rawData);
                    console.log('Received data:', messageData);
                    await this.handleIncomingMessage(messageData, newConnection);
                } catch (error) {
                    console.error('Failed to parse incoming message:', error);
                    // Fallback for non-JSON messages (legacy support)
                    this.handleLegacyMessage(rawData, newConnection);
                }
            });

            newConnection.on('close', () => {
                this.handleDisconnect(newConnection);
            });
        });

        peer.on('error', err => {
            console.error('PeerJS Error:', err);
            window.notify && window.notify(`PeerJS Error: ${err.message}`, 5000, 'error');
        });
    }

    // Handle incoming JSON messages
    async handleIncomingMessage(messageData, connection, isDecrypted = false) {
        const { type, senderId, senderName, content, timestamp, data } = messageData;
        
        // SECURITY: Override sender information with verified connection data
        // Use the connection's peer ID as the authoritative sender ID
        const verifiedSenderId = connection.peer;
        const verifiedSenderName = connection.peer.slice(0, 8); // Use first 8 chars of peer ID as name
        
        // Add unencrypted warning for messages that should be encrypted
        if (!isDecrypted && type !== MESSAGE_TYPES.SYSTEM && type !== MESSAGE_TYPES.PUBLIC_KEY && type !== MESSAGE_TYPES.ENCRYPTED) {
            window.addMessage && window.addMessage(
                '⚠️ WARNING: This message was sent UNENCRYPTED and could be intercepted!', 
                'system', 'System', 'system'
            );
        }
        
        switch (type) {
            case MESSAGE_TYPES.ENCRYPTED:
                // Handle encrypted messages
                try {
                    const decryptedMessageData = await this.decryptMessage(messageData);
                    // Recursively call handleIncomingMessage with decrypted data
                    await this.handleIncomingMessage(decryptedMessageData, connection, true);
                } catch (error) {
                    console.error('Decryption failed:', error);
                    window.addMessage && window.addMessage(
                        '🔒❌ Failed to decrypt message. It may be corrupted or tampered with.', 
                        'system', 'System', 'system'
                    );
                }
                break;

            case MESSAGE_TYPES.TEXT:
                // Display text message with verified sender info
                const messagePrefix = isDecrypted ? '🔒 ' : '🔓 ';
                window.addMessage && window.addMessage(
                    messagePrefix + content, 
                    verifiedSenderId, 
                    verifiedSenderName,
                    'text'
                );
                
                // Broadcast to other connections (if host) with verified sender info
                const verifiedMessageData = {
                    ...messageData,
                    senderId: verifiedSenderId,
                    senderName: verifiedSenderName
                };
                this.broadcastMessage(verifiedMessageData, connection.peer);
                break;

            case MESSAGE_TYPES.IMAGE:
                // Display image message with verified sender info
                const imagePrefix = isDecrypted ? '🔒 ' : '🔓 ';
                window.addMessage && window.addMessage(
                    imagePrefix + `Shared an image: ${data.filename}`, 
                    verifiedSenderId, 
                    verifiedSenderName,
                    'image',
                    {
                        base64Data: data.base64Data,
                        filename: data.filename,
                        mimeType: data.mimeType,
                        size: data.size
                    }
                );
                
                // Broadcast with verified sender info
                const verifiedImageData = {
                    ...messageData,
                    senderId: verifiedSenderId,
                    senderName: verifiedSenderName
                };
                this.broadcastMessage(verifiedImageData, connection.peer);
                break;

            case MESSAGE_TYPES.VIDEO:
                // Display video message with verified sender info
                const videoPrefix = isDecrypted ? '🔒 ' : '🔓 ';
                window.addMessage && window.addMessage(
                    videoPrefix + `Shared a video: ${data.filename}`, 
                    verifiedSenderId, 
                    verifiedSenderName,
                    'video',
                    {
                        base64Data: data.base64Data,
                        filename: data.filename,
                        mimeType: data.mimeType,
                        size: data.size
                    }
                );
                
                // Broadcast with verified sender info
                const verifiedVideoData = {
                    ...messageData,
                    senderId: verifiedSenderId,
                    senderName: verifiedSenderName
                };
                this.broadcastMessage(verifiedVideoData, connection.peer);
                break;

            case MESSAGE_TYPES.FILE:
                // Display file message with verified sender info
                const filePrefix = isDecrypted ? '🔒 ' : '🔓 ';
                window.addMessage && window.addMessage(
                    filePrefix + `Shared a file: ${data.filename}`, 
                    verifiedSenderId, 
                    verifiedSenderName,
                    'file',
                    {
                        base64Data: data.base64Data,
                        filename: data.filename,
                        mimeType: data.mimeType,
                        size: data.size
                    }
                );
                
                // Broadcast with verified sender info
                const verifiedFileData = {
                    ...messageData,
                    senderId: verifiedSenderId,
                    senderName: verifiedSenderName
                };
                this.broadcastMessage(verifiedFileData, connection.peer);
                break;
                
            case MESSAGE_TYPES.SYSTEM:
                // SECURITY: Block SYSTEM messages from external peers to prevent spoofing
                // System messages should only be generated locally, not accepted from network
                console.warn(`Blocked SYSTEM message from external peer: ${verifiedSenderId}`);
                window.addMessage && window.addMessage(
                    `⚠️ Security Warning: Peer ${verifiedSenderId.slice(0, 6)} attempted to send a system message (blocked)`, 
                    'system', 'System', 'system'
                );
                break;
                
            case MESSAGE_TYPES.PUBLIC_KEY:
                // Legacy 2-party key exchange - still supported for backward compatibility
                const receivedPubKey = data.publicKey;
                const receivedPubKeyRepresentation = BigInt(receivedPubKey).toString(16).slice(0, 16);
                window.addMessage(`Received public key: ${receivedPubKeyRepresentation}...`, 'System', 'system', 'system');

                finalKey = modularExponentiation(BigInt(receivedPubKey), BigInt(myPrivateKey), BigInt(primeMod));
                const finalKeyRepresentation = finalKey.toString(16).slice(0, 16);
                window.addMessage(`Computed shared secret key: ${finalKeyRepresentation}...`, 'System', 'system', 'system');
                window.addMessage('Key exchange complete! To verify integrity, compare the final key with the other party.', 'System', 'system', 'system');
                break;
                
            default:
                console.warn('Unknown message type:', type);
        }
    }

    // Decrypt message function
    async decryptMessage(encryptedMessageData) {
        if (!finalKey) {
            throw new Error('Shared secret key not established yet');
        }

        const { iv, data } = encryptedMessageData;
        
        try {
            // Create key hash from finalKey
            const keyBuffer = new TextEncoder().encode(finalKey.toString());
            const keyHashBuffer = await crypto.subtle.digest('SHA-256', keyBuffer);
            
            // Import the hash as AES key (first 32 bytes for AES-256)
            const aesKey = await crypto.subtle.importKey(
                'raw',
                keyHashBuffer.slice(0, 32),
                { name: 'AES-GCM' },
                false,
                ['decrypt'] // Changed to decrypt
            );
            
            // Convert arrays back to Uint8Array
            const ivArray = new Uint8Array(iv);
            const encryptedArray = new Uint8Array(data);
            
            // Decrypt the message
            const decryptedBuffer = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: ivArray },
                aesKey,
                encryptedArray
            );
            
            // Convert back to JSON
            const decryptedString = new TextDecoder().decode(decryptedBuffer);
            const decryptedMessageData = JSON.parse(decryptedString);
            
            return decryptedMessageData;
            
        } catch (error) {
            console.error('Decryption error:', error);
            throw new Error(`Decryption failed: ${error.message}`);
        }
    }

    // Legacy support for old text-only messages
    handleLegacyMessage(rawData, connection) {
        const verifiedSenderId = connection.peer;
        const verifiedSenderName = connection.peer.slice(0, 8);
        
        console.log(`Legacy message from [${verifiedSenderId.slice(0, 6)}]: ${rawData}`);
        
        // Treat as text message with verified sender info
        window.addMessage && window.addMessage(
            rawData, 
            verifiedSenderId, 
            verifiedSenderName,
            'text'
        );
        
        // Convert to JSON format and broadcast with verified sender info
        const jsonMessage = this.createTextMessage(rawData, verifiedSenderId, verifiedSenderName);
        this.broadcastMessage(jsonMessage, connection.peer);
    }

    // 2-party key exchange method
    initiateKeyExchange() {
        // For 2-party exchange, simply send our public key
        const keyExchangeMessage = createKeyExchangeMessage();
        this.broadcastMessage(keyExchangeMessage);
        
        window.addMessage && window.addMessage(
            '🔄 Initiating key exchange...', 
            'system', 'System', 'system'
        );
    }

    createTextMessage(content) {
        return {
            type: MESSAGE_TYPES.TEXT,
            content: content,
            timestamp: Date.now()
        };
    }

    createMediaMessage(type, base64Data, filename, mimeType, size) {
        return {
            type: type,
            timestamp: Date.now(),
            data: {
                base64Data: base64Data,
                filename: filename,
                mimeType: mimeType,
                size: size
            }
        };
    }

    sendSystemMessage(content, senderId = 'system') {
        window.addMessage && window.addMessage(
            content, 
            senderId, 
            'System',
            'system'
        );
    }

    hostChat() {
        if (!peer || !window.myId) {
            window.notify && window.notify('Peer not initialized yet. Please wait...', 3000, 'warning');
            return;
        }
        window.notify && window.notify(`Hosting chat! Share this ID: ${window.myId}`, 8000, 'success');
        console.log(`Hosting chat with ID: ${window.myId}`);
        setCurrentRoomId(window.myId);
    }

    connectToPeer(peerId) {
        if (!peerId) {
            window.notify && window.notify('Please enter a valid Peer ID to connect.', 3000, 'warning');
            return;
        }
        if (!peer) {
            window.notify && window.notify('Peer not initialized yet. Please wait...', 3000, 'warning');
            return;
        }
        
        window.notify && window.notify(`Connecting to ${peerId.slice(0, 8)}...`, 3000, 'info');
        
        const conn = peer.connect(peerId);
        
        // Set a timeout for connection failure
        const connectionTimeout = setTimeout(() => {
            if (!conn.open) {
                this.sendSystemMessage(`Failed to connect to ${peerId.slice(0, 8)} - peer not found or unreachable`);
                window.setConnectionStatus && window.setConnectionStatus(false);
                // Clear user list on failed connection
                window.clearUserList && window.clearUserList();
                window.goHome && window.goHome();
            }
        }, 10000); // 10 second timeout
        
        conn.on('open', () => {
            this.monitorConnectionState(conn);
            clearTimeout(connectionTimeout);
            connections.push(conn);
            console.log(`Connected to: ${peerId}`);
            setCurrentRoomId(peerId);
            
            // Update connection status
            window.setConnectionStatus && window.setConnectionStatus(true);
            this.sendSystemMessage(`Connected to ${peerId.slice(0, 8)}!`);
            
            // Add users to the list when connection is successful
            window.addUser && window.addUser(peerId, true); // Add host
            window.addUser && window.addUser(window.myId, false); // Add self

            this.initiateKeyExchange();

            conn.on('data', async rawData => {
                try {
                    const messageData = JSON.parse(rawData);
                    await this.handleIncomingMessage(messageData, conn);
                } catch (error) {
                    console.error('Failed to parse incoming message:', error);
                    // Fallback for non-JSON messages
                    this.handleLegacyMessage(rawData, conn);
                }
            });
            
            conn.on('close', () => {
                this.handleDisconnect(conn);
            });
        });

        conn.on('error', err => {
            clearTimeout(connectionTimeout);
            console.error('Connection error:', err);
            this.sendSystemMessage(`Failed to connect: ${err.message}`);
            window.setConnectionStatus && window.setConnectionStatus(false);
            // Clear user list on connection error
            window.clearUserList && window.clearUserList();
            window.goHome && window.goHome();
        });
    }

    handleDisconnect(connection) {
        if (!connection) return;

        const peerId = connection.peer;
        // Ensure we only handle this once
        const existingConnection = connections.find(c => c.peer === peerId);
        if (!existingConnection) {
            return; // Already handled
        }

        this.sendSystemMessage(`[${peerId.slice(0, 6)}] has disconnected.`);
        connections = connections.filter(c => c.peer !== peerId);
        
        // Remove user from the list
        window.removeUser && window.removeUser(peerId);
        
        // If no connections are left, update status
        if (connections.length === 0) {
            window.setConnectionStatus && window.setConnectionStatus(false);
            finalKey = null; // Reset key
            this.sendSystemMessage("All users have disconnected.");
        }
    }

    // Broadcast JSON message to all connections except sender
    async broadcastMessage(messageData, senderPeer = null) {
        // Check if this is a key exchange message that should be sent unencrypted
        const isKeyExchangeMessage = messageData.type === MESSAGE_TYPES.PUBLIC_KEY;
        
        // If no shared key and it's not a key exchange message, refuse to send
        if (!finalKey && !isKeyExchangeMessage) {
            console.warn('No shared key available for encryption. Cannot send non-key-exchange message.');
            window.notify && window.notify('No shared key available for encryption', 3000, 'warning');
            return;
        }
        
        // Key exchange messages are sent unencrypted to establish the shared key
        if (isKeyExchangeMessage) {
            const jsonString = JSON.stringify(messageData);
            for (let conn of connections) {
                if (conn && conn.open && conn.peer !== senderPeer) {
                    conn.send(jsonString);
                }
            }
            return;
        }

        // All other messages must be encrypted
        try {
            // Create key hash from finalKey
            const keyBuffer = new TextEncoder().encode(finalKey.toString());
            const keyHashBuffer = await crypto.subtle.digest('SHA-256', keyBuffer);
            
            // Import the hash as AES key (first 32 bytes for AES-256)
            const aesKey = await crypto.subtle.importKey(
                'raw',
                keyHashBuffer.slice(0, 32),
                { name: 'AES-GCM' },
                false,
                ['encrypt']
            );
            
            // Encrypt the message
            const jsonString = JSON.stringify(messageData);
            const messageBuffer = new TextEncoder().encode(jsonString);
            const iv = crypto.getRandomValues(new Uint8Array(12)); // 12 bytes for GCM
            
            const encryptedBuffer = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv },
                aesKey,
                messageBuffer
            );
            
            // Create encrypted message payload without sender info in outer envelope
            const encryptedPayload = {
                type: MESSAGE_TYPES.ENCRYPTED,
                timestamp: Date.now(),
                iv: Array.from(iv),
                data: Array.from(new Uint8Array(encryptedBuffer))
            };
            
            // Broadcast encrypted message
            const encryptedString = JSON.stringify(encryptedPayload);
            for (let conn of connections) {
                if (conn && conn.open && conn.peer !== senderPeer) {
                    conn.send(encryptedString);
                }
            }
            
        } catch (error) {
            console.error('Encryption failed. Data will not send unless encrypted. Error: ', error);
        }
    }

    // Send text message (main public method)
    sendMessage(message) {
        if (connections.length === 0) {
            return;
        }

        if (!finalKey) {
            window.notify && window.notify('Shared secret key not established yet. Your messages will not be encrypted. Please wait for key exchange to complete', 3000, 'warning');
            return;
        }
        
        // Create JSON message object without sender info (will be verified by receiver)
        const messageData = this.createTextMessage(message);
        
        // Broadcast to all connections
        this.broadcastMessage(messageData);
        
        console.log(`Sent message: ${message}`);
    }

    async sendMediaFile(file) {
        if (connections.length === 0) {
            window.notify && window.notify('No connections available', 3000, 'warning');
            return;
        }

        if (!finalKey) {
            window.notify && window.notify('Shared secret key not established yet. Media will not be encrypted. Please wait for key exchange to complete', 3000, 'warning');
            return;
        }

        try {
            // Show uploading notification
            window.notify && window.notify(`Uploading ${file.name}...`, 2000, 'info');
            
            // Convert file to base64
            const base64Data = await fileToBase64(file);
            
            // Determine message type
            const messageType = getMediaType(file);
            
            // Create media message
            const messageData = this.createMediaMessage(
                messageType,
                base64Data,
                file.name,
                file.type,
                file.size
            );
            
            // Add to local UI first
            const prefix = '🔒 ';
            let displayText = '';
            if (messageType === MESSAGE_TYPES.IMAGE) {
                displayText = prefix + `Shared an image: ${file.name}`;
            } else if (messageType === MESSAGE_TYPES.VIDEO) {
                displayText = prefix + `Shared a video: ${file.name}`;
            } else {
                displayText = prefix + `Shared a file: ${file.name}`;
            }
            
            window.addMessage && window.addMessage(
                displayText,
                window.myId,
                'You',
                messageType.toLowerCase(),
                {
                    base64Data: base64Data,
                    filename: file.name,
                    mimeType: file.type,
                    size: file.size
                }
            );
            
            // Broadcast to all connections
            this.broadcastMessage(messageData);
            
            console.log(`Sent ${messageType}: ${file.name}`);
            window.notify && window.notify(`${file.name} sent successfully!`, 2000, 'success');
            
        } catch (error) {
            console.error('Failed to send media file:', error);
            window.notify && window.notify(`Failed to send ${file.name}: ${error.message}`, 5000, 'error');
        }
    }

    leaveChat() {
        // Close all connections
        connections.forEach(conn => {
            if (conn && conn.open) {
                conn.close();
            }
        });
        
        // Clear connections array
        connections = [];
        
        // Don't destroy peer if hosting - just close connections
        // If we're not hosting, we can destroy and reinitialize
        if (peer && connections.length === 0) {
            peer.destroy();
            // Reinitialize peer for future connections
            setTimeout(() => {
                this.init();
            }, 1000);
        }
        
        // Reset connection status
        window.setConnectionStatus && window.setConnectionStatus(false);
        
        // Add system message about leaving
        this.sendSystemMessage("You left the chat");
        
        console.log('Left the chat and disconnected from all peers');
    }
}

// Make PeerFuncs available globally
window.PeerFuncs = PeerFuncs;

// Create a global instance for easy access
window.peerInstance = new PeerFuncs();

