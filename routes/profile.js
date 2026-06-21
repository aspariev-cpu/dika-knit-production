const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { User } = require('../models');
const jwt = require('jsonwebtoken');  // 👈 ДОБАВЬ

// Middleware для проверки авторизации
const isAuthenticated = (req, res, next) => {
    console.log('🔐 isAuthenticated вызван');
    console.log('   req.user:', req.user ? req.user.fullName : 'НЕТ');
    console.log('   req.cookies.token:', req.cookies.token ? 'Есть' : 'Нет');
    
    // Если req.user уже есть - отлично
    if (req.user) {
        return next();
    }
    
    // Если нет - пробуем сами найти пользователя по токену
    try {
        const token = req.cookies.token;
        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            console.log('🔍 Сами декодировали токен:', decoded);
            
            User.findByPk(decoded.id).then(user => {
                if (user) {
                    req.user = user;
                    console.log('👤 Сами нашли пользователя:', user.fullName);
                    return next();
                }
                console.log('❌ Пользователь не найден');
                return res.redirect('/login');
            }).catch(err => {
                console.error('❌ Ошибка поиска пользователя:', err);
                return res.redirect('/login');
            });
        } else {
            console.log('❌ Нет токена, редирект на /login');
            return res.redirect('/login');
        }
    } catch (err) {
        console.error('❌ Ошибка проверки токена:', err.message);
        return res.redirect('/login');
    }
};

// Страница смены пароля
router.get('/profile', isAuthenticated, (req, res) => {
    console.log('👤 Страница профиля, пользователь:', req.user.fullName);
    res.render('profile', {
        user: req.user,
        message: req.query.message || null,
        error: req.query.error || null
    });
});

// Обработка смены пароля
router.post('/api/profile/change-password', isAuthenticated, async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;
        const userId = req.user.id;

        console.log('🔄 Смена пароля для:', req.user.fullName);

        if (newPassword !== confirmPassword) {
            return res.status(400).json({ 
                success: false, 
                error: 'Новый пароль и подтверждение не совпадают' 
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ 
                success: false, 
                error: 'Пароль должен быть не менее 6 символов' 
            });
        }

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                error: 'Пользователь не найден' 
            });
        }

        const isValid = await bcrypt.compare(currentPassword, user.password);
        if (!isValid) {
            return res.status(401).json({ 
                success: false, 
                error: 'Неверный текущий пароль' 
            });
        }

        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
        user.password = hashedPassword;
        await user.save();

        console.log('✅ Пароль изменён для:', user.fullName);

        res.json({ 
            success: true, 
            message: 'Пароль успешно изменён!' 
        });

    } catch (err) {
        console.error('❌ Ошибка:', err);
        res.status(500).json({ 
            success: false, 
            error: 'Внутренняя ошибка сервера' 
        });
    }
});

module.exports = router;