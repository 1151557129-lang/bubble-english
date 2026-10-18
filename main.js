/**
 * 泡泡英语 - H5 入口
 * 自由泡泡模式（点破发音）+ 听音找词闯关模式（判对错 + 星星结算）
 */
import CATEGORIES from './data/words.js'

// ===== 配置常量 =====
const BUBBLE_COUNT = 16           // 自由模式同屏泡泡数
const BUBBLE_MIN_R = 46
const BUBBLE_MAX_R = 68
const FLOAT_SPEED = 0.4
const WORD_CARD_MS = 1600         // 单词卡片显示时长
const QUIZ_CHOICES = 4            // 闯关每题的选项数
const QUIZ_PER_ROUND = 10         // 闯关每轮题目数

const PALETTE = [
  'rgba(255,107,157,', 'rgba(78,205,196,', 'rgba(255,230,109,',
  'rgba(149,225,211,', 'rgba(243,129,129,', 'rgba(170,150,218,',
  'rgba(168,230,207,', 'rgba(255,211,182,', 'rgba(110,198,255,', 'rgba(181,234,215,'
]
const PRAISE = ['great_job', 'excellent', 'well_done']

// ===== 全局状态 =====
let categories = []
let currentCat = null
let muted = false
let mode = 'home'                 // 'home' | 'free' | 'quiz'

const bubbles = []                // 自由模式泡泡
const particles = []              // 粒子（两模式共用）
let quiz = null                   // 闯关状态

// ===== 画布初始化（DPR 高清适配）=====
const canvas = document.getElementById('game')
const ctx = canvas.getContext('2d')
const dpr = window.devicePixelRatio || 1
const W = window.innerWidth
const H = window.innerHeight
canvas.width = Math.floor(W * dpr)
canvas.height = Math.floor(H * dpr)
canvas.style.width = W + 'px'
canvas.style.height = H + 'px'
ctx.scale(dpr, dpr)

// ===== 工具 =====
const el = id => document.getElementById(id)

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }

// ===== 存储与统计 =====
const STORE_PREFIX = 'be_'
function getStorage(key, def) {
  try {
    const v = localStorage.getItem(STORE_PREFIX + key)
    return v === null ? def : JSON.parse(v)
  } catch (e) { return def }
}
function setStorage(key, val) {
  try { localStorage.setItem(STORE_PREFIX + key, JSON.stringify(val)) } catch (e) {}
}

let stats = getStorage('stats', { totalQuizzes: 0, totalCorrect: 0, totalWrong: 0, wordsLearned: [], byCategory: {} })
let disabledCats = getStorage('disabledCats', [])

function saveStats() { setStorage('stats', stats) }
function saveDisabledCats() { setStorage('disabledCats', disabledCats) }

function recordCorrect(word) {
  stats.totalCorrect++
  const c = stats.byCategory[currentCat.id] || { quizzes: 0, correct: 0, wrong: 0 }
  c.correct++
  stats.byCategory[currentCat.id] = c
  if (!stats.wordsLearned.includes(word.id)) stats.wordsLearned.push(word.id)
  saveStats()
}
function recordWrong() {
  stats.totalWrong++
  const c = stats.byCategory[currentCat.id] || { quizzes: 0, correct: 0, wrong: 0 }
  c.wrong++
  stats.byCategory[currentCat.id] = c
  saveStats()
}
function recordQuizDone() {
  stats.totalQuizzes++
  const c = stats.byCategory[currentCat.id] || { quizzes: 0, correct: 0, wrong: 0 }
  c.quizzes++
  stats.byCategory[currentCat.id] = c
  saveStats()
}

