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
const { sequelize, User, Machine, Task, Program, Operation } = require('./models');

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
//  MIDDLEWARE: ПОЛУЧЕНИЕ ПОЛЬЗОВАТЕЛЯ ИЗ КУКИ
// ========================================
app.use(async (req, res, next) => {
    try {
        const token = req.cookies.token;
        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await User.findByPk(decoded.id);
            if (user) {
                req.user = user;
            }
        }
        next();
    } catch (err) {
        next();
    }
});

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
        const tasks = await Task.findAll({
            include: [
                { model: Program, as: 'programs' }
            ]
        });
        
        let totalTasks = tasks.length;
        let completedTasks = tasks.filter(t => t.status === 'completed').length;
        let totalMade = 0;
        
        tasks.forEach(t => {
            if (t.programs) {
                t.programs.forEach(p => {
                    totalMade += p.doneQuantity;
                });
            }
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
            include: [
                { model: Program, as: 'programs' }
            ]
        });

        const workerName = req.user ? req.user.fullName : 'Вязальщик';

        res.render('worker/dashboard', {
            tasks,
            user: { fullName: workerName }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка сервера');
    }
});

// ---- СОЗДАНИЕ ЗАДАНИЯ ----
app.post('/api/tasks', async (req, res) => {
    const { modelName, color, className, isUrgent, isCoat, programFile, planQuantity } = req.body;
    
    try {
        const task = await Task.create({
            modelName,
            color,
            className,
            isUrgent: isUrgent === 'on',
            isCoat: isCoat === 'on',
            status: 'pending'
        });
        
        if (isCoat === 'on') {
            for (let i = 1; i <= 6; i++) {
                const name = req.body[`coat_name_${i}`];
                const program = req.body[`coat_program_${i}`];
                const quantity = req.body[`coat_quantity_${i}`];
                
                if (name && program && quantity) {
                    await Program.create({
                        taskId: task.id,
                        name: name,
                        programFile: program,
                        planQuantity: parseInt(quantity),
                        doneQuantity: 0,
                        status: 'pending'
                    });
                }
            }
        } else {
            await Program.create({
                taskId: task.id,
                name: 'Основная',
                programFile: programFile,
                planQuantity: parseInt(planQuantity),
                doneQuantity: 0,
                status: 'pending'
            });
        }
        
        const io = req.app.get('io');
        io.emit('newTask', task);
        
        res.redirect('/admin');
    } catch (err) {
        console.error('Ошибка при создании задания:', err);
        res.status(500).send('Ошибка при создании задания');
    }
});

