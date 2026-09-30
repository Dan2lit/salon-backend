const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_glow_co';

// Middleware
app.use(cors());
app.use(express.json());

// Подключение к базе данных PostgreSQL (Render PostgreSQL / DATABASE_URL)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// ==========================================
// MIDDLEWARE ДЛЯ АВТОРИЗАЦИИ И ПРОВЕРКИ РОЛЕЙ
// ==========================================
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Доступ запрещен. Токен не предоставлен.' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Недействительный или истекший токен.' });
        }
        req.user = user;
        next();
    });
}

function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Недостаточно прав для выполнения операции.' });
        }
        next();
    };
}

// ==========================================
// ИНИЦИАЛИЗАЦИЯ БАЗЫ ДАННЫХ И СИДИРОВАНИЕ
// ==========================================
async function initDb() {
    try {
        // 1. Таблица услуг
        await pool.query(`
      CREATE TABLE IF NOT EXISTS services (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        price INT NOT NULL,
        duration_minutes INT NOT NULL
      );
    `);

        // 2. Таблица мастеров
        await pool.query(`
      CREATE TABLE IF NOT EXISTS masters (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        role VARCHAR(100) NOT NULL,
        rating NUMERIC(2, 1) DEFAULT 5.0
      );
    `);

        // 3. Таблица записей
        await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        client_name VARCHAR(100) NOT NULL,
        client_phone VARCHAR(50) NOT NULL,
        service_id INT REFERENCES services(id),
        master_id INT REFERENCES masters(id),
        booking_date DATE NOT NULL,
        booking_time VARCHAR(10) NOT NULL,
        status VARCHAR(20) DEFAULT 'confirmed',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

        // 4. Таблица пользователей для CRM
        await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'master'
      );
    `);

        // Заполнение начальными данными, если таблицы пусты
        const servicesCount = await pool.query('SELECT COUNT(*) FROM services');
        if (parseInt(servicesCount.rows[0].count) === 0) {
            await pool.query(`
        INSERT INTO services (name, price, duration_minutes) VALUES
        ('Женская стрижка & Укладка', 2500, 60),
        ('Мужская стрижка', 1500, 45),
        ('Окрашивание волос', 4500, 120),
        ('Маникюр с покрытием', 2000, 60);
      `);
        }

        const mastersCount = await pool.query('SELECT COUNT(*) FROM masters');
        if (parseInt(mastersCount.rows[0].count) === 0) {
            await pool.query(`
        INSERT INTO masters (name, role, rating) VALUES
        ('Елена Смирнова', 'Топ-стилист', 4.9),
        ('Анна Иванова', 'Мастер маникюра', 4.8),
        ('Дмитрий Петров', 'Барбер-стилист', 5.0);
      `);
        }

        const usersCount = await pool.query('SELECT COUNT(*) FROM users');
        if (parseInt(usersCount.rows[0].count) === 0) {
            const adminHash = await bcrypt.hash('admin123', 10);
            const masterHash = await bcrypt.hash('master123', 10);

            await pool.query(`
        INSERT INTO users (username, password_hash, role) VALUES
        ('admin', $1, 'admin'),
        ('master1', $2, 'master');
      `, [adminHash, masterHash]);
        }

        console.log('✅ База данных успешно инициализирована!');
    } catch (err) {
        console.error('❌ Ошибка инициализации БД:', err);
    }
}

initDb();

// ==========================================
// ПУБЛИЧНЫЕ МАРШРУТЫ (ДЛЯ КЛИЕНТСКОГО ВИДЖЕТА)
// ==========================================

// Проверка статуса сервера
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        message: 'Бэкенд системы онлайн-записи салона красоты успешно работает!'
    });
});

// Получить список услуг
app.get('/api/v1/services', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM services ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка при получении списка услуг' });
    }
});

// Получить список мастеров
app.get('/api/v1/masters', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM masters ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка при получении списка мастеров' });
    }
});

// Расчет свободных слотов времени на дату для мастера
app.get('/api/v1/available-slots', async (req, res) => {
    const { date, master_id } = req.query;

    if (!date || !master_id) {
        return res.status(400).json({ error: 'Укажите date и master_id' });
    }

    const allSlots = ['10:00', '11:30', '13:00', '14:30', '16:00', '17:30', '19:00'];

    try {
        // Получаем уже занятые слоты на эту дату у выбранного мастера
        const busySlotsResult = await pool.query(
            'SELECT booking_time FROM bookings WHERE booking_date = $1 AND master_id = $2 AND status != $3',
            [date, master_id, 'cancelled']
        );

        const busySlots = busySlotsResult.rows.map(row => row.booking_time);
        const availableSlots = allSlots.filter(slot => !busySlots.includes(slot));

        res.json({
            date,
            master_id: parseInt(master_id),
            slots: availableSlots
        });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка при расчете свободных слотов' });
    }
});

// Создание записи
app.post('/api/v1/bookings', async (req, res) => {
    const { client_name, client_phone, service_id, master_id, date, slot_time } = req.body;

    if (!client_name || !client_phone || !service_id || !master_id || !date || !slot_time) {
        return res.status(400).json({ error: 'Все поля обязательны для заполнения' });
    }

    try {
        // Проверка занятости слота
        const checkSlot = await pool.query(
            'SELECT id FROM bookings WHERE booking_date = $1 AND master_id = $2 AND booking_time = $3 AND status != $4',
            [date, master_id, slot_time, 'cancelled']
        );

        if (checkSlot.rows.length > 0) {
            return res.status(409).json({ error: 'Выбранное время уже занято. Выберите другой слот.' });
        }

        const insertResult = await pool.query(
            `INSERT INTO bookings (client_name, client_phone, service_id, master_id, booking_date, booking_time)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [client_name, client_phone, service_id, master_id, date, slot_time]
        );

        res.status(201).json({
            success: true,
            message: 'Запись успешно создана!',
            booking: insertResult.rows[0]
        });
    } catch (err) {
        console.error('Ошибка создания записи:', err);
        res.status(500).json({ error: 'Ошибка при сохранении записи в базе данных' });
    }
});

