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

// Расчет времени: старт в часах, длительность в часах
function calculateTimes(startHour, durationHours) {
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

        let htmlContent = iconv.decode(Buffer.from(response.data), 'win1250');
        const $ = cheerio.load(htmlContent);
        const result = [];

        // Проходим по каждому дню недели (строке)
        $(".rozvrh_tyzden").each(function (dayIndex) {
            const dayNum = dayIndex + 1;
            if (dayNum > 5) return; // Пн - Пт

            const $spans =$(this).children("span");
            let i = 0;
            let currentHour = 7; // День всегда начинается в 7:00 (1-й час)

            while (i < $spans.length) {
                const $span = $($spans[i]);
                const styleAttr = $span.attr('style') || '';
                
                let spanWidth = 61;
                const widthMatch = styleAttr.match(/width:\s*([-\d.]+)px/i);
                if (widthMatch) {
                    spanWidth = parseFloat(widthMatch[1]);
                }
                const pxPerHour = 61;
                let durationHours = spanWidth / pxPerHour;

                const links = $span.find("a");

                if (links.length >= 3) {
                    // Это полноценная пара! Проверяем, есть ли сразу за ней пустые блоки-продолжения (с суффиксом -c)
                    let extraHours = 0;
                    let nextIndex = i + 1;

                    while (nextIndex < $spans.length) {
                        const $nextSpan = $($spans[nextIndex]);
                        const nextClass = $nextSpan.attr('class') || '';
                        const nextText = $nextSpan.text().trim();

                        // Если следующий спан содержит суффикс продолжения (-c) или пустой — это часть текущей пары
                        if (nextClass.includes('-c') || nextText === '') {
                            let nextWidth = 61;
                            const nextStyle = $nextSpan.attr('style') || '';
                            const nextWMatch = nextStyle.match(/width:\s*([-\d.]+)px/i);
                            if (nextWMatch) nextWidth = parseFloat(nextWMatch[1]);

                            extraHours += (nextWidth / pxPerHour);
                            nextIndex++;
                        } else {
                            break;
                        }
                    }

                    // Общая длительность пары = её ширина + все сцепленные блоки продолжения
                    const totalDuration = durationHours + extraHours;

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

                    const timeSlot = calculateTimes(currentHour, totalDuration);

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

                    // Пропускаем в цикле те блоки продолжения, которые мы уже объединили в эту пару
                    i = nextIndex;
                    currentHour += totalDuration;
                    continue;
                }

                // Если это пустой слот (окно), просто сдвигаем текущий час и идем дальше
                currentHour += durationHours;
                i++;
            }
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
