const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_glow_co';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Подключение к PostgreSQL (Neon / Render)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Middleware авторизации
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Доступ запрещен. Токен не предоставлен.' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Недействительный токен.' });
        req.user = user;
        next();
    });
}

function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Недостаточно прав.' });
        }
        next();
    };
}

// Инициализация базы данных
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

        // 2. Таблица мастеров с полем specialties (список ID услуг, которые мастер делает)
        await pool.query(`
      CREATE TABLE IF NOT EXISTS masters (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        role VARCHAR(100) NOT NULL,
        rating NUMERIC(2, 1) DEFAULT 5.0,
        specialties INT[] DEFAULT '{}'
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

        // 4. Таблица пользователей CRM
        await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'master'
      );
    `);

        // Заполнение начальными данными
        const servicesCount = await pool.query('SELECT COUNT(*) FROM services');
        if (parseInt(servicesCount.rows[0].count) === 0) {
            await pool.query(`
        INSERT INTO services (id, name, price, duration_minutes) VALUES
        (1, 'Женская стрижка & Укладка', 2500, 60),
        (2, 'Мужская стрижка', 1500, 45),
        (3, 'Окрашивание волос', 4500, 120),
        (4, 'Маникюр с покрытием', 2000, 60);
      `);
        }

        const mastersCount = await pool.query('SELECT COUNT(*) FROM masters');
        if (parseInt(mastersCount.rows[0].count) === 0) {
            // Мастера и их услуги:
            // Елена (1, 3) - Стрижка женская, Окрашивание
            // Дмитрий (2) - Мужская стрижка
            // Анна (4) - Маникюр
            await pool.query(`
        INSERT INTO masters (name, role, rating, specialties) VALUES
        ('Елена Смирнова', 'Топ-стилист', 4.9, '{1, 3}'),
        ('Дмитрий Петров', 'Барбер-стилист', 5.0, '{2}'),
        ('Анна Иванова', 'Мастер маникюра', 4.8, '{4}');
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

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'glow_co_salon_platform.html'));
});

// Публичные API
app.get('/api/v1/services', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM services ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка при получении услуг' });
    }
});

// Получить мастеров (с фильтрацией по услуге, если передан параметр service_id)
app.get('/api/v1/masters', async (req, res) => {
    const { service_id } = req.query;
    try {
        let query = 'SELECT * FROM masters';
        let params = [];

        if (service_id) {
            query += ' WHERE $1 = ANY(specialties)';
            params.push(parseInt(service_id));
        }

        query += ' ORDER BY id ASC';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка при получении мастеров' });
    }
});

// Доступные слоты
app.get('/api/v1/available-slots', async (req, res) => {
    const { date, master_id } = req.query;
    if (!date || !master_id) return res.status(400).json({ error: 'Укажите date и master_id' });

    const allSlots = ['10:00', '11:30', '13:00', '14:30', '16:00', '17:30', '19:00'];

    try {
        const busySlotsResult = await pool.query(
            'SELECT booking_time FROM bookings WHERE booking_date = $1 AND master_id = $2 AND status != $3',
            [date, master_id, 'cancelled']
        );

        const busySlots = busySlotsResult.rows.map(row => row.booking_time);
        const availableSlots = allSlots.filter(slot => !busySlots.includes(slot));

        res.json({ date, master_id: parseInt(master_id), slots: availableSlots });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка при получении слотов' });
    }
});

// Создание записи
app.post('/api/v1/bookings', async (req, res) => {
    const { client_name, client_phone, service_id, master_id, date, slot_time } = req.body;
    if (!client_name || !client_phone || !service_id || !master_id || !date || !slot_time) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }

    try {
        const checkSlot = await pool.query(
            'SELECT id FROM bookings WHERE booking_date = $1 AND master_id = $2 AND booking_time = $3 AND status != $4',
            [date, master_id, slot_time, 'cancelled']
        );

        if (checkSlot.rows.length > 0) {
            return res.status(409).json({ error: 'Выбранное время уже занято' });
        }

        const insertResult = await pool.query(
            `INSERT INTO bookings (client_name, client_phone, service_id, master_id, booking_date, booking_time)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [client_name, client_phone, service_id, master_id, date, slot_time]
        );

        res.status(201).json({ success: true, message: 'Запись создана!', booking: insertResult.rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка при записи' });
    }
});

// CRM Авторизация
app.post('/api/v1/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const userResult = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (userResult.rows.length === 0) return res.status(401).json({ error: 'Неверный логин или пароль' });

        const user = userResult.rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) return res.status(401).json({ error: 'Неверный логин или пароль' });

        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
        res.json({ success: true, token, user: { id: user.id, username: user.username, role: user.role } });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// CRM Записи
app.get('/api/v1/crm/appointments', authenticateToken, requireRole('admin', 'master'), async (req, res) => {
    try {
        const query = `
      SELECT b.id, b.client_name, b.client_phone, b.booking_date, b.booking_time, b.status,
             s.name AS service_name, m.name AS master_name
      FROM bookings b
      LEFT JOIN services s ON b.service_id = s.id
      LEFT JOIN masters m ON b.master_id = m.id
      ORDER BY b.booking_date DESC, b.booking_time DESC;
    `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка CRM' });
    }
});

app.delete('/api/v1/crm/appointments/:id', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM bookings WHERE id = $1 RETURNING *', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Запись не найдена' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка удаления' });
    }
});

app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));