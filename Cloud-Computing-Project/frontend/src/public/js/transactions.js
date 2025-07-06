// Constants
const API_URL = (typeof window !== 'undefined' && window.TRANS_API);
const USER_API_URL = (typeof window !== 'undefined' && window.USER_API);
const ITEMS_PER_PAGE = 5;

console.log('Transactions.js Environment Check:');
console.log('Window object exists:', typeof window !== 'undefined');
console.log('USER_API from window:', window.USER_API);
console.log('TRANS_API from window:', window.TRANS_API);
console.log('Final API_URL value:', API_URL);
console.log('Final USER_API_URL value:', USER_API_URL);

// State
let currentPage = 1;
let totalPages = 1;
let allTransactions = [];
let filteredTransactions = [];
let currentTab = 'all';
let cards = [];
let expenseBarChartInstance = null;

// Utility Functions
function getAuthData() {
    const token = localStorage.getItem('token');
    const userId = localStorage.getItem('user_id');
    const tokenExpiry = localStorage.getItem('token_expiry');

    // If no token or user ID, redirect to login
    if (!token || !userId) {
        redirectToLogin();
        return null;
    }

    // If token expiry exists, check if it's expired
    if (tokenExpiry) {
        const currentTime = new Date().getTime();
        const expiryTime = parseInt(tokenExpiry);

        // Only redirect if token is actually expired
        if (currentTime > expiryTime) {
            console.log('Token expired, redirecting to login');
            redirectToLogin();
            return null;
        }
    }

    return { token, userId };
}

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

// Add error handling for unauthorized responses
async function handleApiResponse(response) {
    if (response.status === 401) {
        console.log('Received 401 response, redirecting to login');
        redirectToLogin();
        return null;
    }
    return response;
}

function formatCardNumber(number) {
    // Get first 4 and last 4 digits
    const firstFour = number.substring(0, 4);
    const lastFour = number.substring(number.length - 4);
    // Return formatted number with asterisks in between
    return `${firstFour} **** **** ${lastFour}`;
}


function formatAmount(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount);
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true
    });
}

// Card Rendering (reuse from home.js)
function createCardElement(card, isSecondary = false) {
    const cardDiv = document.createElement('div');
    cardDiv.className = `card${isSecondary ? ' secondary' : ''}`;
    cardDiv.innerHTML = `
        <div class="balance">Balance<br><span style="font-size:2rem;font-weight:700;">${formatAmount(card.balance)}</span></div>
        <div class="card-icons"><i class="fa-solid fa-credit-card"></i></div>
        <div class="card-details">
            CARD HOLDER<br><b>${card.cardholder_name}</b><br>VALID THRU ${card.exp_date.split('-')[1]}/${card.exp_date.split('-')[0].slice(2)}<br>USERNAME: ${card.username}
        </div>
        <div class="card-number">${formatCardNumber(card.cardnumber)}</div>
    `;
    return cardDiv;
}

function createAddCardButton() {
    const buttonDiv = document.createElement('div');
    buttonDiv.className = 'add-card-btn';
    buttonDiv.innerHTML = `
        <i class="fa-solid fa-plus"></i>
        <span>Add Card</span>
    `;
    buttonDiv.onclick = () => document.getElementById('add-card-modal').style.display = 'block';
    return buttonDiv;
}

// Show only 2 cards by default, show all in modal
function renderCardsRow(cards) {
    const container = document.getElementById('cards-container');
    container.innerHTML = '';
    const toShow = cards.slice(0, 3);
    toShow.forEach(card => container.appendChild(createCardElement(card)));
    // Always show Add Card button at the end
    container.appendChild(createAddCardButton());
}

