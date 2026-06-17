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
const { sequelize, User, Machine, Task, Operation } = require('./models');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

app.set('io', io);

// ========================================
//  МАРШРУТЫ
// ========================================

app.get('/', (req, res) => res.redirect('/login'));

app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

// ---- ВХОД ----
app.post('/api/login', async (req, res) => {
    const { login, password } = req.body;
    
    try {
        const user = await User.findOne({ where: { login } });
        
        if (!user) {
            return res.render('login', { error: '❌ Неверный логин или пароль' });
        }
        
        const isPasswordValid = await bcrypt.compare(password, user.password);
        
        if (!isPasswordValid) {
            return res.render('login', { error: '❌ Неверный логин или пароль' });
        }
        
        const token = jwt.sign(
            { id: user.id, login: user.login, isAdmin: user.isAdmin },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );
        
        res.cookie('token', token, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
        
        if (user.isAdmin) {
            res.redirect('/admin');
        } else {
            res.redirect('/worker');
        }
        
    } catch (err) {
        console.error('Ошибка входа:', err);
        res.render('login', { error: '❌ Ошибка сервера, попробуйте позже' });
    }
});

app.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/login');
});

// ---- АДМИН-ПАНЕЛЬ ----
app.get('/admin', async (req, res) => {
    try {
        const tasks = await Task.findAll({ include: ['operations'] });
        
        let totalTasks = tasks.length;
        let completedTasks = tasks.filter(t => t.status === 'completed').length;
        let totalMade = 0;
        tasks.forEach(t => {
            if (t.operations) t.operations.forEach(o => totalMade += o.quantity);
        });

        res.render('admin/dashboard', {
            tasks,
            totalTasks,
            completedTasks,
            totalMade,
            user: { fullName: 'Администратор', isAdmin: true }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка сервера');
    }
});

// ---- УПРАВЛЕНИЕ СОТРУДНИКАМИ ----
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
        const existing = await User.findOne({ where: { login } });
        if (existing) {
            return res.status(400).send('❌ Сотрудник с таким логином уже существует');
        }
        
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
        res.status(500).send('Ошибка при создании сотрудника');
    }
});

app.post('/api/workers/delete', async (req, res) => {
    const { id } = req.body;
    
    try {
        await User.destroy({ where: { id } });
        res.redirect('/admin/workers');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при удалении');
    }
});

// ---- КАБИНЕТ ВЯЗАЛЬЩИКА ----
app.get('/worker', async (req, res) => {
    try {
        const tasks = await Task.findAll({
            where: { status: ['pending', 'in_progress'] },
            include: ['operations']
        });

        res.render('worker/dashboard', {
            tasks,
            user: { fullName: 'Вязальщик' }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка сервера');
    }
});

// ---- СОЗДАНИЕ ЗАДАНИЯ ----
app.post('/api/tasks', async (req, res) => {
    const { modelName, programFile, color, className, planQuantity, isUrgent } = req.body;
    
    const task = await Task.create({
        modelName,
        programFile,
        color,
        className,
        planQuantity: parseInt(planQuantity),
        isUrgent: isUrgent === 'on',
        status: 'pending'
    });
    
    const io = req.app.get('io');
    io.emit('newTask', task);
    
    res.redirect('/admin');
});

// ---- РЕДАКТИРОВАНИЕ ЗАДАНИЯ ----
app.post('/api/tasks/edit/:id', async (req, res) => {
    const { id } = req.params;
    const { modelName, programFile, color, className, planQuantity, isUrgent } = req.body;
    
    try {
        const task = await Task.findByPk(id);
        if (!task) {
            return res.status(404).send('Задание не найдено');
        }
        
        await task.update({
            modelName,
            programFile,
            color,
            className,
            planQuantity: parseInt(planQuantity),
            isUrgent: isUrgent === 'on'
        });
        
        res.redirect('/admin');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при редактировании');
    }
});

// ---- ВЕРНУТЬ В РАБОТУ ----
app.post('/api/tasks/restore/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        const task = await Task.findByPk(id);
        if (!task) {
            return res.status(404).send('Задание не найдено');
        }
        
        await task.update({
            status: 'pending',
            lastPrintedAt: null
        });
        
        res.redirect('/admin');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при восстановлении');
    }
});

// ---- ДУБЛИРОВАТЬ ЗАДАНИЕ ----
app.post('/api/tasks/duplicate/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        const original = await Task.findByPk(id);
        if (!original) {
            return res.status(404).send('Задание не найдено');
        }
        
        await Task.create({
            modelName: original.modelName + ' (копия)',
            programFile: original.programFile,
            color: original.color,
            className: original.className,
            planQuantity: original.planQuantity,
            isUrgent: original.isUrgent,
            status: 'pending'
        });
        
        res.redirect('/admin');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при дублировании');
    }
});

// ---- УДАЛИТЬ ЗАДАНИЕ ----
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

// ---- ОТМЕНИТЬ ПОСЛЕДНЕЕ ДЕЙСТВИЕ ----
app.post('/api/operations/undo/:taskId', async (req, res) => {
    const { taskId } = req.params;
    
    try {
        const lastOperation = await Operation.findOne({
            where: { taskId },
            order: [['createdAt', 'DESC']]
        });
        
        if (!lastOperation) {
            return res.status(404).send('Нет операций для отмены');
        }
        
        const task = await Task.findByPk(taskId);
        if (task && task.lastPrintedAt) {
            const now = new Date();
            const diffMs = now - new Date(task.lastPrintedAt);
            const diffMinutes = diffMs / (1000 * 60);
            
            if (diffMinutes >= 60) {
                return res.status(400).send('⏰ Прошло больше часа, отмена невозможна');
            }
        }
        
        await lastOperation.destroy();
        
        if (task && task.status === 'completed') {
            await task.update({ 
                status: 'pending',
                lastPrintedAt: null
            });
        }
        
        res.redirect('/worker');
        
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при отмене');
    }
});

