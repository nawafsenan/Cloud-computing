// At the top of the file, add:
let weeklyActivityChart = null;
let balanceHistoryChart = null;

// Constants
const API_URL = (typeof window !== 'undefined' && window.USER_API);
const TRANSACTION_API_URL = (typeof window !== 'undefined' && window.TRANS_API);
const REPORT_API_URL = (typeof window !== 'undefined' && window.REPORT_API);

console.log('Home.js Environment Check:');
console.log('Window object exists:', typeof window !== 'undefined');
console.log('USER_API from window:', window.USER_API);
console.log('TRANS_API from window:', window.TRANS_API);
console.log('REPORT_API from window:', window.REPORT_API);
console.log('Final API_URL value:', API_URL);
console.log('Final TRANSACTION_API_URL value:', TRANSACTION_API_URL);
console.log('Final REPORT_API_URL value:', REPORT_API_URL);

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

function formatBalance(balance) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(balance);
}

// Format date for display
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
}

// Format amount for display
function formatAmount(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount);
}

// Card Template
function createCardElement(card, isSecondary = false) {
    const cardDiv = document.createElement('div');
    const isSelected = card.username === localStorage.getItem('username');

    // Set card class based on selection state
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

// Modal Functions
function setupModal() {
    const modal = document.getElementById('add-card-modal');
    const closeBtn = modal.querySelector('.close');
    const form = document.getElementById('add-card-form');

    closeBtn.onclick = () => modal.style.display = 'none';
    window.onclick = (event) => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
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
            const response = await fetch(`${API_URL}/cards`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${auth.token}`
                },
                body: JSON.stringify(formData)
            });

            if (!response.ok) {
                throw new Error('Failed to create card');
            }

            modal.style.display = 'none';
            form.reset();
            loadCards(); // Reload cards after adding new one
        } catch (error) {
            alert(error.message);
        }
    };
}

// Show only 2 cards by default, show all in modal
function renderCardsRow(cards) {
    const container = document.getElementById('cards-container');
    container.innerHTML = '';
    const toShow = cards.slice(0, 2);
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

// Update loadCards to use new rendering
async function loadCards() {
    const auth = getAuthData();
    if (!auth) return;
    try {
        const response = await fetch(`${API_URL}/cards`, {
            headers: {
                'Authorization': `Bearer ${auth.token}`
            }
        });
        const handledResponse = await handleApiResponse(response);
        if (!handledResponse) return;
        if (!handledResponse.ok) {
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
        document.getElementById('cards-container').innerHTML = '<div class="error-message">Failed to load cards</div>';
    }
}

// Initialize Charts
async function initializeCharts() {
    const auth = getAuthData();
    if (!auth) return;

    try {
        // Fetch cards data
        const cardsResponse = await fetch(`${API_URL}/cards`, {
            headers: {
                'Authorization': `Bearer ${auth.token}`
            }
        });

        if (!cardsResponse.ok) {
            throw new Error('Failed to fetch cards data');
        }

        const cardsData = await cardsResponse.json();
        const cards = cardsData.cards;

        // Calculate total balance
        const totalBalance = cards.reduce((sum, card) => sum + card.balance, 0);

        // Weekly Activity Chart
        const weeklyData = {
            deposit: [0, 0, 0, 0, 0, 0, 0], // Initialize with zeros for each day
            withdraw: [0, 0, 0, 0, 0, 0, 0]
        };

        // Get current week's transactions
        const today = new Date();
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay()); // Start of week (Sunday)

        // Fetch transactions for each card
        for (const card of cards) {
            const baseUrl = window.REPORT_API.endsWith('/') ? window.REPORT_API.slice(0, -1) : window.REPORT_API;
            const response = await fetch(`${baseUrl}/report/${card.username}`, {
                headers: {
                    'Authorization': `Bearer ${auth.token}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                const transactions = data.summary.recent_activity || [];

                // Filter and process transactions for this week
                transactions.forEach(transaction => {
                    const transDate = new Date(transaction.timestamp);
                    if (transDate >= weekStart && transDate <= today) {
                        const dayIndex = transDate.getDay(); // 0 = Sunday, 6 = Saturday
                        if (transaction.type === 'received') {
                            weeklyData.deposit[dayIndex] += transaction.amount;
                        } else {
                            weeklyData.withdraw[dayIndex] += transaction.amount;
                        }
                    }
                });
            }
        }

        // Initialize Weekly Activity Chart
        if (weeklyActivityChart) {
            weeklyActivityChart.destroy();
        }
        weeklyActivityChart = new Chart(document.getElementById('weeklyActivity'), {
            type: 'bar',
            data: {
                labels: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
                datasets: [
                    {
                        label: 'Deposit',
                        data: weeklyData.deposit,
                        backgroundColor: '#1a73e8',
                        borderRadius: 8,
                        barThickness: 18
                    },
                    {
                        label: 'Withdraw',
                        data: weeklyData.withdraw,
                        backgroundColor: '#00b894',
                        borderRadius: 8,
                        barThickness: 18
                    }
                ]
            },
            options: {
                plugins: {
                    legend: { display: true, position: 'top' },
                    title: {
                        display: true,
                        text: 'Weekly Activity'
                    }
                },
                scales: {
                    x: { grid: { display: false } },
                    y: {
                        grid: { color: '#eee' },
                        beginAtZero: true,
                        ticks: {
                            callback: value => formatBalance(value)
                        }
                    }
                }
            }
        });

        // Balance History Chart
        const balanceHistory = [];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const currentMonth = today.getMonth();
        const currentYear = today.getFullYear();
        const labels = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(currentYear, currentMonth - i, 1);
            labels.push(months[d.getMonth()] + ' ' + d.getFullYear().toString().slice(-2));
        }

        // For each card, fetch all transactions and aggregate by month
        // We'll sum all deposits and subtract all withdrawals up to the end of each month
        let allCardTransactions = [];
        for (const card of cards) {
            const baseUrl = window.REPORT_API.endsWith('/') ? window.REPORT_API.slice(0, -1) : window.REPORT_API;
            const response = await fetch(`${baseUrl}/report/${card.username}`, {
                headers: {
                    'Authorization': `Bearer ${auth.token}`
                }
            });
            if (response.ok) {
                const data = await response.json();
                // Assume the reporting service returns all transactions in data.summary.all_activity or similar
                // If not, fallback to recent_activity (less accurate)
                let transactions = data.summary.all_activity || data.summary.recent_activity || [];
                // Add card info to each transaction
                transactions = transactions.map(tx => ({ ...tx, card }));
                allCardTransactions = allCardTransactions.concat(transactions);
            }
        }

        // For each of the last 6 months, calculate the balance
        for (let i = 5; i >= 0; i--) {
            const monthDate = new Date(currentYear, currentMonth - i + 1, 0); // last day of month
            let balance = 0;
            allCardTransactions.forEach(tx => {
                const txDate = new Date(tx.timestamp);
                if (txDate <= monthDate) {
                    if (tx.type === 'received') {
                        balance += tx.amount;
                    } else if (tx.type === 'sent') {
                        balance -= tx.amount;
                    }
                }
            });
            balanceHistory.push(balance);
        }

        // Initialize Balance History Chart
        if (balanceHistoryChart) {
            balanceHistoryChart.destroy();
        }
        balanceHistoryChart = new Chart(document.getElementById('balanceHistory'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Balance',
                    data: balanceHistory,
                    borderColor: '#1a73e8',
                    backgroundColor: 'rgba(26,115,232,0.08)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 0
                }]
            },
            options: {
                plugins: {
                    legend: { display: false },
                    title: {
                        display: true,
                        text: 'Balance History'
                    }
                },
                scales: {
                    x: { grid: { display: false } },
                    y: {
                        grid: { color: '#eee' },
                        beginAtZero: true,
                        ticks: {
                            callback: value => formatBalance(value)
                        }
                    }
                }
            }
        });

    } catch (error) {
        console.error('Error initializing charts:', error);
        // Show error message in chart containers
        document.getElementById('weeklyActivity').parentElement.innerHTML = '<div class="error-message">Failed to load weekly activity data</div>';
        document.getElementById('balanceHistory').parentElement.innerHTML = '<div class="error-message">Failed to load balance history</div>';
    }
}