function renderAllCardsModal(cards) {
    const modalContainer = document.getElementById('all-cards-container');
    modalContainer.innerHTML = '';
    cards.forEach(card => modalContainer.appendChild(createCardElement(card)));
    modalContainer.appendChild(createAddCardButton());
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

// Update renderCards to use new rendering
async function renderCards() {
    const auth = getAuthData();
    if (!auth) return;
    const container = document.getElementById('cards-container');
    container.innerHTML = '';
    try {
        const response = await fetch(`${USER_API_URL}/cards`, {
            headers: { 'Authorization': `Bearer ${auth.token}` }
        });
        if (!response.ok) throw new Error('Failed to fetch cards');
        const data = await response.json();
        cards = data.cards;
        if (cards.length === 0) {
            renderCardsRow([]);
        } else {
            // Sort cards to put selected card first
            const selectedUsername = localStorage.getItem('username');
            cards.sort((a, b) => {
                if (a.username === selectedUsername) return -1;
                if (b.username === selectedUsername) return 1;
                return 0;
            });
            renderCardsRow(cards);
            setupCardsModal(cards);
        }
    } catch (e) {
        container.innerHTML = '<div class="error-message">Failed to load cards</div>';
    }
}

// Expense Bar Chart
function renderExpenseChart() {
    const ctx = document.getElementById('expenseBarChart').getContext('2d');
    // Destroy previous chart instance if it exists
    if (expenseBarChartInstance) {
        expenseBarChartInstance.destroy();
    }
    // Get last 6 months labels
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(d.toLocaleString('en-US', { month: 'short' }));
    }
    // Aggregate expenses by month
    const myCardUsernames = cards.map(c => c.username);
    const values = Array(6).fill(0);
    allTransactions.forEach(tx => {
        const isSender = myCardUsernames.includes(tx.sender_username);
        if (isSender) {
            const txDate = new Date(tx.timestamp);
            const monthDiff = (now.getFullYear() - txDate.getFullYear()) * 12 + (now.getMonth() - txDate.getMonth());
            if (monthDiff >= 0 && monthDiff < 6) {
                values[5 - monthDiff] += Math.abs(tx.amount);
            }
        }
    });
    expenseBarChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: months,
            datasets: [{
                label: 'Expense',
                data: values,
                backgroundColor: months.map((m, i) => i === 5 ? '#1a73e8' : '#e5e9f2'),
                borderRadius: 8
            }]
        },
        options: {
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false } },
                y: { grid: { color: '#eee' }, beginAtZero: true }
            }
        }
    });
}

// Tabs
function setupTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            currentTab = this.dataset.tab;
            filterTransactions();
        });
    });
}

// Filter Transactions by Tab
function filterTransactions() {
    const myCardUsernames = cards.map(c => c.username);
    if (currentTab === 'all') {
        filteredTransactions = allTransactions;
    } else if (currentTab === 'income') {
        filteredTransactions = allTransactions.filter(tx => !myCardUsernames.includes(tx.sender_username) && myCardUsernames.includes(tx.receiver_username));
    } else if (currentTab === 'expense') {
        filteredTransactions = allTransactions.filter(tx => myCardUsernames.includes(tx.sender_username) && !myCardUsernames.includes(tx.receiver_username));
    }
    currentPage = 1;
    renderTransactionsTable();
}

// Render Transactions Table
function renderTransactionsTable() {
    const tbody = document.getElementById('transactions-table-body');
    tbody.innerHTML = '';
    if (!filteredTransactions.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#888;">No transactions found</td></tr>';
        updatePagination();
        return;
    }
    totalPages = Math.ceil(filteredTransactions.length / ITEMS_PER_PAGE);
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const pageTxs = filteredTransactions.slice(start, end);

    // Get all your card usernames for easy lookup
    const myCardUsernames = cards.map(c => c.username);

    pageTxs.forEach(tx => {
        const isSender = myCardUsernames.includes(tx.sender_username);
        const isReceiver = myCardUsernames.includes(tx.receiver_username);
        let type = '';
        let amount = tx.amount;
        if (isSender && !isReceiver) {
            type = 'Expense';
            amount = -Math.abs(tx.amount);
        } else if (!isSender && isReceiver) {
            type = 'Income';
            amount = Math.abs(tx.amount);
        } else if (isSender && isReceiver) {
            type = 'Transfer (Own Card)';
            amount = 0;
        } else {
            type = 'Other';
        }

        // Find card numbers for sender and receiver
        const senderCard = cards.find(c => c.username === tx.sender_username);
        const receiverCard = cards.find(c => c.username === tx.receiver_username);
        // Mask card numbers: show first 4 and last 4 digits
        const maskCard = num => num ? `${num.substring(0, 4)} **** **** ${num.substring(num.length - 4)}` : '';
        const senderCardDisplay = senderCard ? `${maskCard(senderCard.cardnumber)} (You)` : tx.sender_username;
        const receiverCardDisplay = receiverCard ? `${maskCard(receiverCard.cardnumber)} (You)` : tx.receiver_username;

        tbody.innerHTML += `
            <tr>
                <td>${tx.description || (isSender ? `Sent to ${tx.receiver_username}` : `Received from ${tx.sender_username}`)}</td>
                <td>#${tx.trans_id}</td>
                <td>${type}</td>
                <td>${senderCardDisplay}</td>
                <td>${receiverCardDisplay}</td>
                <td>${formatDate(tx.timestamp)}</td>
                <td class="amount ${amount < 0 ? 'negative' : 'positive'}">${amount < 0 ? '-' : '+'}${formatAmount(Math.abs(amount))}</td>
                <td><button class="download-btn" onclick="downloadReceipt('${tx.trans_id}')">Download</button></td>
            </tr>
        `;
    });
    updatePagination();
}

