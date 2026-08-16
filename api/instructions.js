import multer from 'multer';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import TelegramBot from 'node-telegram-bot-api';

const SUPABASE_URL = 'https://tyogvnnfodqhkynfsxlq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5b2d2bm5mb2RxaGt5bmZzeGxxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4OTQxNjUsImV4cCI6MjEwMjQ3MDE2NX0.Si2JwqI7bbC_ZtVbIb_1q-JqpxWqB8UYRATkZn6_CIk';
const TELEGRAM_BOT_TOKEN = '8604489769:AAFFW7qDAta3XfOoWKQUcFGrh2yEtPCSD2Y';
const MODERATOR_CHAT_IDS = ['5078476951', '8296850527'];

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });

const upload = multer({ storage: multer.memoryStorage() });

export const config = {
  api: {
    bodyParser: false, // Отключаем встроенный парсер Vercel, чтобы multer смог забрать файл
  },
};

export default async function handler(req, res) {
  // Разрешаем CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    upload.single('media')(req, res, async (err) => {
      if (err) return res.status(500).json({ error: err.message });

      try {
        const { title, description } = req.body;
        const file = req.file;

        if (!file) return res.status(400).json({ error: 'Файл обязателен' });

        // Сжатие фото до 50%
        let compressedBuffer = file.buffer;
        if (file.mimetype.startsWith('image/')) {
          compressedBuffer = await sharp(file.buffer).jpeg({ quality: 50 }).toBuffer();
        }

        // Запись в Supabase (со статусом pending, без загрузки в Storage)
        const { data: dbData, error: dbError } = await supabase
          .from('instructions')
          .insert([{ title, description, status: 'pending' }])
          .select()
          .single();

        if (dbError) throw dbError;

        const caption = `<b>Новая заявка КИПиА (#${dbData.id})</b>\n\n<b>Заголовок:</b> ${title}\n<b>Описание:</b> ${description}`;
        const reply_markup = {
          inline_keyboard: [[
            { text: '✅ Одобрить', callback_data: `approve_${dbData.id}` },
            { text: '❌ Отклонить', callback_data: `reject_${dbData.id}` }
          ]]
        };

        // Отправка модераторам в Telegram
        const sendPromises = MODERATOR_CHAT_IDS.map(chatId => {
          if (file.mimetype.startsWith('image/')) {
            return bot.sendPhoto(chatId, compressedBuffer, { caption, parse_mode: 'HTML', reply_markup });
          } else {
            return bot.sendVideo(chatId, compressedBuffer, { caption, parse_mode: 'HTML', reply_markup });
          }
        });

        await Promise.all(sendPromises);

        return res.status(200).json({ success: true, message: 'Отправлено на модерацию!' });

      } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Ошибка сервера: ' + error.message });
      }
    });
  } else {
    res.status(405).json({ error: 'Method Not Allowed' });
  }
}
