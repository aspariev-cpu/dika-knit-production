/**
 * ========================================
 * DIKA KNIT - ОСНОВНОЙ JS
 * Клиентская логика для вязальщика и админа
 * ========================================
 */

// ----- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ (через window, чтобы избежать конфликтов) -----
window.currentTaskId = null;
window.currentProgramId = null;
window.cancelTimer = null;
window.cancelTimeout = null;

// ----- ПОДКЛЮЧЕНИЕ SOCKET.IO -----
const socket = io();

// ========================================
// 1. МОДАЛЬНОЕ ОКНО (ввод выработки)
// ========================================

/**
 * Открыть модальное окно для ввода выработки
 * @param {number} taskId - ID задания
 * @param {number} programId - ID программы
 * @param {string} programName - Название программы
 */
function openModal(taskId, programId, programName) {
    console.log('🔍 openModal вызван:', { taskId, programId, programName });
    
    window.currentTaskId = taskId;
    window.currentProgramId = programId;
    
    const modal = document.getElementById('modal');
    const taskIdInput = document.getElementById('taskId');
    const programIdInput = document.getElementById('programId');
    const title = document.getElementById('modalTitle');
    const form = document.getElementById('operationForm');
    
    if (!modal || !taskIdInput || !programIdInput || !title || !form) {
        alert('Ошибка: элементы формы не найдены');
        return;
    }
    
    taskIdInput.value = String(taskId);
    programIdInput.value = String(programId);
    title.textContent = '📦 ' + programName;
    
    // Меняем action формы, добавляя programId в URL
    form.action = '/api/operations?programId=' + String(programId) + '&taskId=' + String(taskId);
    
    console.log('✅ Action формы изменен на:', form.action);
    console.log('✅ Установлены значения:', {
        taskId: taskIdInput.value,
        programId: programIdInput.value
    });
    
    modal.classList.add('active');
}

/**
 * Закрыть модальное окно
 */
function closeModal() {
    const modal = document.getElementById('modal');
    if (modal) {
        modal.classList.remove('active');
    }
    resetCancelTimer();
}

/**
 * Закрыть модальное окно при клике на фон
 */
window.onclick = function(event) {
    const modal = document.getElementById('modal');
    if (event.target === modal) {
        closeModal();
    }
};

// ========================================
// 2. ПЕЧАТЬ ЭТИКЕТКИ
// ========================================

/**
 * Печать этикетки (60×40 мм)
 * @param {number} taskId - ID задания
 * @param {number} operationId - ID операции (опционально)
 * @param {object} data - Данные для этикетки (опционально)
 */
