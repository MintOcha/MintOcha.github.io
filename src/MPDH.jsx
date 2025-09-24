// MPDH.jsx - Diffie-Hellman Key Exchange Module for MintChat
// Simple 2-party Diffie-Hellman implementation

// RFC 3526 2048-bit MODP Group prime
const primeMod = 0xffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f14374fe1356d6d51c245e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7edee386bfb5a899fa5ae9f24117c4b1fe649286651ece45b3dc2007cb8a163bf0598da48361c55d39a69163fa8fd24cf5f83655d23dca3ad961c62f356208552bb9ed529077096966d670c354e4abc9804f1746c08ca18217c32905e462e36ce3be39e772c180e86039b2783a2ec07a28fb5c55df06f4c52c9de2bcbf6955817183995497cea956ae515d2261898fa051015728e5a8aaac42dad33170d04507a33a85521abdf1cba64ecfb850458dbef0a8aea71575d060c7db3970f85a6e1e4c7abf5ae8cdb0933d71e8c94e04a25619dcee3d2261ad2ee6bf12ffa06d98a0864d87602733ec86a64521f2b18177b200cbbe117577a615d6c770988c0bad946e208e24fa074e5ab3143db5bfce0fd108e4b82d120a92108011a723c12a787e6d788719a10bdba5b2699c327186af4e23c1a946834b6150bda2583e9ca2ad44ce8dbbbc2db04de8ef92e8efc141fbecaa6287c59474e6bc05d99b2964fa090c3a2233ba186515be7ed1f612970cee2d7afb81bdd762170481cd0069127d5b05aa993b4ea988d8fddc186ffb7dc90a6c08f4df435c934063199ffffffffffffffffn;

const base = 2n;

// Key exchange state
let myPrivateKey = BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
let myPublicKey;
let finalKey;

// Message types for key exchange
const MESSAGE_TYPES = {
    PUBLIC_KEY: 'publicKey'
};

/**
 * Modular exponentiation function for Diffie-Hellman
 * @param {BigInt} base - Base number
 * @param {BigInt} exponent - Exponent
 * @param {BigInt} modulus - Modulus
 * @returns {BigInt} Result of (base^exponent) mod modulus
 */
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

/**
 * Initialize key exchange for a new room
 * @param {string} roomId - Room identifier
 */
function initializeKeyExchange(roomId) {
    myPublicKey = modularExponentiation(base, myPrivateKey, primeMod);
    finalKey = null; // Reset shared key for new room
}

/**
 * Create a key exchange message containing our public key
 * @returns {Object} Key exchange message
 */
function createKeyExchangeMessage() {
    return {
        type: MESSAGE_TYPES.PUBLIC_KEY,
        timestamp: Date.now(),
        data: {
            publicKey: myPublicKey.toString()
        }
    };
}

/**
 * Process received public key and compute shared secret
 * @param {string} receivedPublicKey - Received public key as string
 * @returns {Object} Result containing finalKey and display info
 */
function processReceivedPublicKey(receivedPublicKey) {
    const receivedPubKeyBigInt = BigInt(receivedPublicKey);
    finalKey = modularExponentiation(receivedPubKeyBigInt, myPrivateKey, primeMod);
    
    const receivedPubKeyRepresentation = receivedPubKeyBigInt.toString(16).slice(0, 16);
    const finalKeyRepresentation = finalKey.toString(16).slice(0, 16);
    
    return {
        finalKey,
        receivedKeyHash: receivedPubKeyRepresentation,
        finalKeyHash: finalKeyRepresentation
    };
}

/**
 * Check if we have a valid shared key
 * @returns {boolean} True if finalKey exists
 */
function hasSharedKey() {
    return finalKey !== null && finalKey !== undefined;
}

/**
 * Get the current shared key
 * @returns {BigInt|null} The shared secret key
 */
function getSharedKey() {
    return finalKey;
}

/**
 * Reset the key exchange state
 */
function resetKeyExchange() {
    finalKey = null;
}

/**
 * Get our public key
 * @returns {BigInt|null} Our public key
 */
function getPublicKey() {
    return myPublicKey;
}

/**
 * Generate a new private key and corresponding public key
 */
function regenerateKeys() {
    myPrivateKey = BigInt(crypto.getRandomValues(new Uint32Array(1))[0]);
    myPublicKey = modularExponentiation(base, myPrivateKey, primeMod);
    finalKey = null;
}

// Export all functions and constants
export {
    primeMod,
    base,
    MESSAGE_TYPES,
    modularExponentiation,
    initializeKeyExchange,
    createKeyExchangeMessage,
    processReceivedPublicKey,
    hasSharedKey,
    getSharedKey,
    resetKeyExchange,
    getPublicKey,
    regenerateKeys
};