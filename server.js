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
            where: { 
                isPart: false  // временно, пока не удалим поле
            },
            include: [
                { model: Model },
                { model: Color },
                { model: Operation, as: 'operations' }
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

        if (models.length === 0) {
            return res.send('Нет моделей для экспорта');
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
                        'Пряжа': model.yarn,
                        'Фото': model.image || '—',
                        'Тип': 'Кофта',
                        'Деталь': part.partName,
                        'Программа детали': part.program,
                        'Размер детали': part.size,
                        'Класс детали': part.className,
                        'Пряжа детали': part.yarn,
                        'Фото детали': part.image || '—'
                    });
                });
            } else {
                data.push({
                    'Название': model.name,
                    'Программа': model.program,
                    'Размер': model.size,
                    'Класс': model.className,
                    'Пряжа': model.yarn,
                    'Фото': model.image || '—',
                    'Тип': 'Обычная',
                    'Деталь': '—',
                    'Программа детали': '—',
                    'Размер детали': '—',
                    'Класс детали': '—',
                    'Пряжа детали': '—',
                    'Фото детали': '—'
                });
            }
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, 'Модели');

        ws['!cols'] = [
            { wch: 25 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 20 },
            { wch: 30 }, { wch: 12 }, { wch: 25 }, { wch: 15 }, { wch: 12 },
            { wch: 12 }, { wch: 20 }, { wch: 30 }
        ];

        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=models-${new Date().toISOString().split('T')[0]}.xlsx`);
        res.send(buffer);

    } catch (err) {
        console.error('Ошибка экспорта моделей:', err);
        res.status(500).send('Ошибка при выгрузке');
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
        const original = await Task.findByPk(id);
        if (!original) {
            return res.status(404).send('Задание не найдено');
        }

        // Копируем задачу (для кофт копируются и детали в JSON)
        const newTask = await Task.create({
            modelId: original.modelId,
            colorId: original.colorId,
            planQuantity: original.planQuantity,
            isUrgent: original.isUrgent,
            status: 'pending',
            ip: original.ip,
            isCoat: original.isCoat,
            parts: original.parts ? original.parts.map(p => ({ ...p, done: 0 })) : [],
            doneQuantity: 0
        });

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
                { wch: 20 },
                { wch: 25 },
                { wch: 15 },
                { wch: 12 },
                { wch: 20 }
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
                { model: Operation, as: 'operations' }
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
            } else {
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
//  API: СОЗДАНИЕ ЗАДАНИЯ (НОВАЯ ЛОГИКА)
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

        // ========================================
        // НОВАЯ ЛОГИКА ДЛЯ КОФТ (С JSON)
        // ========================================
        if (model.isCoat && model.parts && model.parts.length > 0) {
            // Собираем данные о деталях из формы
            const partsData = [];
            let totalPlan = 0;
            
            model.parts.forEach((part, index) => {
                const quantity = parseInt(req.body[`part_${index}`]) || 0;
                if (quantity > 0) {
                    partsData.push({
                        name: part.partName,
                        plan: quantity,
                        done: 0
                    });
                    totalPlan += quantity;
                }
            });
            
            if (partsData.length === 0) {
                return res.status(400).json({ error: 'Укажите количество хотя бы для одной детали' });
            }

            // Создаём одну задачу-кофту с деталями в JSON
            const coat = await Task.create({
                modelId: model.id,
                colorId: colorId,
                planQuantity: totalPlan,
                isUrgent: isUrgent === 'on',
                status: 'pending',
                ip: ip || null,
                isCoat: true,
                parts: partsData,
                doneQuantity: 0
            });

            io.emit('newTask', coat);
            
            try {
                await sendNotificationToActiveWorkers(coat, model, null, totalPlan, ip);
                console.log('📨 Уведомления отправлены активным вязальщикам');
            } catch (err) {
                console.error('❌ Ошибка отправки уведомлений:', err);
            }
            
            return res.redirect('/admin');
        }
        
        // ========================================
        // ЛОГИКА ДЛЯ ШАПОК (ОСТАЁТСЯ БЕЗ ИЗМЕНЕНИЙ)
        // ========================================
        else {
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
                doneQuantity: 0
            });
            io.emit('newTask', task);
            
            try {
                await sendNotificationToActiveWorkers(task, model, null, planQuantity, ip);
                console.log('📨 Уведомления отправлены активным вязальщикам');
            } catch (err) {
                console.error('❌ Ошибка отправки уведомлений:', err);
            }
            
            res.redirect('/admin');
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка при создании задания' });
    }
});

// ========================================
//  API: ВВОД ВЫРАБОТКИ (НОВАЯ ЛОГИКА)
// ========================================

app.post('/api/operations', async (req, res) => {
    const { taskId, machineId, quantity, partName } = req.body;
    console.log('📥 Получен запрос на сохранение выработки:', { taskId, machineId, quantity, partName });
    
    try {
        const task = await Task.findByPk(taskId, {
            include: [
                { model: Model },
                { model: Color }
            ]
        });
        if (!task) {
            console.log('❌ Задание не найдено:', taskId);
            return res.status(404).json({ error: 'Задание не найдено' });
        }

        // ========================================
        // 1. СОЗДАЁМ ОПЕРАЦИЮ (ДЛЯ СТАТИСТИКИ)
        // ========================================
        const operation = await Operation.create({
            taskId: parseInt(taskId),
            employeeId: req.user ? req.user.id : 1,
            machineId: parseInt(machineId),
            quantity: parseInt(quantity),
            colorName: task.Color ? task.Color.name : null,
            modelName: task.Model ? task.Model.name : null,
            partName: partName || null
        });

        // ========================================
        // 2. ОБНОВЛЕНИЕ ПРОГРЕССА ДЛЯ ШАПКИ
        // ========================================
        if (!task.isCoat) {
            const ops = await Operation.findAll({ where: { taskId } });
            const totalDone = ops.reduce((sum, op) => sum + op.quantity, 0);
            const percent = task.planQuantity > 0 ? Math.min((totalDone / task.planQuantity) * 100, 100) : 0;
            await task.update({ doneQuantity: totalDone });
            
            console.log(`✅ Обновлён doneQuantity для шапки ${taskId}: ${totalDone}/${task.planQuantity}`);
            
            return res.json({
                success: true,
                operationId: operation.id,
                quantity: quantity,
                totalDone: totalDone,
                percent: percent,
                planQuantity: task.planQuantity,
                machineId: machineId,
                partName: partName,
                parentProgress: null
            });
        }

        // ========================================
        // 3. НОВАЯ ЛОГИКА ДЛЯ КОФТЫ (ОБНОВЛЕНИЕ JSON)
        // ========================================
        if (task.isCoat && task.parts && task.parts.length > 0) {
            if (!partName) {
                console.log('❌ Не передано имя детали для кофты');
                return res.status(400).json({ error: 'Не указана деталь' });
            }
            
            // Находим деталь в массиве parts
            const partIndex = task.parts.findIndex(p => p.name === partName);
            
            if (partIndex === -1) {
                console.log(`❌ Деталь "${partName}" не найдена в кофте ${task.id}`);
                return res.status(404).json({ error: `Деталь "${partName}" не найдена` });
            }
            
            // Обновляем done у конкретной детали
            task.parts[partIndex].done = (task.parts[partIndex].done || 0) + parseInt(quantity);
            
            // Пересчитываем общий прогресс
            let totalDone = 0;
            let totalPlan = 0;
            task.parts.forEach(p => {
                totalDone += Math.min(p.done, p.plan);
                totalPlan += p.plan;
            });
            
            // Сохраняем изменения
            await task.update({ 
                doneQuantity: totalDone,
                parts: task.parts 
            });
            
            const percent = totalPlan > 0 ? Math.min((totalDone / totalPlan) * 100, 100) : 0;
            
            console.log(`✅ Обновлена кофта ${task.id}: ${totalDone}/${totalPlan} (деталь: ${partName})`);
            
            return res.json({
                success: true,
                operationId: operation.id,
                quantity: quantity,
                totalDone: totalDone,
                percent: percent,
                planQuantity: totalPlan,
                machineId: machineId,
                partName: partName,
                parentProgress: {
                    coatId: task.id,
                    totalDone: totalDone,
                    totalPlan: totalPlan,
                    percent: percent
                }
            });
        }

        // Если ничего не подошло
        return res.status(400).json({ error: 'Неизвестный тип задания' });
        
    } catch (err) {
        console.error('❌ Ошибка при сохранении выработки:', err);
        res.status(500).json({ error: 'Ошибка при сохранении: ' + err.message });
    }
});

// ========================================
//  API: ОТПРАВИТЬ АДМИНУ
// ========================================

app.post('/api/tasks/complete/:taskId', async (req, res) => {
    const { taskId } = req.params;
    try {
        const task = await Task.findByPk(taskId);
        if (!task) {
            return res.status(404).json({ error: 'Задание не найдено' });
        }

        // Для кофт проверяем, что все детали готовы
        if (task.isCoat && task.parts && task.parts.length > 0) {
            let allDone = true;
            for (const part of task.parts) {
                if (part.done < part.plan) {
                    allDone = false;
                    break;
                }
            }
            if (!allDone) {
                return res.status(400).json({ error: 'Не все детали кофты выполнены!' });
            }
        } else {
            // Для шапок проверяем количество
            const ops = await Operation.findAll({ where: { taskId } });
            const totalDone = ops.reduce((sum, op) => sum + op.quantity, 0);
            
            if (totalDone < task.planQuantity) {
                return res.status(400).json({ error: 'Задание не выполнено!' });
            }
        }

        await task.update({ status: 'completed' });
        io.emit('taskCompleted', task);
        console.log(`✅ Задание ${task.id} отправлено админу!`);

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка при отправке' });
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
            // Для кофт с JSON нужно обновить и детали
            if (task.isCoat && task.parts && task.parts.length > 0) {
                // TODO: реализовать отмену для кофт (уменьшить done у детали)
                // Пока просто пересчитываем общий прогресс
                let totalDone = 0;
                task.parts.forEach(p => {
                    totalDone += Math.min(p.done, p.plan);
                });
                await task.update({ 
                    doneQuantity: totalDone,
                    parts: task.parts 
                });
            } else {
                const ops = await Operation.findAll({ where: { taskId } });
                const totalDone = ops.reduce((sum, op) => sum + op.quantity, 0);
                await task.update({ doneQuantity: totalDone });
            }
            console.log('✅ Обновлён doneQuantity:', task.doneQuantity);
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
                { model: Operation, as: 'operations' }
            ]
        });
        
        if (!task) {
            return res.status(404).json({ success: false, error: 'Задание не найдено' });
        }
        
        let totalDone = 0;
        let totalPlan = task.planQuantity || 0;
        
        // Для кофт с JSON
        if (task.isCoat && task.parts && task.parts.length > 0) {
            totalPlan = 0;
            totalDone = 0;
            for (const part of task.parts) {
                totalDone += Math.min(part.done || 0, part.plan);
                totalPlan += part.plan;
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
//  API: СОХРАНИТЬ ИЗМЕНЕНИЯ ЗАДАНИЯ
// ========================================

app.post('/api/tasks/edit/:id', async (req, res) => {
    const { id } = req.params;
    const { quantity, doneQuantity, status, parts } = req.body;
    
    console.log('========================================');
    console.log('📥 ПОЛУЧЕН ЗАПРОС НА РЕДАКТИРОВАНИЕ');
    console.log('📌 ID задания:', id);
    console.log('📦 Полученные данные:', { quantity, doneQuantity, status, parts });
    
    try {
        const task = await Task.findByPk(id);
        
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
        
        // ========================================
        // НОВАЯ ЛОГИКА ДЛЯ КОФТ (С JSON)
        // ========================================
        if (task.isCoat && task.parts && task.parts.length > 0) {
            console.log('🧥 ЭТО КОФТА (JSON), деталей:', task.parts.length);
            
            // Обновляем план и факт для каждой детали
            for (let i = 0; i < task.parts.length; i++) {
                const part = task.parts[i];
                const newPlan = parseInt(parts[`part_${i}_plan`]) || 0;
                const newDone = parseInt(parts[`part_${i}_done`]) || 0;
                
                console.log(`   Деталь ${part.name}:`);
                console.log(`      новый план: ${newPlan}, старый: ${part.plan}`);
                console.log(`      новое связано: ${newDone}, старое: ${part.done}`);
                
                part.plan = newPlan;
                part.done = newDone;
            }
            
            // Пересчитываем общий прогресс
            let totalPlan = 0;
            let totalDone = 0;
            task.parts.forEach(p => {
                totalPlan += p.plan;
                totalDone += Math.min(p.done, p.plan);
            });
            
            await task.update({ 
                planQuantity: totalPlan,
                doneQuantity: totalDone,
                parts: task.parts 
            });
            
            console.log(`📊 Итог по кофте: ${totalDone}/${totalPlan}`);
        }
        // ========================================
        // ЛОГИКА ДЛЯ ШАПКИ
        // ========================================
        else {
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
//  ТЕЛЕГРАМ БОТ (telegraf) С УВЕДОМЛЕНИЯМИ
// ========================================

const { Telegraf } = require('telegraf');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
let bot = null;

if (TELEGRAM_BOT_TOKEN) {
    bot = new Telegraf(TELEGRAM_BOT_TOKEN);
    console.log('🤖 Telegram бот инициализирован');
} else {
    console.log('⚠️ TELEGRAM_BOT_TOKEN не задан, бот не запущен');
}

// ========================================
//  КЛАВИАТУРЫ (ОБНОВЛЕНЫ)
// ========================================

const mainKeyboard = {
    reply_markup: {
        keyboard: [
            ['📋 Мои задания', '📊 Статистика'],
            ['🔗 Привязать аккаунт', '✅ На работу', '⏹️ Закончил работу'],
            ['🔧 Настройки', '🚪 Выйти']
        ],
        resize_keyboard: true
    }
};

const settingsKeyboard = {
    reply_markup: {
        keyboard: [
            ['👥 Все пользователи'],
            ['👤 Назначить роль'],
            ['📢 Отправить уведомление'],
            ['🔙 В главное меню']
        ],
        resize_keyboard: true
    }
};

// ========================================
//  ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
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

if (bot) {
    bot.use(async (ctx, next) => {
        const text = ctx.message?.text;
        
        const buttonTexts = [
            '📋 Мои задания',
            '📊 Статистика',
            '🔗 Привязать аккаунт',
            '✅ На работу',
            '⏹️ Закончил работу',
            '🔧 Настройки',
            '🚪 Выйти',
            '👥 Все пользователи',
            '👤 Назначить роль',
            '📢 Отправить уведомление',
            '🔙 В главное меню'
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
}

// ========================================
//  ЗАПУСК БОТА В POLLING РЕЖИМЕ (БЕЗ WEBHOOK)
// ========================================

if (bot) {
    // Запускаем бота в polling-режиме
    bot.launch()
        .then(() => {
            console.log('🤖 Бот успешно запущен в polling-режиме');
        })
        .catch(err => {
            console.error('❌ Ошибка запуска бота:', err);
        });
    
    // Удаляем старый webhook, если был
    bot.telegram.setWebhook('').catch(() => {});
}

// ========================================
//  ОБРАБОТЧИКИ
// ========================================

if (bot) {

    bot.action('dismiss_message', async (ctx) => {
        try {
            await ctx.deleteMessage();
        } catch (err) {}
        try {
            await ctx.answerCbQuery('🗑️ Сообщение удалено');
        } catch (err) {}
    });

    bot.action(/dismiss_(.+)/, async (ctx) => {
        try {
            await ctx.deleteMessage();
        } catch (err) {}
        try {
            await ctx.answerCbQuery('✅ Сообщение удалено');
        } catch (err) {}
    });

    // ========================================
    //  /start
    // ========================================

    bot.start(async (ctx) => {
        const name = ctx.from.first_name || 'Вязальщик';
        const userId = String(ctx.from.id);
        
        const user = await User.findOne({ where: { telegramId: userId } });
        
        let status = '';
        if (user) {
            status = `\n✅ Аккаунт привязан: ${user.login} (${user.role})`;
        } else {
            status = '\n⚠️ Аккаунт не привязан. Нажмите "Привязать аккаунт"';
        }
        
        await ctx.reply(`