function printLabel(taskId, operationId, data) {
    const taskCard = document.querySelector(`.task-card[data-task-id="${taskId}"]`);
    
    const modelName = data?.modelName || taskCard?.dataset.model || 'Неизвестно';
    const color = data?.color || taskCard?.dataset.color || 'Неизвестно';
    const program = data?.programFile || taskCard?.dataset.program || 'Неизвестно';
    const className = data?.className || taskCard?.dataset.class || 'Неизвестно';
    const quantity = data?.quantity || taskCard?.dataset.quantity || '0';
    const worker = data?.worker || taskCard?.dataset.worker || 'Вязальщик';
    const machine = data?.machineId || taskCard?.dataset.machine || '—';
    const date = new Date().toLocaleDateString('ru-RU');
    
    const printWindow = window.open('', '_blank', 'width=400,height=300');
    if (!printWindow) {
        alert('❌ Разрешите всплывающие окна для печати');
        return;
    }
    
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Этикетка Dika Knit</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                    background: #f5f5f5;
                    font-family: 'Inter', Arial, sans-serif;
                }
                .label {
                    width: 60mm;
                    height: 40mm;
                    background: #ffffff;
                    border: 2px solid #0f0c29;
                    border-radius: 4px;
                    padding: 4mm 5mm;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                }
                .label .brand {
                    font-size: 10px;
                    font-weight: 800;
                    color: #c9a959;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    border-bottom: 1px solid #eee;
                    padding-bottom: 2px;
                    margin-bottom: 4px;
                }
                .label .model {
                    font-size: 16px;
                    font-weight: 700;
                    color: #0f0c29;
                }
                .label .info {
                    font-size: 10px;
                    color: #555;
                    margin: 1px 0;
                }
                .label .info span {
                    font-weight: 600;
                    color: #0f0c29;
                }
                .label .footer {
                    margin-top: 4px;
                    font-size: 8px;
                    color: #aaa;
                    border-top: 1px solid #eee;
                    padding-top: 3px;
                    text-align: center;
                }
                .label .color-dot {
                    display: inline-block;
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    vertical-align: middle;
                    margin-right: 4px;
                    border: 1px solid #ddd;
                }
                @media print {
                    body { background: white; }
                    .label { border-color: #000; box-shadow: none; }
                }
            </style>
        </head>
        <body>
            <div class="label">
                <div class="brand">✦ Dika Knit</div>
                <div class="model">${modelName}</div>
                <div class="info">
                    <span class="color-dot" style="background:${color};"></span>
                    Цвет: <span>${color}</span>
                </div>
                <div class="info">Класс: <span>${className}</span></div>
                <div class="info">Программа: <span>${program}</span></div>
                <div class="info">Количество: <span>${quantity} шт.</span></div>
                <div class="info">Вязал: <span>${worker}</span></div>
                <div class="info">Дата: <span>${date}</span></div>
                <div class="info">Станок: <span>№${machine}</span></div>
                <div class="footer">Dika Knit Production</div>
            </div>
            <script>
                window.onload = function() {
                    if (${operationId || 'null'}) {
                        fetch('/api/print', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ operationId: ${operationId || 'null'} })
                        });
                    }
                    setTimeout(function() {
                        window.print();
                        setTimeout(function() { window.close(); }, 500);
                    }, 300);
                };
            <\/script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

// ========================================
// 3. ОБРАБОТЧИК ФОРМЫ ВЫРАБОТКИ
// ========================================

/**
 * Обработка отправки формы выработки
 */
