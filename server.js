const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

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

// Эндпоинт для парсинга расписания UNIZA
app.get('/api/schedule/:group', async (req, res) => {
    try {
        const group = req.params.group.toUpperCase();
        const url = `https://vzdelavanie.uniza.sk/vzdelavanie/rozvrh2.php?sq=2&id=${group}`;

        const response = await axios.get(url);
        const $ = cheerio.load(response.data);
        const result = [];

        $(".rozvrh_tyzden").each(function (dayIndex) {
            const dayNum = dayIndex + 1;
            
            $(this).find("span[class^='rozvrh_bloky']").each(function () {
                const links = $(this).find("a");
                
                if (links.length >= 3) {
                    result.push({
                        id: Math.random().toString(36).substring(2, 11),
                        day: dayNum > 5 ? 1 : dayNum,
                        teacher: $(links[0]).text().trim(),
                        room: $(links[1]).text().trim(),
                        title: $(links[2]).text().trim(),
                        type: "prednáška",
                        start: "08:00",
                        end: "09:40"
                    });
                }
            });
        });

        res.json({ schedule: result });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
