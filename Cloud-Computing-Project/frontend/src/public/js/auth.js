// Constants
const API_URL = (typeof window !== 'undefined' && window.USER_API);

console.log('Auth.js Environment Check:');
console.log('Window object exists:', typeof window !== 'undefined');
console.log('USER_API from window:', window.USER_API);
console.log('Final API_URL value:', API_URL);

// DOM Elements
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const loginMessage = document.getElementById('login-message');
const signupMessage = document.getElementById('signup-message');

// Utility Functions
function showMessage(element, message, type) {
    element.className = `message ${type}`;
    element.textContent = message;
}

function setLoading(button, isLoading) {
    button.disabled = isLoading;
    button.classList.toggle('loading', isLoading);
}

function validateForm(formData) {
    for (const [key, value] of Object.entries(formData)) {
        if (!value || value.trim() === '') {
            throw new Error(`${key.charAt(0).toUpperCase() + key.slice(1)} is required`);
        }
    }

    if (formData.email && !formData.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
        throw new Error('Please enter a valid email address');
    }

    if (formData.phone && !formData.phone.match(/^\+?[\d\s-]{10,}$/)) {
        throw new Error('Please enter a valid phone number');
    }

    if (formData.password && formData.password.length < 6) {
        throw new Error('Password must be at least 6 characters long');
    }

    if (formData.username && formData.username.length < 3) {
        throw new Error('Username must be at least 3 characters long');
    }

    if (formData.birthdate) {
        const birthDate = new Date(formData.birthdate);
        const today = new Date();
        const age = today.getFullYear() - birthDate.getFullYear();
        if (age < 18) {
            throw new Error('You must be at least 18 years old to register');
        }
    }
}

// Tab Switching
function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.form-container').forEach(f => {
        f.classList.remove('active');
        setTimeout(() => {
            if (!f.classList.contains('active')) {
                f.style.display = 'none';
            }
        }, 300);
    });

    document.querySelector(`.tab:nth-child(${tab === 'login' ? '1' : '2'})`).classList.add('active');
    const activeForm = document.getElementById(`${tab}-form`);
    activeForm.style.display = 'block';
    setTimeout(() => activeForm.classList.add('active'), 10);

    // Clear messages
    loginMessage.className = '';
    loginMessage.textContent = '';
    signupMessage.className = '';
    signupMessage.textContent = '';
}

// API Calls
async function makeRequest(endpoint, data) {
    const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    });

    const result = await response.json();

    if (!response.ok) {
        throw new Error(result.message || 'An error occurred');
    }

    return result;
}

// Form Handlers
async function handleLogin(event) {
    event.preventDefault();
    const button = event.target.querySelector('button');
    setLoading(button, true);

    const formData = {
        identifier: document.getElementById('login-identifier').value,
        password: document.getElementById('login-password').value
    };

    try {
        validateForm(formData);
        const data = await makeRequest('/login', formData);
        showMessage(loginMessage, 'Login successful! Redirecting...', 'success');

        // Clear any existing username from localStorage
        localStorage.removeItem('username');

        // Store auth data
        localStorage.setItem('token', data.access_token);
        localStorage.setItem('user_id', data.user_id);

        // Redirect with animation
        setTimeout(() => {
            document.body.style.opacity = '0';
            setTimeout(() => {
                window.location.href = '/';
            }, 500);
        }, 1000);
    } catch (error) {
        console.error('Login error:', error);
        showMessage(loginMessage, error.message, 'error');
    } finally {
        setLoading(button, false);
    }
}

async function handleSignup(event) {
    event.preventDefault();
    const fname = document.getElementById('signup-fname').value.trim();
    const lname = document.getElementById('signup-lname').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const phone = document.getElementById('signup-phone').value.trim();
    const password = document.getElementById('signup-password').value;
    const confirmPassword = document.getElementById('signup-confirm-password').value;
    const birthdate = document.getElementById('signup-birthdate').value;
    const messageDiv = document.getElementById('signup-message');

    if (password !== confirmPassword) {
        messageDiv.textContent = 'Passwords do not match.';
        messageDiv.className = 'error';
        return;
    }

    const formData = {
        fname: fname,
        lname: lname,
        email: email,
        phone: phone,
        password: password,
        birthdate: birthdate
    };

    try {
        validateForm(formData);
        await makeRequest('/register', formData);
        showMessage(signupMessage, 'Registration successful! Please login.', 'success');

        // Switch to login tab with animation
        setTimeout(() => {
            switchTab('login');
            document.getElementById('login-identifier').value = formData.email;
        }, 2000);
    } catch (error) {
        console.error('Signup error:', error);
        showMessage(signupMessage, error.message, 'error');
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    loginForm.addEventListener('submit', handleLogin);
    signupForm.addEventListener('submit', handleSignup);

    // Password visibility toggle for signup
    document.querySelectorAll('.toggle-password').forEach(btn => {
        btn.addEventListener('click', function () {
            const targetId = this.getAttribute('data-target');
            const input = document.getElementById(targetId);
            if (input.type === 'password') {
                input.type = 'text';
                this.querySelector('i').classList.remove('fa-eye');
                this.querySelector('i').classList.add('fa-eye-slash');
            } else {
                input.type = 'password';
                this.querySelector('i').classList.remove('fa-eye-slash');
                this.querySelector('i').classList.add('fa-eye');
            }
        });
    });
}); 