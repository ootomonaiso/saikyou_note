/**
 * 僕の考えた最強のノート - メインアプリケーション
 */

import {
  auth,
  db,
  signInWithPopup,
  googleProvider,
  signOut,
  onAuthStateChanged,
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where
} from './firebase-config.js';

// ========================================
// 定数定義
// ========================================
const TIMEOUT_MS = 10000; // 通信タイムアウト10秒
const MAX_RETRY = 3; // 最大再試行回数
const ERROR_DISPLAY_TIME = 5000; // エラー表示時間5秒
const TITLE_MAX_LENGTH = 50;
const CONTENT_MAX_LENGTH = 999;
const STORAGE_KEY = 'notes';

// エラーコード定義
const ERROR_CODES = {
  E001: 'ログインに失敗しました',
  E002: 'ログアウトに失敗しました',
  E003: 'データの取得に失敗しました',
  E004: 'データの登録に失敗しました',
  E005: 'データの更新に失敗しました',
  E006: 'データの削除に失敗しました',
  E007: '必須項目が入力されていません',
  E008: 'タイトルが既に存在します',
  E009: 'タイトルが一致しません',
  E010: '通信がタイムアウトしました。再試行中...',
  E011: '通信に失敗しました。ページを再読み込みしてください',
  E012: 'タイトルは50文字以内で入力してください',
  E013: '入力は999文字以内で入力してください'
};

// ========================================
// グローバル状態
// ========================================
let currentUser = null;
let notesData = [];
let currentPage = 'login';
let isModalOpen = false;
let hasUnsavedChanges = false;
let retryBlocked = false;
let usedProblemIds = []; // ランダム出題で使用済みのID
let currentProblemId = null;
let missMarkUsed = false;

// ========================================
// DOM要素
// ========================================
const pageContent = document.getElementById('page-content');
const errorContainer = document.getElementById('error-container');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingMessage = document.getElementById('loading-message');
const modalOverlay = document.getElementById('modal-overlay');
const modalContainer = document.getElementById('modal-container');
const modalContent = document.getElementById('modal-content');

// ========================================
// ユーティリティ関数
// ========================================

/**
 * HTMLエスケープ（XSS対策）
 */
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

/**
 * テキストを安全に設定
 */
function setTextContent(element, text) {
  if (element) {
    element.textContent = text || '';
  }
}

/**
 * エラー表示
 */
function showError(code) {
  const message = ERROR_CODES[code] || `エラーが発生しました (${code})`;
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-message';
  errorDiv.textContent = `[${code}] ${message}`;
  errorContainer.appendChild(errorDiv);
  
  setTimeout(() => {
    errorDiv.remove();
  }, ERROR_DISPLAY_TIME);
}

/**
 * ローディング表示/非表示
 */
function showLoading(message = '読み込み中...') {
  loadingMessage.textContent = message;
  loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  loadingOverlay.classList.add('hidden');
}

/**
 * タイムアウト付きfetch
 */
async function fetchWithTimeout(promise, timeout = TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('timeout')), timeout)
    )
  ]);
}

/**
 * 再試行付きFirebase操作
 */
async function withRetry(operation, retryCount = 0) {
  if (retryBlocked) {
    showError('E011');
    throw new Error('Retry blocked');
  }

  try {
    return await fetchWithTimeout(operation());
  } catch (error) {
    if (error.message === 'timeout' && retryCount < MAX_RETRY - 1) {
      showError('E010');
      showLoading('通信を再試行中...');
      return withRetry(operation, retryCount + 1);
    } else if (retryCount >= MAX_RETRY - 1) {
      retryBlocked = true;
      showError('E011');
      throw error;
    }
    throw error;
  }
}

/**
 * LocalStorageにデータを保存
 */
