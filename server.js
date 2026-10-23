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

                // Если это блок-продолжение (-c), пропускаем как отдельный предмет, просто сдвигаем час
                if (className.includes('-c')) {
                    currentHour += 1;
                    i++;
                    continue;
                }

                let $targetSpan = null;

                // Проверяем, есть ли разделенные подгруппы внутри ячейки (берем верхнюю: -v-color)
                const $vChild = $span.children("span").filter(function() {
                    const cls = $(this).attr('class') || '';
                    return cls.includes('-v-color') || (cls.includes('-v') && !cls.includes('-pv'));
                }).first();

                if ($vChild.length > 0) {
                    $targetSpan = $vChild;
                } else if ($span.children("span").length > 0) {
                    // Если нет явного -v, но есть дочерние спаны, берем первый (верхний)
                    $targetSpan = $span.children("span").first();
                } else {
                    // Иначе это обычный цельный блок
                    $targetSpan = $span;
                }

                const links = $targetSpan.find("a");
                const spanText = $targetSpan.text().trim();

                // Если внутри есть ссылки или текст — это занятие
                if (links.length > 0 || spanText.length > 0) {
                    let durationHours = 1;
                    let nextIndex = i + 1;

                    // Считаем следующие блоки-продолжения с суффиксом "-c" для объединения длительности
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

                    let title = '';
                    let teacher = '';
                    let room = '';

                    if (links.length >= 3) {
                        teacher = removeDiacritics($(links[0]).text().trim());
                        room = removeDiacritics($(links[1]).text().trim());
                        title = removeDiacritics($(links[2]).text().trim());
                    } else if (links.length === 1) {
                        // В разделенных блоках обычно только одна ссылка на предмет
                        title = removeDiacritics($(links[0]).text().trim());
                    } else if (links.length === 2) {
                        teacher = removeDiacritics($(links[0]).text().trim());
                        title = removeDiacritics($(links[1]).text().trim());
                    } else {
                        title = removeDiacritics(spanText);
                    }

                    if (title) {
                        let type = "prednáška";
                        const boldChar = removeDiacritics($targetSpan.find(".SRH_bold").text().trim()).charAt(0).toUpperCase();

                        if (boldChar === 'C' || spanText.toLowerCase().includes('cvicenie')) {
                            type = "cvičenie";
                        } else if (boldChar === 'L' || spanText.toLowerCase().includes('laboratorne')) {
                            type = "laboratórne";
                        } else if (boldChar === 'P' || spanText.toLowerCase().includes('prednaska')) {
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
                    }

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
