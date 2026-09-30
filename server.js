const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();

// Настройка CORS (разрешает запросы с любых веб-сайтов и HTML-страниц)
app.use(cors());
app.use(express.json());

// Подключение к PostgreSQL через переменные окружения
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
        ? { rejectUnauthorized: false }
        : false
});

// Автоматическое создание таблиц в базе данных при запуске сервера
async function initDatabase() {
    if (!process.env.DATABASE_URL) {
        console.log('DATABASE_URL не указан. База данных не подключена.');
        return;
    }

    const createTablesQuery = `
    CREATE TABLE IF NOT EXISTS services (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(100) NOT NULL,
      duration_minutes INT NOT NULL,
      price DECIMAL(10, 2) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS masters (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      role VARCHAR(100) NOT NULL,
      rating DECIMAL(3, 2) DEFAULT 5.0
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id SERIAL PRIMARY KEY,
      client_name VARCHAR(255) NOT NULL,
      client_phone VARCHAR(50) NOT NULL,
      service_id INT REFERENCES services(id) ON DELETE SET NULL,
      master_id INT REFERENCES masters(id) ON DELETE SET NULL,
      booking_date DATE NOT NULL,
      booking_time VARCHAR(10) NOT NULL,
      status VARCHAR(50) DEFAULT 'confirmed',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

    try {
        const client = await pool.connect();
        await client.query(createTablesQuery);

        // Проверяем, есть ли начальные данные
        const serviceCheck = await client.query('SELECT COUNT(*) FROM services');
        if (parseInt(serviceCheck.rows[0].count) === 0) {
            await client.query(`
        INSERT INTO services (name, category, duration_minutes, price) VALUES
        ('Женская стрижка & Укладка', 'Волосы', 60, 3500.00),
        ('Сложное окрашивание (Airtouch)', 'Волосы', 180, 12000.00),
        ('Аппаратный Маникюр + Гель-лак', 'Ногли', 90, 2800.00),
        ('Архитектура и окрашивание бровей', 'Брови/Ресницы', 45, 1800.00);
      `);
        }

        const masterCheck = await client.query('SELECT COUNT(*) FROM masters');
        if (parseInt(masterCheck.rows[0].count) === 0) {
            await client.query(`
        INSERT INTO masters (name, role, rating) VALUES
        ('Анна Смирнова', 'Топ-Стилист', 4.9),
        ('Елена Васильева', 'Мастер Маникюра', 4.85),
        ('Мария Иванова', 'Бровист', 5.0);
      `);
        }

        client.release();
        console.log('✅ База данных успешно инициализирована!');
    } catch (err) {
        console.error('⚠️️ Ошибка инициализации базы данных:', err.message);
    }
}

// Запуск инициализации БД
initDatabase();

// --- 1. ПРОВЕРКА РАБОТОСПОСОБНОСТИ СЕРВЕРА ---
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        message: 'Бэкенд системы онлайн-записи салона красоты успешно работает!',
        timestamp: new Date()
    });
});

// --- 2. ПОЛУЧЕНИЕ СПИСКА УСЛУГ ---
app.get('/api/v1/services', async (req, res) => {
    try {
        if (!process.env.DATABASE_URL) {
            // Мок-данные для локального тестирования без подключенной БД
            return res.json([
                { id: 1, name: 'Женская стрижка & Укладка', category: 'Волосы', duration_minutes: 60, price: 3500 },
                { id: 2, name: 'Сложное окрашивание (Airtouch)', category: 'Волосы', duration_minutes: 180, price: 12000 },
                { id: 3, name: 'Аппаратный Маникюр + Гель-лак', category: 'Ногли', duration_minutes: 90, price: 2800 },
                { id: 4, name: 'Архитектура и окрашивание бровей', category: 'Брови/Ресницы', duration_minutes: 45, price: 1800 }
            ]);
        }
        const { rows } = await pool.query('SELECT * FROM services ORDER BY category, id');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера при получении услуг' });
    }
});

// --- 3. ПОЛУЧЕНИЕ СПИСКА МАСТЕРОВ ---
app.get('/api/v1/masters', async (req, res) => {
    try {
        if (!process.env.DATABASE_URL) {
            return res.json([
                { id: 1, name: 'Анна Смирнова', role: 'Топ-Стилист', rating: 4.9 },
                { id: 2, name: 'Елена Васильева', role: 'Мастер Маникюра', rating: 4.85 },
                { id: 3, name: 'Мария Иванова', role: 'Бровист', rating: 5.0 }
            ]);
        }
        const { rows } = await pool.query('SELECT * FROM masters ORDER BY id');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера при получении мастеров' });
    }
});

// --- 4. ПОЛУЧЕНИЕ СВОБОДНЫХ ВРЕМЕННЫХ СЛОТОВ ---
app.get('/api/v1/available-slots', async (req, res) => {
    try {
        const { date, master_id } = req.query;
        const targetDate = date || new Date().toISOString().split('T')[0];

        // Стандартная сетка всех рабочих слотов мастера
        const allPossibleSlots = ["10:00", "11:30", "13:00", "14:30", "16:00", "17:30", "19:00"];

        if (!process.env.DATABASE_URL) {
            return res.json({ date: targetDate, master_id: master_id || 1, slots: allPossibleSlots });
        }

        // Извлекаем уже занятые слоты мастера на эту дату
        const bookedQuery = `
      SELECT booking_time FROM appointments 
      WHERE booking_date = $1 AND master_id = $2 AND status != 'cancelled'
    `;
        const { rows } = await pool.query(bookedQuery, [targetDate, master_id || 1]);
        const bookedTimes = rows.map(r => r.booking_time);

        // Фильтруем свободной время
        const availableSlots = allPossibleSlots.filter(time => !bookedTimes.includes(time));

        res.json({
            date: targetDate,
            master_id: parseInt(master_id) || 1,
            slots: availableSlots
        });
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера при получении слотов' });
    }
});

// --- 5. СОЗДАНИЕ НОВОЙ ЗАПИСИ (БРОНИРОВАНИЕ) ---
app.post('/api/v1/bookings', async (req, res) => {
    try {
        const { client_name, client_phone, service_id, master_id, date, slot_time } = req.body;

        if (!client_name || !client_phone || !date || !slot_time) {
            return res.status(400).json({ error: 'Заполните все обязательные поля' });
        }

        if (!process.env.DATABASE_URL) {
            return res.status(201).json({
                success: true,
                message: 'Запись успешно создана (режим демонстрации)',
                booking: { id: Math.floor(Math.random() * 9000) + 1000, client_name, client_phone, date, slot_time }
            });
        }

        // Вставляем запись в базу данных
        const insertQuery = `
      INSERT INTO appointments (client_name, client_phone, service_id, master_id, booking_date, booking_time)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
        const values = [client_name, client_phone, service_id || 1, master_id || 1, date, slot_time];
        const { rows } = await pool.query(insertQuery, values);

        res.status(201).json({
            success: true,
            message: 'Запись успешно создана!',
            booking: rows[0]
        });
    } catch (err) {
        console.error('Ошибка записи:', err);
        res.status(500).json({ error: 'Ошибка сервера при создании записи' });
    }
});

// --- 6. ПОЛУЧЕНИЕ ВСЕХ ЗАПИСЕЙ (ДЛЯ CRM ПАНЕЛИ) ---
app.get('/api/v1/crm/appointments', async (req, res) => {
    try {
        if (!process.env.DATABASE_URL) {
            return res.json([
                {
                    id: 101,
                    client_name: 'Виктория К.',
                    client_phone: '+7 (999) 123-45-67',
                    service_name: 'Женская стрижка & Укладка',
                    master_name: 'Анна Смирнова',
                    booking_date: '2026-10-01',
                    booking_time: '11:30',
                    status: 'confirmed'
                }
            ]);
        }

        const query = `
      SELECT 
        a.id, 
        a.client_name, 
        a.client_phone, 
        s.name AS service_name, 
        m.name AS master_name, 
        a.booking_date, 
        a.booking_time, 
        a.status
      FROM appointments a
      LEFT JOIN services s ON a.service_id = s.id
      LEFT JOIN masters m ON a.master_id = m.id
      ORDER BY a.booking_date DESC, a.booking_time ASC
    `;
        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера при получении списка записей' });
    }
});

// Запуск сервера
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Сервер бэкенда запущен на порту ${PORT}`);
});