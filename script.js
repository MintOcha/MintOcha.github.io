// Configuration
const ITEMS_URL = 'items.json'; // Change this to '/items' if fetching from an API endpoint
const WEBHOOK_URL = 'https://hkdk.events/ye7iufiyu5zxki';

// State
let items = [];
let cart = JSON.parse(localStorage.getItem('easycatalog_cart')) || [];

// DOM Elements
const catalogView = document.getElementById('catalog-view');
const checkoutView = document.getElementById('checkout-view');
const cartCount = document.getElementById('cart-count');
const cartTotalCount = document.getElementById('cart-total-count');
const cartItemsContainer = document.getElementById('cart-items-container');
const checkoutForm = document.getElementById('checkout-form');
const successOverlay = document.getElementById('success-overlay');

// Initialization
async function init() {
    try {
        const response = await fetch(ITEMS_URL);
        items = await response.json();
        renderCatalog();
        updateCartUI();
    } catch (error) {
        console.error('Error loading items:', error);
        catalogView.innerHTML = '<div class="col-span-full text-center text-red-500">Failed to load items.</div>';
    }

}

// Render Catalog
function renderCatalog() {
    catalogView.innerHTML = items.map(item => `
        <div class="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden flex flex-col">
            <div class="h-48 bg-gray-100 relative">
                <img src="${item.image}" alt="${item.name}" class="w-full h-full object-cover" onerror="this.src='https://placehold.co/400x300?text=No+Image'">
            </div>
            <div class="p-4 flex-grow flex flex-col">
                <h3 class="text-lg font-semibold text-gray-900">${item.name}</h3>
                <p class="text-sm text-gray-500 mt-1 flex-grow">${item.description}</p>
                <div class="mt-4 flex items-center justify-between">
                    <span class="text-lg font-bold text-gray-900">$${item.price}</span>
                    <button onclick="addToCart('${item.id}')" class="px-3 py-1.5 border border-gray-300 rounded-md hover:bg-gray-100 text-sm font-medium transition-colors">Add to Cart</button>
                </div>
            </div>
        </div>
    `).join('');
}

// Cart Functions
function addToCart(itemId) {
    const item = items.find(i => i.id === itemId);
    if (item) {
        cart.push(item);
        saveCart();
        updateCartUI();
        
        // Optional: Show a toast or feedback
        const btn = event.target;
        const originalText = btn.innerText;
        btn.innerText = "Added!";
        setTimeout(() => btn.innerText = originalText, 1000);
    }
}

function removeFromCart(index) {
    cart.splice(index, 1);
    saveCart();
    updateCartUI();
    renderCartItems(); // Re-render the cart list if we are in checkout view
}

function saveCart() {
    localStorage.setItem('easycatalog_cart', JSON.stringify(cart));
}

function updateCartUI() {
    cartCount.innerText = cart.length;
    cartTotalCount.innerText = cart.length;
}

// Navigation
function showCatalog() {
    catalogView.classList.remove('hidden');
    checkoutView.classList.add('hidden');
    window.scrollTo(0, 0);
}

function toggleCart() {
    if (checkoutView.classList.contains('hidden')) {
        showCheckout();
    } else {
        showCatalog();
    }
}

function showCheckout() {
    catalogView.classList.add('hidden');
    checkoutView.classList.remove('hidden');
    renderCartItems();
    window.scrollTo(0, 0);
}

function renderCartItems() {
    if (cart.length === 0) {
        cartItemsContainer.innerHTML = '<p class="text-gray-500 text-center py-8">Your cart is empty.</p>';
        return;
    }

    cartItemsContainer.innerHTML = cart.map((item, index) => `
        <div class="flex items-center gap-4 p-3 bg-gray-50 rounded-md border border-gray-100">
            <img src="${item.image}" alt="${item.name}" class="w-16 h-16 object-cover rounded-md bg-gray-200" onerror="this.src='https://placehold.co/100?text=Item'">
            <div class="flex-grow">
                <h4 class="font-medium text-gray-900">${item.name}</h4>
                <p class="text-sm text-gray-500">$${item.price}</p>
            </div>
            <button onclick="removeFromCart(${index})" class="text-red-500 hover:text-red-700 p-2" title="Remove">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
            </button>
        </div>
    `).join('');
}

// Checkout Logic
async function handleCheckout(event) {
    event.preventDefault();

    if (cart.length === 0) {
        alert("Your cart is empty!");
        return;
    }

    const formData = new FormData(checkoutForm);
    const data = Object.fromEntries(formData.entries());
    
    const itemsListString = cart.map(item => `- ${item.name}`).join('\n');
    
    const payload = {
        embeds: [
            {
                title: "New Order Received!",
                color: 3447003, // Blue-ish color
                fields: [
                    {
                        name: "Customer Name",
                        value: `${data.firstName} ${data.lastName}`,
                        inline: true
                    },
                    {
                        name: "Class",
                        value: data.class,
                        inline: true
                    },
                    {
                        name: "WhatsApp",
                        value: data.whatsapp,
                        inline: true
                    },
                    {
                        name: "When Pickup",
                        value: data.whenPickup,
                        inline: true
                    },
                    {
                        name: "Where Meetup",
                        value: data.whereMeetup,
                        inline: true
                    },
                    {
                        name: "Items",
                        value: itemsListString || "No items (Error?)",
                        inline: false
                    }
                ],
                timestamp: new Date().toISOString()
            }
        ]
    };

    try {
        const submitBtn = checkoutForm.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerText;
        submitBtn.innerText = "Sending...";
        submitBtn.disabled = true;

        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            // Show success animation
            successOverlay.classList.remove('hidden');
            
            // Wait for animation
            setTimeout(() => {
                successOverlay.classList.add('hidden');
                cart = [];
                saveCart();
                updateCartUI();
                showCatalog();
                checkoutForm.reset();
            }, 2500);
        } else {
            throw new Error('Network response was not ok');
        }
    } catch (error) {
        console.error('Checkout error:', error);
        alert('There was a problem placing your order. Please try again.');
    } finally {
        const submitBtn = checkoutForm.querySelector('button[type="submit"]');
        submitBtn.innerText = "Place Order";
        submitBtn.disabled = false;
    }
}

// Expose functions to window for onclick handlers
window.addToCart = addToCart;
window.removeFromCart = removeFromCart;
window.toggleCart = toggleCart;
window.showCatalog = showCatalog;
window.handleCheckout = handleCheckout;

// Start
init();
