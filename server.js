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
            let currentHour = 7; // День всегда начинается в 7:00

            while (i < $spans.length) {
                const $span = $($spans[i]);
                const className = $span.attr('class') || '';

                // Пропускаем пустые блоки-продолжения (-c), которые не содержат контента сами по себе
                if (className.includes('-c') && $span.find("a").length === 0 && $span.children().length === 0) {
                    currentHour += 1;
                    i++;
                    continue;
                }

                let $targetSpan = null;

                // ВАЖНО: В структуре UNIZA верхняя пара всегда лежит Самой Первой внутри контейнера
                const $firstChild = $span.children("span").first();
                if ($firstChild.length > 0) {
                    // Если есть вложенные блоки (разделение подгрупп), берем строго первый (верхний)
                    $targetSpan = $firstChild;
                } else {
                    // Иначе это обычный цельный блок
                    $targetSpan = $span;
                }

                const links = $targetSpan.find("a");

                if ($targetSpan && links.length > 0) {
                    let durationHours = 1;
                    let nextIndex = i + 1;

                    // Считаем следующие блоки как продолжение, если они имеют суффикс -c или пустые
                    while (nextIndex < $spans.length) {
                        const $nextSpan = $($spans[nextIndex]);
                        const nextClass = $nextSpan.attr('class') || '';
                        const nextLinks = $nextSpan.find("a").length;

                        if (nextClass.includes('-c') || (nextLinks === 0 && $nextSpan.text().trim() === '')) {
                            durationHours += 1;
                            nextIndex++;
                        } else {
                            break;
                        }
                    }

                    let teacher = '';
                    let room = '';
                    let title = '';

                    if (links.length >= 3) {
                        teacher = removeDiacritics($(links[0]).text().trim());
                        room = removeDiacritics($(links[1]).text().trim());
                        title = removeDiacritics($(links[2]).text().trim());
                    } else if (links.length === 2) {
                        teacher = removeDiacritics($(links[0]).text().trim());
                        title = removeDiacritics($(links[1]).text().trim());
                    } else {
                        title = removeDiacritics($(links[0]).text().trim());
                    }

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
                        title: title || "Predmet",
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

                // Пустой слот (окно)
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
