// Script to change admin password via API
// Usage: node change-password.js <current-password> <new-password>
const http = require('http');

const currentPassword = process.argv[2];
const newPassword = process.argv[3];

if (!currentPassword || !newPassword) {
    console.error('Usage: node change-password.js <current-password> <new-password>');
    process.exit(1);
}

if (newPassword.length < 6) {
    console.error('New password must be at least 6 characters');
    process.exit(1);
}

const postData = JSON.stringify({
    currentPassword: currentPassword,
    newPassword: newPassword
});

const options = {
    hostname: 'localhost',
    port: 8990,
    path: '/admin/api/change-password',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': postData.length
    }
};

console.log('Changing password...');

const req = http.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const result = JSON.parse(data);
            if (result.success) {
                console.log('Password changed successfully!');
                console.log('Password is now stored encrypted in data/admin.hash');
            } else {
                console.error('Failed to change password:', result.error || data);
            }
        } catch (e) {
            console.error('Error:', data);
        }
    });
});

req.on('error', (e) => {
    console.error(`Request failed: ${e.message}`);
});

req.write(postData);
req.end();