// Add toggle function
window.toggleCard = function (username) {
    const currentSelected = localStorage.getItem('username');
    const toggles = document.querySelectorAll('.toggle');

    // If clicking the currently selected card, do nothing
    if (currentSelected === username) {
        return;
    }

    // Remove all active classes first
    toggles.forEach(toggle => {
        toggle.classList.remove('active');
        toggle.style.pointerEvents = 'auto'; // Enable all switches
    });

    // Select new card
    localStorage.setItem('username', username);

    // Add active class to the clicked toggle and disable it
    const clickedToggle = document.querySelector(`.toggle[data-username="${username}"]`);
    if (clickedToggle) {
        clickedToggle.classList.add('active');
        clickedToggle.style.pointerEvents = 'none'; // Disable the selected switch
    }

    // Instantly refresh the dashboard
    loadDashboard();
};

// Quick Transfer Logic
async function handleQuickTransfer() {
    const auth = getAuthData();
    if (!auth) {
        window.location.href = '/auth';
        return;
    }
    const receiverInput = document.querySelector('.receiver-input');
    const amountInput = document.querySelector('.amount-input');
    const pinInput = document.querySelector('.pin-input');
    const statusDiv = document.querySelector('.transfer-status');
    statusDiv.textContent = '';

    const receiverUsername = receiverInput.value.trim();
    const amount = parseFloat(amountInput.value);
    const pin = pinInput.value.trim();
    const selectedCard = localStorage.getItem('username');

    if (!selectedCard) {
        statusDiv.textContent = 'Please select a card to send money from.';
        statusDiv.style.color = 'red';
        return;
    }

    if (!receiverUsername || !amount || !pin) {
        statusDiv.textContent = 'Please fill all fields.';
        statusDiv.style.color = 'red';
        return;
    }

    // Call backend transaction API
    try {
        const response = await fetch(`${TRANSACTION_API_URL}/transactions`, {
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
        const result = await response.json();
        if (response.ok) {
            statusDiv.textContent = 'Transfer successful!';
            statusDiv.style.color = 'green';
            receiverInput.value = '';
            amountInput.value = '';
            pinInput.value = '';
            loadCards(); // Refresh cards
        } else {
            statusDiv.textContent = result.message || 'Transfer failed.';
            statusDiv.style.color = 'red';
        }
    } catch (e) {
        statusDiv.textContent = 'Transfer failed. Please try again.';
        statusDiv.style.color = 'red';
    }
}

// Fetch and display recent transactions
async function fetchRecentTransactions(username) {
    try {
        const auth = getAuthData();
        if (!auth) {
            console.error('No auth data found');
            return;
        }

        const baseUrl = window.REPORT_API.endsWith('/') ? window.REPORT_API.slice(0, -1) : window.REPORT_API;
        const response = await fetch(`${baseUrl}/report/${username}`, {
            headers: {
                'Authorization': `Bearer ${auth.token}`
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.status}`);
        }

        const data = await response.json();
        const transactionsList = document.getElementById('recent-transactions-list');
        transactionsList.innerHTML = ''; // Clear existing transactions

        if (!data.summary.recent_activity || data.summary.recent_activity.length === 0) {
            transactionsList.innerHTML = '<li class="no-transactions">No recent transactions</li>';
            return;
        }

        // Add each transaction to the list
        data.summary.recent_activity.forEach(tx => {
            const li = document.createElement('li');
            li.className = `transaction-item ${tx.type}`;

            const icon = tx.type === 'sent' ? 'fa-arrow-up' : 'fa-arrow-down';
            const amountClass = tx.type === 'sent' ? 'sent' : 'received';
            const amountPrefix = tx.type === 'sent' ? '-' : '+';

            li.innerHTML = `
                <span class="icon ${tx.type}"><i class="fa-solid ${icon}"></i></span>
                <div class="transaction-info">
                    <div class="transaction-title">${tx.type === 'sent' ? 'Sent' : 'Received'}</div>
                    <div class="transaction-date">${new Date(tx.timestamp).toLocaleString()}</div>
                </div>
                <span class="amount ${amountClass}">${amountPrefix}$${parseFloat(tx.amount).toFixed(2)}</span>
                <span class="status ${tx.status === 'completed' ? 'completed' : 'pending'}">${tx.status}</span>
            `;

            transactionsList.appendChild(li);
        });

    } catch (err) {
        console.error('Error fetching recent transactions:', err);
        const transactionsList = document.getElementById('recent-transactions-list');
        transactionsList.innerHTML = `<li class="error">Failed to load recent transactions: ${err.message}</li>`;
    }
}

// Fetch and display total sent/received
async function fetchAndDisplayTotals(username) {
    try {
        const auth = getAuthData();
        if (!auth) return;
        const baseUrl = window.REPORT_API.endsWith('/') ? window.REPORT_API.slice(0, -1) : window.REPORT_API;
        const response = await fetch(`${baseUrl}/report/${username}`, {
            headers: {
                'Authorization': `Bearer ${auth.token}`
            }
        });
        if (!response.ok) throw new Error('Failed to fetch totals');
        const data = await response.json();
        const summary = data.summary || {};
        document.getElementById('total-sent').textContent = formatAmount(summary.total_sent || 0);
        document.getElementById('total-received').textContent = formatAmount(summary.total_received || 0);
    } catch (err) {
        document.getElementById('total-sent').textContent = 'N/A';
        document.getElementById('total-received').textContent = 'N/A';
    }
}

// Add this function to fetch and display the user's name
async function displayUserName() {
    const auth = getAuthData();
    if (!auth) return;

    try {
        const response = await fetch(`${API_URL}/users/${auth.userId}`, {
            headers: {
                'Authorization': `Bearer ${auth.token}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch user data');
        }

        const userData = await response.json();
        const userProfile = document.querySelector('.profile');
        userProfile.innerHTML = `
            <i class="fa-solid fa-user"></i>
            <div>${userData.fname} ${userData.lname}</div>
        `;
    } catch (error) {
        console.error('Error fetching user data:', error);
    }
}

// Fetch and display transaction statistics
async function fetchAndDisplayTransactionStats(username) {
    const auth = getAuthData();
    if (!auth) return;

    try {
        const response = await fetch(`${REPORT_API_URL}/report/${username}`, {
            headers: {
                'Authorization': `Bearer ${auth.token}`
            }
        });

        const handledResponse = await handleApiResponse(response);
        if (!handledResponse) return;

        if (!handledResponse.ok) {
            throw new Error('Failed to fetch transaction statistics');
        }

        const data = await handledResponse.json();
        const summary = data.summary;

        // Update the statistics in the UI
        document.getElementById('largest-transaction').textContent = formatAmount(summary.largest_transaction);
        document.getElementById('transaction-count').textContent = summary.transaction_count;
        document.getElementById('average-transaction').textContent = formatAmount(summary.average_transaction_amount);
        document.getElementById('successful-transactions').textContent = summary.successful_transactions;
        document.getElementById('failed-transactions').textContent = summary.failed_transactions;
    } catch (error) {
        console.error('Error fetching transaction statistics:', error);
    }
}

// Fetch and display usage data
async function fetchAndDisplayUsage(username) {
    const auth = getAuthData();
    if (!auth) return;
    try {
        const response = await fetch(`${REPORT_API_URL}/report/${username}/usage`, {
            headers: {
                'Authorization': `Bearer ${auth.token}`
            }
        });
        const handledResponse = await handleApiResponse(response);
        if (!handledResponse) return;
        if (!handledResponse.ok) {
            throw new Error('Failed to fetch usage data');
        }
        const data = await handledResponse.json();
        const usage = data.usage_analysis;
        let html = `
            <div><b>Transaction Frequency:</b> Daily: ${usage.transaction_frequency.daily.toFixed(2)}, Weekly: ${usage.transaction_frequency.weekly.toFixed(2)}, Monthly: ${usage.transaction_frequency.monthly.toFixed(2)}</div>
            <div><b>Transaction Patterns:</b> Morning: ${usage.transaction_patterns.morning}, Afternoon: ${usage.transaction_patterns.afternoon}, Evening: ${usage.transaction_patterns.evening}, Night: ${usage.transaction_patterns.night}</div>
            <div><b>Common Recipients:</b> ${Object.entries(usage.common_recipients).map(([k, v]) => `${k} (${v})`).join(', ') || 'None'}</div>
            <div><b>Common Senders:</b> ${Object.entries(usage.common_senders).map(([k, v]) => `${k} (${v})`).join(', ') || 'None'}</div>
        `;
        document.getElementById('usage-content').innerHTML = html;
    } catch (error) {
        document.getElementById('usage-content').innerHTML = `<div class="error">Failed to load usage data</div>`;
        console.error('Error fetching usage data:', error);
    }
}

// Update the loadDashboard function to include transaction statistics
async function loadDashboard() {
    const username = localStorage.getItem('username');
    if (!username) return;

    await Promise.all([
        loadCards(),
        fetchRecentTransactions(username),
        fetchAndDisplayTotals(username),
        fetchAndDisplayTransactionStats(username),
        fetchAndDisplayUsage(username),
        initializeCharts()
    ]);
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    // Check authentication
    const auth = getAuthData();
    if (!auth) {
        window.location.href = '/auth';
        return;
    }

    // Setup modal and load cards
    setupModal();
    await loadCards(); // Wait for cards to load and username to be set

    const username = localStorage.getItem('username');
    if (username) {
        fetchRecentTransactions(username);
        fetchAndDisplayTotals(username);
        fetchAndDisplayTransactionStats(username);
        fetchAndDisplayUsage(username);
    }

    initializeCharts();

    // Setup quick transfer button
    const sendBtn = document.querySelector('.send-btn');
    if (sendBtn) {
        sendBtn.addEventListener('click', handleQuickTransfer);
    }

    // // Smooth auto-refresh for dashboard data (every 30 seconds)
    // setInterval(async () => {
    //     await loadCards();
    //     const username = localStorage.getItem('username');
    //     if (username) {
    //         fetchRecentTransactions(username);
    //         fetchAndDisplayTotals(username);
    //         fetchAndDisplayTransactionStats(username);
    //         fetchAndDisplayUsage(username);
    //     }
    //     initializeCharts();
    // }, 30000);

    // Call displayUserName on page load
    displayUserName();

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
}); 