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

// ========================================
//  MIDDLEWARE
// ========================================

app.use(async (req, res, next) => {
    try {
        const token = req.cookies.token;
        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await User.findByPk(decoded.id);
            if (user) req.user = user;
        }
        next();
    } catch { next(); }
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
//  УПРАВЛЕНИЕ МОДЕЛЯМИ
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

app.post('/api/models', async (req, res) => {
    try {
        const { name, program, size, className, yarn, image, isCoat } = req.body;
        
        const model = await Model.create({
            name,
            program,
            size,
            className,
            yarn,
            image: image || null,
            isCoat: isCoat === 'on'
        });

        if (isCoat === 'on') {
            for (let i = 0; i < 5; i++) {
                const partName = req.body[`part_name_${i}`];
                const partProgram = req.body[`part_program_${i}`];
                const partSize = req.body[`part_size_${i}`];
                const partClass = req.body[`part_class_${i}`];
                const partYarn = req.body[`part_yarn_${i}`];
                const partImage = req.body[`part_image_${i}`];
                
                if (partName && partProgram && partSize && partClass && partYarn) {
                    await ModelPart.create({
                        modelId: model.id,
                        partName: partName,
                        program: partProgram,
                        size: partSize,
                        className: partClass,
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

// ✅ НОВЫЙ МАРШРУТ: ПОЛУЧИТЬ МОДЕЛЬ ДЛЯ РЕДАКТИРОВАНИЯ
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

// ✅ НОВЫЙ МАРШРУТ: ОБНОВИТЬ МОДЕЛЬ
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
            yarn,
            image: image || null,
            isCoat: isCoat === 'on'
        });

        // Удаляем старые детали
        await ModelPart.destroy({ where: { modelId: id } });

        // Создаём новые, если это кофта
        if (isCoat === 'on') {
            for (let i = 0; i < 5; i++) {
                const partName = req.body[`part_name_${i}`];
                const partProgram = req.body[`part_program_${i}`];
                const partSize = req.body[`part_size_${i}`];
                const partClass = req.body[`part_class_${i}`];
                const partYarn = req.body[`part_yarn_${i}`];
                const partImage = req.body[`part_image_${i}`];
                
                if (partName && partProgram && partSize && partClass && partYarn) {
                    await ModelPart.create({
                        modelId: id,
                        partName: partName,
                        program: partProgram,
                        size: partSize,
                        className: partClass,
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

// ✅ НОВЫЙ МАРШРУТ: ЭКСПОРТ МОДЕЛЕЙ В EXCEL
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
//  РЕДАКТИРОВАНИЕ ЗАДАНИЯ
// ========================================

app.post('/api/tasks/edit/:id', async (req, res) => {
    const { id } = req.params;
    const { quantity } = req.body;
    try {
        const task = await Task.findByPk(id);
        if (!task) {
            return res.status(404).json({ error: 'Задание не найдено' });
        }
        await task.update({ planQuantity: quantity });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка при редактировании' });
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
        await Task.create({
            modelId: original.modelId,
            colorId: original.colorId,
            planQuantity: original.planQuantity,
            isUrgent: original.isUrgent,
            status: 'pending',
            ip: original.ip
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
        const { date, shift } = req.query;
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
        
        res.render('admin/shifts', {
            summary: formattedSummary,
            operations: operations,
            date: date || new Date().toISOString().split('T')[0],
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
        const { date, shift } = req.query;
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
                        { model: Model }
                    ]
                },
                { model: Machine, as: 'machine' }
            ],
            order: [['createdAt', 'DESC']],
            timezone: '+03:00'
        });
        
        const data = operations.map(op => ({
            'Дата и время': new Date(op.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }),
            'Сотрудник': op.employee?.fullName || '—',
            'Программа': op.Task?.Model?.program || '—',
            'Количество': op.quantity,
            'Станок': op.machine?.machineNumber || '—',
            'ИП': op.Task?.ip || '—',
            'Модель': op.Task?.Model?.name || '—',
            'Цвет': op.Task?.Color?.name || '—',
            'Размер': op.Task?.Model?.size || '—',
            'Класс': op.Task?.Model?.className || '—'
        }));
        
        if (data.length === 0) {
            return res.send('За эту смену нет данных');
        }
        
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, 'Смена');
        
        ws['!cols'] = [
            { wch: 20 },
            { wch: 20 },
            { wch: 15 },
            { wch: 12 },
            { wch: 12 },
            { wch: 15 },
            { wch: 20 },
            { wch: 15 },
            { wch: 12 },
            { wch: 12 }
        ];
        
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        
        const dateStr = date || new Date().toISOString().split('T')[0];
        const shiftName = shift === 'day' ? 'дневная' : 'ночная';
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=smena-${dateStr}-${shiftName}.xlsx`);
        res.send(buffer);
        
    } catch (err) {
        console.error('Ошибка выгрузки Excel:', err);
        res.status(500).send('Ошибка при выгрузке');
    }
});

// ========================================
//  КАБИНЕТ ВЯЗАЛЬЩИКА
// ========================================

app.get('/worker', async (req, res) => {
    try {
        const tasks = await Task.findAll({
            where: { status: ['pending', 'in_progress'] },
            include: [
                { model: Model, include: [{ model: ModelPart, as: 'parts' }] },
                { model: Color },
                { model: Operation, as: 'operations' }
            ],
            order: [
                ['isUrgent', 'DESC'],
                ['createdAt', 'ASC']
            ]
        });
        res.render('worker/dashboard', {
            tasks,
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
    const models = await Model.findAll();
    res.json(models);
});

app.get('/api/colors', async (req, res) => {
    res.json(await Color.findAll());
});

// ========================================
//  API: СОЗДАНИЕ ЗАДАНИЯ
// ========================================

app.post('/api/tasks', async (req, res) => {
    const { modelId, colorId, planQuantity, isUrgent, ip } = req.body;
    try {
        const model = await Model.findByPk(modelId);
        if (!model) {
            return res.status(404).json({ error: 'Модель не найдена' });
        }

        const task = await Task.create({
            modelId,
            colorId,
            planQuantity: parseInt(planQuantity),
            isUrgent: isUrgent === 'on',
            status: 'pending',
            ip: ip || null
        });

        io.emit('newTask', task);
        res.redirect('/admin');
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка при создании задания' });
    }
});

// ========================================
//  API: ВВОД ВЫРАБОТКИ
// ========================================

app.post('/api/operations', async (req, res) => {
    const { taskId, machineId, quantity } = req.body;
    try {
        const task = await Task.findByPk(taskId);
        if (!task) {
            return res.status(404).json({ error: 'Задание не найдено' });
        }

        const operation = await Operation.create({
            taskId: parseInt(taskId),
            employeeId: req.user ? req.user.id : 1,
            machineId: parseInt(machineId),
            quantity: parseInt(quantity)
        });

        const operations = await Operation.findAll({ where: { taskId } });
        const totalDone = operations.reduce((sum, op) => sum + op.quantity, 0);
        const percent = Math.min((totalDone / task.planQuantity) * 100, 100);

        res.json({
            success: true,
            operationId: operation.id,
            quantity: quantity,
            totalDone: totalDone,
            percent: percent,
            planQuantity: task.planQuantity,
            machineId: machineId
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка при сохранении' });
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

        const operations = await Operation.findAll({ where: { taskId } });
        const totalDone = operations.reduce((sum, op) => sum + op.quantity, 0);
        const percent = Math.min((totalDone / task.planQuantity) * 100, 100);

        if (percent < 100) {
            return res.status(400).json({ error: 'Задание ещё не выполнено на 100%' });
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
//  API: ОТМЕНА ОПЕРАЦИИ
// ========================================

app.post('/api/operations/undo/:taskId', async (req, res) => {
    const { taskId } = req.params;
    try {
        const operation = await Operation.findOne({
            where: { taskId },
            order: [['createdAt', 'DESC']]
        });
        if (!operation) {
            return res.status(404).json({ error: 'Нет операций для отмены' });
        }
        await operation.destroy();
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка при отмене' });
    }
});

// ========================================
//  ЗАПУСК
// ========================================

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, async () => {
    console.log(`🚀 Dika Knit работает на http://localhost:${PORT}`);
    await sequelize.authenticate();
    console.log('✅ База данных подключена');
    
    await sequelize.sync({ alter: true });
    console.log('✅ Таблицы пересозданы');

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