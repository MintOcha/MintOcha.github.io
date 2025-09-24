// MPDH.jsx - Elliptic-curve Diffie-Hellman Key Exchange Module for MintChat

const MPDH = {
    keyPair: null,
    sharedKey: null,

    /**
     * Generates a new ECDH key pair for the client.
     * This should be called at the start of a new chat session.
     */
    async generateKeys() {
        this.keyPair = await window.crypto.subtle.generateKey(
            { name: "ECDH", namedCurve: "P-256" },
            true,
            ["deriveKey"]
        );
        this.sharedKey = null; // Reset shared key whenever new keys are generated
        console.log("Generated new ECDH key pair.");
    },

    /**
     * Exports the public key to be sent to the other peer.
     * @returns {Promise<JsonWebKey>} The public key in JWK format.
     */
    async getPublicKey() {
        if (!this.keyPair) {
            await this.generateKeys();
        }
        return await window.crypto.subtle.exportKey("jwk", this.keyPair.publicKey);
    },

    /**
     * Derives the shared secret using our private key and the other peer's public key.
     * @param {JsonWebKey} peerPublicKey - The public key in JWK format from the other peer.
     */
    async deriveSharedSecret(peerPublicKey) {
        const publicKey = await window.crypto.subtle.importKey(
            "jwk",
            peerPublicKey,
            { name: "ECDH", namedCurve: "P-256" },
            true,
            []
        );

        this.sharedKey = await window.crypto.subtle.deriveKey(
            { name: "ECDH", public: publicKey },
            this.keyPair.privateKey,
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"]
        );
        console.log("Derived shared secret.");
    },

    /**
     * Encrypts a message using the shared secret.
     * @param {string} message - The plaintext message to encrypt.
     * @returns {Promise<{iv: Array, encryptedData: Array}>} The IV and encrypted data as arrays.
     */
    async encrypt(message) {
        if (!this.sharedKey) {
            throw new Error("Shared key is not derived yet. Cannot encrypt.");
        }
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encodedMessage = new TextEncoder().encode(message);

        const encryptedBuffer = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            this.sharedKey,
            encodedMessage
        );

        return { iv: Array.from(iv), encryptedData: Array.from(new Uint8Array(encryptedBuffer)) };
    },

    /**
     * Decrypts a message using the shared secret.
     * @param {Array} encryptedData - The encrypted data from the peer.
     * @param {Array} iv - The initialization vector from the peer.
     * @returns {Promise<string>} The decrypted plaintext message.
     */
    async decrypt(encryptedData, iv) {
        if (!this.sharedKey) {
            throw new Error("Shared key is not derived yet. Cannot decrypt.");
        }
        const decryptedBuffer = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: new Uint8Array(iv) },
            this.sharedKey,
            new Uint8Array(encryptedData)
        );

        return new TextDecoder().decode(decryptedBuffer);
    },

    hasSharedKey() {
        return this.sharedKey !== null;
    },

    /**
     * Generates a verification hash of the shared key salted with a timestamp.
     * @param {number} salt - A timestamp or nonce to use as a salt.
     * @returns {Promise<string>} A 16-character hex string hash.
     */
    async getSharedKeyHash(salt) {
        if (!this.sharedKey) {
            throw new Error("Shared key not available for hashing.");
        }

        // Export the key to get raw bytes
        const keyMaterial = await window.crypto.subtle.exportKey("raw", this.sharedKey);

        // Use the provided salt
        const saltBuffer = new TextEncoder().encode(salt.toString());

        // Combine key material and salt
        const combinedBuffer = new Uint8Array(keyMaterial.byteLength + saltBuffer.byteLength);
        combinedBuffer.set(new Uint8Array(keyMaterial), 0);
        combinedBuffer.set(saltBuffer, keyMaterial.byteLength);

        // Hash the combined buffer
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', combinedBuffer);

        // Convert to hex string and truncate
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hexHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        
        return hexHash.slice(0, 16); // Return the first 16 characters
    }
};

window.MPDH = MPDH;