// ---- ВВОД ВЫРАБОТКИ ----
app.post('/api/operations', async (req, res) => {
    const { taskId, machineId, quantity } = req.body;
    
    try {
        const task = await Task.findByPk(taskId);
        if (!task) {
            return res.status(404).json({ error: 'Задание не найдено' });
        }
        
        const operations = await Operation.findAll({ where: { taskId } });
        let totalDone = 0;
        operations.forEach(op => totalDone += op.quantity);
        
        const operation = await Operation.create({
            taskId,
            employeeId: 1,
            machineId: parseInt(machineId),
            quantity: parseInt(quantity)
        });
        
        const newTotal = totalDone + parseInt(quantity);
        const taskCompleted = newTotal >= task.planQuantity;
        
        res.json({
            success: true,
            operationId: operation.id,
            taskId: task.id,
            modelName: task.modelName,
            programFile: task.programFile,
            color: task.color,
            className: task.className,
            quantity: quantity,
            machineId: machineId,
            worker: 'Вязальщик',
            planQuantity: task.planQuantity,
            totalDone: newTotal,
            taskCompleted: taskCompleted
        });
        
    } catch (err) {
        console.error('Ошибка при сохранении:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// ---- ПОДТВЕРЖДЕНИЕ ПЕЧАТИ ----
app.post('/api/print', async (req, res) => {
    const { operationId } = req.body;
    
    try {
        await Operation.update(
            { printedAt: new Date() },
            { where: { id: operationId } }
        );
        
        const operation = await Operation.findByPk(operationId);
        if (operation) {
            const task = await Task.findByPk(operation.taskId);
            if (task) {
                await task.update({ lastPrintedAt: new Date() });
            }
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка при сохранении печати' });
    }
});

// ---- СТАТИСТИКА ПО СМЕНАМ ----
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
                { model: Task, as: 'Task' },
                { model: Machine, as: 'machine' }
            ],
            order: [['createdAt', 'DESC']]
        });
        
        const summary = {};
        operations.forEach(op => {
            const name = op.employee ? op.employee.fullName : 'Неизвестный';
            if (!summary[name]) {
                summary[name] = {
                    total: 0,
                    machines: new Set(),
                    tasks: new Set()
                };
            }
            summary[name].total += op.quantity;
            if (op.machine) summary[name].machines.add(op.machine.machineNumber);
            if (op.Task) summary[name].tasks.add(op.Task.modelName);
        });
        
        const formattedSummary = Object.keys(summary).map(name => ({
            name,
            total: summary[name].total,
            machines: Array.from(summary[name].machines).join(', '),
            tasks: Array.from(summary[name].tasks).join(', ')
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

// ---- АВТОМАТИЧЕСКОЕ ЗАВЕРШЕНИЕ ЗАДАНИЙ ----
async function checkCompletedTasks() {
    try {
        const tasks = await Task.findAll({
            where: { 
                status: 'in_progress',
                lastPrintedAt: { [Op.ne]: null }
            }
        });
        
        const now = new Date();
        for (const task of tasks) {
            const diffMs = now - new Date(task.lastPrintedAt);
            const diffMinutes = diffMs / (1000 * 60);
            
            if (diffMinutes >= 60) {
                task.status = 'completed';
                await task.save();
                const io = app.get('io');
                io.emit('taskCompleted', task);
                console.log(`✅ Задание ${task.modelName} завершено автоматически через час`);
            }
        }
    } catch (err) {
        console.error('Ошибка проверки заданий:', err);
    }
}

setInterval(checkCompletedTasks, 60000);

// ========================================
//  ЗАПУСК
// ========================================

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, async () => {
    console.log(`🚀 Dika Knit работает на http://localhost:${PORT}`);
    
    try {
        await sequelize.authenticate();
        console.log('✅ База данных подключена');
        
        await sequelize.sync({ alter: true });
        console.log('✅ Таблицы созданы');
        
        const adminExists = await User.findOne({ where: { login: 'admin' } });
        if (!adminExists) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await User.create({
                login: 'admin',
                password: hashedPassword,
                fullName: 'Администратор',
                isAdmin: true
            });
            console.log('✅ Создан админ: admin / admin123');
        }
        
        const workerExists = await User.findOne({ where: { login: '001' } });
        if (!workerExists) {
            const hashedPassword = await bcrypt.hash('worker123', 10);
            await User.create({
                login: '001',
                password: hashedPassword,
                fullName: 'Иванов И.И.',
                isAdmin: false
            });
            console.log('✅ Создан вязальщик: 001 / worker123');
        }
        
        for (let i = 1; i <= 15; i++) {
            const exists = await Machine.findOne({ where: { machineNumber: i } });
            if (!exists) {
                await Machine.create({ machineNumber: i, isActive: true });
            }
        }
        console.log('✅ 15 станков готовы');
        
        console.log('✅ Готово!');
        console.log('📝 Вход: admin/admin123 или 001/worker123');
        
    } catch (err) {
        console.error('❌ Ошибка при запуске:', err);
    }
});