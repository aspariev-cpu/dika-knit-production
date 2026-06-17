require('dotenv').config();
const { Sequelize, DataTypes } = require('sequelize');

const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    logging: false
});

const User = sequelize.define('User', {
    login: { type: DataTypes.STRING, unique: true, allowNull: false },
    password: { type: DataTypes.STRING, allowNull: false },
    fullName: { type: DataTypes.STRING, allowNull: false },
    isAdmin: { type: DataTypes.BOOLEAN, defaultValue: false }
});

const Machine = sequelize.define('Machine', {
    machineNumber: { type: DataTypes.INTEGER, unique: true, allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, defaultValue: true }
});

const Task = sequelize.define('Task', {
    modelName: { type: DataTypes.STRING, allowNull: false },
    programFile: { type: DataTypes.STRING, allowNull: false },
    color: { type: DataTypes.STRING, allowNull: false },
    className: { type: DataTypes.STRING, allowNull: false },
    planQuantity: { type: DataTypes.INTEGER, allowNull: false },
    isUrgent: { type: DataTypes.BOOLEAN, defaultValue: false },
    status: { type: DataTypes.ENUM('pending', 'in_progress', 'completed'), defaultValue: 'pending' },
    lastPrintedAt: { type: DataTypes.DATE, defaultValue: null }
});

const Operation = sequelize.define('Operation', {
    quantity: { type: DataTypes.INTEGER, allowNull: false },
    printedAt: { type: DataTypes.DATE, defaultValue: null }
});

// Связи
Task.hasMany(Operation, { 
    as: 'operations',
    foreignKey: 'taskId' 
});
Operation.belongsTo(Task, { 
    foreignKey: 'taskId' 
});

Operation.belongsTo(User, { 
    as: 'employee',
    foreignKey: 'employeeId' 
});

Operation.belongsTo(Machine, { 
    as: 'machine',
    foreignKey: 'machineId' 
});

module.exports = { sequelize, User, Machine, Task, Operation };