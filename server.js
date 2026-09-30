const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// Подключение к PostgreSQL через переменную окружения DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Проверка работы сервера
app.get('/', (req, res) => {
  res.json({ message: 'Бэкенд салона красоты работает!' });
});

// Эндпоинт получения доступных временных слотов
app.get('/api/v1/available-slots', async (req, res) => {
  const { date, master_id } = req.query;
  
  // Пример логики слотов: возвращаем стандартную сетку
  const allSlots = ["09:00", "10:30", "12:00", "14:00", "15:30", "17:00", "18:30"];
  
  res.json({
    date: date || new Date().toISOString().split('T')[0],
    master_id: master_id || 1,
    slots: allSlots
  });
});

// Эндпоинт создания записи
app.post('/api/v1/bookings', async (req, res) => {
  const { client_name, client_phone, service_id, staff_id, slot_time } = req.body;
  
  // В реальном проекте здесь выполняется INSERT запрос в PostgreSQL
  res.status(201).json({
    success: true,
    booking_id: Math.floor(Math.random() * 10000),
    details: { client_name, client_phone, service_id, staff_id, slot_time }
  });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});