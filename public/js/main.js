console.log('🧵 Dika Knit загружен!');

const socket = io();

socket.on('newTask', function(task) {
    console.log('📢 Новое задание:', task);
    showNotification('🆕 Новое задание создано!', 'success');
});

socket.on('taskCompleted', function(task) {
    console.log('✅ Задание выполнено:', task);
    showNotification('✅ Задание выполнено!', 'success');
});

socket.on('taskUpdated', function(data) {
    console.log('🔄 Задание обновлено:', data);
    showNotification(`🔄 Задание #${data.taskId} обновлено`, 'info');
    
    // Если это страница вязальщика - обновляем прогресс
    if (window.location.pathname === '/worker' || window.location.pathname === '/dashboard') {
        // Можно добавить логику обновления прогресса без перезагрузки
        // Или просто показать уведомление
    }
});

socket.on('taskRemoved', function(data) {
    console.log('🗑️ Задание удалено:', data);
    showNotification(`❌ Задание #${data.taskId} удалено`, 'error');
});

function showNotification(message, type) {
    let container = document.getElementById('notificationContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notificationContainer';
        container.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 10px;
            max-width: 350px;
        `;
        document.body.appendChild(container);
    }

    const notification = document.createElement('div');
    const colors = { success: '#4ade80', error: '#f87171', info: '#c9a959' };
    notification.style.cssText = `
        background: rgba(255,255,255,0.08);
        color: #fff;
        padding: 14px 20px;
        border-radius: 12px;
        border-left: 4px solid ${colors[type] || colors.info};
        box-shadow: 0 10px 30px rgba(0,0,0,0.4);
        font-size: 14px;
        font-weight: 500;
        animation: slideInRight 0.4s ease;
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255,255,255,0.05);
    `;
    notification.textContent = message;
    container.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.4s ease';
        setTimeout(() => notification.remove(), 400);
    }, 4000);
}

// ========================================
//  АВТООБНОВЛЕНИЕ СТРАНИЦЫ
// ========================================
// Только для страницы вязальщика
if (window.location.pathname === '/worker' || window.location.pathname === '/dashboard') {
    // Автообновление каждую минуту
    setInterval(function() {
        console.log('🔄 Автообновление страницы...');
        location.reload();
    }, 60000); // 60000 мс = 1 минута
    
    console.log('⏰ Автообновление включено (каждую минуту)');
}

// ========================================
//  СТИЛИ ДЛЯ УВЕДОМЛЕНИЙ
// ========================================
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from { opacity: 0; transform: translateX(60px); }
        to { opacity: 1; transform: translateX(0); }
    }
    @keyframes slideOutRight {
        from { opacity: 1; transform: translateX(0); }
        to { opacity: 0; transform: translateX(60px); }
    }
`;
document.head.appendChild(style);