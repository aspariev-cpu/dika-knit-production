require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const XLSX = require('xlsx');
const profileRoutes = require('./routes/profile');
const {
    sequelize,
    User,
    Machine,
    Model,
    ModelPart,
    Color,
    Task,
    Operation
} = require('./models');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

app.set('io', io);
app.use('/', profileRoutes);
// ========================================
//  MIDDLEWARE
// ========================================

app.use(async (req, res, next) => {
    try {
        const token = req.cookies.token;
        console.log('🔍 Проверка токена:', token ? 'Есть' : 'Нет');
        
        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            console.log('🔍 Декодирован:', decoded);
            
            const user = await User.findByPk(decoded.id);
            if (user) {
                req.user = user;
                console.log('👤 Найден пользователь:', user.fullName, 'ID:', user.id);
            } else {
                console.log('❌ Пользователь не найден в БД');
            }
        }
        next();
    } catch (err) {
        console.log('❌ Ошибка проверки токена:', err.message);
        next();
    }
});

// ========================================
//  АВТОРИЗАЦИЯ
// ========================================

app.get('/', (req, res) => res.redirect('/login'));

app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/api/login', async (req, res) => {
    const { login, password } = req.body;
    try {
        const user = await User.findOne({ where: { login } });
        if (!user || !await bcrypt.compare(password, user.password)) {
            return res.render('login', { error: '❌ Неверный логин или пароль' });
        }
        const token = jwt.sign(
            { id: user.id, login: user.login, isAdmin: user.isAdmin },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );
        res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
        res.redirect(user.isAdmin ? '/admin' : '/worker');
    } catch (err) {
        console.error(err);
        res.render('login', { error: '❌ Ошибка сервера' });
    }
});

app.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/login');
});

// ========================================
//  АДМИН-ПАНЕЛЬ
// ========================================

app.get('/admin', async (req, res) => {
    try {
        const tasks = await Task.findAll({
            where: { isPart: false },
            include: [
                { model: Model },
                { model: Color },
                { model: Operation, as: 'operations' },
                { 
                    model: Task, 
                    as: 'parts',
                    include: [
                        { model: Model },
                        { model: Operation, as: 'operations' }
                    ]
                }
            ],
            order: [['createdAt', 'DESC']]
        });
        res.render('admin/dashboard', {
            tasks,
            user: { fullName: 'Администратор', isAdmin: true }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка сервера');
    }
});

// ========================================
//  СТРАНИЦА МОДЕЛЕЙ
// ========================================

app.get('/admin/models', async (req, res) => {
    try {
        const models = await Model.findAll({
            include: [{ model: ModelPart, as: 'parts' }],
            order: [['name', 'ASC']]
        });
        res.render('admin/models', {
            models,
            user: { fullName: 'Администратор', isAdmin: true }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка сервера');
    }
});

// ========================================
//  СОЗДАНИЕ МОДЕЛИ
// ========================================

app.post('/api/models', async (req, res) => {
    try {
        const { name, program, size, className, yarn, image, isCoat } = req.body;
        
        const model = await Model.create({
            name,
            program,
            size,
            className,
            yarn: yarn || null,
            image: image || null,
            isCoat: isCoat === 'on'
        });

        if (isCoat === 'on') {
            for (let i = 0; i < 5; i++) {
                const partName = req.body[`part_name_${i}`];
                const partProgram = req.body[`part_program_${i}`];
                const partYarn = req.body[`part_yarn_${i}`];
                const partImage = req.body[`part_image_${i}`];
                
                if (partName && partProgram && partYarn) {
                    await ModelPart.create({
                        modelId: model.id,
                        partName: partName,
                        program: partProgram,
                        size: null,
                        className: null,
                        yarn: partYarn,
                        image: partImage || null
                    });
                }
            }
        }

        res.redirect('/admin/models');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при создании модели: ' + err.message);
    }
});

// ========================================
//  УДАЛЕНИЕ МОДЕЛИ
// ========================================

app.post('/api/models/delete/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await Model.destroy({ where: { id } });
        res.redirect('/admin/models');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при удалении');
    }
});

// ========================================
//  ПОЛУЧИТЬ МОДЕЛЬ ДЛЯ РЕДАКТИРОВАНИЯ
// ========================================

app.get('/api/models/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const model = await Model.findByPk(id, {
            include: [{ model: ModelPart, as: 'parts' }]
        });
        if (!model) {
            return res.status(404).json({ error: 'Модель не найдена' });
        }
        res.json(model);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка при загрузке модели' });
    }
});

// ========================================
//  ОБНОВИТЬ МОДЕЛЬ
// ========================================

app.post('/api/models/edit/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const model = await Model.findByPk(id);
        if (!model) {
            return res.status(404).json({ error: 'Модель не найдена' });
        }

        const { name, program, size, className, yarn, image, isCoat } = req.body;
        
        await model.update({
            name,
            program,
            size,
            className,
            yarn: yarn || null,
            image: image || null,
            isCoat: isCoat === 'on'
        });

        await ModelPart.destroy({ where: { modelId: id } });

        if (isCoat === 'on') {
            for (let i = 0; i < 5; i++) {
                const partName = req.body[`part_name_${i}`];
                const partProgram = req.body[`part_program_${i}`];
                const partYarn = req.body[`part_yarn_${i}`];
                const partImage = req.body[`part_image_${i}`];
                
                if (partName && partProgram && partYarn) {
                    await ModelPart.create({
                        modelId: id,
                        partName: partName,
                        program: partProgram,
                        size: null,
                        className: null,
                        yarn: partYarn,
                        image: partImage || null
                    });
                }
            }
        }

        res.redirect('/admin/models');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при редактировании модели: ' + err.message);
    }
});

// ========================================
//  ЭКСПОРТ МОДЕЛЕЙ В EXCEL
// ========================================