// Download Receipt (dummy)
window.downloadReceipt = function (transId) {
    const tx = allTransactions.find(t => t.trans_id === transId);
    if (!tx) {
        alert('Transaction not found.');
        return;
    }
    const senderCard = cards.find(c => c.username === tx.sender_username);
    const receiverCard = cards.find(c => c.username === tx.receiver_username);
    const maskCard = num => num ? `${num.substring(0, 4)} **** **** ${num.substring(num.length - 4)}` : '';
    const senderCardDisplay = senderCard ? maskCard(senderCard.cardnumber) : tx.sender_username;
    const receiverCardDisplay = receiverCard ? maskCard(receiverCard.cardnumber) : tx.receiver_username;
    const type = senderCard ? (tx.sender_username === senderCard.username ? 'Expense' : 'Income') : 'Income';

    // Use jsPDF to create a modern PDF receipt
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Header
    doc.setFontSize(22);
    doc.setTextColor('#1a73e8');
    doc.text('Transaction Receipt', 105, 20, { align: 'center' });
    doc.setDrawColor('#1a73e8');
    doc.line(20, 25, 190, 25);

    // Details
    doc.setFontSize(12);
    doc.setTextColor('#222');
    let y = 40;
    const lineGap = 10;
    doc.text(`Transaction ID:`, 25, y);
    doc.text(`${tx.trans_id}`, 70, y);
    y += lineGap;
    doc.text(`Date:`, 25, y);
    doc.text(`${formatDate(tx.timestamp)}`, 70, y);
    y += lineGap;
    doc.text(`Type:`, 25, y);
    doc.text(`${type}`, 70, y);
    y += lineGap;
    doc.text(`From:`, 25, y);
    doc.text(`${senderCardDisplay}`, 70, y);
    y += lineGap;
    doc.text(`To:`, 25, y);
    doc.text(`${receiverCardDisplay}`, 70, y);
    y += lineGap;
    doc.text(`Amount:`, 25, y);
    doc.setTextColor(type === 'Expense' ? '#e74c3c' : '#00b894');
    doc.text(`${formatAmount(Math.abs(tx.amount))}`, 70, y);
    doc.setTextColor('#222');
    y += lineGap;
    doc.text(`Description:`, 25, y);
    doc.text(`${tx.description || ''}`, 70, y, { maxWidth: 110 });

    // Footer
    doc.setFontSize(10);
    doc.setTextColor('#888');
    doc.text('Generated by BankDash', 105, 285, { align: 'center' });

    doc.save(`${tx.trans_id}_receipt.pdf`);
};

// Pagination
function updatePagination() {
    document.getElementById('page-info').textContent = `Page ${currentPage} of ${totalPages || 1}`;
    document.getElementById('prev-page').disabled = currentPage === 1;
    document.getElementById('next-page').disabled = currentPage === totalPages || totalPages === 0;
}
document.getElementById('prev-page').onclick = function () {
    if (currentPage > 1) {
        currentPage--;
        renderTransactionsTable();
    }
};
document.getElementById('next-page').onclick = function () {
    if (currentPage < totalPages) {
        currentPage++;
        renderTransactionsTable();
    }
};


