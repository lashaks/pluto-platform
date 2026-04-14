const { v4: uuidv4 } = require('uuid');

const generateId = () => uuidv4();
const generateLogin = () => Math.floor(Math.random() * 9000000 + 1000000).toString();
const generatePassword = () => 'Pluto' + Math.random().toString(36).slice(2, 8) + Math.floor(Math.random() * 900 + 100);
const generateAffiliateCode = (id) => 'ACF-' + id.slice(0, 8).toUpperCase();

const formatCurrency = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Sanitize string for SQL (basic — use parameterized queries in production with PostgreSQL)
const sanitize = (str) => String(str || '').replace(/'/g, "''");

module.exports = { generateId, generateLogin, generatePassword, generateAffiliateCode, formatCurrency, sanitize };