🧵 Привет, ${name}!

Я бот фабрики Dika Knit.
${status}

Выберите действие:
        `, mainKeyboard);
    });

    // ========================================
    //  🔗 ПРИВЯЗАТЬ АККАУНТ
    // ========================================

    bot.hears('🔗 Привязать аккаунт', (ctx) => {
        sendDismissibleMessage(ctx, `
🔐 *Привязка аккаунта*

Введите ваш логин и пароль от сайта в формате:

Логин:Пароль

Например:
admin:admin123
        `);
    });

    // ========================================
    //  ОБРАБОТКА ВВОДА ЛОГИНА:ПАРОЛЯ
    // ========================================

    bot.on('text', async (ctx, next) => {
        const text = ctx.message.text;
        
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
    //  ✅ НА РАБОТУ
    // ========================================

    bot.hears('✅ На работу', async (ctx) => {
        const userId = String(ctx.from.id);
        
        try {
            const user = await User.findOne({ where: { telegramId: userId } });
            if (!user) {
                await sendDismissibleMessage(ctx, '❌ Сначала привяжите аккаунт через "🔗 Привязать аккаунт"');
                return;
            }
            
            if (user.role !== 'worker' && user.role !== 'master') {
                await sendDismissibleMessage(ctx, '❌ У вас нет роли вязальщика или мастера. Обратитесь к администратору.');
                return;
            }
            
            await user.update({
                isActiveForNotifications: true,
                lastActiveAt: new Date()
            });
            
            await sendDismissibleMessage(ctx, `