app.get('/admin/models/export', async (req, res) => {
    try {
        const models = await Model.findAll({
            include: [{ model: ModelPart, as: 'parts' }],
            order: [['name', 'ASC']]
        });

        if (!models || models.length === 0) {
            return res.status(404).send('Нет моделей для экспорта');
        }

        const data = [];
        models.forEach(model => {
            if (model.isCoat && model.parts && model.parts.length > 0) {
                model.parts.forEach(part => {
                    data.push({
                        'Название': model.name,
                        'Программа': model.program,
                        'Размер': model.size,
                        'Класс': model.className,
                        'Пряжа': model.yarn || '—',
                        'Тип': 'Кофта',
                        'Деталь': part.partName,
                        'Программа детали': part.program,
                        'Размер детали': part.size || '—',
                        'Класс детали': part.className || '—',
                        'Пряжа детали': part.yarn || '—'
                    });
                });
            } else {
                data.push({
                    'Название': model.name,
                    'Программа': model.program,
                    'Размер': model.size,
                    'Класс': model.className,
                    'Пряжа': model.yarn || '—',
                    'Тип': 'Обычная',
                    'Деталь': '—',
                    'Программа детали': '—',
                    'Размер детали': '—',
                    'Класс детали': '—',
                    'Пряжа детали': '—'
                });
            }
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, 'Модели');

        ws['!cols'] = [
            { wch: 25 }, // Название
            { wch: 15 }, // Программа
            { wch: 12 }, // Размер
            { wch: 12 }, // Класс
            { wch: 20 }, // Пряжа
            { wch: 12 }, // Тип
            { wch: 25 }, // Деталь
            { wch: 15 }, // Программа детали
            { wch: 12 }, // Размер детали
            { wch: 12 }, // Класс детали
            { wch: 20 }  // Пряжа детали
        ];

        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=models-${new Date().toISOString().split('T')[0]}.xlsx`);
        res.send(buffer);

    } catch (err) {
        console.error('❌ Ошибка экспорта моделей:', err);
        res.status(500).send('Ошибка при выгрузке: ' + err.message);
    }
});

// ========================================
//  УПРАВЛЕНИЕ ЦВЕТАМИ
// ========================================

app.get('/admin/colors', async (req, res) => {
    try {
        const colors = await Color.findAll({ order: [['name', 'ASC']] });
        res.render('admin/colors', {
            colors,
            user: { fullName: 'Администратор', isAdmin: true }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка сервера');
    }
});

app.post('/api/colors', async (req, res) => {
    const { name } = req.body;
    try {
        await Color.create({ name });
        res.redirect('/admin/colors');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при создании цвета');
    }
});

app.post('/api/colors/delete/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await Color.destroy({ where: { id } });
        res.redirect('/admin/colors');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при удалении');
    }
});

// ========================================
//  УПРАВЛЕНИЕ СОТРУДНИКАМИ
// ========================================

app.get('/admin/workers', async (req, res) => {
    try {
        const workers = await User.findAll({
            where: { isAdmin: false },
            order: [['createdAt', 'DESC']]
        });
        res.render('admin/workers', {
            workers,
            user: { fullName: 'Администратор', isAdmin: true }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка сервера');
    }
});

app.post('/api/workers', async (req, res) => {
    const { login, fullName, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await User.create({
            login,
            password: hashedPassword,
            fullName,
            isAdmin: false
        });
        res.redirect('/admin/workers');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при создании');
    }
});

app.post('/api/workers/delete/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await User.destroy({ where: { id } });
        res.redirect('/admin/workers');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при удалении');
    }
});

// ========================================
//  УДАЛЕНИЕ ЗАДАНИЯ
// ========================================

app.post('/api/tasks/delete/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const task = await Task.findByPk(id);
        if (task && task.isCoat) {
            await Task.destroy({ where: { parentTaskId: id } });
        }
        await Task.destroy({ where: { id } });
        res.redirect('/admin');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при удалении');
    }
});

// ========================================
//  ПОВТОР ЗАКАЗА
// ========================================

app.post('/api/tasks/duplicate/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const original = await Task.findByPk(id, {
            include: [{ model: Task, as: 'parts' }]
        });
        if (!original) {
            return res.status(404).send('Задание не найдено');
        }

        const newParent = await Task.create({
            modelId: original.modelId,
            colorId: original.colorId,
            planQuantity: original.planQuantity,
            isUrgent: original.isUrgent,
            status: 'pending',
            ip: original.ip,
            isCoat: original.isCoat,
            isPart: false,
            partName: null,
            parentTaskId: null
        });

        if (original.isCoat && original.parts) {
            for (const part of original.parts) {
                await Task.create({
                    modelId: part.modelId,
                    colorId: part.colorId,
                    planQuantity: part.planQuantity,
                    isUrgent: part.isUrgent,
                    status: 'pending',
                    ip: part.ip,
                    isCoat: false,
                    isPart: true,
                    partName: part.partName || part.Model?.name || 'Деталь',
                    parentTaskId: newParent.id
                });
            }
        }

        res.redirect('/admin');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при дублировании');
    }
});

// ========================================
//  СТАТИСТИКА ПО СМЕНАМ
// ========================================

app.get('/admin/shifts', async (req, res) => {
    try {
        let { date, shift } = req.query;
        
        if (Array.isArray(date)) {
            date = date[0];
        }
        if (date && typeof date === 'string' && date.includes(',')) {
            date = date.split(',')[0];
        }
        if (Array.isArray(shift)) {
            shift = shift[0];
        }
        if (shift && typeof shift === 'string' && shift.includes(',')) {
            shift = shift.split(',')[0];
        }
        
        let whereClause = {};
        let selectedDate = null;
        
        if (date) {
            selectedDate = new Date(date);
            if (isNaN(selectedDate.getTime())) {
                console.error(`❌ Неверный формат даты: ${date}`);
                selectedDate = null;
            }
        }
        
        if (selectedDate) {
            let startDate, endDate;
            
            if (shift === 'day') {
                startDate = new Date(selectedDate);
                startDate.setHours(8, 0, 0, 0);
                endDate = new Date(selectedDate);
                endDate.setHours(20, 0, 0, 0);
            } else if (shift === 'night') {
                startDate = new Date(selectedDate);
                startDate.setHours(20, 0, 0, 0);
                endDate = new Date(selectedDate);
                endDate.setDate(endDate.getDate() + 1);
                endDate.setHours(8, 0, 0, 0);
            } else {
                startDate = new Date(selectedDate);
                startDate.setHours(0, 0, 0, 0);
                endDate = new Date(selectedDate);
                endDate.setHours(23, 59, 59, 999);
            }
            
            whereClause.createdAt = {
                [Op.gte]: startDate,
                [Op.lt]: endDate
            };
        }
        
        const operations = await Operation.findAll({
            where: whereClause,
            include: [
                { model: User, as: 'employee' },
                { 
                    model: Task,
                    include: [
                        { model: Model }
                    ]
                },
                { model: Machine, as: 'machine' }
            ],
            order: [['createdAt', 'DESC']],
            timezone: '+03:00'
        });
        
        const summary = {};
        operations.forEach(op => {
            const name = op.employee ? op.employee.fullName : 'Неизвестный';
            if (!summary[name]) {
                summary[name] = {
                    total: 0,
                    machines: new Set()
                };
            }
            summary[name].total += op.quantity;
            if (op.machine) summary[name].machines.add(op.machine.machineNumber);
        });
        
        const formattedSummary = Object.keys(summary).map(name => ({
            name,
            total: summary[name].total,
            machines: Array.from(summary[name].machines).join(', ')
        }));
        
        const validDate = selectedDate ? selectedDate.toISOString().split('T')[0] : '';
        
        res.render('admin/shifts', {
            summary: formattedSummary,
            operations: operations,
            date: validDate,
            shift: shift || 'day',
            user: { fullName: 'Администратор', isAdmin: true }
        });
    } catch (err) {
        console.error('Ошибка при загрузке статистики:', err);
        res.status(500).send('Ошибка при загрузке статистики: ' + err.message);
    }
});

// ========================================
//  ВЫГРУЗКА СМЕНЫ В EXCEL
// ========================================

app.get('/admin/shifts/export', async (req, res) => {
    try {
        let { date, shift } = req.query;
        
        if (Array.isArray(date)) {
            date = date[0];
        }
        if (date && typeof date === 'string' && date.includes(',')) {
            date = date.split(',')[0];
        }
        
        let whereClause = {};
        
        if (date) {
            const selectedDate = new Date(date);
            let startDate, endDate;
            
            if (shift === 'day') {
                startDate = new Date(selectedDate);
                startDate.setHours(8, 0, 0, 0);
                endDate = new Date(selectedDate);
                endDate.setHours(20, 0, 0, 0);
            } else if (shift === 'night') {
                startDate = new Date(selectedDate);
                startDate.setHours(20, 0, 0, 0);
                endDate = new Date(selectedDate);
                endDate.setDate(endDate.getDate() + 1);
                endDate.setHours(8, 0, 0, 0);
            } else {
                startDate = new Date(selectedDate);
                startDate.setHours(0, 0, 0, 0);
                endDate = new Date(selectedDate);
                endDate.setHours(23, 59, 59, 999);
            }
            whereClause.createdAt = {
                [Op.gte]: startDate,
                [Op.lt]: endDate
            };
        }
        
        const operations = await Operation.findAll({
            where: whereClause,
            include: [
                { model: User, as: 'employee' },
                { 
                    model: Task,
                    include: [
                        { 
                            model: Model,
                            include: [
                                { model: ModelPart, as: 'parts' }
                            ]
                        },
                        { model: Color }
                    ]
                }
            ],
            order: [['createdAt', 'DESC']],
            timezone: '+03:00'
        });
        
        if (operations.length === 0) {
            return res.send('За эту смену нет данных');
        }
        
        const regularData = operations
    .filter(op => op.Task && op.Task.Model && !op.Task.Model.isCoat)
    .map(op => ({
        'Дата и время': new Date(op.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }),
        'Модель': op.modelName || (op.Task && op.Task.Model ? op.Task.Model.name : '—'),
        'Цвет': op.colorName || (op.Task && op.Task.Color ? op.Task.Color.name : '—'),
        'Количество': op.quantity,
        'ИП': op.Task && op.Task.ip ? op.Task.ip : '—',
        'Сотрудник': op.employee ? op.employee.fullName : '—'
    }));
        
        const coatDataRaw = operations
    .filter(op => op.Task && op.Task.Model && op.Task.Model.isCoat)
    .map(op => {
        const task = op.Task;
        const model = task ? task.Model : null;
        const parts = model && model.parts ? model.parts : [];
        
        const row = {
            'Дата и время': new Date(op.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }),
            'Модель': model ? model.name : '—',
            'Цвет': op.colorName || (task && task.Color ? task.Color.name : '—'),
            'Размер': model ? model.size : '—',
            'ИП': task && task.ip ? task.ip : '—',
            'Сотрудник': op.employee ? op.employee.fullName : '—'
        };
        
        parts.forEach((part, index) => {
            row[`Деталь ${index + 1}`] = part.partName;
            row[`Кол-во ${index + 1}`] = op.quantity;
        });
        
        return row;
    });
        
        let maxParts = 0;
        coatDataRaw.forEach(row => {
            let count = 0;
            for (let key in row) {
                if (key.startsWith('Деталь ')) count++;
            }
            if (count > maxParts) maxParts = count;
        });
        
        const coatData = coatDataRaw.map(row => {
            const newRow = {
                'Дата и время': row['Дата и время'],
                'Модель': row['Модель'],
                'Цвет': row['Цвет'],
                'Размер': row['Размер']
            };
            
            for (let i = 1; i <= maxParts; i++) {
                newRow[`Деталь ${i}`] = row[`Деталь ${i}`] || '—';
                newRow[`Кол-во ${i}`] = row[`Кол-во ${i}`] || '—';
            }
            
            newRow['Сотрудник'] = row['Сотрудник'];
            return newRow;
        });
        
        const wb = XLSX.utils.book_new();
        
        if (regularData.length > 0) {
            const wsRegular = XLSX.utils.json_to_sheet(regularData);
            wsRegular['!cols'] = [
    { wch: 20 }, // Дата и время
    { wch: 25 }, // Модель
    { wch: 15 }, // Цвет
    { wch: 12 }, // Количество
    { wch: 15 }, // ИП  ← ДОБАВИТЬ
    { wch: 20 }  // Сотрудник
];
            XLSX.utils.book_append_sheet(wb, wsRegular, 'Обычные');
        }
        
        if (coatData.length > 0) {
            const wsCoat = XLSX.utils.json_to_sheet(coatData);
            
            const cols = [
                { wch: 20 },
                { wch: 25 },
                { wch: 15 },
                { wch: 12 }
            ];
            
            for (let i = 1; i <= maxParts; i++) {
                cols.push({ wch: 20 });
                cols.push({ wch: 12 });
            }
            cols.push({ wch: 20 });
            
            wsCoat['!cols'] = cols;
            XLSX.utils.book_append_sheet(wb, wsCoat, 'Кофты');
        }
        
        if (regularData.length === 0 && coatData.length === 0) {
            return res.send('За эту смену нет данных для выгрузки');
        }
        
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        
        const dateStr = date || new Date().toISOString().split('T')[0];
        const shiftName = shift === 'day' ? 'day' : 'night';
        const fileName = `smena-${dateStr}-${shiftName}.xlsx`;
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        res.send(buffer);
        
    } catch (err) {
        console.error('Ошибка выгрузки Excel:', err);
        res.status(500).send('Ошибка при выгрузке: ' + err.message);
    }
});

// ========================================
//  УДАЛЕНИЕ СМЕНЫ
// ========================================

app.post('/admin/shifts/delete', async (req, res) => {
    try {
        let { date, shift } = req.body;
        
        if (date && typeof date === 'string' && date.includes(',')) {
            date = date.split(',')[0];
        }
        if (Array.isArray(date)) {
            date = date[0];
        }
        if (Array.isArray(shift)) {
            shift = shift[0];
        }
        if (shift && typeof shift === 'string' && shift.includes(',')) {
            shift = shift.split(',')[0];
        }

        if (!date || date === '' || date === 'undefined' || date === 'null') {
            return res.status(400).send('❌ Ошибка: дата не указана');
        }

        const selectedDate = new Date(date);
        
        if (isNaN(selectedDate.getTime())) {
            return res.status(400).send(`❌ Ошибка: неверный формат даты: ${date}`);
        }

        let startDate, endDate;
        
        if (shift === 'day') {
            startDate = new Date(selectedDate);
            startDate.setHours(8, 0, 0, 0);
            endDate = new Date(selectedDate);
            endDate.setHours(20, 0, 0, 0);
        } else if (shift === 'night') {
            startDate = new Date(selectedDate);
            startDate.setHours(20, 0, 0, 0);
            endDate = new Date(selectedDate);
            endDate.setDate(endDate.getDate() + 1);
            endDate.setHours(8, 0, 0, 0);
        } else {
            startDate = new Date(selectedDate);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(selectedDate);
            endDate.setHours(23, 59, 59, 999);
        }

        const whereClause = {
            createdAt: {
                [Op.gte]: startDate,
                [Op.lt]: endDate
            }
        };
        
        const deleted = await Operation.destroy({ where: whereClause });
        
        console.log(`🗑️ Удалено ${deleted} операций за ${date} (${shift || 'весь день'})`);
        res.redirect('/admin/shifts');
        
    } catch (err) {
        console.error('❌ Ошибка удаления смены:', err);
        res.status(500).send('Ошибка при удалении смены: ' + err.message);
    }
});

// ========================================
//  КАБИНЕТ ВЯЗАЛЬЩИКА
// ========================================

app.get('/worker', async (req, res) => {
    try {
        const tasks = await Task.findAll({
            where: { 
                status: ['pending', 'in_progress']
            },
            include: [
                { model: Model },
                { model: Color },
                { model: Operation, as: 'operations' },
                { 
                    model: Task, 
                    as: 'parts',
                    include: [
                        { model: Model },
                        { model: Color },
                        { model: Operation, as: 'operations' }
                    ]
                }
            ],
            order: [
                ['isUrgent', 'DESC'],
                ['createdAt', 'ASC']
            ]
        });

        const shapkiTasks = [];
        const coatTasks = [];

        tasks.forEach(task => {
            if (task.isCoat) {
                coatTasks.push(task);
            } else if (!task.isPart) {
                shapkiTasks.push(task);
            }
        });

        res.render('worker/dashboard', {
            shapkiTasks,
            coatTasks,
            user: { fullName: req.user ? req.user.fullName : 'Вязальщик' }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка сервера');
    }
});

// ========================================
//  API: СПРАВОЧНИКИ
// ========================================

app.get('/api/models', async (req, res) => {
    const models = await Model.findAll({
        include: [{ model: ModelPart, as: 'parts' }]
    });
    res.json(models);
});

app.get('/api/colors', async (req, res) => {
    res.json(await Color.findAll());
});

// ========================================
//  API: СОЗДАНИЕ ЗАДАНИЯ
// ========================================

app.post('/api/tasks', async (req, res) => {
    const { modelId, colorId, isUrgent, ip } = req.body;
    try {
        const model = await Model.findByPk(modelId, {
            include: [{ model: ModelPart, as: 'parts' }]
        });
        if (!model) {
            return res.status(404).json({ error: 'Модель не найдена' });
        }

        if (model.isCoat && model.parts && model.parts.length > 0) {
            const partsQuantities = {};
            let totalPlan = 0;
            
            for (const part of model.parts) {
                const quantity = parseInt(req.body[`part_${part.id}`]) || 0;
                if (quantity > 0) {
                    partsQuantities[part.id] = quantity;
                    totalPlan += quantity;
                }
            }
            
            if (Object.keys(partsQuantities).length === 0) {
                return res.status(400).json({ error: 'Укажите количество хотя бы для одной детали' });
            }

            const coat = await Task.create({
                modelId: model.id,
                colorId: colorId,
                planQuantity: totalPlan,
                isUrgent: isUrgent === 'on',
                status: 'pending',
                ip: ip || null,
                isCoat: true,
                isPart: false,
                partName: null,
                parentTaskId: null
            });

            for (const part of model.parts) {
                const quantity = parseInt(req.body[`part_${part.id}`]) || 0;
                if (quantity > 0) {
                    await Task.create({
                        modelId: model.id,
                        colorId: colorId,
                        planQuantity: quantity,
                        isUrgent: isUrgent === 'on',
                        status: 'pending',
                        ip: ip || null,
                        isCoat: false,
                        isPart: true,
                        partName: part.partName,
                        parentTaskId: coat.id
                    });
                }
            }

            io.emit('newTask', coat);
            // ✅ ОТПРАВКА УВЕДОМЛЕНИЯ
if (bot) {
    try {
        const color = colorId ? await Color.findByPk(colorId) : null;
        await notifyAboutNewTask(coat, model, color, ip);
    } catch (e) { console.error('Ошибка уведомления:', e); }
}
            res.redirect('/admin');
        } else {
            const planQuantity = parseInt(req.body.planQuantity);
            if (!planQuantity || planQuantity <= 0) {
                return res.status(400).json({ error: 'Укажите количество' });
            }
            
            const task = await Task.create({
                modelId: model.id,
                colorId: colorId,
                planQuantity: planQuantity,
                isUrgent: isUrgent === 'on',
                status: 'pending',
                ip: ip || null,
                isCoat: false,
                isPart: false,
                partName: null,
                parentTaskId: null            });
            io.emit('newTask', task);
            // ✅ ОТПРАВКА УВЕДОМЛЕНИЯ
if (bot) {
    try {
        const color = colorId ? await Color.findByPk(colorId) : null;
        await notifyAboutNewTask(task, model, color, ip);
    } catch (e) { console.error('Ошибка уведомления:', e); }
}
            res.redirect('/admin');
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка при создании задания' });
    }
});

// ========================================
//  API: ВВОД ВЫРАБОТКИ (ИСПРАВЛЕННЫЙ)
// ========================================

app.post('/api/operations', async (req, res) => {
    const { taskId, machineId, quantity, partId } = req.body;
    console.log('📥 Получена выработка:', { taskId, machineId, quantity, partId });
    
    try {
        // ========================================
        // 1. ОПРЕДЕЛЯЕМ, ДЛЯ КАКОГО ЗАДАНИЯ СОХРАНЯТЬ ОПЕРАЦИЮ
        // ========================================
        let targetTaskId = parseInt(taskId);
        let isPart = false;
        let partName = null;
        
        // Если передан partId - значит это деталь кофты
        if (partId) {
            // Находим задание-деталь по partId
            const partTask = await Task.findOne({
                where: { 
                    id: parseInt(partId),
                    isPart: true
                }
            });
            
            if (partTask) {
                targetTaskId = partTask.id; // ← Сохраняем операцию для детали!
                isPart = true;
                partName = partTask.partName;
                console.log('🔍 Это деталь кофты, используем taskId:', targetTaskId);
            } else {
                console.log('⚠️ Деталь с ID', partId, 'не найдена');
            }
        }
        
        // ========================================
        // 2. НАХОДИМ ЗАДАНИЕ
        // ========================================
        const task = await Task.findByPk(targetTaskId, {
            include: [
                { model: Model },
                { model: Color }
            ]
        });
        
        if (!task) {
            console.log('❌ Задание не найдено:', targetTaskId);
            return res.status(404).json({ error: 'Задание не найдено' });
        }
        
        console.log('📋 Найдено задание:', {
            id: task.id,
            isPart: task.isPart,
            partName: task.partName,
            parentTaskId: task.parentTaskId
        });

        // ========================================
        // 3. СОЗДАЁМ ОПЕРАЦИЮ
        // ========================================
        const operation = await Operation.create({
            taskId: targetTaskId, // ← Правильный ID!
            employeeId: req.user ? req.user.id : 1,
            machineId: parseInt(machineId),
            quantity: parseInt(quantity),
            colorName: task.Color ? task.Color.name : null,
            modelName: task.Model ? task.Model.name : null,
            partName: task.partName || null
        });
        
        console.log('✅ Операция создана:', operation.id);

        // ========================================
        // 4. ОБНОВЛЯЕМ doneQuantity У ДЕТАЛИ
        // ========================================
        const partOps = await Operation.findAll({ where: { taskId: targetTaskId } });
        const partTotalDone = partOps.reduce((sum, op) => sum + op.quantity, 0);
        await task.update({ doneQuantity: partTotalDone });
        console.log('📊 Обновлён doneQuantity детали:', partTotalDone);

        // ========================================
        // 5. ЕСЛИ ЭТО ДЕТАЛЬ - ОБНОВЛЯЕМ РОДИТЕЛЬСКУЮ КОФТУ
        // ========================================
        let parentProgress = null;
        let coatTotalDone = 0;
        let coatTotalPlan = 0;
        
        if (task.isPart && task.parentTaskId) {
            const parent = await Task.findByPk(task.parentTaskId, {
                include: [{ model: Task, as: 'parts' }]
            });
            
            if (parent) {
                console.log('🧥 Обновляем родительскую кофту:', parent.id);
                
                // Пересчитываем все детали
                for (const part of parent.parts) {
                    const partOps2 = await Operation.findAll({ where: { taskId: part.id } });
                    const partDone = partOps2.reduce((sum, op) => sum + op.quantity, 0);
                    await part.update({ doneQuantity: partDone });
                    
                    coatTotalDone += Math.min(partDone, part.planQuantity);
                    coatTotalPlan += part.planQuantity;
                    
                    console.log(`   Деталь ${part.id}: ${partDone}/${part.planQuantity}`);
                }
                
                // Обновляем родительскую кофту
                await parent.update({ doneQuantity: coatTotalDone });
                
                const parentPercent = coatTotalPlan > 0 ? Math.min((coatTotalDone / coatTotalPlan) * 100, 100) : 0;
                
                parentProgress = {
                    coatId: parent.id,
                    totalDone: coatTotalDone,
                    totalPlan: coatTotalPlan,
                    percent: parentPercent
                };
                
                console.log('📊 Общий прогресс кофты:', parentProgress);
            }
        }

        // ========================================
        // 6. ОТВЕТ
        // ========================================
        const allOps = await Operation.findAll({ where: { taskId: targetTaskId } });
        const totalDone = allOps.reduce((sum, op) => sum + op.quantity, 0);
        const percent = task.planQuantity > 0 ? Math.min((totalDone / task.planQuantity) * 100, 100) : 0;
        
        res.json({
            success: true,
            operationId: operation.id,
            quantity: quantity,
            totalDone: totalDone,
            percent: percent,
            planQuantity: task.planQuantity,
            machineId: machineId,
            isPart: task.isPart,
            partName: task.partName,
            parentProgress: parentProgress
        });
        
    } catch (err) {
        console.error('❌ Ошибка при сохранении выработки:', err);
        res.status(500).json({ error: 'Ошибка при сохранении' });
    }
});

// ========================================
//  API: ОТПРАВИТЬ АДМИНУ (ДЛЯ КОФТ И ШАПОК)
// ========================================

app.post('/api/tasks/complete/:taskId', async (req, res) => {
    const { taskId } = req.params;
    try {
        const task = await Task.findByPk(taskId, {
            include: [
                { model: Task, as: 'parts' }
            ]
        });
        
        if (!task) {
            return res.status(404).json({ error: 'Задание не найдено' });
        }

        // ========================================
        // ПРОВЕРЯЕМ ВЫПОЛНЕНИЕ
        // ========================================
        let isCompleted = false;
        
        if (task.isCoat && task.parts && task.parts.length > 0) {
            // Для кофты - проверяем все детали
            let allPartsDone = true;
            let totalDone = 0;
            let totalPlan = 0;
            
            for (const part of task.parts) {
                const ops = await Operation.findAll({ where: { taskId: part.id } });
                const partDone = ops.reduce((sum, op) => sum + op.quantity, 0);
                await part.update({ doneQuantity: partDone });
                
                totalDone += Math.min(partDone, part.planQuantity);
                totalPlan += part.planQuantity;
                
                if (partDone < part.planQuantity) {
                    allPartsDone = false;
                }
            }
            
            await task.update({ doneQuantity: totalDone });
            isCompleted = allPartsDone && totalPlan > 0;
            
        } else {
            // Для шапки - проверяем doneQuantity
            const ops = await Operation.findAll({ where: { taskId } });
            const totalDone = ops.reduce((sum, op) => sum + op.quantity, 0);
            await task.update({ doneQuantity: totalDone });
            isCompleted = totalDone >= task.planQuantity;
        }

        if (!isCompleted) {
            return res.status(400).json({ 
                error: '❌ Задание не выполнено полностью!' 
            });
        }

        await task.update({ status: 'completed' });
        io.emit('taskCompleted', task);
        console.log(`✅ Задание ${task.id} отправлено админу!`);

        res.json({ success: true });
        
    } catch (err) {
        console.error('❌ Ошибка при отправке:', err);
        res.status(500).json({ error: 'Ошибка при отправке' });
    }
});

// ========================================
//  API: ПОЛУЧИТЬ ОПЕРАЦИИ (ДЛЯ МАШИНОК В РАБОТЕ)
// ========================================

app.get('/api/operations/recent', async (req, res) => {
    try {
        const operations = await Operation.findAll({
            include: [
                { 
                    model: Task,
                    include: [
                        { model: Model }
                    ]
                },
                { model: Machine, as: 'machine' }
            ],
            order: [['createdAt', 'DESC']],
            limit: 100
        });
        res.json(operations);
    } catch (err) {
        console.error('❌ Ошибка загрузки операций:', err);
        res.status(500).json({ error: 'Ошибка загрузки' });
    }
});
// ========================================
//  API: ОТМЕНА ОПЕРАЦИИ (С ЛОГАМИ)
// ========================================

app.post('/api/operations/undo/:taskId', async (req, res) => {
    const { taskId } = req.params;
    console.log('========================================');
    console.log('🗑️ ПОЛУЧЕН ЗАПРОС НА ОТМЕНУ');
    console.log('📌 ID задания:', taskId);
    
    try {
        // Находим последнюю операцию для этого задания
        const operation = await Operation.findOne({
            where: { taskId: parseInt(taskId) },
            order: [['createdAt', 'DESC']]
        });
        
        if (!operation) {
            console.log('❌ Операций для этого задания не найдено');
            console.log('========================================');
            return res.status(404).json({ error: 'Нет операций для отмены' });
        }
        
        console.log('📋 Найдена операция:');
        console.log('   ID:', operation.id);
        console.log('   Количество:', operation.quantity);
        console.log('   Дата:', operation.createdAt);
        
        // Удаляем операцию
        await operation.destroy();
        console.log('✅ Операция удалена');
        
        // Обновляем doneQuantity у задания
        const task = await Task.findByPk(taskId);
        if (task) {
            const ops = await Operation.findAll({ where: { taskId } });
            const totalDone = ops.reduce((sum, op) => sum + op.quantity, 0);
            await task.update({ doneQuantity: totalDone });
            console.log('✅ Обновлён doneQuantity:', totalDone);
        }
        
        console.log('✅ ОТМЕНА УСПЕШНО ЗАВЕРШЕНА');
        console.log('========================================');
        res.json({ success: true });
        
    } catch (err) {
        console.error('❌ ОШИБКА:', err);
        console.log('========================================');
        res.status(500).json({ error: 'Ошибка при отмене: ' + err.message });
    }
});

// ========================================
//  API: ПОЛУЧИТЬ ДАННЫЕ ДЛЯ РЕДАКТИРОВАНИЯ
// ========================================

app.get('/api/tasks/:taskId/edit-data', async (req, res) => {
    const { taskId } = req.params;
    try {
        const task = await Task.findByPk(taskId, {
            include: [
                { model: Model },
                { model: Color },
                { model: Operation, as: 'operations' },
                { 
                    model: Task, 
                    as: 'parts',
                    include: [
                        { model: Model },
                        { model: Operation, as: 'operations' }
                    ]
                }
            ]
        });
        
        if (!task) {
            return res.status(404).json({ success: false, error: 'Задание не найдено' });
        }
        
        let totalDone = 0;
        let totalPlan = task.planQuantity || 0;
        
        if (task.isCoat && task.parts && task.parts.length > 0) {
            totalPlan = 0;
            totalDone = 0;
            for (const part of task.parts) {
                const ops = part.operations || [];
                const done = ops.reduce((sum, op) => sum + op.quantity, 0);
                totalDone += Math.min(done, part.planQuantity);
                totalPlan += part.planQuantity;
            }
        } else {
            const ops = task.operations || [];
            totalDone = ops.reduce((sum, op) => sum + op.quantity, 0);
        }
        
        res.json({
            success: true,
            task: task,
            totalDone: totalDone,
            totalPlan: totalPlan
        });
        
    } catch (err) {
        console.error('❌ Ошибка загрузки данных для редактирования:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ========================================
//  API: СОХРАНИТЬ ИЗМЕНЕНИЯ ЗАДАНИЯ (С ЛОГАМИ)
// ========================================

app.post('/api/tasks/edit/:id', async (req, res) => {
    const { id } = req.params;
    const { quantity, doneQuantity, status, parts } = req.body;
    
    console.log('========================================');
    console.log('📥 ПОЛУЧЕН ЗАПРОС НА РЕДАКТИРОВАНИЕ');
    console.log('📌 ID задания:', id);
    console.log('📦 Полученные данные:', { quantity, doneQuantity, status, parts });
    
    try {
        const task = await Task.findByPk(id, {
            include: [
                { model: Task, as: 'parts' }
            ]
        });
        
        if (!task) {
            console.log('❌ Задание не найдено!');
            return res.status(404).json({ success: false, error: 'Задание не найдено' });
        }
        
        console.log('📋 Текущее состояние задания:');
        console.log('   planQuantity:', task.planQuantity);
        console.log('   doneQuantity:', task.doneQuantity);
        console.log('   status:', task.status);
        console.log('   isCoat:', task.isCoat);
        
        if (status) {
            console.log('🔄 Меняем статус на:', status);
            await task.update({ status: status });
        }
        
        if (task.isCoat && task.parts && task.parts.length > 0) {
            console.log('🧥 ЭТО КОФТА, деталей:', task.parts.length);
            let totalPlan = 0;
            let totalDone = 0;
            
            for (const part of task.parts) {
                const newPlan = parseInt(parts[`part_${part.id}_plan`]) || 0;
                const newDone = parseInt(parts[`part_${part.id}_done`]) || 0;
                
                console.log(`   Деталь ${part.partName || part.id}:`);
                console.log(`      новый план: ${newPlan}, старый: ${part.planQuantity}`);
                console.log(`      новое связано: ${newDone}, старое: ${part.doneQuantity || 0}`);
                
                if (newPlan >= 0) {
                    await part.update({ planQuantity: newPlan });
                    totalPlan += newPlan;
                }
                
                if (newDone >= 0) {
                    await part.update({ doneQuantity: newDone });
                    totalDone += newDone;
                }
            }
            
            console.log('📊 Итог по кофте:');
            console.log('   totalPlan:', totalPlan);
            console.log('   totalDone:', totalDone);
            
            await task.update({ 
                planQuantity: totalPlan,
                doneQuantity: totalDone
            });
            
        } else {
            console.log('🧢 ЭТО ШАПКА');
            console.log('   Новый план:', quantity, 'старый:', task.planQuantity);
            console.log('   Новое связано:', doneQuantity, 'старое:', task.doneQuantity || 0);
            
            if (quantity !== undefined && quantity >= 0) {
                await task.update({ planQuantity: parseInt(quantity) });
            }
            
            if (doneQuantity !== undefined && doneQuantity >= 0) {
                await task.update({ doneQuantity: parseInt(doneQuantity) });
            }
        }
        
        const updatedTask = await Task.findByPk(id);
        console.log('✅ ПОСЛЕ СОХРАНЕНИЯ:');
        console.log('   planQuantity:', updatedTask.planQuantity);
        console.log('   doneQuantity:', updatedTask.doneQuantity);
        console.log('   status:', updatedTask.status);
        console.log('========================================');
        
        res.json({ success: true });
        
    } catch (err) {
        console.error('❌ ОШИБКА:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ========================================
//  ИНИЦИАЛИЗАЦИЯ БОТА
// ========================================

const { Telegraf } = require('telegraf');
const cron = require('node-cron');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
let bot = null;

if (TELEGRAM_BOT_TOKEN) {
    bot = new Telegraf(TELEGRAM_BOT_TOKEN);
    console.log('🤖 Telegram бот инициализирован');
} else {
    console.log('⚠️ TELEGRAM_BOT_TOKEN не задан, бот не запущен');
}

// ========================================
//  ГЛОБАЛЬНЫЕ СОСТОЯНИЯ
// ========================================

const linkState = {};
const roleState = {};
const roleTempData = {};
const notificationState = {};

// ========================================
//  ФУНКЦИИ УВЕДОМЛЕНИЙ (ДОСТУПНЫ ВЕЗДЕ)
// ========================================

async function notifyActiveUsers(message, taskId) {
    console.log('📨 notifyActiveUsers вызвана');
    
    if (!bot) {
        console.log('❌ Бот не инициализирован');
        return 0;
    }
    
    try {
        console.log('🔍 Ищем активных пользователей...');
        
        const users = await User.findAll({
            where: {
                telegramId: { [Op.not]: null },
                isActive: true
            }
        });
        
        console.log(`🔍 Найдено активных пользователей: ${users ? users.length : 0}`);
        
        if (!users || users.length === 0) {
            console.log('⚠️ Нет активных пользователей для уведомления');
            return 0;
        }
        
        users.forEach(u => {
            console.log(`   👤 ${u.login} (${u.fullName}) — telegramId: ${u.telegramId}`);
        });
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: [[{ text: '✅ Прочитал', callback_data: `dismiss_${taskId}` }]]
            }
        };
        
        let sent = 0;
        for (const u of users) {
            try {
                await bot.telegram.sendMessage(u.telegramId, message, { parse_mode: 'Markdown', ...keyboard });
                sent++;
            } catch (e) {
                console.error(`❌ ${u.login}:`, e.message);
            }
        }
        return sent;
    } catch (err) {
        console.error('Ошибка уведомления пользователей:', err);
        return 0;
    }
}

async function notifyAdmins(message, taskId) {
    if (!bot) return 0;
    try {
        const admins = await User.findAll({
            where: {
                role: 'admin',
                telegramId: { [Op.not]: null },
                isActive: true
            }
        });
        if (!admins || admins.length === 0) return 0;
        const keyboard = {
            reply_markup: {
                inline_keyboard: [[{ text: '✅ Прочитал', callback_data: `dismiss_${taskId}` }]]
            }
        };
        let sent = 0;
        for (const a of admins) {
            try {
                await bot.telegram.sendMessage(a.telegramId, message, { parse_mode: 'Markdown', ...keyboard });
                sent++;
            } catch (e) {
                console.error(`❌ ${a.login}:`, e.message);
            }
        }
        return sent;
    } catch (err) {
        console.error('Ошибка уведомления админов:', err);
        return 0;
    }
}

async function notifyBosses(message) {
    if (!bot) return 0;
    try {
        const bosses = await User.findAll({
            where: {
                role: 'boss',
                telegramId: { [Op.not]: null },
                isActive: true
            }
        });
        if (!bosses || bosses.length === 0) return 0;
        let sent = 0;
        for (const b of bosses) {
            try {
                await bot.telegram.sendMessage(b.telegramId, message, { parse_mode: 'Markdown' });
                sent++;
            } catch (e) {
                console.error(`❌ ${b.login}:`, e.message);
            }
        }
        return sent;
    } catch (err) {
        console.error('Ошибка уведомления начальства:', err);
        return 0;
    }
}

async function notifyAboutNewTask(task, model, color, ip) {
    console.log('🔔🔔🔔 notifyAboutNewTask ВЫЗВАНА!');
    console.log('   Заказ #:', task?.id);
    console.log('   Модель:', model?.name);
    console.log('   bot существует?', bot ? 'ДА' : 'НЕТ');
    
    if (!bot) {
        console.log('❌ Бот не инициализирован');
        return;
    }
    
    const modelName = model?.name || 'Неизвестная модель';
    const colorName = color?.name || '—';
    const quantity = task.planQuantity || 0;
    const taskId = task.id;
    const urgent = task.isUrgent ? ' 🔥 СРОЧНО!' : '';
    
    const message = `
🆕 *НОВЫЙ ЗАКАЗ!*${urgent}

📦 Модель: *${modelName}*
🎨 Цвет: ${colorName}
📊 Количество: ${quantity} шт.
🏢 ИП: ${ip || '—'}
🆔 ID заказа: #${taskId}

👆 Зайдите на сайт, чтобы начать работу.
    `;
    
    await notifyActiveUsers(message, taskId);
}

async function notifyAdminAboutCompletion(task, employeeName) {
    if (!bot) return;
    
    console.log('🔔🔔🔔 notifyAdminAboutCompletion ВЫЗВАНА!');
    console.log('   Заказ #:', task?.id);
    console.log('   Модель:', task?.Model?.name);
    
    const modelName = task.Model?.name || 'Неизвестная модель';
    const colorName = task.Color?.name || '—';
    const quantity = task.planQuantity || 0;
    const taskId = task.id;
    
    const message = `
✅ *ЗАКАЗ ВЫПОЛНЕН!*

📦 Модель: *${modelName}*
🎨 Цвет: ${colorName}
📊 Количество: ${quantity} шт.
🧵 Вязальщик: ${employeeName || 'Неизвестен'}
🆔 ID заказа: #${taskId}

📌 Статус: Готов к проверке
    `;
    
    await notifyAdmins(message, taskId);
}

async function generateShiftReport(date, shift) {
    try {
        const now = new Date();
        const startDate = new Date(now);
        startDate.setHours(now.getHours() - 24, 0, 0, 0);
        const endDate = new Date(now);

        const ops = await Operation.findAll({
            where: { createdAt: { [Op.gte]: startDate, [Op.lt]: endDate } },
            include: [
                { model: User, as: 'employee' },
                { model: Machine, as: 'machine' },
                { 
                    model: Task, 
                    include: [
                        { model: Model },
                        { model: Color }
                    ] 
                }
            ]
        });

        if (!ops || ops.length === 0) {
            return `📊 За последние 24 часа данных нет.`;
        }

        // ========================================
        // 1. КТО РАБОТАЛ (сотрудники)
        // ========================================
        const employees = {};
        for (const op of ops) {
            const name = op.employee?.fullName || 'Неизвестный';
            if (!employees[name]) {
                employees[name] = {
                    total: 0,
                    machines: new Set()
                };
            }
            employees[name].total += op.quantity;
            if (op.machine) {
                employees[name].machines.add(op.machine.machineNumber);
            }
        }

        // ========================================
        // 2. ЗАКАЗЫ ПО МАШИНКАМ
        // ========================================
        const machines = {};
        const coatOrders = {};

        for (const op of ops) {
            const task = op.Task;
            const model = task?.Model;
            const color = task?.Color;
            
            if (!model) continue;

            const machineNum = op.machine?.machineNumber || '?';
            const className = model.className || '—';
            const modelName = model.name || '—';
            const quantity = op.quantity;
            const isCoat = model.isCoat || false;
            const partName = op.partName || null;
            const size = model.size || '—';
            const colorName = color?.name || '—';

            if (isCoat) {
                const key = `${modelName} (${size}) — ${colorName}`;
                if (!coatOrders[key]) {
                    coatOrders[key] = {
                        modelName: modelName,
                        size: size,
                        color: colorName,
                        parts: {}
                    };
                }
                const partKey = partName || 'Деталь';
                if (!coatOrders[key].parts[partKey]) {
                    coatOrders[key].parts[partKey] = 0;
                }
                coatOrders[key].parts[partKey] += quantity;
                continue;
            }

            const machineKey = `№${machineNum} (Класс ${className})`;
            if (!machines[machineKey]) {
                machines[machineKey] = {};
            }
            const orderKey = `${modelName} (${colorName})`;
            if (!machines[machineKey][orderKey]) {
                machines[machineKey][orderKey] = 0;
            }
            machines[machineKey][orderKey] += quantity;
        }

        // ========================================
        // 3. ФОРМИРУЕМ ОТЧЁТ
        // ========================================
        let report = `📊 *ОТЧЁТ ЗА СМЕНУ*\n`;
        report += `${new Date(startDate).toLocaleDateString('ru-RU')} ${new Date(startDate).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} — ${new Date(endDate).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}\n`;
        report += `━━━━━━━━━━━━━━━━━━\n\n`;

        // БЛОК 1: КТО РАБОТАЛ
        report += `👥 *СОТРУДНИКИ*\n`;
        const sortedEmployees = Object.entries(employees).sort((a, b) => b[1].total - a[1].total);
        for (const [name, data] of sortedEmployees) {
            const machinesList = Array.from(data.machines).sort((a, b) => a - b).join(', ');
            report += `   ${name} — ${data.total} шт. (машины: ${machinesList || '—'})\n`;
        }
        report += `\n`;

        // БЛОК 2: ЗАКАЗЫ ПО МАШИНКАМ
        if (Object.keys(machines).length > 0) {
            report += `🖥️ *ЗАКАЗЫ ПО МАШИНКАМ*\n`;
            const sortedMachines = Object.keys(machines).sort();
            for (const machine of sortedMachines) {
                const models = machines[machine];
                for (const [orderKey, qty] of Object.entries(models)) {
                    report += `   ${machine} — ${orderKey}: ${qty} шт.\n`;
                }
            }
            report += `\n`;
        }

        // БЛОК 3: КОФТЫ
        if (Object.keys(coatOrders).length > 0) {
            report += `👕 *КОФТЫ*\n`;
            for (const [key, data] of Object.entries(coatOrders)) {
                report += `   ${data.modelName} (${data.size}) — ${data.color}\n`;
                for (const [partName, qty] of Object.entries(data.parts)) {
                    report += `      ${partName}: ${qty} шт.\n`;
                }
            }
            report += `\n`;
        }

        const totalQuantity = Object.values(employees).reduce((sum, e) => sum + e.total, 0);
        report += `━━━━━━━━━━━━━━━━━━\n`;
        report += `📊 *ИТОГО:* ${totalQuantity} шт.`;

        return report;
    } catch (err) {
        console.error('Ошибка генерации отчёта:', err);
        return '❌ Ошибка при формировании отчёта';
    }
}

// ========================================
//  ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ========================================

function getRoleDisplay(role) {
    const roleMap = {
        'bot_admin': '🤖 Главный админ бота',
        'admin': '👑 Администратор сайта',
        'boss': '💼 Начальство',
        'worker': '🧵 Вязальщик'
    };
    return roleMap[role] || role;
}

function getRecipientName(recipient) {
    const names = {
        'workers': '👥 Вязальщики',
        'admins': '👑 Админы сайта',
        'bosses': '💼 Начальство',
        'all': '📢 Все пользователи'
    };
    return names[recipient] || recipient;
}

function hasAccess(user, allowedRoles) {
    if (!user) return false;
    if (user.role === 'bot_admin') return true;
    return allowedRoles.includes(user.role);
}

// ========================================
//  ВЕСЬ КОД БОТА
// ========================================

if (bot) {
    // ========================================
    //  КЛАВИАТУРЫ
    // ========================================

    const mainKeyboard = {
        reply_markup: {
            keyboard: [
                ['📋 Мои задания', '📊 Статистика'],
                ['🔗 Привязать аккаунт', '🔧 Настройки'],
                ['🟢 Отдыхаю', '🚪 Выйти']
            ],
            resize_keyboard: true
        }
    };

    const settingsKeyboard = {
        reply_markup: {
            keyboard: [
                ['👥 Все пользователи'],
                ['👤 Дать роль', '👤 Снять роль'],
                ['👤 Управление статусами'],
                ['📢 Отправить уведомление'],
                ['📊 Тест отчёта'],
                ['🔙 В главное меню']
            ],
            resize_keyboard: true
        }
    };

    // ========================================
    //  ОТПРАВКА СООБЩЕНИЯ С КНОПКОЙ "ЗАКРЫТЬ"
    // ========================================

    async function sendDismissibleMessage(ctx, text, options = {}) {
        const dismissKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🗑️ Закрыть', callback_data: 'dismiss_message' }]
                ]
            }
        };
        
        try {
            await ctx.reply(text, {
                parse_mode: 'Markdown',
                ...dismissKeyboard,
                ...options
            });
        } catch (err) {
            console.log('⚠️ Проблема с Markdown, отправка без форматирования');
            try {
                await ctx.reply(text, {
                    ...dismissKeyboard,
                    ...options
                });
            } catch (e) {
                console.error('❌ Ошибка отправки:', e);
            }
        }
    }

    // ========================================
    //  УДАЛЕНИЕ КОМАНД И ТЕКСТА КНОПОК
    // ========================================

    bot.use(async (ctx, next) => {
        const text = ctx.message?.text;
        
        const buttonTexts = [
            '📋 Мои задания', '📊 Статистика', '🔗 Привязать аккаунт',
            '🔧 Настройки', '🚪 Выйти', '👥 Все пользователи',
            '👤 Дать роль', '👤 Снять роль', '👤 Управление статусами',
            '📢 Отправить уведомление', '📊 Тест отчёта',
            '🔙 В главное меню', '🟢 Отдыхаю', '🔴 На работе'
        ];
        
        const isCommand = text?.startsWith('/');
        const isButtonText = buttonTexts.includes(text);
        
        await next();
        
        if ((isCommand || isButtonText) && ctx.message) {
            try {
                await ctx.deleteMessage().catch(() => {});
            } catch (err) {}
        }
    });

    // ========================================
    //  ГЛОБАЛЬНЫЙ ОБРАБОТЧИК ОШИБОК
    // ========================================

    bot.catch((err, ctx) => {
        console.error('❌ Ошибка бота:', err);
        ctx.reply('⚠️ Произошла ошибка. Попробуйте позже.')
            .catch(() => {});
    });

    // ========================================
    //  ОБРАБОТКА КНОПКИ "🗑️ Закрыть"
    // ========================================

    bot.action('dismiss_message', async (ctx) => {
        try {
            await ctx.deleteMessage();
        } catch (err) {}
        try {
            await ctx.answerCbQuery('🗑️ Сообщение удалено');
        } catch (err) {}
    });

    bot.action(/dismiss_(.+)/, async (ctx) => {
        const taskId = ctx.match[1];
        try {
            await ctx.deleteMessage();
            console.log(`🗑️ Сообщение о задании #${taskId} удалено у ${ctx.chat.id}`);
        } catch (err) {}
        try {
            await ctx.answerCbQuery('✅ Сообщение удалено');
        } catch (err) {}
    });

    // ========================================
    //  /start — ГЛАВНОЕ МЕНЮ
    // ========================================

    bot.start(async (ctx) => {
        const name = ctx.from.first_name || 'Вязальщик';
        const userId = String(ctx.from.id);
        
        const user = await User.findOne({ where: { telegramId: userId } });
        
        let status = '';
        let keyboard = mainKeyboard;
        let statusText = '';
        
        if (user) {
            status = `\n✅ Аккаунт привязан: *${user.login}* (${getRoleDisplay(user.role)})`;
            const isActive = user.isActive !== false;
            statusText = isActive ? '🟢 Отдыхаю' : '🔴 На работе';
            
            const statusButton = isActive ? '🟢 Отдыхаю' : '🔴 На работе';
            keyboard.reply_markup.keyboard[2] = [statusButton, '🚪 Выйти'];
        } else {
            status = '\n⚠️ Аккаунт не привязан. Нажмите "🔗 Привязать аккаунт"';
        }
        
        let greeting = `🧵 *Привет, ${name}!*\n\n`;
        greeting += `Я бот фабрики *Dika Knit*.\n`;
        greeting += status;
        if (user) {
            greeting += `\n📌 Статус: ${statusText}`;
        }
        greeting += '\n\nВыберите действие:';
        
        await ctx.reply(greeting, keyboard);
    });

    // ========================================
    //  /help — ПОМОЩЬ
    // ========================================

    bot.help(async (ctx) => {
        await sendDismissibleMessage(ctx, `
🤖 *Помощь по боту Dika Knit*

*Основные команды:*
/start — Главное меню
/help — Эта справка

*Кнопки:*
📋 Мои задания — Показать активные заказы
📊 Статистика — Общая статистика производства
🔗 Привязать аккаунт — Связать Telegram с сайтом
🔧 Настройки — Админ-панель бота
🟢 Отдыхаю / 🔴 На работе — Включить/выключить уведомления
🚪 Выйти — Отвязать аккаунт

*Для администраторов:*
👤 Дать роль — Назначить роль пользователю
👤 Снять роль — Снять роль с пользователя
👤 Управление статусами — Включить/выключить уведомления для пользователей
📢 Отправить уведомление — Рассылка
📊 Тест отчёта — Проверить отчёт за сегодня
        `);
    });

    // ========================================
    //  🟢 ОТДЫХАЮ / 🔴 НА РАБОТЕ
    // ========================================

    bot.hears(['🟢 Отдыхаю', '🔴 На работе'], async (ctx) => {
        const userId = String(ctx.from.id);
        const user = await User.findOne({ where: { telegramId: userId } });
        
        if (!user) {
            await sendDismissibleMessage(ctx, '❌ Вы не привязаны к аккаунту. Сначала нажмите "🔗 Привязать аккаунт".');
            return;
        }
        
        const currentStatus = user.isActive !== false;
        const newStatus = !currentStatus;
        
        await user.update({ isActive: newStatus });
        
        const statusText = newStatus ? '🟢 Отдыхаю' : '🔴 На работе';
        const message = newStatus 
            ? '✅ Статус изменён: *Отдыхаю*\n\nВы больше не будете получать уведомления о новых заказах.\nЧтобы снова получать уведомления — нажмите "🟢 На работе".'
            : '🔴 Статус изменён: *На работе*\n\nВы будете получать уведомления.';
        
        await sendDismissibleMessage(ctx, message);
        
        const keyboard = {
            reply_markup: {
                keyboard: [
                    ['📋 Мои задания', '📊 Статистика'],
                    ['🔗 Привязать аккаунт', '🔧 Настройки'],
                    [statusText, '🚪 Выйти']
                ],
                resize_keyboard: true
            }
        };
        
        await ctx.reply('🏠 *Главное меню*', keyboard);
    });

    // ========================================
    //  🔗 ПРИВЯЗАТЬ АККАУНТ
    // ========================================

    bot.hears('🔗 Привязать аккаунт', async (ctx) => {
        const userId = String(ctx.from.id);
        
        const users = await User.findAll({
            where: {
                telegramId: null
            },
            order: [['fullName', 'ASC']]
        });
        
        if (!users || users.length === 0) {
            await sendDismissibleMessage(ctx, '📭 Нет доступных пользователей для привязки.\n\nВсе пользователи уже привязаны к Telegram.');
            return;
        }
        
        linkState[userId] = { step: 'select_user', targetUserId: null };
        
        const userButtons = users.map(u => {
            return [{ text: `${u.fullName || u.login} (${u.login})`, callback_data: `link_user_${u.id}` }];
        });
        
        userButtons.push([{ text: '❌ Отмена', callback_data: 'link_cancel' }]);
        
        await ctx.reply('👤 *Выберите пользователя для привязки к Telegram:*', {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: userButtons
            }
        });
    });

    // ========================================
    //  ОБРАБОТКА ВЫБОРА ПОЛЬЗОВАТЕЛЯ ДЛЯ ПРИВЯЗКИ
    // ========================================

    bot.action(/link_user_(.+)/, async (ctx) => {
        const userId = String(ctx.from.id);
        const targetUserId = parseInt(ctx.match[1]);
        
        const targetUser = await User.findByPk(targetUserId);
        if (!targetUser) {
            await ctx.answerCbQuery('❌ Пользователь не найден');
            return;
        }
        
        linkState[userId] = {
            step: 'enter_password',
            targetUserId: targetUserId,
            targetLogin: targetUser.login,
            targetName: targetUser.fullName || targetUser.login
        };
        
        await ctx.editMessageText(`
🔐 *Введите пароль для пользователя:*

👤 ${targetUser.fullName || targetUser.login} (${targetUser.login})

Введите пароль текстовым сообщением.
        `, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '❌ Отмена', callback_data: 'link_cancel' }]
                ]
            }
        });
        
        await ctx.answerCbQuery();
    });

    // ========================================
    //  ОБРАБОТКА ОТМЕНЫ ПРИВЯЗКИ
    // ========================================

    bot.action('link_cancel', async (ctx) => {
        const userId = String(ctx.from.id);
        delete linkState[userId];
        await ctx.deleteMessage();
        await ctx.answerCbQuery('❌ Отменено');
    });

    // ========================================
    //  ОБРАБОТКА ТЕКСТА (ПРИВЯЗКА, РОЛИ, УВЕДОМЛЕНИЯ)
    // ========================================

    bot.on('text', async (ctx, next) => {
        const text = ctx.message.text;
        const userId = String(ctx.from.id);
        
        // Проверяем, не ждём ли мы ввод пароля для привязки
        const linkStateData = linkState[userId];
        if (linkStateData && linkStateData.step === 'enter_password') {
            const password = text.trim();
            
            if (!password) {
                await sendDismissibleMessage(ctx, '❌ Введите пароль.');
                return;
            }
            
            try {
                const targetUser = await User.findByPk(linkStateData.targetUserId);
                if (!targetUser) {
                    await sendDismissibleMessage(ctx, '❌ Пользователь не найден.');
                    delete linkState[userId];
                    return;
                }
                
                const isValid = await bcrypt.compare(password, targetUser.password);
                
                if (!isValid) {
                    await sendDismissibleMessage(ctx, '❌ Неверный пароль. Попробуйте снова.');
                    return;
                }
                
                const telegramId = String(ctx.from.id);
                await targetUser.update({ telegramId: telegramId });
                
                delete linkState[userId];
                
                await sendDismissibleMessage(ctx, `
✅ Аккаунт *${targetUser.login}* успешно привязан к Telegram!

👤 Пользователь: ${targetUser.fullName || targetUser.login}
📌 Роль: ${getRoleDisplay(targetUser.role)}
📌 Статус: ${targetUser.isActive !== false ? '🟢 Отдыхаю' : '🔴 На работе'}
                `);
                
                const isActive = targetUser.isActive !== false;
                const statusButton = isActive ? '🟢 Отдыхаю' : '🔴 На работе';
                const keyboard = {
                    reply_markup: {
                        keyboard: [
                            ['📋 Мои задания', '📊 Статистика'],
                            ['🔗 Привязать аккаунт', '🔧 Настройки'],
                            [statusButton, '🚪 Выйти']
                        ],
                        resize_keyboard: true
                    }
                };
                
                await ctx.reply('🏠 *Главное меню*\n\nВыберите действие:', keyboard);
                
            } catch (err) {
                console.error('Ошибка привязки:', err);
                await sendDismissibleMessage(ctx, '❌ Ошибка при привязке аккаунта. Попробуйте позже.');
                delete linkState[userId];
            }
            return;
        }
        
        // Проверяем, не ждём ли мы ввод для ролей
        if (roleState[userId]) {
            return await next();
        }
        
        // Проверяем, не ждём ли мы ввод для уведомлений
        if (notificationState[userId]) {
            return await next();
        }
        
        // Старый способ привязки (логин:пароль) — для совместимости
        if (text.includes(':')) {
            const parts = text.split(':');
            const login = parts[0].trim();
            const password = parts.slice(1).join(':').trim();
            
            if (!login || !password) {
                await sendDismissibleMessage(ctx, '❌ Неверный формат. Используйте: Логин:Пароль');
                return;
            }
            
            try {
                const user = await User.findOne({ where: { login } });
                
                if (!user) {
                    await sendDismissibleMessage(ctx, '❌ Пользователь с таким логином не найден.');
                    return;
                }
                
                const isValid = await bcrypt.compare(password, user.password);
                
                if (!isValid) {
                    await sendDismissibleMessage(ctx, '❌ Неверный пароль.');
                    return;
                }
                
                const telegramId = String(ctx.from.id);
                await user.update({ telegramId: telegramId });
                
                await sendDismissibleMessage(ctx, `✅ Аккаунт ${login} успешно привязан к Telegram!`);
                
            } catch (err) {
                console.error('Ошибка привязки:', err);
                await sendDismissibleMessage(ctx, '❌ Ошибка при привязке аккаунта. Попробуйте позже.');
            }
            return;
        }
        
        await next();
    });

    // ========================================
    //  📋 МОИ ЗАДАНИЯ
    // ========================================

    bot.hears('📋 Мои задания', async (ctx) => {
        try {
            const tasks = await Task.findAll({
                where: { status: ['pending', 'in_progress'], isPart: false },
                include: [
                    { model: Model },
                    { model: Color },
                    { model: Operation, as: 'operations' }
                ],
                limit: 10,
                order: [['isUrgent', 'DESC'], ['createdAt', 'ASC']]
            });

            if (!tasks || tasks.length === 0) {
                await sendDismissibleMessage(ctx, '📭 Активных заданий нет\n\nВсе задания выполнены! 🎉');
                return;
            }

            let message = '📋 *Активные задания*\n━━━━━━━━━━━━━━━━━━\n';

            (tasks || []).forEach((task, index) => {
                const modelName = task.Model?.name || 'Без модели';
                const colorName = task.Color?.name || '—';
                const urgent = task.isUrgent ? ' 🔥' : '';
                
                const done = task.doneQuantity || 0;
                const plan = task.planQuantity || 0;
                const percent = plan > 0 ? Math.round((done / plan) * 100) : 0;
                
                const barLength = 10;
                const filled = Math.round((percent / 100) * barLength);
                const empty = barLength - filled;
                const bar = '█'.repeat(filled) + '░'.repeat(empty);

                message += `\n${index + 1}. *${modelName}*${urgent}\n`;
                message += `   🎨 ${colorName}  |  📦 ${plan} шт.\n`;
                message += `   ${bar} ${percent}%\n`;
                message += `   🆔 ID: ${task.id}\n`;
                message += `   📌 ${task.status === 'pending' ? '⏳ Ожидает' : '🔄 В работе'}\n`;
            });

            message += '\n━━━━━━━━━━━━━━━━━━\n';
            message += `📊 Всего: ${tasks.length} заданий в работе`;

            await sendDismissibleMessage(ctx, message);

        } catch (err) {
            console.error('Ошибка /tasks:', err);
            await sendDismissibleMessage(ctx, '❌ Ошибка при загрузке заданий');
        }
    });

    // ========================================
    //  📊 СТАТИСТИКА
    // ========================================

    bot.hears('📊 Статистика', async (ctx) => {
        try {
            const total = await Task.count();
            const completed = await Task.count({ where: { status: 'completed' } });
            const inProgress = await Task.count({ where: { status: ['pending', 'in_progress'] } });
            const urgent = await Task.count({ where: { isUrgent: true, status: ['pending', 'in_progress'] } });
            
            const allOperations = await Operation.findAll();
            const totalDone = (allOperations || []).reduce((sum, op) => sum + op.quantity, 0);
            
            const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
            
            const barLength = 15;
            const filled = Math.round((percent / 100) * barLength);
            const empty = barLength - filled;
            const bar = '█'.repeat(filled) + '░'.repeat(empty);

            await sendDismissibleMessage(ctx, `
📊 *СТАТИСТИКА ПРОИЗВОДСТВА*
━━━━━━━━━━━━━━━━━━

📋 Всего заданий: ${total}
✅ Выполнено: ${completed}
⏳ В работе: ${inProgress}
🔥 Срочных: ${urgent}

📈 Общий прогресс:
${bar} ${percent}%

🧶 Всего связано: ${totalDone} шт.

${percent >= 100 ? '🎉 Отлично! Все задания выполнены!' : '💪 Продолжайте в том же духе!'}
            `);

        } catch (err) {
            console.error('Ошибка статистики:', err);
            await sendDismissibleMessage(ctx, '❌ Ошибка при загрузке статистики');
        }
    });

    // ========================================
    //  🚪 ВЫЙТИ (ОТВЯЗАТЬ АККАУНТ)
    // ========================================

    bot.hears('🚪 Выйти', async (ctx) => {
        const userId = String(ctx.from.id);
        
        try {
            const user = await User.findOne({ where: { telegramId: userId } });
            
            if (!user) {
                await sendDismissibleMessage(ctx, '❌ Вы не привязаны к аккаунту.');
                return;
            }
            
            const login = user.login;
            await user.update({ telegramId: null });
            
            await sendDismissibleMessage(ctx, `
✅ Вы вышли из аккаунта ${login}.

Теперь вы не будете получать уведомления.
Чтобы снова привязать аккаунт — нажмите "🔗 Привязать аккаунт".
            `);
            
        } catch (err) {
            console.error('Ошибка выхода:', err);
            await sendDismissibleMessage(ctx, '❌ Ошибка при выходе из аккаунта.');
        }
    });

    // ========================================
    //  🔧 НАСТРОЙКИ
    // ========================================

    bot.hears('🔧 Настройки', async (ctx) => {
        const userId = String(ctx.from.id);
        const user = await User.findOne({ where: { telegramId: userId } });
        
        if (!user || !hasAccess(user, ['bot_admin'])) {
            await sendDismissibleMessage(ctx, '❌ У вас нет прав для доступа к настройкам бота.');
            return;
        }
        
        await ctx.reply(`
👑 *АДМИН-ПАНЕЛЬ БОТА*

Добро пожаловать, ${user.fullName || user.login}!

Выберите действие:
        `, settingsKeyboard);
    });

    // ========================================
    //  🔙 В ГЛАВНОЕ МЕНЮ
    // ========================================

    bot.hears('🔙 В главное меню', async (ctx) => {
        const userId = String(ctx.from.id);
        const user = await User.findOne({ where: { telegramId: userId } });
        
        let keyboard = mainKeyboard;
        if (user) {
            const isActive = user.isActive !== false;
            const statusButton = isActive ? '🟢 Отдыхаю' : '🔴 На работе';
            keyboard.reply_markup.keyboard[2] = [statusButton, '🚪 Выйти'];
        }
        
        await ctx.reply('🏠 *Главное меню*\n\nВыберите действие:', keyboard);
    });

    // ========================================
    //  👥 ВСЕ ПОЛЬЗОВАТЕЛИ
    // ========================================

    bot.hears('👥 Все пользователи', async (ctx) => {
        const userId = String(ctx.from.id);
        const user = await User.findOne({ where: { telegramId: userId } });
        
        if (!user || !hasAccess(user, ['bot_admin', 'admin', 'boss', 'worker'])) {
            await sendDismissibleMessage(ctx, '❌ У вас нет прав для просмотра списка пользователей.');
            return;
        }
        
        try {
            const users = await User.findAll({
                order: [['role', 'ASC'], ['fullName', 'ASC']]
            });
            
            if (!users || users.length === 0) {
                await sendDismissibleMessage(ctx, '📭 Пользователей пока нет.');
                return;
            }
            
            let message = '👥 *СПИСОК ПОЛЬЗОВАТЕЛЕЙ*\n━━━━━━━━━━━━━━━━━━\n';
            
            (users || []).forEach((u, index) => {
                const roleDisplay = u.role ? getRoleDisplay(u.role) : '❌ Нет роли';
                const tgStatus = u.telegramId ? '✅' : '❌';
                const activeStatus = u.isActive !== false ? '🟢' : '🔴';
                message += `\n${index + 1}. *${u.fullName || u.login}*\n`;
                message += `   Логин: ${u.login} | Роль: ${roleDisplay}\n`;
                message += `   TG: ${tgStatus} ${u.telegramId ? 'привязан' : 'не привязан'}\n`;
                message += `   Статус: ${activeStatus} ${u.isActive !== false ? 'На работе' : 'Отдыхает'}\n`;
            });
            
            message += '\n━━━━━━━━━━━━━━━━━━\n';
            message += `👥 Всего: ${users.length} пользователей`;

            await sendDismissibleMessage(ctx, message);

        } catch (err) {
            console.error('Ошибка списка пользователей:', err);
            await sendDismissibleMessage(ctx, '❌ Ошибка при загрузке пользователей');
        }
    });

    // ========================================
    //  👤 УПРАВЛЕНИЕ СТАТУСАМИ
    // ========================================

    bot.hears('👤 Управление статусами', async (ctx) => {
        const userId = String(ctx.from.id);
        const user = await User.findOne({ where: { telegramId: userId } });
        
        if (!user || !hasAccess(user, ['bot_admin'])) {
            await sendDismissibleMessage(ctx, '❌ У вас нет прав для этой команды.');
            return;
        }
        
        const users = await User.findAll({
            where: {
                telegramId: { [Op.not]: null },
                role: { [Op.ne]: 'bot_admin' }
            },
            order: [['fullName', 'ASC']]
        });
        
        if (!users || users.length === 0) {
            await sendDismissibleMessage(ctx, '📭 Нет пользователей с привязанным Telegram.');
            return;
        }
        
        const userButtons = (users || []).map(u => {
            const statusText = u.isActive !== false ? '🟢 Отдыхает' : '🔴 Работает';
            return [{ text: `${u.fullName || u.login} (${u.login}) — ${statusText}`, callback_data: `status_user_${u.id}` }];
        });
        
        userButtons.push([{ text: '❌ Отмена', callback_data: 'status_cancel' }]);
        
        await ctx.reply('👤 *Выберите пользователя для изменения статуса:*', {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: userButtons
            }
        });
    });

    // ========================================
    //  ОБРАБОТКА ВЫБОРА ПОЛЬЗОВАТЕЛЯ ДЛЯ СТАТУСА
    // ========================================

    bot.action(/status_user_(.+)/, async (ctx) => {
        const targetUserId = parseInt(ctx.match[1]);
        
        const targetUser = await User.findByPk(targetUserId);
        if (!targetUser) {
            await ctx.answerCbQuery('❌ Пользователь не найден');
            return;
        }
        
        if (targetUser.role === 'bot_admin') {
            await ctx.answerCbQuery('❌ Нельзя менять статус главного администратора');
            return;
        }
        
        const currentStatus = targetUser.isActive !== false;
        const newStatus = !currentStatus;
        
        await targetUser.update({ isActive: newStatus });
        
        const statusText = newStatus ? '🟢 Отдыхает' : '🔴 На работе';
        const statusEmoji = newStatus ? '🟢' : '🔴';
        
        await ctx.deleteMessage();
        await sendDismissibleMessage(ctx, `
✅ *Статус изменён!*

👤 Пользователь: ${targetUser.fullName || targetUser.login}
📌 Логин: ${targetUser.login}
🔄 Новый статус: ${statusEmoji} ${statusText}
        `);
        
        if (targetUser.telegramId) {
            try {
                await bot.telegram.sendMessage(targetUser.telegramId, `
🔔 *Ваш статус изменён администратором*

📌 Новый статус: ${statusEmoji} ${statusText}

${newStatus ? 'Теперь вы будете получать уведомления о новых заказах.' : 'Теперь вы не будете получать уведомления о новых заказах.'}
                `, { parse_mode: 'Markdown' });
            } catch (e) {
                console.error(`❌ ${targetUser.login}:`, e.message);
            }
        }
        
        await ctx.answerCbQuery('✅ Статус изменён');
    });

    // ========================================
    //  ОТМЕНА (СТАТУСЫ)
    // ========================================

    bot.action('status_cancel', async (ctx) => {
        await ctx.deleteMessage();
        await ctx.answerCbQuery('❌ Отменено');
    });

    // ========================================
    //  👤 ДАТЬ РОЛЬ
    // ========================================

    bot.hears('👤 Дать роль', async (ctx) => {
        const userId = String(ctx.from.id);
        const user = await User.findOne({ where: { telegramId: userId } });
        
        if (!user || !hasAccess(user, ['bot_admin'])) {
            await sendDismissibleMessage(ctx, '❌ У вас нет прав для этой команды.');
            return;
        }
        
        const users = await User.findAll({
            where: { role: { [Op.ne]: 'bot_admin' } },
            order: [['fullName', 'ASC']]
        });
        
        if (!users || users.length === 0) {
            await sendDismissibleMessage(ctx, '📭 Нет пользователей для назначения роли.');
            return;
        }
        
        roleState[userId] = 'give';
        
        const userButtons = (users || []).map(u => {
            const roleDisplay = u.role ? getRoleDisplay(u.role) : '❌ Нет роли';
            return [{ text: `${u.fullName || u.login} (${u.login}) — ${roleDisplay}`, callback_data: `role_user_${u.id}` }];
        });
        
        userButtons.push([{ text: '❌ Отмена', callback_data: 'role_cancel' }]);
        
        await ctx.reply('👤 *Выберите пользователя для назначения роли:*', {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: userButtons
            }
        });
    });

    // ========================================
    //  👤 СНЯТЬ РОЛЬ
    // ========================================

    bot.hears('👤 Снять роль', async (ctx) => {
        const userId = String(ctx.from.id);
        const user = await User.findOne({ where: { telegramId: userId } });
        
        if (!user || !hasAccess(user, ['bot_admin'])) {
            await sendDismissibleMessage(ctx, '❌ У вас нет прав для этой команды.');
            return;
        }
        
        const users = await User.findAll({
            where: {
                role: { [Op.ne]: null, [Op.ne]: 'bot_admin' }
            },
            order: [['fullName', 'ASC']]
        });
        
        if (!users || users.length === 0) {
            await sendDismissibleMessage(ctx, '📭 Нет пользователей с ролями для снятия.');
            return;
        }
        
        roleState[userId] = 'remove';
        
        const userButtons = (users || []).map(u => {
            const roleDisplay = u.role ? getRoleDisplay(u.role) : '❌ Нет роли';
            return [{ text: `${u.fullName || u.login} (${u.login}) — ${roleDisplay}`, callback_data: `role_user_${u.id}` }];
        });
        
        userButtons.push([{ text: '❌ Отмена', callback_data: 'role_cancel' }]);
        
        await ctx.reply('👤 *Выберите пользователя для снятия роли:*', {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: userButtons
            }
        });
    });

    // ========================================
    //  ОБРАБОТКА ВЫБОРА ПОЛЬЗОВАТЕЛЯ ДЛЯ РОЛИ
    // ========================================

    bot.action(/role_user_(.+)/, async (ctx) => {
        const userId = String(ctx.from.id);
        const targetUserId = parseInt(ctx.match[1]);
        const action = roleState[userId];
        
        if (!action) {
            await ctx.answerCbQuery('❌ Сессия истекла, начните заново');
            return;
        }
        
        const targetUser = await User.findByPk(targetUserId);
        if (!targetUser) {
            await ctx.answerCbQuery('❌ Пользователь не найден');
            return;
        }
        
        if (targetUser.role === 'bot_admin') {
            await ctx.answerCbQuery('❌ Нельзя менять роль главного администратора');
            return;
        }
        
        if (action === 'remove') {
            if (!targetUser.role) {
                await ctx.answerCbQuery('❌ У пользователя уже нет роли');
                return;
            }
            
            const oldRole = targetUser.role;
            const oldRoleDisplay = getRoleDisplay(oldRole);
            
            await targetUser.update({ role: null });
            
            delete roleState[userId];
            
            await ctx.deleteMessage();
            await sendDismissibleMessage(ctx, `
✅ *Роль снята!*

👤 Пользователь: ${targetUser.fullName || targetUser.login}
📌 Логин: ${targetUser.login}
🔄 Снята роль: ${oldRoleDisplay}
📌 Теперь: ❌ Нет роли (доступ закрыт)
            `);
            
            await ctx.answerCbQuery('✅ Роль снята');
            
        } else if (action === 'give') {
            roleTempData[userId] = {
                targetUserId: targetUser.id,
                targetUserLogin: targetUser.login,
                targetUserName: targetUser.fullName || targetUser.login
            };
            
            const roles = [
                { code: 'admin', display: '👑 Администратор сайта' },
                { code: 'boss', display: '💼 Начальство' },
                { code: 'worker', display: '🧵 Вязальщик' }
            ];
            
            const roleButtons = roles.map(r => {
                return [{ text: r.display, callback_data: `role_set_${r.code}` }];
            });
            
            roleButtons.push([{ text: '🔙 Назад', callback_data: 'role_back_users' }]);
            roleButtons.push([{ text: '❌ Отмена', callback_data: 'role_cancel' }]);
            
            await ctx.editMessageText(`
👤 *Выберите роль для пользователя:*

📌 ${targetUser.fullName || targetUser.login} (${targetUser.login})
            `, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: roleButtons
                }
            });
            
            await ctx.answerCbQuery();
        }
    });

    // ========================================
    //  ОБРАБОТКА ВЫБОРА РОЛИ
    // ========================================

    bot.action(/role_set_(.+)/, async (ctx) => {
        const userId = String(ctx.from.id);
        const roleCode = ctx.match[1];
        const tempData = roleTempData[userId];
        
        if (!tempData) {
            await ctx.answerCbQuery('❌ Сессия истекла, начните заново');
            return;
        }
        
        const targetUser = await User.findByPk(tempData.targetUserId);
        if (!targetUser) {
            await ctx.answerCbQuery('❌ Пользователь не найден');
            return;
        }
        
        const oldRole = targetUser.role;
        const oldRoleDisplay = oldRole ? getRoleDisplay(oldRole) : '❌ Нет роли';
        const newRoleDisplay = getRoleDisplay(roleCode);
        
        await targetUser.update({ role: roleCode });
        
        delete roleState[userId];
        delete roleTempData[userId];
        
        await ctx.deleteMessage();
        await sendDismissibleMessage(ctx, `
✅ *Роль назначена!*

👤 Пользователь: ${targetUser.fullName || targetUser.login}
📌 Логин: ${targetUser.login}
🔄 Старая роль: ${oldRoleDisplay}
🆕 Новая роль: ${newRoleDisplay}
        `);
        
        await ctx.answerCbQuery('✅ Роль назначена');
    });

    // ========================================
    //  НАЗАД К СПИСКУ ПОЛЬЗОВАТЕЛЕЙ (РОЛИ)
    // ========================================

    bot.action('role_back_users', async (ctx) => {
        const userId = String(ctx.from.id);
        const action = roleState[userId];
        
        if (!action) {
            await ctx.answerCbQuery('❌ Сессия истекла');
            return;
        }
        
        const users = await User.findAll({
            where: { role: { [Op.ne]: 'bot_admin' } },
            order: [['fullName', 'ASC']]
        });
        
        const userButtons = (users || []).map(u => {
            const roleDisplay = u.role ? getRoleDisplay(u.role) : '❌ Нет роли';
            return [{ text: `${u.fullName || u.login} (${u.login}) — ${roleDisplay}`, callback_data: `role_user_${u.id}` }];
        });
        
        userButtons.push([{ text: '❌ Отмена', callback_data: 'role_cancel' }]);
        
        await ctx.editMessageText('👤 *Выберите пользователя для назначения роли:*', {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: userButtons
            }
        });
        
        await ctx.answerCbQuery();
    });

    // ========================================
    //  ОТМЕНА (РОЛИ)
    // ========================================

    bot.action('role_cancel', async (ctx) => {
        const userId = String(ctx.from.id);
        
        delete roleState[userId];
        delete roleTempData[userId];
        
        await ctx.deleteMessage();
        await ctx.answerCbQuery('❌ Отменено');
    });

    // ========================================
    //  📢 ОТПРАВИТЬ УВЕДОМЛЕНИЕ
    // ========================================

    bot.hears('📢 Отправить уведомление', async (ctx) => {
        const userId = String(ctx.from.id);
        const user = await User.findOne({ where: { telegramId: userId } });
        
        if (!user || !hasAccess(user, ['bot_admin', 'admin', 'boss', 'worker'])) {
            await sendDismissibleMessage(ctx, '❌ У вас нет прав для этой команды.');
            return;
        }
        
        const recipientKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👥 Вязальщикам', callback_data: 'notify_workers' }],
                    [{ text: '👑 Админам сайта', callback_data: 'notify_admins' }],
                    [{ text: '💼 Начальству', callback_data: 'notify_bosses' }],
                    [{ text: '📢 Всем', callback_data: 'notify_all' }],
                    [{ text: '❌ Отмена', callback_data: 'notify_cancel' }]
                ]
            }
        };
        
        await ctx.reply('📢 *Кому отправить уведомление?*', {
            parse_mode: 'Markdown',
            ...recipientKeyboard
        });
    });

    // ========================================
    //  ОБРАБОТКА ВЫБОРА ПОЛУЧАТЕЛЯ ДЛЯ УВЕДОМЛЕНИЯ
    // ========================================

    bot.action(/notify_(.+)/, async (ctx) => {
        const userId = String(ctx.from.id);
        const user = await User.findOne({ where: { telegramId: userId } });
        const recipient = ctx.match[1];
        
        if (!user || !hasAccess(user, ['bot_admin', 'admin', 'boss', 'worker'])) {
            await ctx.answerCbQuery('❌ Нет прав');
            return;
        }
        
        if (recipient === 'cancel') {
            await ctx.deleteMessage();
            await ctx.answerCbQuery('❌ Отменено');
            return;
        }
        
        notificationState[userId] = { recipient };
        
        await ctx.deleteMessage();
        await sendDismissibleMessage(ctx, `
✏️ *Введите текст уведомления*

📌 Получатель: ${getRecipientName(recipient)}

Отправьте текст сообщения.
        `);
        
        await ctx.answerCbQuery('✅ Выберите получателя');
    });

    // ========================================
    //  ОБРАБОТКА ВВОДА ТЕКСТА УВЕДОМЛЕНИЯ
    // ========================================

    bot.on('text', async (ctx, next) => {
        const userId = String(ctx.from.id);
        const state = notificationState[userId];
        
        if (!state) {
            return await next();
        }
        
        const text = ctx.message.text;
        
        if (text.startsWith('/')) {
            return await next();
        }
        
        const { recipient } = state;
        
        let users = [];
        let recipientName = '';
        
        switch (recipient) {
            case 'workers':
                users = await User.findAll({ where: { role: 'worker', telegramId: { [Op.not]: null } } });
                recipientName = 'вязальщикам';
                break;
            case 'admins':
                users = await User.findAll({ where: { role: 'admin', telegramId: { [Op.not]: null } } });
                recipientName = 'администраторам сайта';
                break;
            case 'bosses':
                users = await User.findAll({ where: { role: 'boss', telegramId: { [Op.not]: null } } });
                recipientName = 'начальству';
                break;
            case 'all':
                users = await User.findAll({ where: { telegramId: { [Op.not]: null } } });
                recipientName = 'всем пользователям';
                break;
            default:
                await sendDismissibleMessage(ctx, '❌ Неизвестный получатель');
                delete notificationState[userId];
                return;
        }
        
        if (!users || users.length === 0) {
            await sendDismissibleMessage(ctx, '❌ Нет пользователей для отправки.');
            delete notificationState[userId];
            return;
        }
        
        let sent = 0;
        for (const u of users) {
            try {
                await bot.telegram.sendMessage(u.telegramId, `📢 *Уведомление от администратора*\n\n${text}`, {
                    parse_mode: 'Markdown'
                });
                sent++;
            } catch (e) {
                console.error(`❌ ${u.login}:`, e.message);
            }
        }
        
        await sendDismissibleMessage(ctx, `✅ Уведомление отправлено ${sent} ${recipientName}.`);
        delete notificationState[userId];
    });

    // ========================================
    //  📊 ТЕСТ ОТЧЁТА
    // ========================================

    bot.hears('📊 Тест отчёта', async (ctx) => {
        const userId = String(ctx.from.id);
        const user = await User.findOne({ where: { telegramId: userId } });
        
        if (!user || !hasAccess(user, ['bot_admin'])) {
            await sendDismissibleMessage(ctx, '❌ У вас нет прав для этой команды.');
            return;
        }
        
        await sendDismissibleMessage(ctx, '⏳ Формирую отчёты за сегодня...');
        
        try {
            const date = new Date();
            
            const dayReport = await generateShiftReport(date, 'day');
            await ctx.reply(`📊 *ДНЕВНАЯ СМЕНА (ТЕСТ)*\n\n${dayReport}`, {
                parse_mode: 'Markdown'
            });
            
            const nightReport = await generateShiftReport(date, 'night');
            await ctx.reply(`📊 *НОЧНАЯ СМЕНА (ТЕСТ)*\n\n${nightReport}`, {
                parse_mode: 'Markdown'
            });
            
        } catch (err) {
            console.error('Ошибка теста отчёта:', err);
            await sendDismissibleMessage(ctx, '❌ Ошибка при формировании отчёта');
        }
    });

    // ========================================
    //  РАСПИСАНИЕ ОТЧЁТОВ (cron)
    // ========================================

    cron.schedule('0 20 * * *', async () => {
        console.log('📊 Отправка дневного отчёта...');
        const date = new Date();
        const report = await generateShiftReport(date, 'day');
        await notifyBosses(report);
    });

    cron.schedule('0 8 * * *', async () => {
        console.log('📊 Отправка ночного отчёта...');
        const date = new Date();
        const report = await generateShiftReport(date, 'night');
        await notifyBosses(report);
    });

    // ========================================
    //  ЗАПУСК БОТА (polling)
    // ========================================

    bot.launch(() => {
        console.log('🤖 Бот запущен (polling)');
    });
}

