import express, { Request, Response } from 'express';
import serverless from 'serverless-http';
import { google } from 'googleapis';
import admin from 'firebase-admin';

// Firebase init
if (!admin.apps?.length) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccount) {
    console.error("❌ FIREBASE_SERVICE_ACCOUNT is missing");
  } else {
    try {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(serviceAccount)),
      });
      console.log("✅ Firebase initialized");
    } catch (e) {
      console.error("❌ Firebase init error:", e);
    }
  }
}

const db = admin.firestore();

async function getDoc(col: string, docId: string) {
  try {
    const doc = await db.collection(col).doc(docId).get();
    return doc.exists ? doc.data() : null;
  } catch (err) { return null; }
}

async function setDoc(col: string, docId: string, data: any, merge = true) {
  try {
    await db.collection(col).doc(docId).set(data, { merge });
    return true;
  } catch (err) { console.error('setDoc error:', err); return false; }
}

async function sendFcmPush(userId: string, username: string, code: string) {
  try {
    const tokenData = await getDoc('fcmTokens', userId);
    const token = tokenData?.android;
    if (!token) return;
    await admin.messaging().send({
      token,
      data: { code, username, type: 'roblox_code' },
      android: {
        priority: 'high',
        notification: {
          channelId: 'roblox2fa',
          title: `🎮 Запрос на вход: ${username}`,
          body: `Код: ${code}`,
          sound: 'default',
        }
      },
    });
    console.log('✅ FCM push sent');
  } catch (err: any) { console.error('FCM error:', err?.message); }
}

async function addNotification(userId: string, username: string, code: string, notifId?: string) {
  const id = notifId || Date.now().toString();
  await db.collection('notifications').doc(userId).collection('items').doc(id).set({
    username, code: String(code),
    createdAt: new Date().toISOString(),
    shown: false,
  });
  await sendFcmPush(userId, username, code);
}

const app = express();
app.use(express.json());

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.APP_URL}/auth/google/callback`
);

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, firebase: admin.apps.length > 0 });
});

// Gmail OAuth URL
app.get('/api/auth/google/url', (req: Request, res: Response) => {
  const { userId } = req.query;
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly', 'email', 'profile'],
    prompt: 'consent',
    state: (userId as string) || '',
  });
  res.json({ url });
});

// Gmail OAuth Callback
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
        googleTokenExpiry: tokens.expiry_date?.toString() || '',
      });
      console.log(`✅ Gmail токены сохранены для: ${userId}`);
    }
    res.send(`
      <html><head><title>Roblox2FA</title>
      <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f4f4f5}.card{background:white;padding:2rem;border-radius:1rem;text-align:center;box-shadow:0 4px 6px rgba(0,0,0,.1)}</style>
      </head><body><div class="card"><div style="font-size:64px">✅</div><h2>Gmail подключён!</h2><p>Вернитесь в приложение и нажмите <strong>"↻ Обновить статус"</strong></p></div></body></html>
    `);
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).send('Ошибка авторизации.');
  }
});

// Save FCM token
app.post('/api/save-fcm-token', async (req: Request, res: Response) => {
  const { userId, token, platform } = req.body;
  if (!userId || !token) return res.status(400).json({ error: 'Missing fields' });
  await setDoc('fcmTokens', userId, { [platform || 'android']: token, updatedAt: new Date().toISOString() });
  console.log(`FCM token saved: ${userId}`);
  res.json({ ok: true });
});

// Send notification
app.post('/api/send-notification', async (req: Request, res: Response) => {
  const { userId, username, code } = req.body;
  if (!userId || !username || !code) return res.status(400).json({ error: 'Missing fields' });
  await addNotification(userId, username, code);
  res.json({ ok: true });
});

// Send verification code
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
    } catch (err: any) { console.error('Resend error:', err?.message); }
  }
  res.json({ ok: true });
});

// Gmail sync background
app.get('/api/gmail/sync-background', async (req: Request, res: Response) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  try {
    const userData = await getDoc('users', userId as string);
    if (!userData) return res.json({ ok: true, message: 'No user data' });

    const { googleAccessToken: accessToken, googleRefreshToken: refreshToken,
            googleTokenExpiry: expiryDate, robloxNickname, notificationsEnabled } = userData;

    if (!accessToken || !robloxNickname || !notificationsEnabled) {
      return res.json({ ok: true, message: 'no gmail or notifications disabled' });
    }

    const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    client.setCredentials({ access_token: accessToken, refresh_token: refreshToken,
      expiry_date: expiryDate ? parseInt(expiryDate) : undefined });
    const gmail = google.gmail({ version: 'v1', auth: client });

    const after = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
    const response = await gmail.users.messages.list({
      userId: 'me', q: `from:accounts@roblox.com after:${after}`, maxResults: 10
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

      const existingNotif = await db.collection('notifications').doc(userId as string)
        .collection('items').doc(notifId).get();
      if (existingNotif.exists) continue;

      const headers = payload?.headers;
      const subject = headers?.find((h: any) => h.name === 'Subject')?.value || 'Без темы';
      const from = headers?.find((h: any) => h.name === 'From')?.value || 'accounts@roblox.com';
      const date = headers?.find((h: any) => h.name === 'Date')?.value || new Date().toISOString();

      await db.collection('emails').doc(notifId).set({
        id: notifId, gmailId: msg.id, userId,
        from, subject,
        body: body.replace(/<[^>]*>?/gm, '').trim().substring(0, 2000),
        receivedAt: new Date(date).toISOString(),
        isRead: false, code,
        createdAt: new Date().toISOString(),
      });

      await addNotification(userId as string, robloxNickname, code, notifId);
      synced++;
    }
    res.json({ ok: true, synced });
  } catch (err) {
    console.error('sync-background error:', err);
    res.status(500).json({ error: 'Failed' });
  }
});

// Check notifications
app.get('/api/check-notifications', async (req: Request, res: Response) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'Missing userId' });
  try {
    const snapshot = await db.collection('notifications').doc(userId as string)
      .collection('items').where('shown', '==', false)
      .orderBy('createdAt', 'desc').limit(5).get();
    const notifications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ notifications });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// Mark notification shown
app.post('/api/mark-notification-shown', async (req: Request, res: Response) => {
  const { userId, notifId } = req.body;
  if (!userId || !notifId) return res.status(400).json({ error: 'Missing fields' });
  await db.collection('notifications').doc(userId).collection('items').doc(notifId).update({ shown: true });
  res.json({ ok: true });
});

export default serverless(app);