✅ Вы НА РАБОТЕ!

🟢 Уведомления ВКЛЮЧЕНЫ
📨 Вы будете получать уведомления о новых заказах

⏹️ В конце смены нажмите "Закончил работу"
            `);
            
            const admins = await User.findAll({ where: { role: 'admin', telegramId: { [Op.ne]: null } } });
            for (const admin of admins) {
                if (admin.telegramId) {
                    bot.telegram.sendMessage(
                        admin.telegramId,
                        `🟢 ${user.fullName} вышел на работу! (${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })})`
                    ).catch(() => {});
                }
            }
            
        } catch (err) {
            console.error('Ошибка включения уведомлений:', err);
            await sendDismissibleMessage(ctx, '❌ Ошибка при включении уведомлений');
        }
    });

    // ========================================
    //  ⏹️ ЗАКОНЧИЛ РАБОТУ
    // ========================================

    bot.hears('⏹️ Закончил работу', async (ctx) => {
        const userId = String(ctx.from.id);
        
        try {
            const user = await User.findOne({ where: { telegramId: userId } });
            if (!user) {
                await sendDismissibleMessage(ctx, '❌ Сначала привяжите аккаунт');
                return;
            }
            
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const operations = await Operation.findAll({
                where: {
                    employeeId: user.id,
                    createdAt: { [Op.gte]: today }
                }
            });
            
            const totalDone = operations.reduce((sum, op) => sum + op.quantity, 0);
            
            await user.update({
                isActiveForNotifications: false
            });
            
            await sendDismissibleMessage(ctx, `