// ---- СТРАНИЦА РЕДАКТИРОВАНИЯ ----
app.get('/admin/tasks/edit/:id', async (req, res) => {
    try {
        const task = await Task.findByPk(req.params.id, {
            include: [{ model: Program, as: 'programs' }]
        });
        if (!task) {
            return res.status(404).send('Задание не найдено');
        }
        
        res.render('admin/edit-task', {
            task,
            user: { fullName: 'Администратор', isAdmin: true }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при загрузке задания');
    }
});

// ---- РЕДАКТИРОВАНИЕ ЗАДАНИЯ ----
app.post('/api/tasks/edit/:id', async (req, res) => {
    const { id } = req.params;
    const { modelName, color, className, isUrgent, isCoat } = req.body;
    
    try {
        const task = await Task.findByPk(id);
        if (!task) {
            return res.status(404).send('Задание не найдено');
        }
        
        await task.update({
            modelName,
            color,
            className,
            isUrgent: isUrgent === 'on',
            isCoat: isCoat === 'on'
        });
        
        // Обновляем программы
        if (isCoat === 'on') {
            await Program.destroy({ where: { taskId: id } });
            
            for (let i = 1; i <= 6; i++) {
                const name = req.body[`coat_name_${i}`];
                const program = req.body[`coat_program_${i}`];
                const quantity = req.body[`coat_quantity_${i}`];
                
                if (name && program && quantity) {
                    await Program.create({
                        taskId: id,
                        name: name,
                        programFile: program,
                        planQuantity: parseInt(quantity),
                        doneQuantity: 0,
                        status: 'pending'
                    });
                }
            }
        } else {
            await Program.destroy({ where: { taskId: id } });
            await Program.create({
                taskId: id,
                name: 'Основная',
                programFile: req.body.programFile,
                planQuantity: parseInt(req.body.planQuantity),
                doneQuantity: 0,
                status: 'pending'
            });
        }
        
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
        const original = await Task.findByPk(id, {
            include: [{ model: Program, as: 'programs' }]
        });
        if (!original) {
            return res.status(404).send('Задание не найдено');
        }
        
        const newTask = await Task.create({
            modelName: original.modelName + ' (копия)',
            color: original.color,
            className: original.className,
            isUrgent: original.isUrgent,
            isCoat: original.isCoat,
            status: 'pending'
        });
        
        for (const program of original.programs) {
            await Program.create({
                taskId: newTask.id,
                name: program.name,
                programFile: program.programFile,
                planQuantity: program.planQuantity,
                doneQuantity: 0,
                status: 'pending'
            });
        }
        
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
    const { programId } = req.body;
    
    console.log('📝 Отмена операции:', { taskId, programId });
    
    try {
        const task = await Task.findByPk(taskId);
        if (!task) {
            return res.status(404).send('Задание не найдено');
        }
        
        let lastOperation = null;
        let lastProgramId = null;
        
        if (programId) {
            const operations = await Operation.findAll({
                where: { programId: programId },
                order: [['createdAt', 'DESC']],
                limit: 1
            });
            if (operations.length > 0) {
                lastOperation = operations[0];
                lastProgramId = programId;
            }
        } else {
            const programs = await Program.findAll({ where: { taskId } });
            for (const program of programs) {
                const ops = await Operation.findAll({
                    where: { programId: program.id },
                    order: [['createdAt', 'DESC']],
                    limit: 1
                });
                if (ops.length > 0) {
                    if (!lastOperation || ops[0].createdAt > lastOperation.createdAt) {
                        lastOperation = ops[0];
                        lastProgramId = program.id;
                    }
                }
            }
        }
        
        if (!lastOperation) {
            return res.status(400).send('❌ Нет операций для отмены');
        }
        
        if (task.status === 'completed' && task.lastPrintedAt) {
            const now = new Date();
            const diffMs = now - new Date(task.lastPrintedAt);
            const diffMinutes = diffMs / (1000 * 60);
            
            if (diffMinutes >= 60) {
                return res.status(400).send('⏰ Прошло больше часа, отмена невозможна');
            }
        }
        
        const quantity = lastOperation.quantity;
        await lastOperation.destroy();
        
        const program = await Program.findByPk(lastProgramId);
        if (program) {
            await program.update({
                doneQuantity: Math.max(0, program.doneQuantity - quantity)
            });
            
            const progOps = await Operation.findAll({ where: { programId: program.id } });
            let progDone = 0;
            progOps.forEach(op => progDone += op.quantity);
            
            if (progDone >= program.planQuantity) {
                await program.update({ status: 'completed' });
            } else {
                await program.update({ status: 'pending' });
            }
        }
        
        const allPrograms = await Program.findAll({ where: { taskId } });
        const allDone = allPrograms.every(p => p.doneQuantity >= p.planQuantity);
        
        if (task.status === 'completed') {
            await task.update({
                status: allDone ? 'completed' : 'pending',
                lastPrintedAt: allDone ? task.lastPrintedAt : null
            });
        }
        
        res.redirect('/worker');
        
    } catch (err) {
        console.error('Ошибка при отмене:', err);
        res.status(500).send('Ошибка при отмене');
    }
});

// ---- РЕДАКТИРОВАНИЕ ОПЕРАЦИИ ----
app.post('/api/operations/edit/:id', async (req, res) => {
    const { id } = req.params;
    const { quantity } = req.body;
    
    try {
        const operation = await Operation.findByPk(id);
        if (!operation) {
            return res.status(404).json({ error: 'Операция не найдена' });
        }
        
        const oldQuantity = operation.quantity;
        await operation.update({ quantity: parseInt(quantity) });
        
        const program = await Program.findByPk(operation.programId);
        if (program) {
            await program.update({
                doneQuantity: Math.max(0, program.doneQuantity - oldQuantity + parseInt(quantity))
            });
        }
        
        res.redirect('/admin');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при редактировании операции');
    }
});

// ---- УДАЛЕНИЕ ОПЕРАЦИИ ----
app.post('/api/operations/delete/:id', async (req, res) => {
    const { id } = req.params;
    
    try {
        const operation = await Operation.findByPk(id);
        if (!operation) {
            return res.status(404).json({ error: 'Операция не найдена' });
        }
        
        const quantity = operation.quantity;
        const programId = operation.programId;
        await operation.destroy();
        
        const program = await Program.findByPk(programId);
        if (program) {
            await program.update({
                doneQuantity: Math.max(0, program.doneQuantity - quantity)
            });
        }
        
        res.redirect('/admin');
    } catch (err) {
        console.error(err);
        res.status(500).send('Ошибка при удалении операции');
    }
});

// ---- ВВОД ВЫРАБОТКИ ----
app.post('/api/operations', async (req, res) => {
    const { taskId, programId, machineId, quantity } = req.body;
    
    console.log('📝 Ввод выработки:', { taskId, programId, machineId, quantity });
    
    try {
        if (!programId) {
            console.error('❌ programId не передан!');
            return res.status(400).json({ error: '❌ Не передан ID детали' });
        }
        
        const program = await Program.findByPk(programId);
        if (!program) {
            console.error('❌ Программа не найдена, ID:', programId);
            return res.status(404).json({ error: '❌ Деталь не найдена' });
        }
        
        console.log('✅ Найдена программа:', program.name, 'ID:', program.id);
        
        // ✅ БЕРЁМ ID ВЯЗАЛЬЩИКА ИЗ req.user
        const userId = req.user ? req.user.id : 1;
        console.log('👤 Вязальщик ID:', userId);
        console.log('👤 Вязальщик имя:', req.user ? req.user.fullName : 'Неизвестный');
        
        const operation = await Operation.create({
            programId: parseInt(programId),
            employeeId: userId,
            machineId: parseInt(machineId),
            quantity: parseInt(quantity)
        });
        
        const newDone = program.doneQuantity + parseInt(quantity);
        await program.update({ doneQuantity: newDone });
        console.log(`✅ Обновлено: ${program.name} - ${newDone}/${program.planQuantity}`);
        
        if (newDone >= program.planQuantity) {
            await program.update({ status: 'completed' });
            console.log(`✅ Деталь ${program.name} выполнена!`);
        }
        
        const task = await Task.findByPk(taskId);
        const allPrograms = await Program.findAll({ where: { taskId } });
        const allDone = allPrograms.every(p => p.doneQuantity >= p.planQuantity);
        
        if (allDone && task.status !== 'completed') {
            await task.update({ 
                lastPrintedAt: new Date()
            });
            console.log(`✅ Задание ${task.modelName} полностью выполнено! Таймер запущен!`);
        }
        
        res.json({
            success: true,
            operationId: operation.id,
            programId: program.id,
            programName: program.name,
            quantity: quantity,
            programDone: newDone,
            programPlan: program.planQuantity,
            allDone: allDone,
            taskCompleted: allDone
        });
        
    } catch (err) {
        console.error('❌ Ошибка при сохранении:', err);
        res.status(500).json({ error: '❌ Ошибка сервера: ' + err.message });
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
            const program = await Program.findByPk(operation.programId);
            if (program) {
                const task = await Task.findByPk(program.taskId);
                if (task) {
                    await task.update({ lastPrintedAt: new Date() });
                }
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
                { model: Program },
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
                    programs: new Set()
                };
            }
            summary[name].total += op.quantity;
            if (op.machine) summary[name].machines.add(op.machine.machineNumber);
            if (op.Program) summary[name].programs.add(op.Program.name);
        });
        
        const formattedSummary = Object.keys(summary).map(name => ({
            name,
            total: summary[name].total,
            machines: Array.from(summary[name].machines).join(', '),
            programs: Array.from(summary[name].programs).join(', ')
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

// ---- АВТОМАТИЧЕСКОЕ ЗАВЕРШЕНИЕ ----
async function checkCompletedTasks() {
    try {
        const tasks = await Task.findAll({
            where: {
                status: ['pending', 'in_progress'],
                lastPrintedAt: { [Op.ne]: null }
            },
            include: [{ model: Program, as: 'programs' }]
        });
        
        const now = new Date();
        for (const task of tasks) {
            const allDone = task.programs.every(p => p.doneQuantity >= p.planQuantity);
            if (!allDone) continue;
            
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