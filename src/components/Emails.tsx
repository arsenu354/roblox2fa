import React, { useEffect, useState } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  orderBy, 
  addDoc, 
  deleteDoc, 
  doc, 
  updateDoc,
  getDoc
} from 'firebase/firestore';
import { Mail, Trash2, RefreshCw, CheckCircle, Clock, AlertCircle, X, Copy, ExternalLink, ArrowLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx } from 'clsx';

export function Emails() {
  const [emails, setEmails] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isSyncingRef = React.useRef(false);
  const [userProfile, setUserProfile] = useState<any>(null);
  const userProfileRef = React.useRef<any>(null);

  useEffect(() => {
    userProfileRef.current = userProfile;
  }, [userProfile]);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<any>(null);

  useEffect(() => {
    // Handle messages from Service Worker
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type === 'COPY_CODE' && event.data.code) {
        try {
          await navigator.clipboard.writeText(event.data.code);
        } catch (err) {
          console.error('Clipboard API failed, using fallback', err);
          const textArea = document.createElement("textarea");
          textArea.value = event.data.code;
          document.body.appendChild(textArea);
          textArea.focus();
          textArea.select();
          try {
            document.execCommand('copy');
          } catch (err) {
            console.error('Fallback copy failed', err);
          }
          document.body.removeChild(textArea);
        }
      }
    };

    // Handle initial copy from URL
    const urlParams = new URLSearchParams(window.location.search);
    const copyCodeFromUrl = urlParams.get('copy');
    if (copyCodeFromUrl) {
      navigator.clipboard.writeText(copyCodeFromUrl);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Слушаем новые уведомления от сервера (записанные через /api/send-notification)
  useEffect(() => {
    if (!auth.currentUser) return;
    const userId = auth.currentUser.uid;

    const notifQuery = query(
      collection(db, 'notifications', userId, 'items'),
      where('shown', '==', false),
      orderBy('createdAt', 'desc')
    );

    const unsubNotif = onSnapshot(notifQuery, async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        if (change.type === 'added') {
          const data = change.doc.data();
          const { username, code, createdAt } = data;

          // Не показываем старые уведомления при первом подключении
          const ageMs = Date.now() - new Date(createdAt).getTime();
          if (ageMs > 30_000) continue; // старше 30 секунд — пропускаем

          // Показываем уведомление
          const title = `Запрос на вход в аккаунт Roblox: ${username}`;
          const body = `Код: ${code}`;
          const options: any = {
            body,
            icon: '/icon-192.png',
            tag: change.doc.id,
            requireInteraction: true,
            data: { code },
            actions: [{ action: 'copy', title: 'Скопировать код' }],
          };

          if ('serviceWorker' in navigator) {
            const reg = await navigator.serviceWorker.ready;
            reg.showNotification(title, options);
          } else if (Notification.permission === 'granted') {
            new Notification(title, options);
          }

          // Помечаем как показанное
          await fetch('/api/mark-notification-shown', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, notifId: change.doc.id }),
          });
        }
      }
    });

    return () => unsubNotif();
  }, []);

  useEffect(() => {
    // Request notification permission
    if ("Notification" in window) {
      if (Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
      }
    }
    if (!auth.currentUser) {
      console.warn('Emails component mounted without auth.currentUser');
      return;
    }

    // Listen to user profile to get Roblox nickname and Google tokens
    const unsubscribeProfile = onSnapshot(doc(db, 'users', auth.currentUser.uid), (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setUserProfile(data);
      }
    }, (err) => {
      console.error('Error listening to profile:', err);
      handleFirestoreError(err, OperationType.GET, `users/${auth.currentUser?.uid}`);
    });

    const q = query(
      collection(db, 'emails'),
      where('userId', '==', auth.currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const emailData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })).sort((a: any, b: any) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
      setEmails(emailData);
      setLoading(false);
    }, (error) => {
      console.error('Error listening to emails:', error);
      // If it's a permission error or index error, we still want to stop loading
      setLoading(false);
    });

    return () => {
      unsubscribeProfile();
      unsubscribe();
    };
  }, []);

  // Automatic sync every 3 seconds (silent)
  useEffect(() => {
    if (!userProfile?.googleAccessToken || !userProfile?.notificationsEnabled) {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'STOP_BACKGROUND_SYNC' });
      }
      if (!userProfile?.googleAccessToken) return;
    }

    // Initial sync
    syncGmail(true, true);

    const interval = setInterval(() => {
      syncGmail(true, false);
    }, 3000);

    // Start background sync in Service Worker
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller && userProfile?.notificationsEnabled) {
      navigator.serviceWorker.controller.postMessage({
        type: 'START_BACKGROUND_SYNC',
        token: userProfile.googleAccessToken,
        nickname: userProfile.robloxNickname
      });
    }

    return () => {
      clearInterval(interval);
      // We do NOT send STOP_BACKGROUND_SYNC here because we want it to continue running
      // when the app is closed or in the background.
    };
  }, [userProfile?.googleAccessToken, userProfile?.robloxNickname, userProfile?.notificationsEnabled]);

  const extractCode = (text: string) => {
    const match = text.match(/\b\d{6}\b/);
    return match ? match[0] : null;
  };

  const showNotification = async (email: any) => {
    const currentProfile = userProfileRef.current;
    if (!("Notification" in window) || Notification.permission !== "granted" || !currentProfile?.notificationsEnabled) return;

    const code = extractCode(email.body);
    const title = `Запрос на вход в аккаунт Roblox: ${currentProfile?.robloxNickname || 'Пользователь'}`;
    const body = code ? `Код: ${code}` : email.subject;

    const options: any = {
      body: body,
      icon: '/favicon.ico',
      tag: email.id,
      requireInteraction: true,
      data: { code: code }
    };

    // Add actions if supported and code exists
    if (code) {
      options.actions = [
        { action: 'copy', title: 'Скопировать код' }
      ];
    }

    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready;
      registration.showNotification(title, options);
    } else {
      const notification = new Notification(title, options);
      notification.onclick = () => {
        window.focus();
        setSelectedEmail(email);
        if (code) {
          navigator.clipboard.writeText(code);
        }
        notification.close();
      };
    }
  };

  const syncGmail = async (silent = false, isInitialSync = false) => {
    const currentProfile = userProfileRef.current;
    if (!auth.currentUser || !currentProfile || isSyncingRef.current) return;
    
    if (!currentProfile.googleAccessToken) {
      return;
    }

    isSyncingRef.current = true;
    if (!silent) {
      setIsRefreshing(true);
    }
    setSyncError(null);

    try {
      const response = await fetch('/api/gmail/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: currentProfile.googleAccessToken,
          refreshToken: currentProfile.googleRefreshToken,
          expiryDate: currentProfile.googleTokenExpiry,
          robloxNickname: currentProfile.robloxNickname
        })
      });

      if (!response.ok) {
        let errorMessage = 'Ошибка при получении писем';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (e) {
          // Fallback if not JSON
        }
        throw new Error(errorMessage);
      }

      const { emails: gmailEmails } = await response.json();
      
      // Save new emails to Firestore using setDoc with deterministic ID
      const { setDoc, getDoc } = await import('firebase/firestore');
      
      const newEmailsFound: any[] = [];

      const savePromises = gmailEmails.map(async (email: any) => {
        const emailId = `${auth.currentUser!.uid}_${email.id}`;
        const emailRef = doc(db, 'emails', emailId);
        const existingDoc = await getDoc(emailRef);
        
        if (!existingDoc.exists()) {
          newEmailsFound.push(email);
          return setDoc(emailRef, {
            userId: auth.currentUser!.uid,
            from: email.from,
            subject: email.subject,
            body: email.body,
            receivedAt: email.receivedAt,
            isRead: email.isRead,
            gmailId: email.id
          });
        }
        return Promise.resolve();
      });

      await Promise.all(savePromises);
      
      if (newEmailsFound.length > 0 && !isInitialSync) {
        // Show notification for the most recent one
        showNotification(newEmailsFound[0]);
      }

    } catch (err: any) {
      if (!silent) {
        console.error("Sync Error:", err);
        setSyncError(err.message || 'Не удалось синхронизировать Gmail');
      }
    } finally {
      isSyncingRef.current = false;
      if (!silent) {
        setIsRefreshing(false);
      }
    }
  };

  const simulateNewEmail = async () => {
    // Keep this for testing if needed, but we'll prioritize syncGmail
    if (!auth.currentUser || !userProfile) return;
    setIsRefreshing(true);
    
    // Simulate a delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    const mockEmail = {
      userId: auth.currentUser.uid,
      from: 'accounts@roblox.com',
      subject: 'Код подтверждения Roblox (Тест)',
      body: `Привет, ${userProfile.robloxNickname}! Ваш код подтверждения: ${Math.floor(100000 + Math.random() * 900000)}.`,
      receivedAt: new Date().toISOString(),
      isRead: false
    };

    try {
      await addDoc(collection(db, 'emails'), mockEmail);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'emails');
    } finally {
      setIsRefreshing(false);
    }
  };

  const deleteEmail = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'emails', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `emails/${id}`);
    }
  };

  const markAsRead = async (id: string) => {
    try {
      await updateDoc(doc(db, 'emails', id), { isRead: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `emails/${id}`);
    }
  };

  const openEmail = (email: any) => {
    setSelectedEmail(email);
    if (!email.isRead) {
      markAsRead(email.id);
    }
  };

  const copyCode = (text: string) => {
    const code = extractCode(text);
    if (code) {
      navigator.clipboard.writeText(code);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AnimatePresence>
        {selectedEmail && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white dark:bg-zinc-900 w-full max-w-2xl rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.1)] dark:shadow-2xl overflow-hidden border border-zinc-100 dark:border-zinc-800"
            >
              <div className="p-6 border-b border-zinc-50 dark:border-zinc-800 flex items-center justify-between">
                <button 
                  onClick={() => setSelectedEmail(null)}
                  className="flex items-center gap-2 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
                >
                  <ArrowLeft className="w-5 h-5" />
                  <span className="font-medium">Назад</span>
                </button>
                <div className="flex gap-2">
                  <button 
                    onClick={() => copyCode(selectedEmail.body)}
                    className="p-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-xl hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                    title="Скопировать код"
                  >
                    <Copy className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={() => setSelectedEmail(null)}
                    className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-xl transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="p-8 overflow-y-auto max-h-[70vh]">
                <div className="mb-8">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-2xl flex items-center justify-center">
                      <Mail className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <h4 className="font-bold text-zinc-900 dark:text-white break-all">{selectedEmail.from}</h4>
                      <p className="text-sm text-zinc-500">{new Date(selectedEmail.receivedAt).toLocaleString('ru-RU')}</p>
                    </div>
                  </div>
                  <h2 className="text-2xl font-black text-zinc-900 dark:text-white leading-tight break-words">
                    {selectedEmail.subject}
                  </h2>
                </div>
                
                <div className="bg-zinc-50 dark:bg-zinc-950 p-6 rounded-2xl border border-zinc-100 dark:border-zinc-800 mb-8">
                  <p className="text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-words leading-relaxed font-medium">
                    {selectedEmail.body}
                  </p>
                </div>

                {extractCode(selectedEmail.body) && (
                  <div className="flex flex-col items-center justify-center p-8 bg-blue-600 rounded-3xl text-white shadow-xl shadow-blue-600/20">
                    <span className="text-blue-100 text-sm font-bold uppercase tracking-widest mb-2">Ваш код подтверждения</span>
                    <span className="text-5xl font-black tracking-tighter mb-6">{extractCode(selectedEmail.body)}</span>
                    <button 
                      onClick={() => copyCode(selectedEmail.body)}
                      className="flex items-center gap-2 px-8 py-3 bg-white text-blue-600 font-bold rounded-2xl hover:bg-blue-50 transition-all active:scale-95"
                    >
                      <Copy className="w-5 h-5" />
                      Скопировать код
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">Входящие письма</h2>
          {userProfile?.robloxNickname && (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Мониторинг Roblox:</span>
              <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-xs font-bold">
                {userProfile.robloxNickname}
              </span>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => syncGmail(false)}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-all disabled:opacity-50 shadow-lg shadow-blue-600/20 active:scale-95"
          >
            <RefreshCw className={clsx("w-4 h-4", isRefreshing && "animate-spin")} />
            <span>{isRefreshing ? 'Синхронизация...' : 'Обновить'}</span>
          </button>
        </div>
      </div>

      {syncError && (
        <div className="p-4 bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 rounded-2xl flex items-center gap-3 text-red-600 dark:text-red-400">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium">{syncError}</p>
        </div>
      )}

      {emails.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 bg-white dark:bg-zinc-900 rounded-3xl border border-dashed border-zinc-200 dark:border-zinc-800 shadow-sm">
          <Mail className="w-12 h-12 text-zinc-300 dark:text-zinc-700 mb-4" />
          <p className="text-zinc-500 dark:text-zinc-400 font-medium text-center px-6 max-w-sm">
            {userProfile?.googleAccessToken 
              ? 'Писем от accounts@roblox.com пока нет. Нажмите "Обновить", чтобы проверить почту.'
              : 'Gmail не подключен. Подключите его в настройках, чтобы получать реальные письма.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {emails.map((email) => (
              <motion.div
                key={email.id}
                layout
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                onClick={() => openEmail(email)}
                className={clsx(
                  "p-5 bg-white dark:bg-zinc-900 rounded-2xl border transition-all group cursor-pointer",
                  email.isRead 
                    ? "border-zinc-100 dark:border-zinc-800 opacity-75 hover:opacity-100 hover:border-zinc-200 dark:hover:border-zinc-700" 
                    : "border-blue-100 dark:border-blue-900/30 shadow-[0_4px_12px_rgba(59,130,246,0.05)] hover:shadow-[0_8px_20px_rgba(59,130,246,0.1)] hover:border-blue-300 dark:hover:border-blue-700"
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="flex-1 min-w-0 text-[10px] font-black text-blue-600 dark:text-blue-400 uppercase tracking-widest truncate">
                        {email.from}
                      </span>
                      {!email.isRead && (
                        <span className="w-2 h-2 bg-blue-600 rounded-full shadow-sm shadow-blue-600/50" />
                      )}
                    </div>
                    <h3 className="text-lg font-bold text-zinc-900 dark:text-white truncate mb-1">
                      {email.subject}
                    </h3>
                    <p className="text-zinc-500 dark:text-zinc-400 text-sm line-clamp-2 leading-relaxed break-words">
                      {email.body}
                    </p>
                    <div className="flex flex-wrap items-center gap-4 mt-4">
                      <div className="flex items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500 font-medium">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{new Date(email.receivedAt).toLocaleString('ru-RU')}</span>
                      </div>
                      {email.isRead && (
                        <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 font-medium">
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>Прочитано</span>
                        </div>
                      )}
                      {extractCode(email.body) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            copyCode(email.body);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-xl text-xs font-bold hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-all border border-blue-100/50 dark:border-blue-900/30"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>Код: {extractCode(email.body)}</span>
                        </button>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteEmail(email.id);
                    }}
                    className="p-2 text-zinc-300 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-xl transition-all"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