⏹️ Вы ЗАКОНЧИЛИ РАБОТУ!

🟡 Уведомления ВЫКЛЮЧЕНЫ
📊 За сегодня вы связали: ${totalDone} шт.
📋 Операций: ${operations.length}

👋 Хорошего отдыха!
            `);
            
            const admins = await User.findAll({ where: { role: 'admin', telegramId: { [Op.ne]: null } } });
            for (const admin of admins) {
                if (admin.telegramId) {
                    bot.telegram.sendMessage(
                        admin.telegramId,
                        `🔴 ${user.fullName} закончил работу!\n📊 Связано за смену: ${totalDone} шт.`
                    ).catch(() => {});
                }
            }
            
        } catch (err) {
            console.error('Ошибка выключения уведомлений:', err);
            await sendDismissibleMessage(ctx, '❌ Ошибка при выключении уведомлений');
        }
    });

    // ========================================
    //  📋 МОИ ЗАДАНИЯ
    // ========================================

    bot.hears('📋 Мои задания', async (ctx) => {
        try {
            const tasks = await Task.findAll({
                where: { status: ['pending', 'in_progress'], isCoat: false },
                include: [
                    { model: Model },
                    { model: Color },
                    { model: Operation, as: 'operations' }
                ],
                limit: 10,
                order: [['isUrgent', 'DESC'], ['createdAt', 'ASC']]
            });

            if (tasks.length === 0) {
                await sendDismissibleMessage(ctx, '📭 Активных заданий нет\n\nВсе задания выполнены! 🎉');
                return;
            }

            let message = '📋 *Активные задания*\n━━━━━━━━━━━━━━━━━━\n';

            tasks.forEach((task, index) => {
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
            const totalDone = allOperations.reduce((sum, op) => sum + op.quantity, 0);
            
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
    //  🔧 НАСТРОЙКИ
    // ========================================

    bot.hears('🔧 Настройки', async (ctx) => {
        const userId = String(ctx.from.id);
        const user = await User.findOne({ where: { telegramId: userId } });
        
        if (!user || user.role !== 'bot_admin') {
            await ctx.reply('❌ У вас нет прав для доступа к настройкам бота.');
            return;
        }
        
        await ctx.reply(`