// ========================================
//  ПРОФИЛЬ (СМЕНА ПАРОЛЯ)
// ========================================

app.use('/', profileRoutes);

// ========================================
//  ЗАПУСК
// ========================================

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, async () => {
    console.log(`🚀 Dika Knit работает на http://localhost:${PORT}`);
    await sequelize.authenticate();
    console.log('✅ База данных подключена');
    
    await sequelize.sync({ alter: true });
    console.log('✅ Таблицы синхронизированы (данные сохранены)');

    const adminExists = await User.findOne({ where: { login: 'admin' } });
    if (!adminExists) {
        await User.create({
            login: 'admin',
            password: await bcrypt.hash('admin123', 10),
            fullName: 'Администратор',
            isAdmin: true,
            role: 'bot_admin'
        });
        console.log('✅ Создан админ: admin / admin123');
    }
    const workerExists = await User.findOne({ where: { login: '001' } });
    if (!workerExists) {
        await User.create({
            login: '001',
            password: await bcrypt.hash('worker123', 10),
            fullName: 'Иванов И.И.',
            isAdmin: false,
            role: 'worker'
        });
        console.log('✅ Создан вязальщик: 001 / worker123');
    }

    for (let i = 1; i <= 15; i++) {
        await Machine.findOrCreate({
            where: { machineNumber: i },
            defaults: { isActive: true }
        });
    }
    console.log('✅ 15 станков готовы');
    console.log('✅ Готово! Вход: admin/admin123 или 001/worker123');
});
