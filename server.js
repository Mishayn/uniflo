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

// Расчет времени с учетом академических часов и перемен
function calculateTimes(startHour, durationHours) {
    const startMins = startHour * 60;
    
    // Если пара длится 2 часа (по сетке), это обычно 1.5 часа чистых (90 минут) + перемена, 
    // либо полные блоки. Судя по вашей системе: 1 блок = 60 мин (50 урок + 10 перемена).
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

        let htmlContent = iconv.decode(Buffer.from(response.data), 'win1250');
        const $ = cheerio.load(htmlContent);
        const result = [];

        $(".rozvrh_tyzden").each(function (dayIndex) {
            const dayNum = dayIndex + 1;
            if (dayNum > 5) return; // Пн - Пт

            let accumulatedPixels = 0;
            const pxPerHour = 61; // 1 час = 61px

            $(this).children("span").each(function () {
                const $span =$(this);
                const styleAttr = $span.attr('style') || '';
                
                let spanWidth = 61;
                const widthMatch = styleAttr.match(/width:\s*([-\d.]+)px/i);
                if (widthMatch) {
                    spanWidth = parseFloat(widthMatch[1]);
                }

                const startHour = 7 + (accumulatedPixels / pxPerHour);
                // Длительность в часах теперь рассчитывается из реальной ширины блока (spanWidth)
                const durationHours = spanWidth / pxPerHour;

                const links = $span.find("a");
                if (links.length >= 3) {
                    const teacher = removeDiacritics($(links[0]).text().trim());
                    const room = removeDiacritics($(links[1]).text().trim());
                    const title = removeDiacritics($(links[2]).text().trim());

                    let type = "prednáška";
                    const blockText = removeDiacritics($span.text().trim());
                    const firstChar = blockText.charAt(0).toUpperCase();

                    if (firstChar === 'C' || blockText.toLowerCase().includes('cvicenie')) {
                        type = "cvičenie";
                    } else if (firstChar === 'L' || blockText.toLowerCase().includes('laboratorne')) {
                        type = "laboratórne";
                    } else if (firstChar === 'P' || blockText.toLowerCase().includes('prednaska')) {
                        type = "prednáška";
                    }

                    const timeSlot = calculateTimes(startHour, durationHours);

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

                // Сдвигаем на ширину текущего блока
                accumulatedPixels += spanWidth;
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
