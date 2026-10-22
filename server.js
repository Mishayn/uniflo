const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio =ريخ = require('cheerio'); // исправлено

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Функция надежной очистки словацких символов без знаков вопроса
function removeDiacritics(str) {
    if (!str) return '';
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[čČ]/g, 'c').replace(/[šŠ]/g, 's').replace(/[žŽ]/g, 'z')
        .replace(/[ťŤ]/g, 't').replace(/[ďĎ]/g, 'd').replace(/[ňŇ]/g, 'n')
        .replace(/[áÁàÀâÂäÄ]/g, 'a').replace(/[éÉèÈêÊëË]/g, 'e')
        .replace(/[íÍìÌîÎïÏ]/g, 'i').replace(/[óÓòÒôÔöÖ]/g, 'o')
        .replace(/[úÚùÙûÛüÜ]/g, 'u').replace(/[ýÝýÝ]/g, 'y')
        .replace(/ľ/g, 'l').replace(/Ľ/g, 'L')
        .replace(/ĺ/g, 'l').replace(/Ĺ/g, 'L')
        .replace(/ŕ/g, 'r').replace(/Ŕ/g, 'R');
}

function minutesToTime(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const mins = Math.round(totalMinutes % 60);
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

app.get('/api/status', (req, res) => {
    res.json({ status: 'online', message: 'UniFlo Backend работает успешно!' });
});

app.get('/api/schedule/:group', async (req, res) => {
    try {
        const group = req.params.group.toUpperCase();
        const url = `https://vzdelavanie.uniza.sk/vzdelavanie/rozvrh2.php?sq=2&id=${group}`;

        // Запрашиваем страницу в правильной кодировке windows-1250 / utf-8
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });

        // Декодируем буфер в текст (на сайте UNIZA используется windows-1250)
        let htmlContent = '';
        try {
            const iconv = require('iconv-lite');
            htmlContent = iconv.decode(Buffer.from(response.data), 'win1250');
        } catch (e) {
            htmlContent = Buffer.from(response.data).toString('utf8');
        }

        const $ = cheerio.load(htmlContent);
        const result = [];

        // Шаг 1. Считываем сетку часов из шапки таблицы (например, 7:00, 8:00 ...)
        const hourColumns = [];
        // Обычно часы идут в первой строке таблицы или в элементах с классом времени
        // На UNIZA колонки часов соответствуют ячейкам заголовка
        let baseStartHour = 7; // Старт с 7:00

        $(".rozvrh_tyzden").each(function (dayIndex) {
            const dayNum = dayIndex + 1;
            if (dayNum > 5) return; // Только Пн-Пт

            // Ищем все ячейки или блоки внутри этого дня
            // На UNIZA каждый блок имеет родительские элементы, по которым можно понять его позицию по сетке часов
            $(this).find("span[class^='rozvrh_bloky']").each(function () {
                const $block = $(this);
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

                    // НАХОДИМ ВРЕМЯ ПО ПОЗИЦИИ В ТАБЛИЦЕ (ЯЧЕЙКАХ / КОЛОНКАХ)
                    // Ищем родительскую ячейку <td> или элемент сетки
                    const $td = $block.closest('td, th, div');
                    
                    // По умолчанию ставим стандартное время, если не найдем позицию
                    let startMinutes = 7 * 60; // 07:00
                    let durationMinutes = 90;  // 1.5 часа

                    // Проверяем всевозможные варианты стилей в родителях (left/width)
                    let foundStyle = $block.attr('style') || '';
                    let parentStyle = $td.attr('style') || '';
                    let combinedStyle = foundStyle + ";" + parentStyle;

                    const leftMatch = combinedStyle.match(/left:\s*([-\d.]+)px/i);
                    const widthMatch = combinedStyle.match(/width:\s*([-\d.]+)px/i);

                    if (leftMatch && widthMatch) {
                        const leftPx = parseFloat(leftMatch[1]);
                        const widthPx = parseFloat(widthMatch[1]);
                        // На UNIZA 1 час = 50px (или около того, подбираем коэффициент)
                        const pxPerHour = 50; 
                        startMinutes = (7 * 60) + Math.round((leftPx / pxPerHour) * 60);
                        durationMinutes = Math.round((widthPx / pxPerHour) * 60);
                    } else {
                        // Альтернатива: определяем по порядковому номеру ячейки/колонки в строке дня
                        const tdIndex = $td.index();
                        if (tdIndex > 0) {
                            // Если ячейки идут по часам начиная с 7:00
                            startMinutes = (7 * 60) + ((tdIndex - 1) * 60);
                        }
                    }

                    // Безопасная проверка длительности (если ширина спарсилась некорректно)
                    if (durationMinutes < 30 || durationMinutes > 360) {
                        durationMinutes = 90; // Стандартная пара 1.5 часа
                    }

                    const startTime = minutesToTime(startMinutes);
                    const endTime = minutesToTime(startMinutes + durationMinutes);

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