👑 *АДМИН-ПАНЕЛЬ БОТА*

Добро пожаловать, ${user.fullName || user.login}!

Выберите действие:
        `, settingsKeyboard);
    });

    // ========================================
    //  👥 ВСЕ ПОЛЬЗОВАТЕЛИ
    // ========================================

    bot.hears('👥 Все пользователи', async (ctx) => {
        try {
            const users = await User.findAll({
                order: [['role', 'ASC'], ['fullName', 'ASC']]
            });
            
            if (users.length === 0) {
                await sendDismissibleMessage(ctx, '📭 Пользователей пока нет.');
                return;
            }
            
            let message = '👥 *СПИСОК ПОЛЬЗОВАТЕЛЕЙ*\n━━━━━━━━━━━━━━━━━━\n';
            
            const roleEmojis = {
                'bot_admin': '🤖',
                'admin': '👑',
                'boss': '💼',
                'master': '🔧',
                'worker': '🧵'
            };
            
            const roleNames = {
                'bot_admin': 'Главный админ бота',
                'admin': 'Администратор сайта',
                'boss': 'Начальство',
                'master': 'Мастер',
                'worker': 'Вязальщик'
            };
            
            users.forEach((u, index) => {
                const emoji = roleEmojis[u.role] || '👤';
                const tgStatus = u.telegramId ? '✅' : '❌';
                const activeStatus = u.isActiveForNotifications ? '🟢' : '⚪';
                message += `\n${index + 1}. ${emoji} *${u.fullName || u.login}*\n`;
                message += `   Логин: ${u.login} | Роль: ${roleNames[u.role] || u.role}\n`;
                message += `   TG: ${tgStatus} ${u.telegramId ? 'привязан' : 'не привязан'}\n`;
                message += `   📨 ${activeStatus} ${u.isActiveForNotifications ? 'на работе' : 'не активен'}\n`;
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
    //  👤 НАЗНАЧИТЬ РОЛЬ
    // ========================================

    bot.hears('👤 Назначить роль', (ctx) => {
        sendDismissibleMessage(ctx, `
