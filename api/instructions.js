const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tyogvnnfodqhkynfsxlq.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5b2d2bm5mb2RxaGt5bmZzeGxxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4OTQxNjUsImV4cCI6MjEwMjQ3MDE2NX0.Si2JwqI7bbC_ZtVbIb_1q-JqpxWqB8UYRATkZn6_CIk';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const botToken = '8604489769:AAFFW7qDAta3XfOoWKQUcFGrh2yEtPCSD2Y';
const adminChatIds = ['8296850527', '5078476951']; // Твои два аккаунта

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

function runMiddleware(req, res, fn) {
  return new Promise((resolve, reject) => {
    fn(req, res, (result) => {
      if (result instanceof Error) return reject(result);
      return resolve(result);
    });
  });
}

export const config = {
  api: { bodyParser: false }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Метод не поддерживается' });
  }

  try {
    await runMiddleware(req, res, upload.any());

    const { title, category, description } = req.body;
    let media_url = null;

    if (req.files && req.files.length > 0) {
      const file = req.files[0];
      const fileExt = path.extname(file.originalname);
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('instruction-media')
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('instruction-media')
        .getPublicUrl(fileName);

      media_url = urlData.publicUrl;
    }

    // Сохраняем в базу и сразу получаем ID созданной записи (.select())
    const { data: insertedData, error } = await supabase
      .from('instructions')
      .insert([
        {
          title,
          category,
          description,
          media_url,
          status: 'pending'
        }
      ])
      .select();

    if (error) throw error;

    const newInstruction = insertedData[0];

    // Формируем текст сообщения
    const messageText = `📥 <b>Новая инструкция на модерацию!</b>\n\n` +
                        `📌 <b>Заголовок:</b> ${title}\n` +
                        `🏷 <b>Раздел:</b> ${category}\n` +
                        `📝 <b>Описание:</b>\n${description}\n\n` +
                        (media_url ? `🖼 <b>Медиа:</b> ${media_url}` : `🖼 <b>Медиа:</b> Нет файла`);

    // Кнопки: слева Принять, по центру На удержании, справа Отклонить
    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: '✅ Принять', callback_data: `approve_${newInstruction.id}` },
          { text: '⏳ На удержании', callback_data: `hold_${newInstruction.id}` },
          { text: '❌ Отклонить', callback_data: `reject_${newInstruction.id}` }
        ]
      ]
    };

    // Рассылаем на оба аккаунта
    for (const chatId of adminChatIds) {
      try {
        const isImage = media_url && (media_url.endsWith('.png') || media_url.endsWith('.jpg') || media_url.endsWith('.jpeg') || media_url.endsWith('.webp'));
        
        if (isImage) {
          await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              photo: media_url,
              caption: messageText,
              parse_mode: 'HTML',
              reply_markup: inlineKeyboard
            })
          });
        } else {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: messageText,
              parse_mode: 'HTML',
              reply_markup: inlineKeyboard
            })
          });
        }
      } catch (tgErr) {
        console.error(`Ошибка отправки админу ${chatId}:`, tgErr);
      }
    }

    return res.status(200).json({ success: true, message: 'Успешно отправлено' });
  } catch (err) {
    console.error('Ошибка Vercel API:', err);
    return res.status(500).json({ error: err.message || 'Ошибка сервера' });
  }
}
