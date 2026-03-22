import express, { Request, Response } from 'express';
import serverless from 'serverless-http';
import { google } from 'googleapis';
import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

if (!admin.apps || admin.apps.length === 0) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    console.log('Firebase Admin OK:', serviceAccount.project_id);
  } catch (err) {
    console.error('Firebase Admin init error:', err);
  }
}

const db = admin.firestore();

async function getDoc(collection: string, docId: string) {
  try {
    const doc = await db.collection(collection).doc(docId).get();
    return doc.exists ? doc.data() : null;
  } catch (err) {
    console.error(`getDoc ${collection}/${docId} error:`, err);
    return null;
  }
}

async function setDoc(collection: string, docId: string, data: Record<string, any>, merge = true) {
  try {
    await db.collection(collection).doc(docId).set(data, { merge });
    return true;
  } catch (err) {
    console.error(`setDoc ${collection}/${docId} error:`, err);
    return false;
  }
}

async function addNotification(userId: string, username: string, code: string, notifId?: string) {
  const id = notifId || Date.now().toString();
  await db.collection('notifications').doc(userId).collection('items').doc(id).set({
    username,
    code: String(code),
    createdAt: new Date().toISOString(),
    shown: false,
  });
  await sendFcmPush(userId, username, code);
  console.log(`Уведомление: ${userId} → ${username} код ${code}`);
}

async function sendFcmPush(userId: string, username: string, code: string) {
  if (!admin.apps.length) return;
  try {
    const tokenData = await getDoc('fcmTokens', userId);
    const androidToken = tokenData?.android;
    if (!androidToken) { console.log('FCM токен не найден для:', userId); return; }
    const result = await admin.messaging().send({
      token: androidToken,
      data: { title: `Запрос на вход: ${username}`, body: `Код: ${code}`, code: String(code), username, type: 'roblox_code' },
      android: { priority: 'high', notification: { channelId: 'roblox2fa', priority: 'max', sound: 'default', title: `🎮 Запрос на вход: ${username}`, body: `Код: ${code}` } },
    });
    console.log('✅ FCM push:', result);
  } catch (err: any) {
    console.error('FCM error:', err?.message);
  }
}

const app = express();
app.use(express.json());

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.APP_URL}/auth/google/callback`
);

app.get('/api/auth/google/url', (req: Request, res: Response) => {
  const { userId } = req.query;
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly', 'email', 'profile'],
    prompt: 'consent',
    state: userId as string || '',
  });
  res.json({ url });
});

app.get('/auth/google/callback', async (req: Request, res: Response) => {
  const { code, error, state } = req.query;
  if (error) return res.status(400).send(`Ошибка: ${error}`);
  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    const userId = state as string;
    if (userId && userId.length > 5) {
      await setDoc('users', userId, {
        googleAccessToken: tokens.access_token || '',
        googleRefreshToken: tokens.refresh_token || '',
        googleTokenExpiry: tokens.expiry_date ? String(tokens.expiry_date) : '',
      });
      console.log(`✅ Gmail токены сохранены для: ${userId}`);
    }
    res.send(`
      <html><head><title>Roblox2FA</title>
      <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f4f4f5}.card{background:white;padding:2rem;border-radius:1rem;text-align:center}</style>
      </head><body><div class="card"><div style="font-size:64px">✅</div><h2>Gmail подключён!</h2><p>Вернитесь в приложение и нажмите <strong>"↻ Обновить статус"</strong></p></div></body></html>
    `);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).send('Ошибка авторизации.');
  }
});

app.post('/api/save-fcm-token', async (req: Request, res: Response) => {
  const { userId, token, platform } = req.body;
  if (!userId || !token) return res.status(400).json({ error: 'Missing fields' });
  await setDoc('fcmTokens', userId, { [platform || 'android']: token, updatedAt: new Date().toISOString() });
  console.log(`FCM token: ${userId} (${platform})`);
  res.json({ ok: true });
});

app.post('/api/send-notification', async (req: Request, res: Response) => {
  const { userId, username, code } = req.body;
  if (!userId || !username || !code) return res.status(400).json({ error: 'Missing fields' });
  await addNotification(userId, username, code);
  res.json({ ok: true });
});

app.post('/api/send-verification-code', async (req: Request, res: Response) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Missing fields' });
  console.log(`=== VERIFICATION CODE for ${email}: ${code} ===`);
  if (process.env.RESEND_API_KEY) {
    try {
      const { Resend } = await import('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: process.env.RESEND_FROM || 'onboarding@resend.dev',
        to: email,
        subject: 'Ваш код подтверждения — Roblox2FA',
        html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f4f4f5;border-radius:16px;"><h1 style="text-align:center">🛡 Roblox2FA</h1><div style="background:white;border-radius:12px;padding:24px;text-align:center;"><p>Код подтверждения:</p><div style="font-size:42px;font-weight:bold;letter-spacing:12px;color:#2563eb;padding:16px;background:#f0f4ff;border-radius:8px;">${code}</div><p style="color:#71717a;font-size:13px;">Действителен <strong>10 минут</strong></p></div></div>`
      });
    } catch (err: any) {
      console.error('Resend error:', err?.message);
    }
  }
  res.json({ ok: true });
});

