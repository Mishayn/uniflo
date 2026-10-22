const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Проверка статуса сервера
app.get('/api/status', (req, res) => {
    res.json({ 
        status: 'online', 
        message: 'UniFlo Backend работает успешно!',
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});