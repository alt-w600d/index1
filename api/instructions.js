const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const https = require('https');

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://tyogvnnfodqhkynfsxlq.supabase.co').trim();

// Вставленный ключ service_role
const HARDCODED_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5b2d2bm5mb2RxaGt5bmZzeGxxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Njg5NDE2NSwiZXhwIjoyMTAyNDcwMTY1fQ.qquUwFCvu9MBTHLwDyrh0rIluH-jD5KlNNuphsZxv3E';

// Очистка ключа от спецсимволов и пробелов
const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY || HARDCODED_SERVICE_KEY;
const SUPABASE_SERVICE_ROLE_KEY = String(rawKey).trim().replace(/[^\x00-\x7F]/g, '');

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

function sendTelegramRequest(endpoint, payload) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(payload), 'utf8');

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${botToken}/${endpoint}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': data.length
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve(body));
    });

    req.on('error', (e) => reject(e));
    req.write(data);
    req.end();
  });
}

export const config = {
  api: { bodyParser: false }
};

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    await runMiddleware(req, res, upload.any());

    const title = String(req.body.title || '');
    const category = String(req.body.category || '');
    const description = String(req.body.description || '');

    let media_url = null;

    if (req.files && req.files.length > 0) {
      const file = req.files[0];
      const safeFileName = `file_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.png`;
      const uploadUrl = `${SUPABASE_URL}/storage/v1/object/instruction-media/${safeFileName}`;

      await new Promise((resolve, reject) => {
        const urlObj = new URL(uploadUrl);
        const reqSupabase = https.request({
          hostname: urlObj.hostname,
          port: 443,
          path: urlObj.pathname,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'apiKey': SUPABASE_SERVICE_ROLE_KEY,
            'Content-Type': 'image/png',
            'Content-Length': file.buffer.length
          }
        }, (resSup) => {
          if (resSup.statusCode >= 200 && resSup.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`Storage HTTP Status ${resSup.statusCode}`));
          }
        });

        reqSupabase.on('error', reject);
        reqSupabase.write(file.buffer);
        reqSupabase.end();
      });

      media_url = `${SUPABASE_URL}/storage/v1/object/public/instruction-media/${safeFileName}`;
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
      throw new Error(error ? `DB insert failed: ${error.message}` : 'Failed to retrieve instruction ID');
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

        await sendTelegramRequest(endpoint, payload);
      } catch (tgErr) {
        console.error(`Ошибка отправки админу ${chatId}:`, tgErr);
      }
    }

    return res.status(200).json({ success: true, message: 'OK' });
  } catch (err) {
    console.error('Ошибка Vercel API:', err);
    return res.status(500).json({ error: String(err.message || err) });
  }
}
