const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Функция для замены словацких символов на английские похожие
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

// Превращает минуты в формат "HH:MM"
function minutesToTime(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
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

        // Каждое занятие на сайте UNIZA обычно находится внутри блоков сетки
        // Мы ищем блоки и смотрим их стиль (left/width) или порядок в сетке часов
        $(".rozvrh_tyzden").each(function (dayIndex) {
            const dayNum = dayIndex + 1;
            
            $(this).find("span[class^='rozvrh_bloky']").each(function () {
                const $block =$(this);
                const styleAttr = $block.attr('style') || '';
                const fullText = removeDiacritics($block.text());
                const blockHtml = $block.html() || '';
                const links = $block.find("a");
                
                if (links.length >= 3) {
                    const teacher = removeDiacritics($(links[0]).text().trim());
                    const room = removeDiacritics($(links[1]).text().trim());
                    const title = removeDiacritics($(links[2]).text().trim());

                    // Тип занятия (C - cvičenie, P - prednáška, L - laboratórne)
                    let type = "prednáška";
                    const firstLetter = $block.find('.rozvrh_typ, b, span').first().text().trim().toUpperCase();
                    if (firstLetter === 'C' || fullText.toLowerCase().includes('cvicenie') || blockHtml.includes('cvičenie')) {
                        type = "cvičenie";
                    } else if (firstLetter === 'L' || fullText.toLowerCase().includes('laboratorne') || blockHtml.includes('laboratórne')) {
                        type = "laboratórne";
                    }

                    // АВТОМАТИЧЕСКИЙ РАСЧЕТ ВРЕМЕНИ ПО CSS-СТИЛЯМ (left / width)
                    // На сайте UNIZA шкала начинается с 7:00 (минута 420 от начала суток)
                    let startMinutes = 7 * 60; // по умолчанию 07:00
                    let durationMinutes = 90;  // стандартная пара 1.5 часа (90 минут)

                    // Пытаемся вытащить координаты left и width из атрибута style (например: "left: 150px; width: 120px;")
                    const leftMatch = styleAttr.match(/left:\s*([-\d.]+)px/i);
                    const widthMatch = styleAttr.match(/width:\s*([-\d.]+)px/i);

                    if (leftMatch && widthMatch) {
                        const leftPx = parseFloat(leftMatch[1]);
                        const widthPx = parseFloat(widthMatch[1]);
                        
                        // Примерный масштаб: сетка от 7:00 до 19:00 (12 часов = 720 минут). 
                        // Вы можете скорректирвоать коэффициент масштаба, если пиксели отличаются.
                        // Обычно 1 час на сайтах UNIZA занимает фиксированное число пикселей (например, 60px или 80px на час).
                        // Проверим стандартную пропорцию: 
                        const pixelsPerHour = 70; // подбирается под верстку шкалы
                        startMinutes = 7 * 60 + Math.round((leftPx / pixelsPerHour) * 60);
                        durationMinutes = Math.round((widthPx / pixelsPerHour) * 60);
                    } else {
                        // Запасной вариант: ищем время прямо в тексте блока (если оно там прописано)
                        const timeMatch = fullText.match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
                        if (timeMatch) {
                            result.push({
                                id: Math.random().toString(36).substring(2, 11),
                                day: dayNum > 5 ? 1 : dayNum,
                                teacher, room, title, type,
                                start: timeMatch[1],
                                end: timeMatch[2]
                            });
                            return;
                        }
                    }

                    const startTime = minutesToTime(startMinutes);
                    const endTime = minutesToTime(startMinutes + durationMinutes);

                    result.push({
                        id: Math.random().toString(36).substring(2, 11),
                        day: dayNum > 5 ? 1 : dayNum,
                        teacher: teacher,
                        room: room,
                        title: title,
                        type: type,
                        start: startTime,
                        end: endTime
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
