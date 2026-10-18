// 泡泡英语 Service Worker —— 应用壳预缓存 + 运行时缓存（音频/词库）
const CACHE = 'bubble-english-v1'
const SHELL = [
  './',
  './index.html',
  './main.js',
  './manifest.json',
  './data/words.js'
]

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// 缓存优先 + 网络回退（音频文件首次播放后会被缓存，实现离线可用）
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return
  e.respondWith(
    caches.match(e.request).then(hit => {
      if (hit) return hit
      return fetch(e.request).then(res => {
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const clone = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, clone))
        }
        return res
      })
    })
  )
})
