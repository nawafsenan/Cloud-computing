const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.FRONTEND_PORT;

// Set up EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'public'));

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Inject environment variables into HTML
app.use((req, res, next) => {
    const userApi = process.env.USER_API;
    const transApi = process.env.TRANS_API;
    const reportApi = process.env.REPORT_API;
    console.log('Setting USER_API for request:', userApi);
    console.log('Setting TRANS_API for request:', transApi);
    console.log('Setting REPORT_API for request:', reportApi);
    res.locals.USER_API = userApi;
    res.locals.TRANS_API = transApi;
    res.locals.REPORT_API = reportApi;
    next();
});



// Basic route
app.get(['/', '/home', '/home.html'], (req, res) => {
    res.render('home', {
        USER_API: res.locals.USER_API,
        TRANS_API: res.locals.TRANS_API
    });
});

// Auth route
app.get('/auth', (req, res) => {
    console.log('Rendering auth with USER_API:', res.locals.USER_API);
    res.render('auth', { USER_API: res.locals.USER_API });
});

// Transactions route
app.get(['/transactions', '/transactions.html'], (req, res) => {
    res.render('transactions', {
        USER_API: res.locals.USER_API,
        TRANS_API: res.locals.TRANS_API
    });
});

// Transfer route
app.get(['/transfer', '/transfer.html'], (req, res) => {
    res.render('transfer', {
        USER_API: res.locals.USER_API,
        TRANS_API: res.locals.TRANS_API,
        REPORT_API: res.locals.REPORT_API
    });
});

// API test route
app.get('/api/test', (req, res) => {
    res.json({ message: 'Frontend API is working!' });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log('Current working directory:', process.cwd());
    console.log('Views directory:', path.join(__dirname, 'public'));
}); 