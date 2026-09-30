const express = require('express');
const jwt = require('jsonwebtoken');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'glow_co_super_secret_key_2026';

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public')); // Если фронтенд лежит в папке public

// База данных пользователей (в памяти для примера)
const users = [
    { id: 1, username: 'admin', password: 'admin123', role: 'admin', name: 'Главный Администратор' },
    { id: 2, username: 'master1', password: 'master123', role: 'master', name: 'Елена Ростова' },
    { id: 3, username: 'user', password: 'user123', role: 'client', name: 'Иван Клиент' },
    { id: 4, username: 'user129', password: 'user129', role: 'client', name: 'Пользователь 129' }
];

// База данных записей (в памяти)
let appointments = [
    { id: 1, clientId: 3, client_name: 'Иван Клиент', client_phone: '+375 (29) 123-45-67', service_name: 'Стрижка и укладка', master_name: 'Елена Ростова', booking_date: '2026-10-05', booking_time: '10:00', status: 'confirmed' },
    { id: 2, clientId: 4, client_name: 'Пользователь 129', client_phone: '+375 (29) 987-65-43', service_name: 'Маникюр с покрытием', master_name: 'Анна Смирнова', booking_date: '2026-10-06', booking_time: '13:00', status: 'arrived' }
];

// Middleware для проверки JWT токена
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Требуется авторизация (токен не найден)' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Недействительный или просроченный токен' });
        req.user = user;
        next();
    });
}

// 1. Эндпоинт авторизации (Логин)
app.post('/api/v1/auth/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);

    if (!user) {
        return res.status(400).json({ error: 'Неверный логин или пароль' });
    }

    // Создаем JWT токен с информацией о пользователе
    const tokenPayload = { id: user.id, username: user.username, role: user.role, name: user.name };
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '8h' });

    res.json({
        token,
        user: {
            id: user.id,
            username: user.username,
            role: user.role,
            name: user.name
        }
    });
});

// 2. Получение записей (с разделением прав доступа)
app.get('/api/v1/crm/appointments', authenticateToken, (req, res) => {
    if (req.user.role === 'admin' || req.user.role === 'master') {
        // Админ и мастер видят все записи салона (или мастер может фильтровать по своему имени, если требуется)
        return res.json(appointments);
    } else {
        // Обычный клиент видит только свои записи
        const clientAppointments = appointments.filter(app => app.clientId === req.user.id);
        return res.json(clientAppointments);
    }
});

// 3. Создание новой записи (клиентом)
app.post('/api/v1/crm/appointments', authenticateToken, (req, res) => {
    if (req.user.role !== 'client') {
        return res.status(403).json({ error: 'Только клиенты могут создавать новые записи' });
    }

    const { service_name, master_name, booking_date, booking_time } = req.body;

    if (!service_name || !master_name || !booking_date || !booking_time) {
        return res.status(400).json({ error: 'Заполните все обязательные поля' });
    }

    const newAppointment = {
        id: appointments.length > 0 ? appointments[appointments.length - 1].id + 1 : 1,
        clientId: req.user.id,
        client_name: req.user.name || req.user.username,
        client_phone: '+375 (29) 000-00-00', // Дефолтный телефон для примера
        service_name,
        master_name,
        booking_date,
        booking_time,
        status: 'confirmed' // Статус по умолчанию при создании
    };

    appointments.push(newAppointment);
    res.status(201).json(newAppointment);
});

// 4. Изменение статуса записи (для мастеров и администраторов)
app.patch('/api/v1/crm/appointments/:id/status', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin' && req.user.role !== 'master') {
        return res.status(403).json({ error: 'Недостаточно прав для изменения статуса' });
    }

    const appointmentId = parseInt(req.params.id);
    const { status } = req.body;
    const validStatuses = ['confirmed', 'arrived', 'completed', 'cancelled'];

    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Недопустимый статус записи' });
    }

    const appointment = appointments.find(app => app.id === appointmentId);
    if (!appointment) {
        return res.status(404).json({ error: 'Запись не найдена' });
    }

    appointment.status = status;
    res.json({ message: 'Статус успешно обновлен', appointment });
});

// 5. Удаление / отмена записи
app.delete('/api/v1/crm/appointments/:id', authenticateToken, (req, res) => {
    const appointmentId = parseInt(req.params.id);
    const index = appointments.findIndex(app => app.id === appointmentId);

    if (index === -1) {
        return res.status(404).json({ error: 'Запись не найдена' });
    }

    // Клиент может удалять только свои записи, админ — любые
    if (req.user.role === 'client' && appointments[index].clientId !== req.user.id) {
        return res.status(403).json({ error: 'Нет прав на удаление чужой записи' });
    }

    appointments.splice(index, 1);
    res.json({ message: 'Запись успешно удалена' });
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Сервер Glow & Co. запущен на http://localhost:${PORT}`);
});