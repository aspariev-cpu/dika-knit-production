require('dotenv').config();
const { Sequelize, DataTypes } = require('sequelize');

const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    logging: false,
    timezone: '+03:00'  // Московское время (GMT+3)
});

// ========================================
//  МОДЕЛИ
// ========================================

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
    color: { type: DataTypes.STRING, allowNull: false },
    className: { type: DataTypes.STRING, allowNull: false },
    isUrgent: { type: DataTypes.BOOLEAN, defaultValue: false },
    isCoat: { type: DataTypes.BOOLEAN, defaultValue: false },
    status: { type: DataTypes.ENUM('pending', 'in_progress', 'completed'), defaultValue: 'pending' },
    lastPrintedAt: { type: DataTypes.DATE, defaultValue: null }
});

const Program = sequelize.define('Program', {
    name: { type: DataTypes.STRING, allowNull: false },
    programFile: { type: DataTypes.STRING, allowNull: false },
    planQuantity: { type: DataTypes.INTEGER, allowNull: false },
    doneQuantity: { type: DataTypes.INTEGER, defaultValue: 0 },
    status: { type: DataTypes.ENUM('pending', 'in_progress', 'completed'), defaultValue: 'pending' }
});

const Operation = sequelize.define('Operation', {
    quantity: { type: DataTypes.INTEGER, allowNull: false },
    printedAt: { type: DataTypes.DATE, defaultValue: null }
});

// ========================================
//  СВЯЗИ
// ========================================

Task.hasMany(Program, { as: 'programs', foreignKey: 'taskId' });
Program.belongsTo(Task, { foreignKey: 'taskId' });

Program.hasMany(Operation, { as: 'operations', foreignKey: 'programId' });
Operation.belongsTo(Program, { foreignKey: 'programId' });

Operation.belongsTo(User, { as: 'employee', foreignKey: 'employeeId' });
Operation.belongsTo(Machine, { as: 'machine', foreignKey: 'machineId' });

module.exports = { sequelize, User, Machine, Task, Program, Operation };