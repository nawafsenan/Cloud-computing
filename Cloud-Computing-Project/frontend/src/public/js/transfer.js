const TRANS_API_URL = (typeof window !== 'undefined' && window.TRANS_API);
const USER_API_URL = (typeof window !== 'undefined' && window.USER_API);

// Add error handling for unauthorized responses
async function handleApiResponse(response) {
    if (response.status === 401) {
        console.log('Received 401 response, redirecting to login');
        redirectToLogin();
        return null;
    }
    return response;
}

// Quick Transfer Logic for Transfer Page
function getAuthData() {
    const token = localStorage.getItem('token');
    const userId = localStorage.getItem('user_id');
    const tokenExpiry = localStorage.getItem('token_expiry');
    if (!token || !userId) {
        window.location.href = '/auth';
        return null;
    }
    if (tokenExpiry) {
        const currentTime = new Date().getTime();
        const expiryTime = parseInt(tokenExpiry);
        if (currentTime > expiryTime) {
            localStorage.removeItem('token');
            localStorage.removeItem('user_id');
            localStorage.removeItem('token_expiry');
            localStorage.removeItem('username');
            window.location.href = '/auth';
            return null;
        }
    }
    return { token, userId };
}

async function handleQuickTransfer() {
    const auth = getAuthData();
    if (!auth) return;

    const selectedCard = localStorage.getItem('username');
    const receiverUsername = document.getElementById('receiver-input').value;
    const amount = parseFloat(document.getElementById('amount-input').value);
    const pin = document.getElementById('pin-input').value;
    const statusDiv = document.querySelector('.transfer-status');

    if (!selectedCard) {
        statusDiv.textContent = 'Please select a card to send money from.';
        statusDiv.style.color = 'red';
        return;
    }

    if (!receiverUsername || !amount || !pin) {
        statusDiv.textContent = 'Please fill in all fields';
        statusDiv.style.color = 'red';
        return;
    }

    try {
        const response = await fetch(`${TRANS_API_URL}/transactions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${auth.token}`
            },
            credentials: 'include',
            body: JSON.stringify({
                sender_username: selectedCard,
                receiver_username: receiverUsername,
                amount: amount,
                pin: pin
            })
        });

        const handledResponse = await handleApiResponse(response);
        if (!handledResponse) return;

        const result = await handledResponse.json();
        if (handledResponse.ok) {
            statusDiv.textContent = 'Transfer successful!';
            statusDiv.style.color = 'green';
            document.getElementById('receiver-input').value = '';
            document.getElementById('amount-input').value = '';
            document.getElementById('pin-input').value = '';
        } else {
            statusDiv.textContent = result.message || 'Transfer failed.';
            statusDiv.style.color = 'red';
        }
    } catch (e) {
        console.error('Transfer error:', e);
        statusDiv.textContent = 'Transfer failed. Please try again.';
        statusDiv.style.color = 'red';
    }
}