👤 *НАЗНАЧИТЬ РОЛЬ*

Введите команду:

/set_role логин роль

📌 Доступные роли:
🤖 bot_admin — главный админ бота
👑 admin — админ сайта
💼 boss — начальство
🔧 master — мастер
🧵 worker — вязальщик

Пример:
/set_role ivanov boss
        `);
    });

    bot.command('set_role', async (ctx) => {
        const adminId = String(ctx.from.id);
        const admin = await User.findOne({ where: { telegramId: adminId } });
        
        if (!admin || admin.role !== 'bot_admin') {
            await sendDismissibleMessage(ctx, '❌ У вас нет прав для этой команды.');
            return;
        }
        
        const args = ctx.message.text.split(' ');
        if (args.length < 3) {
            await sendDismissibleMessage(ctx, '❌ Использование: /set_role логин роль');
            return;
        }
        
        const login = args[1];
        const role = args[2];
        
        if (!['bot_admin', 'admin', 'boss', 'master', 'worker'].includes(role)) {
            await sendDismissibleMessage(ctx, '❌ Некорректная роль.');
            return;
        }
        
        try {
            const user = await User.findOne({ where: { login } });
            if (!user) {
                await sendDismissibleMessage(ctx, `❌ Пользователь ${login} не найден.`);
                return;
            }
            
            await user.update({ role: role });
            await sendDismissibleMessage(ctx, `✅ Пользователю ${login} назначена роль: ${role}`);
            
            if (user.telegramId) {
                await bot.telegram.sendMessage(user.telegramId, `🔔 Ваша роль обновлена: ${role}`, {
                    parse_mode: 'Markdown'
                });
            }
        } catch (err) {
            console.error('Ошибка назначения роли:', err);
            await sendDismissibleMessage(ctx, '❌ Ошибка при назначении роли');
        }
    });

    // ========================================
    //  📢 ОТПРАВИТЬ УВЕДОМЛЕНИЕ
    // ========================================

    const notificationState = {};

    bot.hears('📢 Отправить уведомление', async (ctx) => {
        const userId = String(ctx.from.id);
        const user = await User.findOne({ where: { telegramId: userId } });
        
        if (!user || (user.role !== 'bot_admin' && user.role !== 'admin')) {
            await sendDismissibleMessage(ctx, '❌ У вас нет прав для этой команды.');
            return;
        }
        
        const recipientKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👥 Вязальщикам', callback_data: 'notify_workers' }],
                    [{ text: '🔧 Мастерам', callback_data: 'notify_masters' }],
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

    bot.action(/notify_(.+)/, async (ctx) => {
        const userId = String(ctx.from.id);
        const user = await User.findOne({ where: { telegramId: userId } });
        
        if (!user || (user.role !== 'bot_admin' && user.role !== 'admin')) {
            await ctx.answerCbQuery('❌ Нет прав');
            return;
        }
        
        const recipient = ctx.match[1];
        
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

    function getRecipientName(recipient) {
        const names = {
            'workers': '👥 Вязальщики',
            'masters': '🔧 Мастера',
            'admins': '👑 Админы сайта',
            'bosses': '💼 Начальство',
            'all': '📢 Все пользователи'
        };
        return names[recipient] || recipient;
    }

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
        delete notificationState[userId];
        
        let users = [];
        let recipientName = '';
        
        switch (recipient) {
            case 'workers':
                users = await User.findAll({ where: { role: 'worker', telegramId: { [Op.not]: null } } });
                recipientName = 'вязальщикам';
                break;
            case 'masters':
                users = await User.findAll({ where: { role: 'master', telegramId: { [Op.not]: null } } });
                recipientName = 'мастерам';
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
                return;
        }
        
        if (users.length === 0) {
            await sendDismissibleMessage(ctx, `❌ Нет пользователей для отправки ${recipientName}`);
            return;
        }
        
        let sent = 0;
        let failed = 0;
        
        for (const user of users) {
            if (user.telegramId) {
                try {
                    await bot.telegram.sendMessage(user.telegramId, `
