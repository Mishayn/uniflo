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

// Расчет времени: 1 час сетки = 50 минут учебы
function calculateTimes(startHour, durationHours) {
    const startMins = startHour * 60;
    const totalDurationMins = Math.round(durationHours * 50);
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

        let htmlContent = iconv.decode(Buffer.from(response.data), 'win1250');
        const $ = cheerio.load(htmlContent);
        const result = [];

        // Проходим по каждой строке дня недели (Пн-Пт)
        $(".rozvrh_tyzden").each(function (dayIndex) {
            const dayNum = dayIndex + 1;
            if (dayNum > 5) return;

            const $spans = $(this).children("span");
            let currentHour = 7; // Учебный день всегда начинается в 07:00

            $spans.each(function () {
                const $span = $(this);
                const styleAttr = $span.attr('style') || '';
                
                // Вычисляем ширину блока в часах (61px = 1 час сетки)
                let spanWidthPx = 61;
                const widthMatch = styleAttr.match(/width:\s*([-\d.]+)px/i);
                if (widthMatch) {
                    spanWidthPx = parseFloat(widthMatch[1]);
                }
                const slotHours = spanWidthPx / 61;

                // Если это блок-продолжение (-c), он просто сдвигает время и не содержит нового предмета
                const className = $span.attr('class') || '';
                if (className.includes('-c')) {
                    currentHour += slotHours;
                    return;
                }

                let $targetSpan = null;
                let links = $span.find("a");

                // Если ссылок мало прямо в спане, ищем верхнюю подгруппу (-v) внутри разделенного блока
                if (links.length < 3) {
                    const $vChild = $span.find("span[class*='-v']").first();
                    if ($vChild.length > 0 && $vChild.find("a").length >= 3) {
                        $targetSpan = $vChild;
                        links = $targetSpan.find("a");
                    } else {
                        const $firstChild = $span.find("span").first();
                        if ($firstChild.length > 0 && $firstChild.find("a").length >= 3) {
                            $targetSpan = $firstChild;
                            links = $targetSpan.find("a");
                        }
                    }
                } else {
                    $targetSpan = $span;
                }

                // Если нашли валидный предмет с преподавателем, аудиторией и названием
                if (links.length >= 3) {
                    const teacher = removeDiacritics($(links[0]).text().trim());
                    const room = removeDiacritics($(links[1]).text().trim());
                    const title = removeDiacritics($(links[2]).text().trim());

                    let type = "prednáška";
                    const blockText = removeDiacritics($targetSpan.text().trim());
                    const firstChar = blockText.charAt(0).toUpperCase();

                    if (firstChar === 'C' || blockText.toLowerCase().includes('cvicenie')) {
                        type = "cvičenie";
                    } else if (firstChar === 'L' || blockText.toLowerCase().includes('laboratorne')) {
                        type = "laboratórne";
                    } else if (firstChar === 'P' || blockText.toLowerCase().includes('prednaska')) {
                        type = "prednáška";
                    }

                    const timeSlot = calculateTimes(currentHour, slotHours);

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

                // Сдвигаем текущий час на ширину этого блока
                currentHour += slotHours;
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
