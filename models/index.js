require('dotenv').config();
const { Sequelize, DataTypes } = require('sequelize');

const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    logging: false,
    timezone: '+03:00',
    dialectOptions: {
        useUTC: false,
        timezone: 'Europe/Moscow'
    }
});

// ========================================
//  ПОЛЬЗОВАТЕЛИ
// ========================================
const User = sequelize.define('User', {
    login: { type: DataTypes.STRING, unique: true, allowNull: false },
    password: { type: DataTypes.STRING, allowNull: false },
    fullName: { type: DataTypes.STRING, allowNull: false },
    isAdmin: { type: DataTypes.BOOLEAN, defaultValue: false },
    telegramId: { type: DataTypes.STRING, allowNull: true },
    role: { 
        type: DataTypes.ENUM('bot_admin', 'admin', 'boss', 'master', 'worker'), 
        defaultValue: 'worker' 
    },
    lastActiveAt: { type: DataTypes.DATE, allowNull: true },
    isActiveForNotifications: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
});

// ========================================
//  СТАНКИ
// ========================================

const Machine = sequelize.define('Machine', {
    machineNumber: { type: DataTypes.INTEGER, unique: true, allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
});

// ========================================
//  МОДЕЛИ
// ========================================

const Model = sequelize.define('Model', {
    name: { type: DataTypes.STRING, allowNull: false, unique: true },
    program: { type: DataTypes.STRING, allowNull: false },
    size: { type: DataTypes.STRING, allowNull: false },
    className: { type: DataTypes.STRING, allowNull: false },
    yarn: { type: DataTypes.STRING, allowNull: true },
    image: { type: DataTypes.TEXT, allowNull: true },
    isCoat: { type: DataTypes.BOOLEAN, defaultValue: false }
});

// ========================================
//  ДЕТАЛИ МОДЕЛИ (для шапок и кофт)
// ========================================

const ModelPart = sequelize.define('ModelPart', {
    partName: { type: DataTypes.STRING, allowNull: false },
    program: { type: DataTypes.STRING, allowNull: false },
    size: { type: DataTypes.STRING, allowNull: true },
    className: { type: DataTypes.STRING, allowNull: true },
    yarn: { type: DataTypes.STRING, allowNull: false },
    image: { type: DataTypes.TEXT, allowNull: true }
});

// ========================================
//  ЦВЕТА
// ========================================

const Color = sequelize.define('Color', {
    name: { type: DataTypes.STRING, allowNull: false, unique: true }
});

// ========================================
//  ЗАДАНИЯ (ШАПКИ И КОФТЫ)
// ========================================

const Task = sequelize.define('Task', {
    planQuantity: { type: DataTypes.INTEGER, allowNull: false },
    isUrgent: { type: DataTypes.BOOLEAN, defaultValue: false },
    status: { type: DataTypes.ENUM('pending', 'in_progress', 'completed'), defaultValue: 'pending' },
    lastPrintedAt: { type: DataTypes.DATE, defaultValue: null },
    ip: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    isCoat: { type: DataTypes.BOOLEAN, defaultValue: false },
    // НОВОЕ ПОЛЕ: хранит детали кофты в формате JSON
    parts: {
        type: DataTypes.JSON,
        defaultValue: [],
        allowNull: true
    },
    // ВРЕМЕННО: оставляем для обратной совместимости, но больше не используем
    isPart: { type: DataTypes.BOOLEAN, defaultValue: false },
    partName: { type: DataTypes.STRING, allowNull: true },
    parentTaskId: { type: DataTypes.INTEGER, allowNull: true },
    doneQuantity: { type: DataTypes.INTEGER, defaultValue: 0 }
});

// ========================================
//  ОПЕРАЦИИ (ВЫРАБОТКА)
// ========================================

const Operation = sequelize.define('Operation', {
    quantity: { type: DataTypes.INTEGER, allowNull: false },
    printedAt: { type: DataTypes.DATE, defaultValue: null },
    colorName: { type: DataTypes.STRING, allowNull: true },
    modelName: { type: DataTypes.STRING, allowNull: true },
    partName: { type: DataTypes.STRING, allowNull: true }
});

// ========================================
//  СВЯЗИ
// ========================================

// Связи для модели и её деталей (оставляем без изменений)
Model.hasMany(ModelPart, { as: 'parts', foreignKey: 'modelId' });
ModelPart.belongsTo(Model, { foreignKey: 'modelId' });

// Связи для задания
Task.belongsTo(Model, { foreignKey: 'modelId' });
Task.belongsTo(Color, { foreignKey: 'colorId' });

// Связь для операций (оставляем)
Task.hasMany(Operation, { as: 'operations', foreignKey: 'taskId' });
Operation.belongsTo(Task, { foreignKey: 'taskId' });
Operation.belongsTo(User, { as: 'employee', foreignKey: 'employeeId' });
Operation.belongsTo(Machine, { as: 'machine', foreignKey: 'machineId' });

// ⚠️ ВРЕМЕННО: связи Task ↔ Task для обратной совместимости (будут удалены позже)
Task.hasMany(Task, { as: 'parts_old', foreignKey: 'parentTaskId' });
Task.belongsTo(Task, { as: 'parent', foreignKey: 'parentTaskId' });

module.exports = {
    sequelize,
    User,
    Machine,
    Model,
    ModelPart,
    Color,
    Task,
    Operation
};