async function submitOperation(event) {
    event.preventDefault();
    
    const form = event.target;
    const formData = new FormData(form);
    const data = {
        taskId: formData.get('taskId'),
        programId: formData.get('programId'),
        machineId: formData.get('machineId'),
        quantity: formData.get('quantity')
    };
    
    // Проверяем, что programId есть
    if (!data.programId) {
        // Пробуем восстановить из глобальной переменной
        if (window.currentProgramId) {
            data.programId = window.currentProgramId;
        }
        if (window.currentTaskId) {
            data.taskId = window.currentTaskId;
        }
    }
    
    console.log('📤 Отправка данных:', data);
    
    // Если всё равно нет programId — ошибка
    if (!data.programId) {
        alert('❌ Ошибка: не выбран ID детали');
        return;
    }
    
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Сохранение...';
    
    try {
        const response = await fetch('/api/operations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        
        const result = await response.json();
        
        if (result.success) {
            closeModal();
            showPrintModal(result);
        } else {
            showNotification('❌ Ошибка: ' + (result.error || 'Неизвестная ошибка'), 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = '💾 Сохранить';
        }
    } catch (error) {
        console.error('Ошибка:', error);
        showNotification('❌ Ошибка при сохранении', 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = '💾 Сохранить';
    }
}

// ========================================
// 4. МОДАЛЬНОЕ ОКНО ДЛЯ ПЕЧАТИ
// ========================================

function showPrintModal(data) {
    let printModal = document.getElementById('printModal');
    if (!printModal) {
        printModal = document.createElement('div');
        printModal.id = 'printModal';
        printModal.className = 'modal';
        printModal.innerHTML = `
            <div class="modal-content" style="max-width: 450px; text-align: center;">
                <h2 style="color: #51cf66; margin-bottom: 10px;">✅ Сохранено!</h2>
                <p style="color: #aaa; margin-bottom: 5px;">
                    <span id="printModelName" style="font-weight: 700; color: #fff;"></span>
                </p>
                <p style="color: #c9a959; font-size: 24px; font-weight: 700; margin-bottom: 10px;">
                    <span id="printQuantity"></span> шт.
                </p>
                <p style="color: #888; font-size: 14px; margin-bottom: 5px;">
                    📊 Связано: <span id="printTotalDone"></span> из <span id="printPlan"></span> шт.
                </p>
                <p style="color: #888; font-size: 14px; margin-bottom: 20px;">
                    🖨️ Напечатать этикетку для этой партии?
                </p>
                <div class="modal-buttons" style="display: flex; gap: 10px; flex-wrap: wrap;">
                    <button id="printConfirmBtn" class="btn btn-primary" style="flex: 1; min-width: 120px;">🖨️ Печать</button>
                    <button id="printSkipBtn" class="btn btn-secondary" style="flex: 1; min-width: 120px;">Позже</button>
                    ${data.taskCompleted ? `<button id="printCompleteBtn" class="btn btn-success" style="flex: 1; min-width: 120px;">✅ Завершить</button>` : ''}
                </div>
                <div style="margin-top: 15px; font-size: 12px; color: #666;">
                    ⏳ Этикетку можно напечатать в течение 1 часа
                </div>
            </div>
        `;
        document.body.appendChild(printModal);
        
        printModal.addEventListener('click', function(e) {
            if (e.target === printModal) {
                closePrintModal();
            }
        });
    }
    
    document.getElementById('printModelName').textContent = data.modelName || 'Неизвестно';
    document.getElementById('printQuantity').textContent = data.quantity || '0';
    document.getElementById('printTotalDone').textContent = data.totalDone || '0';
    document.getElementById('printPlan').textContent = data.planQuantity || '0';
    
    printModal.dataset.taskId = data.taskId;
    printModal.dataset.operationId = data.operationId;
    printModal.dataset.data = JSON.stringify(data);
    printModal.dataset.taskCompleted = data.taskCompleted || false;
    
    printModal.classList.add('active');
    
    document.getElementById('printConfirmBtn').onclick = function() {
        const taskId = printModal.dataset.taskId;
        const operationId = printModal.dataset.operationId;
        const dataStr = printModal.dataset.data;
        const data = JSON.parse(dataStr);
        
        printLabel(taskId, operationId, data);
        closePrintModal();
        showNotification('🖨️ Этикетка отправлена на печать', 'success');
        
        if (printModal.dataset.taskCompleted === 'true') {
            completeTask(taskId);
        } else {
            setTimeout(() => {
                location.reload();
            }, 1500);
        }
    };
    
    document.getElementById('printSkipBtn').onclick = function() {
        closePrintModal();
        showNotification('💾 Выработка сохранена. Этикетку можно напечатать позже.', 'info');
        
        if (printModal.dataset.taskCompleted === 'true') {
            completeTask(printModal.dataset.taskId);
        } else {
            setTimeout(() => {
                location.reload();
            }, 1500);
        }
    };
    
    const completeBtn = document.getElementById('printCompleteBtn');
    if (completeBtn) {
        completeBtn.onclick = function() {
            const taskId = printModal.dataset.taskId;
            closePrintModal();
            completeTask(taskId);
        };
    }
}

function closePrintModal() {
    const printModal = document.getElementById('printModal');
    if (printModal) {
        printModal.classList.remove('active');
    }
}

// ---- ФУНКЦИЯ ЗАВЕРШЕНИЯ ЗАДАНИЯ ----
async function completeTask(taskId) {
    try {
        const response = await fetch('/api/tasks/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId })
        });
        if (response.ok) {
            showNotification('✅ Задание завершено!', 'success');
            setTimeout(() => location.reload(), 1000);
        }
    } catch (err) {
        console.error(err);
    }
}

// ========================================
// 5. ТАЙМЕР ОТМЕНЫ (1 час)
// ========================================

function startCancelTimer(operationId, taskId) {
    const cancelBtn = document.getElementById('cancelBtn');
    if (!cancelBtn) return;
    
    let timeLeft = 3600;
    
    if (window.cancelTimer) {
        clearInterval(window.cancelTimer);
    }
    if (window.cancelTimeout) {
        clearTimeout(window.cancelTimeout);
    }
    
    cancelBtn.style.display = 'inline-block';
    updateCancelButton(timeLeft, cancelBtn);
    
    window.cancelTimer = setInterval(function() {
        timeLeft--;
        updateCancelButton(timeLeft, cancelBtn);
        
        if (timeLeft <= 0) {
            clearInterval(window.cancelTimer);
            cancelBtn.style.display = 'none';
            cancelBtn.textContent = '⏰ Время вышло';
            cancelBtn.disabled = true;
            alert('⏰ Время на отмену операции истекло (1 час)');
        }
    }, 1000);
    
    window.cancelTimeout = setTimeout(function() {
        if (cancelBtn) {
            cancelBtn.style.display = 'none';
        }
    }, 3600000);
}

function updateCancelButton(seconds, btn) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    let timeStr = '';
    if (hours > 0) timeStr += hours + 'ч ';
    timeStr += String(minutes).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
    
    btn.textContent = '🔄 Отменить (' + timeStr + ')';
}

function resetCancelTimer() {
    if (window.cancelTimer) {
        clearInterval(window.cancelTimer);
        window.cancelTimer = null;
    }
    if (window.cancelTimeout) {
        clearTimeout(window.cancelTimeout);
        window.cancelTimeout = null;
    }
    const cancelBtn = document.getElementById('cancelBtn');
    if (cancelBtn) {
        cancelBtn.style.display = 'none';
        cancelBtn.disabled = false;
    }
}

// ========================================
// 6. УВЕДОМЛЕНИЯ
// ========================================

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
    const colors = {
        success: '#51cf66',
        error: '#ff6b6b',
        info: '#c9a959'
    };
    
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
    
    setTimeout(function() {
        notification.style.animation = 'slideOutRight 0.4s ease';
        setTimeout(function() {
            notification.remove();
        }, 400);
    }, 4000);
}