async function displayUserName() {
    const token = localStorage.getItem('token');
    const userId = localStorage.getItem('user_id');
    if (!token || !userId) return;
    try {
        const response = await fetch(`${USER_API_URL}/users/${userId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Failed to fetch user data');
        const userData = await response.json();
        const userProfile = document.querySelector('.profile');
        if (userProfile) {
            userProfile.innerHTML = `
                <i class='fa-solid fa-user'></i>
                <div>${userData.fname} ${userData.lname}</div>
            `;
        }
    } catch (error) {
        console.error('Error fetching user data:', error);
    }
}

function formatCardNumber(number) {
    const firstFour = number.substring(0, 4);
    const lastFour = number.substring(number.length - 4);
    return `${firstFour} **** **** ${lastFour}`;
}

function formatBalance(balance) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(balance);
}

function createCardElement(card, isSecondary = false) {
    const cardDiv = document.createElement('div');
    const isSelected = card.username === localStorage.getItem('username');
    cardDiv.className = `card ${isSelected ? '' : 'secondary'}`;
    cardDiv.innerHTML = `
        <div class="balance">Balance<br><span style="font-size:2rem;font-weight:700;">${formatBalance(card.balance)}</span></div>
        <div class="card-icons"><i class="fa-solid fa-credit-card"></i></div>
        <div class="card-details">
            CARD HOLDER<br><b>${card.cardholder_name}</b><br>VALID THRU ${card.exp_date.split('-')[1]}/${card.exp_date.split('-')[0].slice(2)}<br>USERNAME: ${card.username}
        </div>
        <div class="card-number">${formatCardNumber(card.cardnumber)}</div>
        <div class="toggle ${isSelected ? 'active' : ''}"
             data-username="${card.username}"
             onclick="toggleCard('${card.username}')"
             style="pointer-events: ${isSelected ? 'none' : 'auto'}">
            <div class="circle"></div>
        </div>
    `;
    return cardDiv;
}

// Show only 4 cards by default, show all in modal
function renderCardsRow(cards) {
    const container = document.getElementById('cards-container');
    container.innerHTML = '';
    const toShow = cards.slice(0, 4);
    toShow.forEach(card => container.appendChild(createCardElement(card)));
}

function renderAllCardsModal(cards) {
    const modalContainer = document.getElementById('all-cards-container');
    modalContainer.innerHTML = '';
    cards.forEach(card => modalContainer.appendChild(createCardElement(card)));
}

// Modal open/close logic
function setupCardsModal(cards) {
    const seeAllBtn = document.getElementById('see-all-cards-btn');
    const modal = document.getElementById('all-cards-modal');
    const closeBtn = document.getElementById('close-all-cards-modal');
    seeAllBtn.onclick = () => {
        renderAllCardsModal(cards);
        modal.style.display = 'block';
    };
    closeBtn.onclick = () => {
        modal.style.display = 'none';
    };
    window.onclick = (event) => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    };
}

// Update loadCards to use new rendering
async function loadCards() {
    const auth = getAuthData();
    if (!auth) return;
    try {
        console.log('[DEBUG] Fetching cards from:', `${USER_API_URL}/cards`);
        const response = await fetch(`${USER_API_URL}/cards`, {
            headers: {
                'Authorization': `Bearer ${auth.token}`
            }
        });
        console.log('[DEBUG] Response status:', response.status);
        const handledResponse = await handleApiResponse(response);
        if (!handledResponse) {
            console.error('[DEBUG] handleApiResponse returned null (likely 401)');
            return;
        }
        if (!handledResponse.ok) {
            const errorText = await handledResponse.text();
            console.error('[DEBUG] Cards fetch failed:', errorText);
            throw new Error('Failed to fetch cards');
        }
        const data = await handledResponse.json();
        let cards = data.cards;
        if (cards.length === 0) {
            renderCardsRow([]);
        } else {
            // Card selection logic as before
            if (cards.length === 1) {
                localStorage.setItem('username', cards[0].username);
            } else if (!localStorage.getItem('username') && cards.length > 0) {
                cards.sort((a, b) => b.balance - a.balance);
                localStorage.setItem('username', cards[0].username);
            }
            const selectedUsername = localStorage.getItem('username');
            cards.sort((a, b) => {
                if (a.username === selectedUsername) return -1;
                if (b.username === selectedUsername) return 1;
                return 0;
            });
            renderCardsRow(cards);
            setupCardsModal(cards);
        }
    } catch (error) {
        console.error('[DEBUG] Exception in loadCards:', error);
        document.getElementById('cards-container').innerHTML = '<div class="error-message">Failed to load cards</div>';
    }
}


window.toggleCard = function (username) {
    const currentSelected = localStorage.getItem('username');
    if (currentSelected === username) return;
    const container = document.getElementById('cards-container');
    // Animate fade out
    container.style.transition = 'opacity 0.3s';
    container.style.opacity = '0';
    setTimeout(() => {
        localStorage.setItem('username', username);
        loadCards();
        // Animate fade in
        setTimeout(() => {
            container.style.opacity = '1';
        }, 50);
    }, 300);
};

function createAddCardButton() {
    const buttonDiv = document.createElement('div');
    buttonDiv.className = 'add-card-btn';
    buttonDiv.innerHTML = `
        <i class="fa-solid fa-plus"></i>
        <span>Add New Card</span>
    `;
    buttonDiv.onclick = () => document.getElementById('add-card-modal').style.display = 'block';
    return buttonDiv;
}

document.addEventListener('DOMContentLoaded', () => {
    // Immediately check authentication and redirect if token is expired
    const auth = getAuthData();
    if (!auth) {
        window.location.href = '/auth';
        return;
    }
    displayUserName();
    loadCards();
    const sendBtn = document.querySelector('.send-btn');
    if (sendBtn) {
        sendBtn.addEventListener('click', handleQuickTransfer);
    }
}); 

function redirectToLogin() {
    // Only redirect if we're not already on the auth page
    if (!window.location.pathname.includes('/auth')) {
        // Clear all auth-related data
        localStorage.removeItem('token');
        localStorage.removeItem('user_id');
        localStorage.removeItem('token_expiry');
        localStorage.removeItem('username');
        
        // Redirect to login page
        window.location.href = '/auth';
    }
}