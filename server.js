const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Исправление словацких символов без знаков вопроса
function removeDiacritics(str) {
    if (!str) return '';
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[čČ]/g, 'c').replace(/[šŠ]/g, 's').replace(/[žŽ]/g, 'z')
        .replace(/[ťŤ]/g, 't').replace(/[ďĎ]/g, 'd').replace(/[ňŇ]/g, 'n')
        .replace(/[áÁàÀâÂäÄ]/g, 'a').replace(/[éÉèÈêÊëË]/g, 'e')
        .replace(/[íÍìÌîÎïÏ]/g, 'i').replace(/[óÓòÒôÔöÖ]/g, 'o')
        .replace(/[úÚùÙûÛüÜ]/g, 'u').replace(/[ýÝ]/g, 'y')
        .replace(/ľ/g, 'l').replace(/Ľ/g, 'L')
        .replace(/ĺ/g, 'l').replace(/Ĺ/g, 'L')
        .replace(/ŕ/g, 'r').replace(/Ŕ/g, 'R');
}

// Перевод часов/минут в формат HH:MM (учитывая ваши 50 мин урока + 10 мин перемена = 60 мин на один слот)
function getFormattedTime(startHour, durationHours = 2) {
    const startMins = startHour * 60;
    const totalDurationMins = Math.round(durationHours * 60);
    const endMins = startMins + totalDurationMins;

    const format = (m) => {
        const h = Math.floor(m / 60) % 24;
        const min = m % 60;
        return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    };

    return {
        start: format(startMins),
        end: format(endMins)
    };
}

app.get('/api/status', (req, res) => {
    res.json({ status: 'online', message: 'UniFlo Backend работает успешно!' });
});

app.get('/api/schedule/:group', async (req, res) => {
    try {
        const group = req.params.group.toUpperCase();
        const url = `https://vzdelavanie.uniza.sk/vzdelavanie/rozvrh2.php?sq=2&id=${group}`;

        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });

        // Корректная кодировка для словацкого сайта
        let htmlContent = iconv.decode(Buffer.from(response.data), 'win1250');
        const $ = cheerio.load(htmlContent);
        const result = [];

        $(".rozvrh_tyzden").each(function (dayIndex) {
            const dayNum = dayIndex + 1;
            if (dayNum > 5) return; // Пн - Пт

            // Счетчик пар в этот день, чтобы если нет точных стилей, 
            // они гарантированно распределялись по разному времени (например, 7:00, 9:00, 11:00...)
            let dailyPairCounter = 0;

            $(this).find("span[class^='rozvrh_bloky']").each(function () {
                const $block =$(this);
                const links = $block.find("a");
                
                if (links.length >= 3) {
                    const teacher = removeDiacritics($(links[0]).text().trim());
                    const room = removeDiacritics($(links[1]).text().trim());
                    const title = removeDiacritics($(links[2]).text().trim());

                    // Тип занятия (C, P, L)
                    let type = "prednáška";
                    const blockText = removeDiacritics($block.text().trim());
                    const firstChar = blockText.charAt(0).toUpperCase();

                    if (firstChar === 'C' || blockText.toLowerCase().includes('cvicenie')) {
                        type = "cvičenie";
                    } else if (firstChar === 'L' || blockText.toLowerCase().includes('laboratorne')) {
                        type = "laboratórne";
                    } else if (firstChar === 'P' || blockText.toLowerCase().includes('prednaska')) {
                        type = "prednáška";
                    }

                    // Ищем реальное время через родителей или ячейку таблицы (td)
                    let startHour = 7 + (dailyPairCounter * 2); // Каждая следующая пара сдвигается на 2 часа (например, 7:00, 9:00, 11:00)
                    let durationHours = 2; // стандартная пара 2 часа сетки

                    // Пытаемся найти ячейку таблицы `td`, в которой лежит этот блок, 
                    // так как на UNIZA время зашито в порядковый номер ячейки `td`
                    const $td =$block.closest('td');
                    if ($td.length > 0) {
                        const tdIndex = $td.index();
                        const colspan = parseInt($td.attr('colspan') || '1', 10);
                        
                        if (tdIndex > 0) {
                            // 0-я ячейка обычно день недели, значит часы начинаются с (tdIndex - 1) + 7
                            startHour = 7 + (tdIndex - 1);
                        }
                        if (colspan > 1) {
                            durationHours = colspan;
                        }
                    } else {
                        // Запасной вариант через поиск стилей у любых родителей вверх по дереву
                        let foundLeft = false;
                        $block.parents().each(function() {
                            const parentStyle = $(this).attr('style') || '';
                            const leftMatch = parentStyle.match(/left:\s*([-\d.]+)px/i);
                            const widthMatch = parentStyle.match(/width:\s*([-\d.]+)px/i);
                            if (leftMatch && widthMatch) {
                                const leftPx = parseFloat(leftMatch[1]);
                                const widthPx = parseFloat(widthMatch[1]);
                                startHour = 7 + Math.round(leftPx / 50);
                                durationHours = widthPx / 50;
                                foundLeft = true;
                                return false; // прерываем цикл поиска
                            }
                        });

                        if (!foundLeft) {
                            dailyPairCounter++;
                        }
                    }

                    // Защита от вылетов за рамки расписания (7:00 - 19:00)
                    if (isNaN(startHour) || startHour < 7 || startHour > 18) {
                        startHour = 7 + ((dailyPairCounter - 1) * 2);
                    }
                    if (isNaN(durationHours) || durationHours < 0.5 || durationHours > 5) {
                        durationHours = 2;
                    }

                    const timeSlot = getFormattedTime(startHour, durationHours);

                    result.push({
                        id: Math.random().toString(36).substring(2, 11),
                        day: dayNum,
                        title: title,
                        type: type,
                        start: timeSlot.start,
                        end: timeSlot.end,
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