// ========================================
// 7. SOCKET.IO
// ========================================

if (typeof io !== 'undefined') {
    socket.on('newTask', function(task) {
        console.log('📢 Новое задание:', task);
        showNotification('🆕 Новое задание: ' + task.modelName, 'info');
        setTimeout(function() {
            location.reload();
        }, 1500);
    });
    
    socket.on('taskCompleted', function(task) {
        console.log('✅ Задание выполнено:', task);
        showNotification('✅ Задание выполнено: ' + task.modelName, 'success');
        setTimeout(function() {
            location.reload();
        }, 1500);
    });
    
    socket.on('connect', function() {
        console.log('🔌 Подключено к серверу Dika Knit');
    });
    
    socket.on('disconnect', function() {
        console.log('❌ Отключено от сервера');
    });
}

// ========================================
// 8. СТИЛИ ДЛЯ АНИМАЦИЙ
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

// ========================================
// 9. ИНИЦИАЛИЗАЦИЯ
// ========================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('🧵 Dika Knit Production готов к работе!');
    
    const form = document.querySelector('#modal form');
    if (form) {
        form.addEventListener('submit', submitOperation);
    }
});

// ========================================
// 10. ГЛОБАЛЬНЫЕ ФУНКЦИИ
// ========================================

window.openModal = openModal;
window.closeModal = closeModal;
window.printLabel = printLabel;
window.showNotification = showNotification;
window.startCancelTimer = startCancelTimer;
window.resetCancelTimer = resetCancelTimer;
window.submitOperation = submitOperation;
window.closePrintModal = closePrintModal;

console.log('✅ Dika Knit JS загружен!');