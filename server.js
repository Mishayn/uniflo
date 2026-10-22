const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Функция для очистки словацких спецсимволов (чтобы не было битых знаков )
function removeDiacritics(str) {
    if (!str) return '';
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ä/g, 'a').replace(/Ä/g, 'A')
        .replace(/ô/g, 'o').replace(/Ô/g, 'O')
        .replace(/ľ/g, 'l').replace(/Ľ/g, 'L')
        .replace(/ĺ/g, 'l').replace(/Ĺ/g, 'L')
        .replace(/ŕ/g, 'r').replace(/Ŕ/g, 'R');
}

// Превращает минуты от начала суток в формат "HH:MM"
function minutesToTime(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const mins = Math.round(totalMinutes % 60);
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

app.get('/api/status', (req, res) => {
    res.json({ 
        status: 'online', 
        message: 'UniFlo Backend работает успешно!',
        timestamp: new Date().toISOString()
    });
});

app.get('/api/schedule/:group', async (req, res) => {
    try {
        const group = req.params.group.toUpperCase();
        const url = `https://vzdelavanie.uniza.sk/vzdelavanie/rozvrh2.php?sq=2&id=${group}`;

        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        
        const $ = cheerio.load(response.data);
        const result = [];

        // Каждый день недели на UNIZA
        $(".rozvrh_tyzden").each(function (dayIndex) {
            const dayNum = dayIndex + 1; // 1 - Pondelok ... 5 - Piatok
            if (dayNum > 5) return;      // Выходные игнорируем

            $(this).find("span[class^='rozvrh_bloky']").each(function () {
                const $block =$(this);
                const styleAttr = $block.attr('style') || '';
                const links = $block.find("a");
                
                if (links.length >= 3) {
                    // 1. Извлекаем данные из ссылок
                    const teacher = removeDiacritics($(links[0]).text().trim());
                    const room = removeDiacritics($(links[1]).text().trim());
                    const title = removeDiacritics($(links[2]).text().trim());

                    // 2. Определяем точный тип занятия по букве (P / C / L)
                    let type = "prednáška";
                    // Ищем первую букву типа в блоке (P, C или L)
                    const blockText = $block.text().trim();
                    const firstChar = blockText.charAt(0).toUpperCase();

                    if (firstChar === 'C' || blockText.includes('cvičenie') || blockText.includes('cvicenie')) {
                        type = "cvičenie";
                    } else if (firstChar === 'L' || blockText.includes('laboratórne') || blockText.includes('laboratorne')) {
                        type = "laboratórne";
                    } else if (firstChar === 'P' || blockText.includes('prednáška') || blockText.includes('prednaska')) {
                        type = "prednáška";
                    }

                    // 3. Вычисляем время по CSS-позиционированию блока
                    // На UNIZA: left: 0px соответствует 07:00, а каждые 50px = 1 час (60 минут)
                    let startTime = "07:00";
                    let endTime = "08:40";

                    const leftMatch = styleAttr.match(/left:\s*([-\d.]+)px/i);
                    const widthMatch = styleAttr.match(/width:\s*([-\d.]+)px/i);

                    if (leftMatch && widthMatch) {
                        const leftPx = parseFloat(leftMatch[1]);
                        const widthPx = parseFloat(widthMatch[1]);

                        // 50 пикселей = 60 минут (1 час) => 1 пиксель = 1.2 минуты
                        const pixelsPerHour = 50; 
                        const startMinutes = (7 * 60) + ((leftPx / pixelsPerHour) * 60);
                        const durationMinutes = (widthPx / pixelsPerHour) * 60;

                        startTime = minutesToTime(startMinutes);
                        endTime = minutesToTime(startMinutes + durationMinutes);
                    }

                    // Сохраняем объект точно в том формате, который ждет ваш index.html
                    result.push({
                        id: Math.random().toString(36).substring(2, 11),
                        day: dayNum,
                        title: title,
                        type: type,
                        start: startTime,
                        end: endTime,
                        teacher: teacher,
                        room: room
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
