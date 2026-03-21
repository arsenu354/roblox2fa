import express, { Request, Response } from 'express';
import serverless from 'serverless-http';
import { google } from 'googleapis';
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import dotenv from 'dotenv';

dotenv.config();

// ─── Firebase Admin ─────────────────────────────────────────────────────────
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      // Netlify хранит \n как строку — восстанавливаем переносы
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

// Используем именованную базу данных (из firebase-applet-config.json)
const FIRESTORE_DB_ID = 'ai-studio-e2d53176-9f05-45e7-bb6c-d7bf3e802157';
const db = getFirestore(admin.app(), FIRESTORE_DB_ID);
const fcm = getMessaging(admin.app());

// ─── Отправка 2FA уведомления ────────────────────────────────────────────────
async function sendTwoFANotification(userId: string, username: string, code: string) {
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    const fcmTokens = userDoc.data()?.fcmTokens as Record<string, string> | undefined;
    if (!fcmTokens) {
      console.log(`Нет FCM токенов для ${userId}`);
      return;
    }

    const promises = Object.entries(fcmTokens).map(([platform, token]) => {
      console.log(`Отправка FCM [${platform}] → ${username}, код: ${code}`);
      return fcm.send({
        token,
        // data payload — обрабатывается Android даже когда приложение закрыто
        data: {
          title: `Запрос на вход в аккаунт Roblox: ${username}`,
          body: `Код: ${code}`,
          code: String(code),
          username,
        },
        android: {
          priority: 'high',
          ttl: 60_000, // 1 минута — коды устаревают
        },
        webpush: {
          headers: { Urgency: 'high' },
          notification: {
            title: `Запрос на вход в аккаунт Roblox: ${username}`,
            body: `Код: ${code}`,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            actions: [{ action: 'copy', title: 'Скопировать код' }],
            requireInteraction: true,
          },
          data: { code: String(code) },
        },
      }).catch(err => {
        console.error(`FCM ошибка [${platform}]:`, err?.message);
        // Если токен протух — удаляем
        if (err?.code === 'messaging/registration-token-not-registered') {
          return db.collection('users').doc(userId).update({
            [`fcmTokens.${platform}`]: admin.firestore.FieldValue.delete(),
          });
        }
      });
    });

    await Promise.all(promises);
  } catch (err) {
    console.error('sendTwoFANotification error:', err);
  }
}

// ─── Express App ─────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.APP_URL}/auth/google/callback`
);

// GET /api/auth/google/url
app.get('/api/auth/google/url', (req: Request, res: Response) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'email',
      'profile',
    ],
    prompt: 'consent',
  });
  res.json({ url });
});

// GET /auth/google/callback
app.get('/auth/google/callback', async (req: Request, res: Response) => {
  const { code, error } = req.query;

  if (error) {
    return res.status(400).send(`Ошибка авторизации: ${error}`);
  }

  try {
    const { tokens } = await oauth2Client.getToken(code as string);

    res.send(`
      <html>
        <head>
          <title>Авторизация Roblox2FA</title>
          <style>
            body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f4f4f5; color: #18181b; }
            .card { background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); text-align: center; }
            .spinner { border: 3px solid #f3f3f3; border-top: 3px solid #2563eb; border-radius: 50%; width: 24px; height: 24px; animation: spin 1s linear infinite; margin: 1rem auto; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Авторизация успешна!</h2>
            <p>Передаем данные в приложение...</p>
            <div class="spinner"></div>
          </div>
          <script>
            setTimeout(() => {
              if (window.opener) {
                window.opener.postMessage({
                  type: 'GOOGLE_AUTH_SUCCESS',
                  tokens: ${JSON.stringify(tokens)}
                }, '*');
                setTimeout(() => window.close(), 500);
              } else {
                window.location.href = '/';
              }
            }, 1000);
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('OAuth Token Exchange Error:', err);
    res.status(500).send('Ошибка при обмене кода. Попробуйте ещё раз.');
  }
});

// POST /api/save-fcm-token
app.post('/api/save-fcm-token', async (req: Request, res: Response) => {
  const { userId, token, platform } = req.body;

  if (!userId || !token || !platform) {
    return res.status(400).json({ error: 'Missing userId, token or platform' });
  }

  try {
    await db.collection('users').doc(userId).set(
      { fcmTokens: { [platform]: token } },
      { merge: true }
    );
    console.log(`FCM token сохранён: ${userId} (${platform})`);
    res.json({ ok: true });
  } catch (err) {
    console.error('save-fcm-token error:', err);
    res.status(500).json({ error: 'Failed to save token' });
  }
});

// POST /api/send-notification
app.post('/api/send-notification', async (req: Request, res: Response) => {
  const { userId, username, code } = req.body;

  if (!userId || !username || !code) {
    return res.status(400).json({ error: 'Missing userId, username or code' });
  }

  await sendTwoFANotification(userId, username, code);
  res.json({ ok: true });
});

// POST /api/gmail/fetch
app.post('/api/gmail/fetch', async (req: Request, res: Response) => {
  const { accessToken, refreshToken, expiryDate, robloxNickname } = req.body;

  if (!accessToken || !robloxNickname) {
    return res.status(400).json({ error: 'Missing tokens or nickname' });
  }

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({ error: 'Missing Google credentials' });
  }

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: expiryDate,
  });

  const gmail = google.gmail({ version: 'v1', auth: client });

  try {
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: `from:accounts@roblox.com ${robloxNickname}`,
      maxResults: 10,
    });

    const messages = response.data.messages || [];

    const emailData = await Promise.all(
      messages.map(async (msg) => {
        try {
          const details = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id!,
          });

          const payload = details.data.payload;
          const headers = payload?.headers;
          const subject =
            headers?.find((h) => h.name === 'Subject')?.value || 'Без темы';
          const from =
            headers?.find((h) => h.name === 'From')?.value || 'Неизвестно';
          const date =
            headers?.find((h) => h.name === 'Date')?.value ||
            new Date().toISOString();

          const decodeBase64 = (data: string) =>
            Buffer.from(
              data.replace(/-/g, '+').replace(/_/g, '/'),
              'base64'
            ).toString();

          let body = '';
          if (payload?.parts) {
            let textPart = payload.parts.find(
              (p) => p.mimeType === 'text/plain'
            );
            if (!textPart && payload.parts.length > 0)
              textPart = payload.parts[0];
            if (textPart?.body?.data) {
              body = decodeBase64(textPart.body.data);
            } else if (textPart?.parts) {
              const subPart = textPart.parts.find(
                (p) => p.mimeType === 'text/plain'
              );
              if (subPart?.body?.data) body = decodeBase64(subPart.body.data);
            }
          } else if (payload?.body?.data) {
            body = decodeBase64(payload.body.data);
          }

          body = body.replace(/<[^>]*>?/gm, '').trim();

          return {
            id: msg.id,
            from,
            subject,
            body: body.substring(0, 1000),
            receivedAt: new Date(date).toISOString(),
            isRead: !details.data.labelIds?.includes('UNREAD'),
          };
        } catch (msgErr) {
          console.error(`Error fetching message ${msg.id}:`, msgErr);
          return null;
        }
      })
    );

    res.json({ emails: emailData.filter(Boolean) });
  } catch (err) {
    console.error('Gmail Fetch Error:', err);
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

export const handler = serverless(app);