function saveToLocalStorage(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * LocalStorageからデータを取得
 */
function getFromLocalStorage() {
  const data = localStorage.getItem(STORAGE_KEY);
  return data ? JSON.parse(data) : [];
}

/**
 * LocalStorageをクリア
 */
function clearLocalStorage() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * 日付をフォーマット
 */
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * 現在の日時をISO形式で取得
 */
function getCurrentDateTime() {
  return new Date().toISOString();
}

// ========================================
// モーダル（仮想ウインドウ）管理
// ========================================

/**
 * モーダルを開く
 */
function openModal(content) {
  if (isModalOpen) return;
  
  modalContent.innerHTML = content;
  modalOverlay.classList.remove('hidden');
  modalContainer.classList.remove('hidden');
  isModalOpen = true;
  hasUnsavedChanges = false;

  // イベントリスナー設定
  setupModalEventListeners();
}

/**
 * モーダルを閉じる
 */
function closeModal(force = false) {
  if (!isModalOpen) return;

  if (!force && hasUnsavedChanges) {
    if (!confirm('変更が保存されていません。破棄しますか？')) {
      return;
    }
  }

  modalOverlay.classList.add('hidden');
  modalContainer.classList.add('hidden');
  modalContent.innerHTML = '';
  isModalOpen = false;
  hasUnsavedChanges = false;
}

/**
 * モーダルのイベントリスナー設定
 */
function setupModalEventListeners() {
  // オーバーレイクリックで閉じる
  modalOverlay.onclick = () => closeModal();

  // Escキーで閉じる
  const escHandler = (e) => {
    if (e.key === 'Escape' && isModalOpen) {
      closeModal();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  // 閉じるボタン
  const closeBtn = modalContent.querySelector('.modal-close');
  if (closeBtn) {
    closeBtn.onclick = () => closeModal();
  }

  // フォーム変更検知
  const inputs = modalContent.querySelectorAll('input, textarea');
  inputs.forEach(input => {
    input.addEventListener('input', () => {
      hasUnsavedChanges = true;
    });
  });
}

// ========================================
// ルーティング
// ========================================

/**
 * ページ遷移
 */
function navigateTo(page) {
  currentPage = page;
  history.pushState({ page }, '', `#${page}`);
  renderPage();
}

/**
 * 初期ルーティング設定
 */
function initRouter() {
  window.addEventListener('popstate', (e) => {
    if (e.state && e.state.page) {
      currentPage = e.state.page;
      renderPage();
    }
  });

  // 初期ページ判定
  const hash = window.location.hash.slice(1);
  if (['login', 'list', 'random'].includes(hash)) {
    currentPage = hash;
  }
}

/**
 * ページ描画
 */
function renderPage() {
  closeModal(true);

  if (!currentUser && currentPage !== 'login') {
    navigateTo('login');
    return;
  }

  switch (currentPage) {
    case 'login':
      renderLoginPage();
      break;
    case 'list':
      renderListPage();
      break;
    case 'random':
      renderRandomPage();
      break;
    default:
      navigateTo('login');
  }
}

// ========================================
// ログイン画面
// ========================================

function renderLoginPage() {
  pageContent.innerHTML = `
    <div class="login-page">
      <div class="login-container">
        <h1 class="login-title">僕の考えた最強のノート</h1>
        <p class="login-subtitle">間違えた問題を管理して効率的に学習しよう</p>
        <button id="google-login-btn" class="btn btn-primary login-btn btn-large">
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Googleでログイン
        </button>
      </div>
    </div>
  `;

  document.getElementById('google-login-btn').onclick = handleGoogleLogin;
}

/**
 * Googleログイン処理
 */
async function handleGoogleLogin() {
  showLoading('ログイン中...');
  try {
    await withRetry(() => signInWithPopup(auth, googleProvider));
    // onAuthStateChangedで処理される
  } catch (error) {
    console.error('Login error:', error);
    showError('E001');
    hideLoading();
  }
}

// ========================================
// 一覧画面
// ========================================

async function renderListPage() {
  showLoading('データを読み込み中...');

  // Firestoreからデータを取得
  try {
    await loadNotesFromFirestore();
  } catch (error) {
    console.error('Failed to load notes:', error);
    // LocalStorageのデータを使用
    notesData = getFromLocalStorage();
  }

  hideLoading();
  renderListContent();
}

/**
 * Firestoreからノートを読み込み
 */
async function loadNotesFromFirestore() {
  const notesRef = collection(db, 'notes');
  const q = query(notesRef, where('uid', '==', currentUser.uid));
  
  const snapshot = await withRetry(() => getDocs(q));
  
  notesData = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

  saveToLocalStorage(notesData);
}

/**
 * 一覧コンテンツ描画
 */
function renderListContent(sortBy = 'date') {
  // ソート処理
  const sortedData = [...notesData].sort((a, b) => {
    switch (sortBy) {
      case 'date':
        return new Date(b.Date) - new Date(a.Date);
      case 'title':
        return a.Title.localeCompare(b.Title, 'ja');
      case 'miss':
        return b.MissCount - a.MissCount;
      default:
        return 0;
    }
  });

  pageContent.innerHTML = `
    <div class="list-page">
      <div class="list-header">
        <h1>問題一覧</h1>
        <div class="header-actions">
          <button id="add-btn" class="btn btn-primary">+ 新規登録</button>
          <select id="sort-select" class="sort-select">
            <option value="date" ${sortBy === 'date' ? 'selected' : ''}>登録日時順</option>
            <option value="title" ${sortBy === 'title' ? 'selected' : ''}>タイトル順</option>
            <option value="miss" ${sortBy === 'miss' ? 'selected' : ''}>ミス回数順</option>
          </select>
          <button id="random-btn" class="btn btn-outline">ランダム出題</button>
          <button id="logout-btn" class="btn btn-secondary">ログアウト</button>
        </div>
      </div>

      <div class="data-table-container">
        ${sortedData.length > 0 ? `
          <table class="data-table">
            <thead>
              <tr>
                <th>タイトル</th>
                <th>登録日時</th>
                <th>ミス回数</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${sortedData.map(note => `
                <tr>
                  <td class="title-cell" data-id="${escapeHtml(note.id)}">${escapeHtml(note.Title)}</td>
                  <td>${escapeHtml(formatDate(note.Date))}</td>
                  <td>${escapeHtml(String(note.MissCount))}</td>
                  <td class="action-cell">
                    <button class="btn btn-small btn-outline edit-btn" data-id="${escapeHtml(note.id)}">編集/削除</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        ` : `
          <div class="empty-message">
            <p>まだ問題が登録されていません</p>
            <button id="first-add-btn" class="btn btn-primary">最初の問題を登録する</button>
          </div>
        `}
      </div>

      <div class="sync-area">
        <button id="sync-btn" class="btn btn-outline">🔄 サーバーと同期</button>
      </div>
    </div>
  `;

  // イベントリスナー設定
  setupListEventListeners(sortBy);
}

/**
 * 一覧画面のイベントリスナー設定
 */
function setupListEventListeners(currentSort) {
  // 新規登録ボタン
  const addBtn = document.getElementById('add-btn');
  if (addBtn) addBtn.onclick = () => openRegisterModal();

  const firstAddBtn = document.getElementById('first-add-btn');
  if (firstAddBtn) firstAddBtn.onclick = () => openRegisterModal();

  // ソート変更
  const sortSelect = document.getElementById('sort-select');
  if (sortSelect) {
    sortSelect.onchange = (e) => renderListContent(e.target.value);
  }

  // ランダム出題
  const randomBtn = document.getElementById('random-btn');
  if (randomBtn) randomBtn.onclick = () => navigateTo('random');

  // ログアウト
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.onclick = handleLogout;

  // 同期ボタン
  const syncBtn = document.getElementById('sync-btn');
  if (syncBtn) syncBtn.onclick = () => renderListPage();

  // タイトルクリック（詳細表示）
  document.querySelectorAll('.title-cell').forEach(cell => {
    cell.onclick = () => {
      const id = cell.dataset.id;
      const note = notesData.find(n => n.id === id);
      if (note) openDetailModal(note);
    };
  });

  // 編集/削除ボタン
  document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      const note = notesData.find(n => n.id === id);
      if (note) openEditModal(note);
    };
  });
}

// ========================================
// 登録モーダル
// ========================================

function openRegisterModal() {
  const modalHtml = `
    <div class="modal-header">
      <h2>問題を登録</h2>
      <button class="modal-close">&times;</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>タイトル<span class="required">*</span></label>
        <input type="text" id="reg-title" class="form-control" maxlength="${TITLE_MAX_LENGTH}" placeholder="問題のタイトル">
        <div class="char-count"><span id="title-count">0</span>/${TITLE_MAX_LENGTH}</div>
        <div id="title-error" class="form-error hidden"></div>
      </div>
      <div class="form-group">
        <label>問題文<span class="required">*</span></label>
        <textarea id="reg-question" class="form-control" maxlength="${CONTENT_MAX_LENGTH}" placeholder="問題の内容"></textarea>
        <div class="char-count"><span id="question-count">0</span>/${CONTENT_MAX_LENGTH}</div>
      </div>
      <div class="form-group">
        <label>解答<span class="required">*</span></label>
        <textarea id="reg-answer" class="form-control" maxlength="${CONTENT_MAX_LENGTH}" placeholder="正しい解答"></textarea>
        <div class="char-count"><span id="answer-count">0</span>/${CONTENT_MAX_LENGTH}</div>
      </div>
      <div class="form-group">
        <label>解説（任意）</label>
        <textarea id="reg-explain" class="form-control" maxlength="${CONTENT_MAX_LENGTH}" placeholder="解説やポイントなど"></textarea>
        <div class="char-count"><span id="explain-count">0</span>/${CONTENT_MAX_LENGTH}</div>
      </div>
    </div>
    <div class="modal-footer">
      <button id="reg-cancel-btn" class="btn btn-secondary">キャンセル</button>
      <button id="reg-submit-btn" class="btn btn-primary">登録</button>
    </div>
  `;

  openModal(modalHtml);
  setupRegisterModalListeners();
}

function setupRegisterModalListeners() {
  const titleInput = document.getElementById('reg-title');
  const questionInput = document.getElementById('reg-question');
  const answerInput = document.getElementById('reg-answer');
  const explainInput = document.getElementById('reg-explain');

  // 文字数カウント
  const setupCounter = (input, counterId) => {
    const counter = document.getElementById(counterId);
    input.addEventListener('input', () => {
      counter.textContent = input.value.length;
    });
  };

  setupCounter(titleInput, 'title-count');
  setupCounter(questionInput, 'question-count');
  setupCounter(answerInput, 'answer-count');
  setupCounter(explainInput, 'explain-count');

  // キャンセル
  document.getElementById('reg-cancel-btn').onclick = () => closeModal();

  // Enterキーで登録
  modalContent.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleRegister();
    }
  });

  // 登録
  document.getElementById('reg-submit-btn').onclick = handleRegister;
}

async function handleRegister() {
  const title = document.getElementById('reg-title').value.trim();
  const question = document.getElementById('reg-question').value.trim();
  const answer = document.getElementById('reg-answer').value.trim();
  const explain = document.getElementById('reg-explain').value.trim();
  const titleError = document.getElementById('title-error');

  // バリデーション
  titleError.classList.add('hidden');

  if (!title || !question || !answer) {
    showError('E007');
    return;
  }

  if (title.length > TITLE_MAX_LENGTH) {
    showError('E012');
    return;
  }

  if (question.length > CONTENT_MAX_LENGTH || answer.length > CONTENT_MAX_LENGTH || explain.length > CONTENT_MAX_LENGTH) {
    showError('E013');
    return;
  }

  // タイトル重複チェック
  if (notesData.some(n => n.Title === title)) {
    titleError.textContent = 'このタイトルは既に存在します';
    titleError.classList.remove('hidden');
    showError('E008');
    return;
  }

  showLoading('登録中...');

  const newNote = {
    Title: title,
    Question: question,
    Answer: answer,
    Explain: explain,
    Date: getCurrentDateTime(),
    MissCount: 0,
    uid: currentUser.uid
  };

  try {
    const docRef = await withRetry(() => addDoc(collection(db, 'notes'), newNote));
    newNote.id = docRef.id;
    notesData.push(newNote);
    saveToLocalStorage(notesData);
    
    hideLoading();
    closeModal(true);
    renderListContent();
  } catch (error) {
    console.error('Register error:', error);
    showError('E004');
    hideLoading();
  }
}

// ========================================
// 編集モーダル
// ========================================

function openEditModal(note) {
  const modalHtml = `
    <div class="modal-header">
      <h2>問題を編集</h2>
      <button class="modal-close">&times;</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>タイトル<span class="required">*</span></label>
        <input type="text" id="edit-title" class="form-control" maxlength="${TITLE_MAX_LENGTH}" value="${escapeHtml(note.Title)}">
        <div class="char-count"><span id="title-count">${note.Title.length}</span>/${TITLE_MAX_LENGTH}</div>
        <div id="title-error" class="form-error hidden"></div>
      </div>
      <div class="form-group">
        <label>問題文<span class="required">*</span></label>
        <textarea id="edit-question" class="form-control" maxlength="${CONTENT_MAX_LENGTH}">${escapeHtml(note.Question)}</textarea>
        <div class="char-count"><span id="question-count">${note.Question.length}</span>/${CONTENT_MAX_LENGTH}</div>
      </div>
      <div class="form-group">
        <label>解答<span class="required">*</span></label>
        <textarea id="edit-answer" class="form-control" maxlength="${CONTENT_MAX_LENGTH}">${escapeHtml(note.Answer)}</textarea>
        <div class="char-count"><span id="answer-count">${note.Answer.length}</span>/${CONTENT_MAX_LENGTH}</div>
      </div>
      <div class="form-group">
        <label>解説（任意）</label>
        <textarea id="edit-explain" class="form-control" maxlength="${CONTENT_MAX_LENGTH}">${escapeHtml(note.Explain || '')}</textarea>
        <div class="char-count"><span id="explain-count">${(note.Explain || '').length}</span>/${CONTENT_MAX_LENGTH}</div>
      </div>
    </div>
    <div class="modal-footer">
      <button id="delete-mode-btn" class="btn btn-danger">データを削除...</button>
      <button id="edit-cancel-btn" class="btn btn-secondary">キャンセル</button>
      <button id="edit-submit-btn" class="btn btn-primary">保存</button>
    </div>
  `;

  openModal(modalHtml);
  setupEditModalListeners(note);
}

function setupEditModalListeners(note) {
  const titleInput = document.getElementById('edit-title');
  const questionInput = document.getElementById('edit-question');
  const answerInput = document.getElementById('edit-answer');
  const explainInput = document.getElementById('edit-explain');

  // 文字数カウント
  const setupCounter = (input, counterId) => {
    const counter = document.getElementById(counterId);
    input.addEventListener('input', () => {
      counter.textContent = input.value.length;
    });
  };

  setupCounter(titleInput, 'title-count');
  setupCounter(questionInput, 'question-count');
  setupCounter(answerInput, 'answer-count');
  setupCounter(explainInput, 'explain-count');

  // キャンセル
  document.getElementById('edit-cancel-btn').onclick = () => closeModal();

  // 削除モードへ
  document.getElementById('delete-mode-btn').onclick = () => {
    closeModal(true);
    openDeleteModal(note);
  };

  // Enterキーで保存
  modalContent.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEdit(note);
    }
  });

  // 保存
  document.getElementById('edit-submit-btn').onclick = () => handleEdit(note);
}

async function handleEdit(note) {
  const title = document.getElementById('edit-title').value.trim();
  const question = document.getElementById('edit-question').value.trim();
  const answer = document.getElementById('edit-answer').value.trim();
  const explain = document.getElementById('edit-explain').value.trim();
  const titleError = document.getElementById('title-error');

  // バリデーション
  titleError.classList.add('hidden');

  if (!title || !question || !answer) {
    showError('E007');
    return;
  }

  if (title.length > TITLE_MAX_LENGTH) {
    showError('E012');
    return;
  }

  if (question.length > CONTENT_MAX_LENGTH || answer.length > CONTENT_MAX_LENGTH || explain.length > CONTENT_MAX_LENGTH) {
    showError('E013');
    return;
  }

  // タイトル重複チェック（自分以外）
  if (notesData.some(n => n.Title === title && n.id !== note.id)) {
    titleError.textContent = 'このタイトルは既に存在します';
    titleError.classList.remove('hidden');
    showError('E008');
    return;
  }

  showLoading('更新中...');

  const updatedData = {
    Title: title,
    Question: question,
    Answer: answer,
    Explain: explain
  };

  try {
    const noteRef = doc(db, 'notes', note.id);
    await withRetry(() => updateDoc(noteRef, updatedData));

    // ローカルデータ更新
    const index = notesData.findIndex(n => n.id === note.id);
    if (index !== -1) {
      notesData[index] = { ...notesData[index], ...updatedData };
      saveToLocalStorage(notesData);
    }

    hideLoading();
    closeModal(true);
    renderListContent();
  } catch (error) {
    console.error('Edit error:', error);
    showError('E005');
    hideLoading();
  }
}

// ========================================
// 削除モーダル
// ========================================

function openDeleteModal(note) {
  const modalHtml = `
    <div class="modal-header">
      <h2>問題を削除</h2>
      <button class="modal-close">&times;</button>
    </div>
    <div class="modal-body">
      <div class="delete-warning">
        <p>データを削除しますか？</p>
        <p class="delete-title">${escapeHtml(note.Title)}</p>
        <p class="text-muted">確認のため、上記のタイトルを入力してください</p>
      </div>
      <div class="form-group">
        <input type="text" id="delete-confirm-title" class="form-control" placeholder="タイトルを入力">
        <div id="delete-error" class="form-error hidden"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button id="delete-cancel-btn" class="btn btn-secondary">キャンセル</button>
      <button id="delete-submit-btn" class="btn btn-danger">削除を確定</button>
    </div>
  `;

  openModal(modalHtml);
  setupDeleteModalListeners(note);
}

function setupDeleteModalListeners(note) {
  // キャンセル
  document.getElementById('delete-cancel-btn').onclick = () => closeModal();

  // Enterキーで削除
  modalContent.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleDelete(note);
    }
  });

  // 削除
  document.getElementById('delete-submit-btn').onclick = () => handleDelete(note);
}

async function handleDelete(note) {
  const confirmTitle = document.getElementById('delete-confirm-title').value.trim();
  const deleteError = document.getElementById('delete-error');

  deleteError.classList.add('hidden');

  if (confirmTitle !== note.Title) {
    deleteError.textContent = 'タイトルが一致しません';
    deleteError.classList.remove('hidden');
    showError('E009');
    return;
  }

  showLoading('削除中...');

  try {
    const noteRef = doc(db, 'notes', note.id);
    await withRetry(() => deleteDoc(noteRef));

    // ローカルデータ更新
    notesData = notesData.filter(n => n.id !== note.id);
    saveToLocalStorage(notesData);

    hideLoading();
    closeModal(true);
    renderListContent();
  } catch (error) {
    console.error('Delete error:', error);
    showError('E006');
    hideLoading();
  }
}

// ========================================
// 詳細表示モーダル
// ========================================

function openDetailModal(note) {
  const modalHtml = `
    <div class="modal-header">
      <h2>問題詳細</h2>
      <button class="modal-close">&times;</button>
    </div>
    <div class="modal-body">
      <div class="detail-field">
        <div class="detail-label">タイトル</div>
        <div class="detail-value" id="detail-title"></div>
      </div>
      <div class="detail-field">
        <div class="detail-label">問題文</div>
        <div class="detail-value" id="detail-question"></div>
      </div>
      <div class="detail-field">
        <div class="detail-label">解答</div>
        <div class="detail-value" id="detail-answer"></div>
      </div>
      ${note.Explain ? `
        <div class="detail-field">
          <div class="detail-label">解説</div>
          <div class="detail-value" id="detail-explain"></div>
        </div>
      ` : ''}
      <div class="detail-field">
        <div class="detail-label">登録日時</div>
        <div class="detail-value" id="detail-date"></div>
      </div>
      <div class="detail-field">
        <div class="detail-label">間違い回数</div>
        <div class="detail-value" id="detail-miss"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button id="detail-close-btn" class="btn btn-primary">閉じる</button>
    </div>
  `;

  openModal(modalHtml);

  // textContentで安全にテキストを設定
  setTextContent(document.getElementById('detail-title'), note.Title);
  setTextContent(document.getElementById('detail-question'), note.Question);
  setTextContent(document.getElementById('detail-answer'), note.Answer);
  if (note.Explain) {
    setTextContent(document.getElementById('detail-explain'), note.Explain);
  }
  setTextContent(document.getElementById('detail-date'), formatDate(note.Date));
  setTextContent(document.getElementById('detail-miss'), `${note.MissCount}回`);

  document.getElementById('detail-close-btn').onclick = () => closeModal(true);
}

// ========================================
// ランダム問題画面
// ========================================

function renderRandomPage() {
  if (notesData.length === 0) {
    pageContent.innerHTML = `
      <div class="random-page">
        <div class="random-header">
          <h1>ランダム出題</h1>
          <button id="back-to-list-btn" class="btn btn-outline">一覧に戻る</button>
        </div>
        <div class="problem-card">
          <div class="empty-message">
            <p>問題が登録されていません</p>
            <p class="text-muted">まず問題を登録してください</p>
          </div>
        </div>
      </div>
    `;
    document.getElementById('back-to-list-btn').onclick = () => navigateTo('list');
    return;
  }

  // ランダムに問題を選択
  const availableNotes = notesData.filter(n => !usedProblemIds.includes(n.id));
  
  if (availableNotes.length === 0) {
    // 全問題を出題済み
    usedProblemIds = [];
    pageContent.innerHTML = `
      <div class="random-page">
        <div class="random-header">
          <h1>ランダム出題</h1>
        </div>
        <div class="problem-card">
          <div class="empty-message">
            <p>すべての問題を出題しました！</p>
            <p class="text-muted">お疲れさまでした</p>
            <button id="complete-back-btn" class="btn btn-primary mt-4">一覧に戻る</button>
          </div>
        </div>
      </div>
    `;
    document.getElementById('complete-back-btn').onclick = () => navigateTo('list');
    return;
  }

  // 連続で同じ問題が出ないようにする
  let randomNote;
  if (availableNotes.length === 1) {
    randomNote = availableNotes[0];
  } else {
    do {
      randomNote = availableNotes[Math.floor(Math.random() * availableNotes.length)];
    } while (randomNote.id === currentProblemId);
  }

  currentProblemId = randomNote.id;
  usedProblemIds.push(randomNote.id);
  missMarkUsed = false;

  renderProblemContent(randomNote);
}

function renderProblemContent(note) {
  pageContent.innerHTML = `
    <div class="random-page">
      <div class="random-header">
        <h1>ランダム出題</h1>
        <button id="back-to-list-btn" class="btn btn-outline">一覧に戻る</button>
      </div>
      <div class="problem-card">
        <h2 class="problem-title" id="problem-title"></h2>
        <div class="problem-question" id="problem-question"></div>
        
        <div class="answer-input-section">
          <label>あなたの回答:</label>
          <textarea id="user-answer" class="form-control" placeholder="回答を入力してください"></textarea>
        </div>
        
        <button id="show-answer-btn" class="btn btn-primary btn-large">回答を表示</button>
        
        <div id="answer-section" class="answer-section hidden">
          <h3>正解</h3>
          <div class="answer-content" id="correct-answer"></div>
          ${note.Explain ? `
            <div class="explain-section">
              <h3>解説</h3>
              <div class="explain-content" id="explain-content"></div>
            </div>
          ` : ''}
        </div>
      </div>
      
      <div class="problem-actions hidden" id="problem-actions">
        <button id="miss-mark-btn" class="btn miss-mark-btn">❌ 間違いとしてマーク</button>
        <div class="navigation-buttons">
          <button id="next-btn" class="btn btn-primary">次の問題へ →</button>
          <button id="top-btn" class="btn btn-outline">トップに戻る</button>
        </div>
      </div>
    </div>
  `;

  // textContentで安全にテキストを設定
  setTextContent(document.getElementById('problem-title'), note.Title);
  setTextContent(document.getElementById('problem-question'), note.Question);
  setTextContent(document.getElementById('correct-answer'), note.Answer);
  if (note.Explain) {
    setTextContent(document.getElementById('explain-content'), note.Explain);
  }

  setupRandomPageListeners(note);
}

function setupRandomPageListeners(note) {
  // 一覧に戻る
  document.getElementById('back-to-list-btn').onclick = () => navigateTo('list');

  // 回答を表示
  document.getElementById('show-answer-btn').onclick = () => {
    document.getElementById('answer-section').classList.remove('hidden');
    document.getElementById('problem-actions').classList.remove('hidden');
    document.getElementById('show-answer-btn').classList.add('hidden');
  };

  // 間違いマーク
  document.getElementById('miss-mark-btn').onclick = () => handleMissMark(note);

  // 次の問題
  document.getElementById('next-btn').onclick = () => renderRandomPage();

  // トップに戻る
  document.getElementById('top-btn').onclick = () => navigateTo('list');
}

async function handleMissMark(note) {
  if (missMarkUsed) return;

  const missBtn = document.getElementById('miss-mark-btn');
  missBtn.disabled = true;
  missMarkUsed = true;

  const newMissCount = (note.MissCount || 0) + 1;

  try {
    const noteRef = doc(db, 'notes', note.id);
    await withRetry(() => updateDoc(noteRef, { MissCount: newMissCount }));

    // ローカルデータ更新
    const index = notesData.findIndex(n => n.id === note.id);
    if (index !== -1) {
      notesData[index].MissCount = newMissCount;
      saveToLocalStorage(notesData);
    }
  } catch (error) {
    console.error('Miss mark error:', error);
    showError('E005');
    missBtn.disabled = false;
    missMarkUsed = false;
  }
}

// ========================================
// ログアウト処理
// ========================================

async function handleLogout() {
  showLoading('ログアウト中...');
  try {
    await withRetry(() => signOut(auth));
    clearLocalStorage();
    currentUser = null;
    notesData = [];
    usedProblemIds = [];
    currentProblemId = null;
    hideLoading();
    navigateTo('login');
  } catch (error) {
    console.error('Logout error:', error);
    showError('E002');
    hideLoading();
  }
}

// ========================================
// 認証状態の監視
// ========================================

onAuthStateChanged(auth, (user) => {
  hideLoading();
  if (user) {
    currentUser = user;
    retryBlocked = false;
    if (currentPage === 'login') {
      navigateTo('list');
    } else {
      renderPage();
    }
  } else {
    currentUser = null;
    clearLocalStorage();
    navigateTo('login');
  }
});

// ========================================
// 初期化
// ========================================

function init() {
  showLoading('初期化中...');
  initRouter();
  renderPage();
}

init();
