import React, { useState } from 'react';
import { useTheme, Theme } from '../hooks/useTheme';
import { Sun, Moon, Monitor, Palette, Bell, Shield, Trash2, Mail, CheckCircle, AlertCircle, RefreshCw, ExternalLink } from 'lucide-react';
import { clsx } from 'clsx';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { doc, updateDoc, deleteDoc, getDoc, collection, query, where, getDocs, onSnapshot } from 'firebase/firestore';
import { deleteUser } from 'firebase/auth';

export function Settings() {
  const { theme, setTheme } = useTheme();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [userProfile, setUserProfile] = React.useState<any>(null);

  const [robloxNickname, setRobloxNickname] = useState('');
  const [isSavingNickname, setIsSavingNickname] = useState(false);
  const [isUpdatingNotifications, setIsUpdatingNotifications] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const isIframe = typeof window !== 'undefined' && window !== window.parent;
  const isIOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isSafari = typeof navigator !== 'undefined' && /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  const isStandalone = typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches;

  React.useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallClick = async () => {
    if (isIframe) {
      setShowInstallGuide(true);
      return;
    }
    
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else {
      setShowInstallGuide(true);
    }
  };

  React.useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;

    const updatePermission = () => {
      const current = Notification.permission;
      if (current !== permissionStatus) {
        setPermissionStatus(current);
      }
    };

    updatePermission();
    window.addEventListener('focus', updatePermission);
    const interval = setInterval(updatePermission, 1000);
    
    return () => {
      window.removeEventListener('focus', updatePermission);
      clearInterval(interval);
    };
  }, [permissionStatus]);

  React.useEffect(() => {
    if (!auth.currentUser) return;
    const unsubscribe = onSnapshot(doc(db, 'users', auth.currentUser.uid), (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        setUserProfile(data);
        setRobloxNickname(data.robloxNickname || '');
      }
    }, (err) => {
      handleFirestoreError(err, OperationType.GET, `users/${auth.currentUser?.uid}`);
    });
    return () => unsubscribe();
  }, []);

  const handleSaveNickname = async () => {
    if (!auth.currentUser || !robloxNickname.trim()) return;
    setIsSavingNickname(true);
    try {
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        robloxNickname: robloxNickname.trim()
      });
      alert('Никнейм Roblox успешно обновлен!');
    } catch (err) {
      console.error('Error updating nickname:', err);
      handleFirestoreError(err, OperationType.UPDATE, `users/${auth.currentUser.uid}`);
    } finally {
      setIsSavingNickname(false);
    }
  };

  const themeOptions: { id: Theme; label: string; icon: any }[] = [
    { id: 'light', label: 'Светлая', icon: Sun },
    { id: 'dark', label: 'Темная', icon: Moon },
    { id: 'system', label: 'Системная', icon: Monitor },
  ];

  const handleDeleteAccount = async () => {
    if (!auth.currentUser) return;
    const user = auth.currentUser;
    const userId = user.uid;
    setIsDeleting(true);
    
    try {
      // 1. First, try to delete the user from Auth.
      // This is the most likely step to fail due to security (requires-recent-login).
      // We do this BEFORE deleting Firestore data to avoid orphaned data if Auth deletion fails.
      // Wait, if we delete Auth first, we can't delete Firestore data because of security rules.
      
      // Correct approach for Firebase:
      // Re-authentication is usually required.
      // Since we don't have a re-auth UI, we'll try to delete Firestore data first,
      // but we'll catch the Auth error and explain it.
      
      // 1. Delete Firestore data
      // Delete user emails first
      const emailsQuery = query(collection(db, 'emails'), where('userId', '==', userId));
      const emailsSnapshot = await getDocs(emailsQuery);
      const deletePromises = emailsSnapshot.docs.map(emailDoc => deleteDoc(emailDoc.ref));
      await Promise.all(deletePromises);

      // Delete user doc
      await deleteDoc(doc(db, 'users', userId));
      
      // 2. Delete Auth user
      await deleteUser(user);
      window.location.reload();
    } catch (err: any) {
      console.error('Delete Account Error:', err);
      if (err.code === 'auth/requires-recent-login') {
        alert('Для удаления аккаунта требуется недавний вход в систему. Пожалуйста, выйдите из аккаунта и войдите снова, чтобы подтвердить свою личность.');
      } else {
        alert('Ошибка при удалении аккаунта: ' + (err.message || 'Неизвестная ошибка'));
      }
    } finally {
      setIsDeleting(false);
      setShowConfirm(false);
    }
  };

  const handleConnectGmail = async () => {
    setIsConnecting(true);
    try {
      const response = await fetch('/api/auth/google/url');
      const { url } = await response.json();
      window.open(url, 'google_auth', 'width=600,height=700');
    } catch (err) {
      console.error('Connect Gmail Error:', err);
    } finally {
      setIsConnecting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!auth.currentUser?.email) return;
    try {
      const { sendPasswordResetEmail } = await import('firebase/auth');
      await sendPasswordResetEmail(auth, auth.currentUser.email);
      alert('Инструкции по сбросу пароля отправлены на ваш Email.');
    } catch (err) {
      console.error('Reset Password Error:', err);
      alert('Ошибка при отправке письма для сброса пароля.');
    }
  };

  const toggleNotifications = async () => {
    if (!auth.currentUser) return;
    setNotificationError(null);
    
    // If we're enabling, request permission first
    if (!userProfile?.notificationsEnabled) {
      if (!("Notification" in window)) {
        setNotificationError('Ваш браузер не поддерживает уведомления.');
        return;
      }
      
      try {
        const permission = await Notification.requestPermission();
        setPermissionStatus(permission);
        if (permission !== 'granted') {
          setNotificationError('Пожалуйста, разрешите уведомления в настройках браузера. Если вы в превью-режиме, попробуйте открыть приложение в новой вкладке.');
          return;
        }
      } catch (e) {
        console.error('Permission request error:', e);
        setNotificationError('Не удалось запросить разрешение. Попробуйте открыть приложение в новой вкладке.');
        return;
      }
    }

    setIsUpdatingNotifications(true);
    try {
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        notificationsEnabled: !userProfile?.notificationsEnabled
      });
    } catch (err) {
      console.error('Error updating notifications:', err);
      handleFirestoreError(err, OperationType.UPDATE, `users/${auth.currentUser.uid}`);
    } finally {
      setIsUpdatingNotifications(false);
    }
  };

  const checkPermissionManually = async () => {
    if (!("Notification" in window)) return;
    setNotificationError(null);
    const permission = await Notification.requestPermission();
    setPermissionStatus(permission);
    if (permission === 'granted') {
      alert('Уведомления разрешены в браузере! Теперь вы можете включить их в приложении.');
    }
  };

  return (
    <div className="space-y-8 max-w-2xl">
      <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">Настройки</h2>

      {/* Roblox Profile Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-3 text-zinc-400 dark:text-zinc-500">
          <Shield className="w-5 h-5" />
          <h3 className="font-black uppercase tracking-widest text-[10px]">Профиль Roblox</h3>
        </div>
        <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-100 dark:border-zinc-800 p-8 shadow-[0_8px_30px_rgba(0,0,0,0.02)]">
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-bold text-zinc-900 dark:text-white mb-3">
                Никнейм Roblox
              </label>
              <div className="flex gap-3">
                <input 
                  type="text"
                  value={robloxNickname}
                  onChange={(e) => setRobloxNickname(e.target.value)}
                  placeholder="Введите ваш никнейм"
                  className="flex-1 px-5 py-3 bg-zinc-50/50 dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800 rounded-2xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all text-zinc-900 dark:text-white font-medium"
                />
                <button
                  onClick={handleSaveNickname}
                  disabled={isSavingNickname || robloxNickname === userProfile?.robloxNickname}
                  className="px-8 py-3 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all disabled:opacity-50 shadow-lg shadow-blue-600/20 active:scale-95"
                >
                  {isSavingNickname ? '...' : 'Сохранить'}
                </button>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-3 leading-relaxed">
                Приложение будет искать письма от <span className="font-mono font-bold text-blue-600 dark:text-blue-400">accounts@roblox.com</span>, содержащие этот никнейм.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Gmail Connection Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-3 text-zinc-400 dark:text-zinc-500">
          <Mail className="w-5 h-5" />
          <h3 className="font-black uppercase tracking-widest text-[10px]">Подключение почты</h3>
        </div>
        <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-100 dark:border-zinc-800 p-8 shadow-[0_8px_30px_rgba(0,0,0,0.02)]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <div className="flex-1">
              <p className="font-bold text-zinc-900 dark:text-white text-lg">Google Gmail</p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
                {userProfile?.googleAccessToken 
                  ? 'Почта успешно подключена. Мониторинг активен.' 
                  : 'Подключите Gmail, чтобы приложение могло автоматически находить письма с кодами.'}
              </p>
            </div>
            <button 
              onClick={handleConnectGmail}
              disabled={isConnecting}
              className={clsx(
                "px-8 py-3 rounded-2xl font-bold transition-all flex-shrink-0 text-sm active:scale-95",
                userProfile?.googleAccessToken
                  ? "bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400 border border-green-100 dark:border-green-800 hover:bg-green-100"
                  : "bg-blue-600 text-white hover:bg-blue-700 shadow-[0_8px_20px_rgba(37,99,235,0.2)]"
              )}
            >
              {isConnecting ? 'Загрузка...' : userProfile?.googleAccessToken ? 'Переподключить' : 'Подключить Gmail'}
            </button>
          </div>
        </div>
      </section>

      {/* Notifications Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-3 text-zinc-400 dark:text-zinc-500">
          <Bell className="w-5 h-5" />
          <h3 className="font-black uppercase tracking-widest text-[10px]">Уведомления</h3>
        </div>
        <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-100 dark:border-zinc-800 p-8 shadow-[0_8px_30px_rgba(0,0,0,0.02)]">
          <div className="space-y-6">
            {permissionStatus === 'denied' ? (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                  <div className="flex-1">
                    <p className="font-bold text-red-600 dark:text-red-500 text-lg">Браузер блокирует уведомления</p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
                      Вы заблокировали уведомления для этого сайта. Пожалуйста, разрешите их в настройках браузера.
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 min-w-[180px]">
                    <button 
                      onClick={checkPermissionManually}
                      className="px-4 py-2 bg-blue-600 text-white rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all flex items-center justify-center gap-2 shadow-[0_8px_20px_rgba(37,99,235,0.2)]"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Проверить
                    </button>
                    <button 
                      onClick={() => window.open(window.location.href, '_blank')}
                      className="px-4 py-2 bg-zinc-50/50 dark:bg-zinc-800 text-zinc-900 dark:text-white rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-all flex items-center justify-center gap-2 border border-zinc-100 dark:border-zinc-700"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Новая вкладка
                    </button>
                  </div>
                </div>

                <div className="p-6 bg-zinc-50 dark:bg-zinc-950 rounded-2xl border border-zinc-100 dark:border-zinc-800">
                  <div className="flex items-center gap-2.5 mb-5">
                    <AlertCircle className="w-4 h-4 text-blue-600" />
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">Инструкция по включению</p>
                  </div>
                  <ul className="space-y-4">
                    <li className="flex gap-4 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                      <span className="flex-shrink-0 w-6 h-6 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg flex items-center justify-center text-[10px] font-black">1</span>
                      <span>Нажмите на иконку <strong>настроек (или замка)</strong> в адресной строке браузера (сверху слева).</span>
                    </li>
                    <li className="flex gap-4 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                      <span className="flex-shrink-0 w-6 h-6 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg flex items-center justify-center text-[10px] font-black">2</span>
                      <span>Найдите пункт <strong>"Уведомления"</strong> и переключите его в положение <strong>"Разрешить"</strong>.</span>
                    </li>
                    <li className="flex gap-4 text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                      <span className="flex-shrink-0 w-6 h-6 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg flex items-center justify-center text-[10px] font-black">3</span>
                      <span>Если вы используете приложение (PWA), проверьте настройки уведомлений в <strong>настройках телефона/ПК</strong>.</span>
                    </li>
                  </ul>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                  <div className="flex-1">
                    <p className="font-bold text-zinc-900 dark:text-white text-lg">Статус уведомлений</p>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
                      {userProfile?.notificationsEnabled
                        ? 'Уведомления включены. Вы будете получать оповещения о новых кодах.'
                        : 'Уведомления выключены. Включите их, чтобы получать коды мгновенно.'}
                    </p>
                  </div>
                  <button 
                    onClick={toggleNotifications}
                    disabled={isUpdatingNotifications || !("Notification" in window)}
                    className={clsx(
                      "px-8 py-3 rounded-2xl font-bold transition-all flex-shrink-0 text-sm active:scale-95",
                      userProfile?.notificationsEnabled
                        ? "bg-red-50 text-red-600 dark:bg-red-900/10 dark:text-red-400 border border-red-100 dark:border-red-800 hover:bg-red-100"
                        : "bg-blue-600 text-white hover:bg-blue-700 shadow-[0_8px_20px_rgba(37,99,235,0.2)]"
                    )}
                  >
                    {isUpdatingNotifications ? '...' : userProfile?.notificationsEnabled ? 'Выключить' : 'Включить'}
                  </button>
                </div>
                {notificationError && (
                  <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-xs rounded-xl border border-red-100 dark:border-red-900/30 font-medium">
                    {notificationError}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Installation Guide */}
      <section className="space-y-4">
        <div className="flex items-center gap-3 text-zinc-500 dark:text-zinc-400">
          <RefreshCw className="w-5 h-5" />
          <h3 className="font-bold uppercase tracking-wider text-xs">Как установить приложение</h3>
        </div>
        <div className="bg-blue-50 dark:bg-blue-900/10 rounded-3xl border border-blue-100 dark:border-blue-900/30 p-8">
          <div className="mb-8 p-6 bg-white dark:bg-zinc-900 rounded-2xl border border-blue-200 dark:border-blue-800 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <p className="font-bold text-zinc-900 dark:text-white text-lg">Установить приложение</p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                Установите приложение на устройство для лучшей работы в фоновом режиме и быстрого доступа.
              </p>
            </div>
            <button
              onClick={handleInstallClick}
              className="px-8 py-3 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-[0_8px_20px_rgba(37,99,235,0.2)] whitespace-nowrap active:scale-95"
            >
              Скачать приложение
            </button>
          </div>
          <div className="space-y-6">
            <div className="flex gap-4">
              <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">1</div>
              <div>
                <p className="font-bold dark:text-white">На компьютере (Chrome/Edge)</p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                  Нажмите на иконку <span className="inline-block px-1.5 py-0.5 bg-zinc-200 dark:bg-zinc-800 rounded text-xs">⊞</span> (Установить) в правой части адресной строки браузера.
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">2</div>
              <div>
                <p className="font-bold dark:text-white">На iPhone / iPad</p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                  Нажмите кнопку "Поделиться" (квадрат со стрелкой вверх) и выберите <span className="font-bold">"На экран «Домой»"</span>.
                </p>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold flex-shrink-0">3</div>
              <div>
                <p className="font-bold dark:text-white">На Android</p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                  Нажмите на три точки в углу браузера и выберите <span className="font-bold">"Установить приложение"</span> или "Добавить на гл. экран".
                </p>
              </div>
            </div>
            <div className="pt-4 border-t border-blue-100 dark:border-blue-900/30">
              <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                После установки приложение будет работать как отдельная программа и сможет присылать уведомления в фоновом режиме.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Theme Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-3 text-zinc-500 dark:text-zinc-400">
          <Palette className="w-5 h-5" />
          <h3 className="font-bold uppercase tracking-wider text-xs">Внешний вид</h3>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {themeOptions.map((option) => (
            <button
              key={option.id}
              onClick={() => setTheme(option.id)}
              className={clsx(
                "flex flex-col items-center gap-3 p-4 rounded-2xl border transition-all",
                theme === option.id
                  ? "bg-blue-50 border-blue-200 text-blue-600 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-400"
                  : "bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:bg-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-700"
              )}
            >
              <option.icon className="w-6 h-6" />
              <span className="text-sm font-medium">{option.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Security Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-3 text-zinc-500 dark:text-zinc-400">
          <Shield className="w-5 h-5" />
          <h3 className="font-bold uppercase tracking-wider text-xs">Безопасность и Аккаунт</h3>
        </div>
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold dark:text-white">Пароль</p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Сбросить пароль через Email</p>
            </div>
            <button 
              onClick={handleResetPassword}
              className="text-sm font-bold text-blue-600 dark:text-blue-400 hover:underline"
            >
              Сбросить
            </button>
          </div>
          
          <div className="h-px bg-zinc-100 dark:bg-zinc-800" />
          
          <div>
            <p className="font-bold text-red-600 dark:text-red-400 mb-2">Опасная зона</p>
            <button 
              onClick={() => setShowConfirm(true)}
              className="w-full flex items-center justify-center gap-2 py-3 bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400 font-bold rounded-xl hover:bg-red-100 dark:hover:bg-red-900/20 transition-all border border-red-100 dark:border-red-900/20"
            >
              <Trash2 className="w-5 h-5" />
              Удалить аккаунт
            </button>
          </div>
        </div>
      </section>

      {/* Install Guide Modal */}
      {showInstallGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 max-w-md w-full shadow-2xl border border-zinc-200 dark:border-zinc-800 relative">
            <button 
              onClick={() => setShowInstallGuide(false)} 
              className="absolute top-6 right-6 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
            >
              ✕
            </button>
            <h3 className="text-xl font-bold dark:text-white mb-6">Установка приложения</h3>
            
            {isIframe ? (
              <div className="space-y-6">
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300 rounded-xl text-sm leading-relaxed">
                  <strong>Почему нет кнопки?</strong> Вы находитесь внутри окна предпросмотра. Браузеры запрещают устанавливать приложения изнутри других сайтов.
                </div>
                <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  Чтобы установить приложение, его необходимо открыть в отдельной вкладке браузера.
                </p>
                <button 
                  onClick={() => { window.open(window.location.href, '_blank'); setShowInstallGuide(false); }}
                  className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
                >
                  <ExternalLink className="w-5 h-5" />
                  Открыть в новой вкладке
                </button>
              </div>
            ) : isStandalone ? (
              <div className="space-y-6 text-center">
                <div className="w-16 h-16 bg-green-100 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="w-8 h-8" />
                </div>
                <p className="text-lg font-bold text-zinc-900 dark:text-white">Приложение уже установлено!</p>
                <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  Вы уже используете установленную версию приложения. Уведомления могут работать в фоновом режиме.
                </p>
              </div>
            ) : isIOS && !isSafari ? (
              <div className="space-y-6">
                <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300 rounded-xl text-sm leading-relaxed">
                  <strong>Apple запрещает установку из этого браузера.</strong> Вы используете Chrome, Telegram или другой браузер на iPhone/iPad.
                </div>
                <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  Чтобы установить приложение на iOS, вам <strong>необходимо</strong> открыть эту ссылку в стандартном браузере <strong>Safari</strong>.
                </p>
                <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl border border-zinc-100 dark:border-zinc-800 break-all text-xs font-mono text-zinc-500">
                  {window.location.href}
                </div>
              </div>
            ) : (
              <div className="space-y-4 text-sm text-zinc-600 dark:text-zinc-400">
                <p className="leading-relaxed">Ваш браузер не поддерживает автоматическую установку по кнопке, или вы отклонили ее ранее.</p>
                <div className="p-5 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl space-y-4 border border-zinc-100 dark:border-zinc-800">
                  <p className="leading-relaxed"><strong className="text-zinc-900 dark:text-white block mb-1">🍏 На iPhone/iPad (Safari):</strong>Нажмите кнопку «Поделиться» (квадрат со стрелочкой) внизу экрана и выберите «На экран "Домой"».</p>
                  <p className="leading-relaxed"><strong className="text-zinc-900 dark:text-white block mb-1">🤖 На Android (Chrome):</strong>Нажмите меню (три точки) в правом верхнем углу и выберите «Установить приложение» или «Добавить на гл. экран».</p>
                  <p className="leading-relaxed"><strong className="text-zinc-900 dark:text-white block mb-1">💻 На ПК (Chrome/Edge):</strong>Нажмите на значок установки (монитор со стрелочкой) в правой части адресной строки.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-8 max-w-md w-full shadow-2xl border border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center justify-center w-16 h-16 bg-red-100 dark:bg-red-900/20 rounded-full mb-6 mx-auto">
              <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
            </div>
            <h3 className="text-xl font-bold text-center dark:text-white mb-2">Вы уверены?</h3>
            <p className="text-zinc-500 dark:text-zinc-400 text-center mb-8">
              Это действие необратимо. Все ваши данные и настройки будут удалены навсегда.
            </p>
            <div className="flex gap-4">
              <button 
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-3 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white font-bold rounded-xl hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all"
              >
                Отмена
              </button>
              <button 
                onClick={handleDeleteAccount}
                disabled={isDeleting}
                className="flex-1 py-3 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 transition-all disabled:opacity-50"
              >
                {isDeleting ? 'Удаление...' : 'Да, удалить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