// ===== 音频管理 =====
const audio = {
  ctx: null,
  wordCache: new Map(),
  phraseCache: new Map(),

  wake() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)() } catch (e) {}
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume()
  },

  preloadCategory(cat) {
    if (!cat) return
    cat.words.forEach(w => {
      if (this.wordCache.has(w.id)) return
      const a = new Audio(`audio/words/${w.id}.mp3`)
      a.preload = 'auto'
      this.wordCache.set(w.id, a)
    })
  },

  playWord(word) {
    if (muted) return
    const a = this.wordCache.get(word.id)
    if (a) {
      a.currentTime = 0
      a.play().catch(() => this._ttsFallback(word.word))
    } else {
      this._ttsFallback(word.word)
    }
  },

  playPhrase(name, onEnd) {
    if (muted) { if (onEnd) onEnd(); return }
    if (!this.phraseCache.has(name)) {
      this.phraseCache.set(name, new Audio(`audio/phrases/${name}.mp3`))
    }
    const a = this.phraseCache.get(name)
    a.onended = onEnd ? () => onEnd() : null
    a.currentTime = 0
    a.play().catch(() => { if (onEnd) onEnd() })
  },

  _ttsFallback(text) {
    try {
      if (!('speechSynthesis' in window)) return
      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'en-US'
      u.rate = 0.85
      speechSynthesis.cancel()
      speechSynthesis.speak(u)
    } catch (e) {}
  },

  pop() {
    if (muted || !this.ctx) return
    const ac = this.ctx
    const t = ac.currentTime
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(420, t)
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.1)
    gain.gain.setValueAtTime(0.25, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13)
    osc.connect(gain).connect(ac.destination)
    osc.start(t)
    osc.stop(t + 0.14)
  }
}