📢 *УВЕДОМЛЕНИЕ ОТ АДМИНИСТРАЦИИ*

${text}

━━━━━━━━━━━━━━━━━━
📅 ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}
                    `, { parse_mode: 'Markdown' });
                    sent++;
                } catch (err) {
                    failed++;
                    console.error(`❌ Ошибка отправки ${user.fullName}:`, err.message);
                }
            }
        }
        
        await sendDismissibleMessage(ctx, `
📢 *Уведомление отправлено!*

✅ Получателей: ${users.length}
📨 Доставлено: ${sent}
❌ Не доставлено: ${failed}

📌 Кому: ${recipientName}
        `);
    });

    // ========================================
    //  🔙 В ГЛАВНОЕ МЕНЮ
    // ========================================

    bot.hears('🔙 В главное меню', async (ctx) => {
        await ctx.reply('🔙 Возвращаюсь в главное меню', mainKeyboard);
    });

    // ========================================
    //  🚪 ВЫЙТИ
    // ========================================

    bot.hears('🚪 Выйти', async (ctx) => {
        await ctx.reply('👋 До свидания! Чтобы вернуться, нажмите /start');
    });

    console.log('🤖 Все обработчики бота загружены');
}

// ========================================
//  ФУНКЦИЯ ОТПРАВКИ УВЕДОМЛЕНИЙ АКТИВНЫМ ВЯЗАЛЬЩИКАМ
// ========================================

async function sendNotificationToActiveWorkers(task, model, color, planQuantity, ip) {
    try {
        const workers = await User.findAll({
            where: { 
                role: 'worker',
                isActiveForNotifications: true,
                telegramId: { [Op.ne]: null }
            }
        });
        
        if (workers.length === 0) {
            console.log('📨 Нет активных вязальщиков для уведомления');
            return;
        }
        
        const modelName = model ? model.name : 'Новое задание';
        const colorName = color ? color.name : '—';
        const urgent = task.isUrgent ? '🔥 СРОЧНО! ' : '';
        const taskUrl = process.env.APP_URL || 'https://твой-сайт.render.com/worker';
        
        for (const worker of workers) {
            if (worker.telegramId) {
                const message = `
${urgent}📋 Новое задание!

🧵 Модель: ${modelName}
🎨 Цвет: ${colorName}
📦 Количество: ${planQuantity || 'смотри в приложении'}
🏢 ИП: ${ip || '—'}

👆 Перейдите в систему: ${taskUrl}
                `;
                
                try {
                    await bot.telegram.sendMessage(worker.telegramId, message);
                    console.log(`📨 Уведомление отправлено ${worker.fullName}`);
                } catch (err) {
                    console.error(`❌ Ошибка отправки ${worker.fullName}:`, err.message);
                }
            }
        }
    } catch (err) {
        console.error('❌ Ошибка отправки уведомлений:', err);
    }
}

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
            isAdmin: true
        });
        console.log('✅ Создан админ: admin / admin123');
    }
    const workerExists = await User.findOne({ where: { login: '001' } });
    if (!workerExists) {
        await User.create({
            login: '001',
            password: await bcrypt.hash('worker123', 10),
            fullName: 'Иванов И.И.',
            isAdmin: false
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