require('dotenv').config();
const express = require('express');
const path = require('path');
const { sequelize, Program } = require('./models');

const app = express();
const PORT = process.env.PORT || 3002;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

console.log('🚀 Сервер запускается...');

// ========================================
//  ГЛАВНАЯ — СПИСОК ПРОГРАММ
// ========================================
app.get('/', async (req, res) => {
    console.log('📋 Запрос на главную страницу');
    try {
        const programs = await Program.findAll({ order: [['name', 'ASC']] });
        console.log(`✅ Найдено программ: ${programs.length}`);
        res.render('programs', { programs, searchQuery: null });
    } catch (err) {
        console.error('❌ Ошибка загрузки программ:', err);
        res.status(500).send('Ошибка сервера: ' + err.message);
    }
});

// ========================================
//  ПОИСК
// ========================================
app.get('/search', async (req, res) => {
    const { q } = req.query;
    console.log(`🔍 Поиск: "${q}"`);
    try {
        const { Op } = require('sequelize');
        const programs = await Program.findAll({
            where: {
                [Op.or]: [
                    { name: { [Op.like]: `%${q}%` } },
                    { nitevody: { [Op.like]: `%${q}%` } },
                    { density_common: { [Op.like]: `%${q}%` } },
                    { machine_class: { [Op.like]: `%${q}%` } },
                    { notes: { [Op.like]: `%${q}%` } }
                ]
            },
            order: [['name', 'ASC']]
        });
        console.log(`✅ Найдено по поиску: ${programs.length}`);
        res.render('programs', { programs, searchQuery: q });
    } catch (err) {
        console.error('❌ Ошибка поиска:', err);
        res.status(500).send('Ошибка сервера: ' + err.message);
    }
});

// ========================================
//  ДОБАВЛЕНИЕ — ФОРМА
// ========================================
app.get('/add', (req, res) => {
    console.log('📝 Открыта форма добавления');
    res.render('add', { searchQuery: null });
});

// ========================================
//  ДОБАВЛЕНИЕ — СОХРАНЕНИЕ
// ========================================
app.post('/add', async (req, res) => {
    console.log('📥 Получены данные для добавления:');
    console.log(req.body);
    try {
        const newProgram = await Program.create(req.body);
        console.log(`✅ Добавлена программа: ${newProgram.name} (ID: ${newProgram.id})`);
        res.redirect('/');
    } catch (err) {
        console.error('❌ Ошибка при добавлении:', err);
        res.status(500).send('Ошибка при добавлении: ' + err.message);
    }
});

// ========================================
//  РЕДАКТИРОВАНИЕ — ФОРМА
// ========================================
app.get('/edit/:id', async (req, res) => {
    console.log(`📝 Открыта форма редактирования ID: ${req.params.id}`);
    try {
        const program = await Program.findByPk(req.params.id);
        if (!program) {
            console.log(`❌ Программа с ID ${req.params.id} не найдена`);
            return res.status(404).send('Не найдено');
        }
        console.log(`✅ Загружена программа: ${program.name}`);
        res.render('edit', { program, searchQuery: null });
    } catch (err) {
        console.error('❌ Ошибка загрузки программы:', err);
        res.status(500).send('Ошибка сервера: ' + err.message);
    }
});

// ========================================
//  РЕДАКТИРОВАНИЕ — СОХРАНЕНИЕ
// ========================================
app.post('/edit/:id', async (req, res) => {
    console.log(`📥 Получены данные для обновления ID: ${req.params.id}`);
    console.log(req.body);
    try {
        const program = await Program.findByPk(req.params.id);
        if (!program) {
            console.log(`❌ Программа с ID ${req.params.id} не найдена`);
            return res.status(404).send('Не найдено');
        }
        await program.update(req.body);
        console.log(`✅ Обновлена программа: ${program.name} (ID: ${program.id})`);
        res.redirect('/');
    } catch (err) {
        console.error('❌ Ошибка при обновлении:', err);
        res.status(500).send('Ошибка при обновлении: ' + err.message);
    }
});

// ========================================
//  УДАЛЕНИЕ
// ========================================
app.post('/delete/:id', async (req, res) => {
    console.log(`🗑️ Запрос на удаление ID: ${req.params.id}`);
    try {
        const program = await Program.findByPk(req.params.id);
        if (!program) {
            console.log(`❌ Программа с ID ${req.params.id} не найдена`);
            return res.status(404).send('Не найдено');
        }
        const name = program.name;
        await program.destroy();
        console.log(`✅ Удалена программа: ${name} (ID: ${req.params.id})`);
        res.redirect('/');
    } catch (err) {
        console.error('❌ Ошибка при удалении:', err);
        res.status(500).send('Ошибка при удалении: ' + err.message);
    }
});

// ========================================
//  ЗАПУСК
// ========================================
app.listen(PORT, async () => {
    console.log(`📘 Программы: http://localhost:${PORT}`);
    try {
        await sequelize.authenticate();
        console.log('✅ База данных подключена');
        await sequelize.sync({ alter: true });
        console.log('✅ Таблицы созданы/обновлены');
        
        const count = await Program.count();
        console.log(`📊 В базе данных: ${count} программ(ы)`);
    } catch (err) {
        console.error('❌ Ошибка базы данных:', err);
    }
});