// ===== 泡泡绘制（自由/闯关共用）=====
function drawBubbleShape(cx, cy, r, word, color, alpha, highlight) {
  const grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r)
  grad.addColorStop(0, color + '0.9)')
  grad.addColorStop(1, color + alpha + ')')
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = grad
  ctx.fill()

  // 答对时的绿色光环
  if (highlight) {
    ctx.beginPath()
    ctx.arc(cx, cy, r + 6, 0, Math.PI * 2)
    ctx.lineWidth = 5
    ctx.strokeStyle = 'rgba(76,217,100,.9)'
    ctx.stroke()
  }

  // 高光点
  ctx.beginPath()
  ctx.arc(cx - r * 0.35, cy - r * 0.4, r * 0.16, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,.55)'
  ctx.fill()

  // emoji
  ctx.font = `${Math.floor(r * 0.72)}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(word.emoji, cx, cy - r * 0.12)

  // 英文单词
  ctx.font = `700 ${Math.floor(r * 0.3)}px -apple-system, "PingFang SC", sans-serif`
  ctx.fillStyle = 'rgba(255,255,255,.95)'
  ctx.fillText(word.word, cx, cy + r * 0.44)
}

// ===== 粒子 =====
function spawnParticles(x, y, n, spd, color) {
  for (let i = 0; i < n; i++) {
    const ang = (Math.PI * 2 * i) / n + Math.random() * 0.5
    const s = spd * (0.5 + Math.random())
    particles.push({
      x, y,
      vx: Math.cos(ang) * s,
      vy: Math.sin(ang) * s - 1,
      r: 2 + Math.random() * 4,
      color,
      life: 1
    })
  }
}
function spawnCelebration(x, y) {
  for (let i = 0; i < 30; i++) {
    const ang = Math.random() * Math.PI * 2
    const s = 2 + Math.random() * 4
    particles.push({
      x, y,
      vx: Math.cos(ang) * s,
      vy: Math.sin(ang) * s - 1.5,
      r: 3 + Math.random() * 5,
      color: pick(PALETTE),
      life: 1
    })
  }
}
function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]
    p.x += p.vx
    p.y += p.vy
    p.vy += 0.12
    p.vx *= 0.98
    p.life -= 0.03
    if (p.life <= 0) particles.splice(i, 1)
  }
}
function drawParticles() {
  particles.forEach(p => {
    ctx.globalAlpha = Math.max(0, p.life)
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
    ctx.fillStyle = p.color + '0.9)'
    ctx.fill()
  })
  ctx.globalAlpha = 1
}

// ===== 自由模式 =====
function makeBubble(word) {
  const r = BUBBLE_MIN_R + Math.random() * (BUBBLE_MAX_R - BUBBLE_MIN_R)
  return {
    word,
    color: pick(PALETTE),
    x: r + Math.random() * (W - r * 2),
    y: H + r + Math.random() * H * 0.5,
    r,
    vy: FLOAT_SPEED * (0.7 + Math.random() * 0.8),
    wobbleAmp: 8 + Math.random() * 18,
    wobbleFreq: 0.008 + Math.random() * 0.012,
    phase: Math.random() * Math.PI * 2,
    alpha: 0.55
  }
}
function randomWordFromCurrent() {
  if (!currentCat || !currentCat.words.length) return null
  return pick(currentCat.words)
}
function initBubbles() {
  bubbles.length = 0
  for (let i = 0; i < BUBBLE_COUNT; i++) {
    const w = randomWordFromCurrent()
    if (w) bubbles.push(makeBubble(w))
  }
}
function updateFree() {
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i]
    b.phase += b.wobbleFreq
    b.y -= b.vy
    if (b.y < -b.r - 20) {
      const w = randomWordFromCurrent()
      if (w) bubbles[i] = makeBubble(w)
      else bubbles.splice(i, 1)
    }
  }
  updateParticles()
}
function drawFree() {
  ctx.clearRect(0, 0, W, H)
  bubbles.forEach(b => {
    const cx = b.x + Math.sin(b.phase) * b.wobbleAmp
    drawBubbleShape(cx, b.y, b.r, b.word, b.color, b.alpha, false)
  })
  drawParticles()
}

// ===== 单词卡片（自由模式）=====
const wordCard = el('word-card')
const cardEmoji = el('word-card-emoji')
const cardWord = el('word-card-word')
const cardCn = el('word-card-cn')
let cardTimer = null

function showWordCard(word) {
  cardEmoji.textContent = word.emoji
  cardWord.textContent = word.word
  cardCn.textContent = word.cn
  wordCard.classList.add('show')
  clearTimeout(cardTimer)
  cardTimer = setTimeout(() => wordCard.classList.remove('show'), WORD_CARD_MS)
}

// ===== 命中检测（自由模式）=====
function hitFree(x, y) {
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i]
    const dx = x - b.x
    const dy = y - b.y
    if (dx * dx + dy * dy <= b.r * b.r) return i
  }
  return -1
}
function onFreeTap(x, y) {
  const idx = hitFree(x, y)
  if (idx < 0) return
  const b = bubbles[idx]
  spawnParticles(b.x, b.y, 16, 2, b.color)
  audio.pop()
  audio.playWord(b.word)
  showWordCard(b.word)
  const w = randomWordFromCurrent()
  if (w) bubbles[idx] = makeBubble(w)
  else bubbles.splice(idx, 1)
}

// ===== 闯关模式 =====
function quizGridPos(i) {
  // 四个角布局，中间留空给「Listen Again」按钮
  const r = Math.min(W * 0.15, 52)
  const xs = [W * 0.2, W * 0.8]
  const ys = [H * 0.26, H * 0.72]
  return { x: xs[i % 2], y: ys[Math.floor(i / 2)], r }
}

function startQuiz() {
  const pool = shuffle(currentCat.words)
  quiz = {
    words: pool.slice(0, Math.min(QUIZ_PER_ROUND, pool.length)),
    index: 0,
    stars: 0,
    total: Math.min(QUIZ_PER_ROUND, pool.length),
    choices: [],
    phase: 'idle',            // 'idle' | 'correct'
    phaseUntil: 0,
    correctIdx: -1
  }
  particles.length = 0
  nextQuestion(true)   // 第一题：先播开场提示，结束后再播单词
}

function playTargetWord() {
  if (quiz && quiz.index < quiz.total) audio.playWord(quiz.words[quiz.index])
}

function nextQuestion(intro) {
  if (!quiz || quiz.index >= quiz.total) { showResult(); return }
  const target = quiz.words[quiz.index]
  const distractors = shuffle(currentCat.words.filter(w => w.id !== target.id))
    .slice(0, QUIZ_CHOICES - 1)
  const all = shuffle([target, ...distractors])
  quiz.choices = all.map((w, i) => {
    const p = quizGridPos(i)
    return {
      word: w, x: p.x, y: p.y, r: p.r,
      color: pick(PALETTE), bob: Math.random() * Math.PI * 2, shaking: 0
    }
  })
  quiz.correctIdx = quiz.choices.findIndex(c => c.word.id === target.id)
  quiz.phase = 'idle'
  updateQuizHUD()
  if (intro) {
    // 开场提示播完后再播单词，避免重叠
    audio.playPhrase('find_listen', () => { if (mode === 'quiz') playTargetWord() })
  } else {
    setTimeout(playTargetWord, 350)
  }
}

function onQuizTap(x, y) {
  if (!quiz || quiz.phase !== 'idle') return
  for (let i = 0; i < quiz.choices.length; i++) {
    const c = quiz.choices[i]
    const dx = x - c.x
    const dy = y - c.y
    if (dx * dx + dy * dy <= c.r * c.r) {
      if (i === quiz.correctIdx) {
        quiz.stars++
        quiz.phase = 'correct'
        quiz.phaseUntil = performance.now() + 900
        spawnCelebration(c.x, c.y)
        audio.playPhrase(pick(PRAISE))
        updateQuizHUD()
        recordCorrect(quiz.words[quiz.index])
      } else {
        // 答错：只晃动 + 重播，不惩罚
        c.shaking = performance.now() + 500
        audio.playWord(quiz.words[quiz.index])
        recordWrong()
      }
      break
    }
  }
}

function updateQuiz() {
  updateParticles()
  if (quiz.phase === 'correct' && performance.now() >= quiz.phaseUntil) {
    quiz.index++
    nextQuestion()
  }
}

function drawQuiz() {
  ctx.clearRect(0, 0, W, H)
  const now = performance.now()
  quiz.choices.forEach((c, i) => {
    const shake = c.shaking > now ? Math.sin(now * 0.06) * 8 * ((c.shaking - now) / 500) : 0
    const bob = Math.sin(now * 0.002 + c.bob) * 6
    const highlight = quiz.phase === 'correct' && i === quiz.correctIdx
    drawBubbleShape(c.x + shake, c.y + bob, c.r, c.word, c.color, 0.7, highlight)
  })
  drawParticles()
}

function updateQuizHUD() {
  el('quiz-progress').textContent = `第 ${Math.min(quiz.index + 1, quiz.total)} / ${quiz.total} 题`
  el('quiz-stars').textContent = `⭐ ${quiz.stars}`
}

function showResult() {
  audio.playPhrase('you_did_it')
  recordQuizDone()
  el('result-stars').textContent = '⭐'.repeat(quiz.stars) + '☆'.repeat(quiz.total - quiz.stars)
  el('result-text').textContent = `答对 ${quiz.stars} / ${quiz.total}`
  el('result-modal').classList.remove('hidden')
}

// ===== 分类栏 =====
const catBar = el('category-bar')

function renderCategoryBar() {
  catBar.innerHTML = ''
  categories.filter(c => !disabledCats.includes(c.id)).forEach(cat => {
    const btn = document.createElement('button')
    btn.className = 'cat-btn' + (cat.id === currentCat.id ? ' active' : '')
    btn.innerHTML = `<span class="cat-emoji">${cat.emoji}</span><span class="cat-name">${cat.name}</span>`
    btn.addEventListener('click', () => switchCategory(cat.id))
    catBar.appendChild(btn)
  })
}

function switchCategory(id) {
  const cat = categories.find(c => c.id === id)
  if (!cat || cat === currentCat) return
  currentCat = cat
  audio.preloadCategory(cat)
  if (mode === 'free') initBubbles()
  else if (mode === 'quiz') startQuiz()
  renderCategoryBar()
}

// ===== 模式切换 =====
function setMode(newMode) {
  mode = newMode
  el('home').classList.toggle('hidden', mode !== 'home')
  el('topbar').classList.toggle('hidden', mode !== 'free')
  el('quiz-bar').classList.toggle('hidden', mode !== 'quiz')
  el('quiz-play-btn').classList.toggle('hidden', mode !== 'quiz')
  el('category-bar').classList.toggle('hidden', mode === 'home')
  el('result-modal').classList.add('hidden')
  if (mode !== 'quiz') quiz = null
  if (mode === 'quiz') startQuiz()
}

// ===== 家长中心 =====
function openParentCenter() {
  renderParentCenter()
  el('parent-center').classList.remove('hidden')
}

function renderParentCenter() {
  const total = stats.totalCorrect + stats.totalWrong
  const acc = total > 0 ? Math.round((stats.totalCorrect / total) * 100) : 0
  el('pc-quizzes').textContent = stats.totalQuizzes
  el('pc-accuracy').textContent = acc + '%'
  el('pc-learned').textContent = stats.wordsLearned.length
  el('pc-correct').textContent = stats.totalCorrect

  const box = el('pc-categories')
  box.innerHTML = ''
  categories.forEach(cat => {
    const on = !disabledCats.includes(cat.id)
    const row = document.createElement('label')
    row.className = 'cat-toggle'
    row.innerHTML = `<span class="cat-t-left">${cat.emoji} ${cat.name} <span class="cat-t-count">(${cat.words.length}词)</span></span><input type="checkbox" ${on ? 'checked' : ''} data-cat="${cat.id}">`
    row.querySelector('input').addEventListener('change', e => {
      if (e.target.checked) disabledCats = disabledCats.filter(id => id !== cat.id)
      else disabledCats.push(cat.id)
      saveDisabledCats()
      if (!e.target.checked && currentCat.id === cat.id) {
        const next = categories.find(c => !disabledCats.includes(c.id))
        if (next) { currentCat = next; audio.preloadCategory(next); initBubbles() }
      }
      renderCategoryBar()
    })
    box.appendChild(row)
  })
}

function resetData() {
  stats = { totalQuizzes: 0, totalCorrect: 0, totalWrong: 0, wordsLearned: [], byCategory: {} }
  saveStats()
  disabledCats = []
  saveDisabledCats()
  renderParentCenter()
  renderCategoryBar()
}

// ===== 主循环 =====
function loop() {
  if (mode === 'free') { updateFree(); drawFree() }
  else if (mode === 'quiz') { updateQuiz(); drawQuiz() }
  requestAnimationFrame(loop)
}

// ===== 交互事件 =====
canvas.addEventListener('pointerdown', e => {
  e.preventDefault()
  audio.wake()
  const x = e.clientX
  const y = e.clientY
  if (mode === 'free') onFreeTap(x, y)
  else if (mode === 'quiz') onQuizTap(x, y)
})

el('free-btn').addEventListener('click', () => { audio.wake(); setMode('free') })
el('quiz-btn').addEventListener('click', () => { audio.wake(); setMode('quiz') })
el('free-back').addEventListener('click', () => setMode('home'))
el('quiz-back').addEventListener('click', () => setMode('home'))
el('quiz-play-btn').addEventListener('click', () => playTargetWord())
el('result-again').addEventListener('click', () => {
  el('result-modal').classList.add('hidden')
  startQuiz()
})
el('result-home').addEventListener('click', () => setMode('home'))

function toggleMute() {
  muted = !muted
  el('mute-ico').textContent = muted ? '🔇' : '🔊'
  el('quiz-mute-ico').textContent = muted ? '🔇' : '🔊'
}
el('mute-btn').addEventListener('click', toggleMute)
el('quiz-mute').addEventListener('click', toggleMute)

el('parent-btn').addEventListener('click', openParentCenter)
el('pc-close').addEventListener('click', () => el('parent-center').classList.add('hidden'))
el('pc-reset').addEventListener('click', () => { if (confirm('确定要清除所有学习数据吗？')) resetData() })

// ===== 启动 =====
categories = CATEGORIES
currentCat = categories.find(c => !disabledCats.includes(c.id)) || categories[0]
audio.preloadCategory(currentCat)
initBubbles()
renderCategoryBar()
loop()

// 支持 ?mode=free / ?mode=quiz 直达（也便于无头测试）
const qs = new URLSearchParams(location.search)
const qMode = qs.get('mode')
if (qMode === 'free' || qMode === 'quiz') { audio.wake(); setMode(qMode) }

window.addEventListener('resize', () => location.reload())
