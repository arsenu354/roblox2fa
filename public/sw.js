importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDL1yADKOkq3Q0OjVLycc8Xdb3MEdLKTkQ",
  authDomain: "project-9e35b839-f404-4a58-ae2.firebaseapp.com",
  projectId: "project-9e35b839-f404-4a58-ae2",
  messagingSenderId: "24565719329",
  appId: "1:24565719329:web:7b5f86be3e777c02585e60"
});

const messaging = firebase.messaging();

// Фоновые уведомления (сайт закрыт или в другой вкладке)
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Background message:', payload);
  const { title, body, code } = payload.data;

  self.registration.showNotification(title, {
    body: body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: payload.data,
    actions: [
      { action: 'copy', title: 'Скопировать код' }
    ],
    requireInteraction: true
  });
});

// Клик по уведомлению или кнопке
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const code = event.notification.data?.code;

  if (event.action === 'copy' && code) {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if ('focus' in client) {
            client.postMessage({ type: 'COPY_CODE', code: code });
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow('/?copy=' + code);
        }
      })
    );
  } else {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
        for (var i = 0; i < clientList.length; i++) {
          if ('focus' in clientList[i]) return clientList[i].focus();
        }
        if (clients.openWindow) return clients.openWindow('/');
      })
    );
  }
});

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});