// Fetch Transactions
async function fetchTransactions() {
    const auth = getAuthData();
    if (!auth) return;

    try {
        console.log('Fetching cards for user:', auth.userId);
        // First get all cards for the user
        const cardsResponse = await fetch(`${USER_API_URL}/cards`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${auth.token}`,
                'Content-Type': 'application/json'
            }
        });

        const handledCardsResponse = await handleApiResponse(cardsResponse);
        if (!handledCardsResponse) return;

        if (!handledCardsResponse.ok) {
            throw new Error(`Failed to fetch cards: ${handledCardsResponse.statusText}`);
        }

        const cardsData = await handledCardsResponse.json();
        console.log('Received cards:', cardsData);

        if (!cardsData.cards || cardsData.cards.length === 0) {
            console.warn('No cards found for user');
            allTransactions = [];
            filterTransactions();
            return;
        }

        // Get transactions for each card
        allTransactions = [];
        for (const card of cardsData.cards) {
            console.log('Fetching transactions for card:', card.username);
            const response = await fetch(`${API_URL}/transactions/${card.username}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${auth.token}`,
                    'Content-Type': 'application/json'
                }
            });

            const handledResponse = await handleApiResponse(response);
            if (!handledResponse) return;

            if (!handledResponse.ok) {
                if (handledResponse.status === 403) {
                    console.warn(`Access forbidden for card ${card.username} - phone number mismatch`);
                    continue;
                }
                throw new Error(`Failed to fetch transactions for card ${card.username}: ${handledResponse.statusText}`);
            }

            const data = await handledResponse.json();
            console.log(`Transactions for card ${card.username}:`, data);

            if (data.transactions) {
                // Add card information to each transaction
                const transactionsWithCard = data.transactions.map(tx => ({
                    ...tx,
                    card_number: card.cardnumber,
                    card_holder: card.cardholder_name
                }));
                allTransactions = allTransactions.concat(transactionsWithCard);
            }
        }

        // Sort transactions by timestamp
        allTransactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        console.log('All transactions:', allTransactions);

        filterTransactions();

    } catch (e) {
        console.error('Error fetching transactions:', e);
        document.getElementById('transactions-table-body').innerHTML =
            `<tr><td colspan="7" style="text-align:center;color:#e74c3c;">
                Failed to load transactions: ${e.message}
            </td></tr>`;
    }
}

// Modal Functions (Add Card)
function setupModal() {
    const modal = document.getElementById('add-card-modal');
    const closeBtn = modal.querySelector('.close');
    const form = document.getElementById('add-card-form');
    closeBtn.onclick = () => modal.style.display = 'none';
    window.onclick = (event) => {
        if (event.target === modal) modal.style.display = 'none';
    };
    form.onsubmit = async (e) => {
        e.preventDefault();
        const auth = getAuthData();
        if (!auth) {
            window.location.href = '/auth';
            return;
        }
        const formData = {
            username: document.getElementById('card-username').value,
            cardnumber: document.getElementById('card-number').value,
            cvv: document.getElementById('card-cvv').value,
            exp_date: document.getElementById('card-exp').value,
            cardholder_name: document.getElementById('card-name').value,
            pin: document.getElementById('card-pin').value,
            balance: parseFloat(document.getElementById('card-balance').value),
            phone: auth.userId
        };
        try {
            const response = await fetch(`${USER_API_URL}/cards`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${auth.token}`
                },
                body: JSON.stringify(formData)
            });
            if (!response.ok) throw new Error('Failed to create card');
            modal.style.display = 'none';
            form.reset();
            await renderCards();
        } catch (error) {
            alert(error.message);
        }
    };
}

// On Load
window.addEventListener('DOMContentLoaded', async () => {
    const auth = getAuthData();
    if (!auth) {
        window.location.href = '/auth';
        return;
    }
    setupModal();
    await renderCards();
    setupTabs();
    await fetchTransactions();
    renderExpenseChart();
    await displayUserName();

    // Logout button logic
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('token');
            localStorage.removeItem('user_id');
            localStorage.removeItem('token_expiry');
            localStorage.removeItem('username');
            window.location.href = '/auth';
        });
    }


    setInterval(async () => {
        //await renderCards();
        await fetchTransactions();
        //renderExpenseChart();
        await displayUserName();
    }, 3000);
});


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