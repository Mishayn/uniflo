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

// Расчет времени: 1 час сетки = 50 минут учебы (остальное перемена)
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

        // Проходим по каждой строке дня недели (Пн - Пт)
        $(".rozvrh_tyzden").each(function (dayIndex) {
            const dayNum = dayIndex + 1;
            if (dayNum > 5) return;

            const $spans = $(this).children("span");
            let i = 0;
            let currentHour = 7; // День начинается в 7:00

            while (i < $spans.length) {
                const $span = $($spans[i]);
                let $targetSpan = null;

                // 1. Проверяем, есть ли полноценные ссылки прямо в текущем спане
                if ($span.find("a").length >= 3) {
                    $targetSpan = $span;
                } else {
                    // 2. Если это контейнер с разделением (содержит вложенные блоки), 
                    // целенаправленно ищем верхний блок, содержащий "-v" в классе (например, rozvrh_bloky-v-color)
                    const $vChild = $span.find("span[class*='-v']").first();
                    if ($vChild.length > 0 && $vChild.find("a").length >= 3) {
                        $targetSpan = $vChild;
                    } else {
                        // Запасной вариант: если явного -v нет, берем первый попавшийся дочерний элемент
                        const $firstChild = $span.find("span").first();
                        if ($firstChild.length > 0 && $firstChild.find("a").length >= 3) {
                            $targetSpan = $firstChild;
                        }
                    }
                }

                if ($targetSpan && $targetSpan.find("a").length >= 3) {
                    const links = $targetSpan.find("a");
                    let durationHours = 1;
                    let nextIndex = i + 1;

                    // Считаем следующие блоки-продолжения с суффиксом "-c"
                    while (nextIndex < $spans.length) {
                        const $nextSpan = $($spans[nextIndex]);
                        const nextClass = $nextSpan.attr('class') || '';

                        if (nextClass.includes('-c')) {
                            durationHours += 1;
                            nextIndex++;
                        } else {
                            break;
                        }
                    }

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

                    const timeSlot = calculateTimes(currentHour, durationHours);

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

                    i = nextIndex;
                    currentHour += durationHours;
                    continue;
                }

                // Если это пустой слот (окно), просто сдвигаем текущий час дальше
                currentHour += 1;
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