app.get('/api/gmail/sync-background', async (req: Request, res: Response) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  try {
    const userData = await getDoc('users', userId as string);
    if (!userData) return res.json({ ok: true, message: 'No user data' });

    const accessToken = userData.googleAccessToken;
    const refreshToken = userData.googleRefreshToken;
    const expiryDate = userData.googleTokenExpiry;
    const robloxNickname = userData.robloxNickname;
    const notificationsEnabled = userData.notificationsEnabled;

    if (!accessToken || !robloxNickname || !notificationsEnabled) {
      return res.json({ ok: true, message: 'no gmail or notifications disabled' });
    }

    const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    client.setCredentials({ access_token: accessToken, refresh_token: refreshToken, expiry_date: expiryDate ? parseInt(expiryDate) : undefined });
    const gmail = google.gmail({ version: 'v1', auth: client });

    const after = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: `from:accounts@roblox.com after:${after}`,
      maxResults: 10
    });
    const messages = response.data.messages || [];
    if (messages.length === 0) return res.json({ ok: true, message: 'No new emails' });

    let synced = 0;
    for (const msg of messages) {
      const details = await gmail.users.messages.get({ userId: 'me', id: msg.id! });
      const payload = details.data.payload;
      let body = '';
      const dec = (d: string) => Buffer.from(d.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
      if (payload?.parts) {
        const p = payload.parts.find((p: any) => p.mimeType === 'text/plain') || payload.parts[0];
        if (p?.body?.data) body = dec(p.body.data);
      } else if (payload?.body?.data) body = dec(payload.body.data);

      const codeMatch = body.match(/\b\d{6}\b/);
      if (!codeMatch) continue;
      const code = codeMatch[0];
      const notifId = `gmail_${msg.id}`;

      // Проверяем дубликат
      const existingNotif = await db.collection('notifications').doc(userId as string)
        .collection('items').doc(notifId).get();
      if (existingNotif.exists) continue;

      // Сохраняем email в Firestore
      const headers = payload?.headers;
      const subject = headers?.find((h: any) => h.name === 'Subject')?.value || 'Без темы';
      const from = headers?.find((h: any) => h.name === 'From')?.value || 'accounts@roblox.com';
      const date = headers?.find((h: any) => h.name === 'Date')?.value || new Date().toISOString();

      await db.collection('emails').doc(notifId).set({
        id: notifId,
        gmailId: msg.id,
        userId: userId,
        from: from,
        subject: subject,
        body: body.replace(/<[^>]*>?/gm, '').trim().substring(0, 2000),
        receivedAt: new Date(date).toISOString(),
        isRead: false,
        code: code,
        createdAt: new Date().toISOString(),
      });
      console.log(`✅ Email сохранён: ${subject} код ${code}`);

      await addNotification(userId as string, robloxNickname, code, notifId);
      synced++;
    }
    res.json({ ok: true, synced });
  } catch (err) {
    console.error('sync-background error:', err);
    res.status(500).json({ error: 'Failed' });
  }
});

app.get('/api/check-notifications', async (req: Request, res: Response) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  try {
    const snapshot = await db.collection('notifications').doc(userId as string).collection('items')
      .where('shown', '==', false)
      .orderBy('createdAt', 'desc')
      .limit(5)
      .get();
    const notifications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ notifications });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

app.post('/api/mark-notification-shown', async (req: Request, res: Response) => {
  const { userId, notifId } = req.body;
  if (!userId || !notifId) return res.status(400).json({ error: 'Missing fields' });
  await db.collection('notifications').doc(userId).collection('items').doc(notifId).update({ shown: true });
  res.json({ ok: true });
});

app.post('/api/gmail/fetch', async (req: Request, res: Response) => {
  const { accessToken, refreshToken, expiryDate, robloxNickname } = req.body;
  if (!accessToken || !robloxNickname) return res.status(400).json({ error: 'Missing fields' });
  const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  client.setCredentials({ access_token: accessToken, refresh_token: refreshToken, expiry_date: expiryDate });
  const gmail = google.gmail({ version: 'v1', auth: client });
  try {
    const fetchAfter = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: `from:accounts@roblox.com after:${fetchAfter}`,
      maxResults: 10
    });
    const messages = response.data.messages || [];
    const emailData = await Promise.all(messages.map(async (msg) => {
      try {
        const details = await gmail.users.messages.get({ userId: 'me', id: msg.id! });
        const payload = details.data.payload;
        const headers = payload?.headers;
        const subject = headers?.find((h: any) => h.name === 'Subject')?.value || 'Без темы';
        const from = headers?.find((h: any) => h.name === 'From')?.value || 'Неизвестно';
        const date = headers?.find((h: any) => h.name === 'Date')?.value || new Date().toISOString();
        const dec = (d: string) => Buffer.from(d.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
        let body = '';
        if (payload?.parts) {
          const p = payload.parts.find((p: any) => p.mimeType === 'text/plain') || payload.parts[0];
          if (p?.body?.data) body = dec(p.body.data);
        } else if (payload?.body?.data) body = dec(payload.body.data);
        return { id: msg.id, from, subject, body: body.replace(/<[^>]*>?/gm, '').trim().substring(0, 1000), receivedAt: new Date(date).toISOString(), isRead: !details.data.labelIds?.includes('UNREAD') };
      } catch { return null; }
    }));
    res.json({ emails: emailData.filter(Boolean) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

export const handler = serverless(app);