// ==========================================
// АВТОРИЗАЦИЯ ДЛЯ CRM (JWT)
// ==========================================

// Логин пользователя CRM
app.post('/api/v1/auth/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Введите имя пользователя и пароль' });
    }

    try {
        const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: 'Неверное имя пользователя или пароль' });
        }

        const user = userResult.rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);

        if (!validPassword) {
            return res.status(401).json({ error: 'Неверное имя пользователя или пароль' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            success: true,
            token,
            user: { id: user.id, username: user.username, role: user.role }
        });
    } catch (err) {
        console.error('Ошибка входа:', err);
        res.status(500).json({ error: 'Ошибка сервера при авторизации' });
    }
});

// ==========================================
// ЗАЩИЩЕННЫЕ МАРШРУТЫ CRM (ТРЕБУЮТ JWT ТОКЕН)
// ==========================================

// Получить список всех записей (доступно для admin и master)
app.get('/api/v1/crm/appointments', authenticateToken, requireRole('admin', 'master'), async (req, res) => {
    try {
        const query = `
      SELECT 
        b.id,
        b.client_name,
        b.client_phone,
        b.booking_date,
        b.booking_time,
        b.status,
        s.name AS service_name,
        m.name AS master_name
      FROM bookings b
      LEFT JOIN services s ON b.service_id = s.id
      LEFT JOIN masters m ON b.master_id = m.id
      ORDER BY b.booking_date DESC, b.booking_time DESC;
    `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error('Ошибка получения CRM записей:', err);
        res.status(500).json({ error: 'Ошибка при получении записей CRM' });
    }
});

// Удаление записи (доступно только роли admin)
app.delete('/api/v1/crm/appointments/:id', authenticateToken, requireRole('admin'), async (req, res) => {
    const appointmentId = req.params.id;

    try {
        const result = await pool.query('DELETE FROM bookings WHERE id = $1 RETURNING *', [appointmentId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Запись не найдена' });
        }

        res.json({ success: true, message: 'Запись успешно удалена администратором' });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка при удалении записи' });
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен и слушает порт ${PORT}`);
});