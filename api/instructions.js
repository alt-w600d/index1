const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://tyogvnnfodqhkynfsxlq.supabase.co';

// Вставь сюда свой service_role ключ, если не используешь Environment Variables
const HARDCODED_SERVICE_KEY = 'ВСТАВЬ_СЮДА_SERVICE_ROLE_KEY';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || HARDCODED_SERVICE_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const botToken = '8604489769:AAFFW7qDAta3XfOoWKQUcFGrh2yEtPCSD2Y';
const adminChatIds = ['8296850527', '5078476951'];

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

      const { error: uploadError } = await supabaseAdmin.storage
        .from('instruction-media')
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabaseAdmin.storage
        .from('instruction-media')
        .getPublicUrl(fileName);

      media_url = urlData.publicUrl;
    }

    const { data: insertedData, error } = await supabaseAdmin
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
      .select('id')
      .single();

    if (error || !insertedData) {
      throw new Error(error ? error.message : 'Не удалось получить ID новой инструкции');
    }

    const instructionId = insertedData.id;

    const messageText = `📥 <b>Новая инструкция на модерацию!</b>\n\n` +
                        `📌 <b>Заголовок:</b> ${title}\n` +
                        `🏷 <b>Раздел:</b> ${category}\n` +
                        `📝 <b>Описание:</b>\n${description}\n\n` +
                        (media_url ? `🖼 <b>Медиа:</b> ${media_url}` : `🖼 <b>Медиа:</b> Нет файла`);

    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: '✅ Принять', callback_data: `approve_${instructionId}` },
          { text: '⏳ На удержании', callback_data: `hold_${instructionId}` },
          { text: '❌ Отклонить', callback_data: `reject_${instructionId}` }
        ]
      ]
    };

    // Безопасная отправка в Telegram с поддержкой UTF-8
    for (const chatId of adminChatIds) {
      try {
        const isImage = media_url && (media_url.endsWith('.png') || media_url.endsWith('.jpg') || media_url.endsWith('.jpeg') || media_url.endsWith('.webp'));
        const endpoint = isImage ? 'sendPhoto' : 'sendMessage';

        const payload = isImage ? {
          chat_id: chatId,
          photo: media_url,
          caption: messageText,
          parse_mode: 'HTML',
          reply_markup: inlineKeyboard
        } : {
          chat_id: chatId,
          text: messageText,
          parse_mode: 'HTML',
          reply_markup: inlineKeyboard
        };

        // Используем Buffer для явного кодирования в UTF-8, предотвращая ошибку ByteString
        const jsonBody = Buffer.from(JSON.stringify(payload), 'utf-8');

        await fetch(`https://api.telegram.org/bot${botToken}/${endpoint}`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': jsonBody.length.toString()
          },
          body: jsonBody
        });

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
