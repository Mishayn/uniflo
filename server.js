const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const crypto = require('crypto');

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
    res.json({ status: 'online', cache: Boolean(rtdb), message: 'UniFlo Backend работает успешно!' });
});

async function scrapeGroup(group) {
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
            const className = $span.attr('class') || '';

            // Если это чистый блок-продолжение без предмета, просто сдвигаем час
            if (className.includes('-c') && $span.find("a").length === 0 && $span.children().length === 0) {
                currentHour += 1;
                i++;
                continue;
            }

            let $targetSpan = null;

            // 1. Проверяем, есть ли полноценные ссылки прямо в текущем спане
            if ($span.find("a").length >= 3) {
                $targetSpan = $span;
            } else {
                // 2. Если это разделенная ячейка, берем строго самый первый дочерний спан (верхний: v-color)
                const $childrenSpans = $span.children("span");
                if ($childrenSpans.length > 0) {
                    $targetSpan = $childrenSpans.first();
                } else if ($span.find("a").length > 0) {
                    $targetSpan = $span;
                }
            }

            const links = $targetSpan ? $targetSpan.find("a") : $span.find("a");
            const spanText = $targetSpan ? $targetSpan.text().trim() : $span.text().trim();

            if ($targetSpan && (links.length > 0 || spanText.length > 0)) {
                let durationHours = 1;
                let nextIndex = i + 1;

                // Считаем следующие блоки-продолжения с суффиксом "-c" для объединения длительности пары
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
                } else if (links.length === 1) {
                    title = removeDiacritics($(links[0]).text().trim());
                } else {
                    title = removeDiacritics(spanText);
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
                    id: stableId(dayNum, timeSlot.start, title, room),
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

            // Если это пустой слот (окно)
            currentHour += 1;
            i++;
        }
    });
    return result;
}

// ===== Общая база расписаний (Firebase). Без ключа сервер работает как раньше =====
let rtdb = null;
try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        const admin = require('firebase-admin');
        admin.initializeApp({
            credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
            databaseURL: process.env.FIREBASE_DB_URL || 'https://unizarozvrhchat-default-rtdb.europe-west1.firebasedatabase.app'
        });
        rtdb = admin.database();
        console.log('Firebase: общая база расписаний включена');
    } else {
        console.log('Firebase: FIREBASE_SERVICE_ACCOUNT не задан, кэш выключен');
    }
} catch (e) {
    console.error('Firebase init error:', e.message);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const inFlight = new Map(); // одна загрузка группы за раз, даже если запросов много

function stableId(day, start, title, room) {
    return crypto.createHash('md5').update([day, start, title, room].join('|')).digest('hex').slice(0, 10);
}

async function getSchedule(group, force) {
    let cached = null;
    if (rtdb) {
        try { cached = (await rtdb.ref('groupSchedules/' + group).once('value')).val(); } catch (e) { console.error(e.message); }
        if (cached && !force && Date.now() - (cached.updatedAt || 0) < DAY_MS) {
            return { schedule: cached.lessons || [], updatedAt: cached.updatedAt, cached: true };
        }
    }
    if (!inFlight.has(group)) {
        inFlight.set(group, scrapeGroup(group).finally(() => inFlight.delete(group)));
    }
    try {
        const lessons = await inFlight.get(group);
        const updatedAt = Date.now();
        if (rtdb) {
            await rtdb.ref('groupSchedules/' + group).set({ lessons, updatedAt, source: 'uniza' }).catch(e => console.error(e.message));
        }
        return { schedule: lessons, updatedAt, cached: false };
    } catch (e) {
        if (cached) return { schedule: cached.lessons || [], updatedAt: cached.updatedAt, cached: true, stale: true };
        throw e;
    }
}

app.get('/api/schedule/:group', async (req, res) => {
    try {
        const group = req.params.group.toUpperCase();
        // только буквы, цифры, дефис и подчёркивание — чтобы в URL UNIZA нельзя было подставить свои параметры
        if (!/^[A-Z0-9_-]{2,20}$/.test(group)) {
            return res.status(400).json({ error: 'Neplatný názov skupiny' });
        }
        res.json(await getSchedule(group, req.query.force === '1'));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
