(function (root, factory) {
  const lib = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = lib;
  if (typeof document !== 'undefined') lib.start();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const DEFAULT_MODELS = { gemini: 'gemini-flash-latest', deepseek: 'deepseek-flash' };
  const PROVIDER_LABELS = { gemini: 'Gemini', deepseek: 'DeepSeek V4.1-Flash' };
  const ROLE_LABELS = {
    background: '背景', problem: '問題', claim: '主張', evidence: '證據', example: '舉例',
    contrast: '轉折', cause: '原因', effect: '結果', conclusion: '結論',
  };
  const MODIFIER_LABELS = {
    relative_clause: '關係子句', reduced_relative_clause: '省略關係子句', participial_modifier: '分詞修飾',
    prepositional_phrase: '介系詞片語', appositive: '同位語', adverbial_clause: '副詞子句',
    infinitive_phrase: '不定詞片語', other: '其他修飾',
  };
  const MODE_HINTS = {
    dehydrate: '⚫ 灰色是修飾語，先略過；只讀藍色：誰 → 做什麼 → 什麼。',
    skeleton: '🔵 只留主詞、動詞、受詞／補語，先確定句子在說什麼。',
    reattach: '🔴 把紅色修飾語掛回它修飾的對象，看懂每個細節補充了什麼。',
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    }[char]));
  }

  // ---- 在原句中標出修飾語與主幹的位置 ----

  const WORD = /[a-z0-9]/i;

  function overlaps(start, end, ranges) {
    return ranges.some((range) => start < range.end && end > range.start);
  }

  function atBoundary(text, start, end) {
    const before = start > 0 ? text[start - 1] : '';
    const after = end < text.length ? text[end] : '';
    const startsWithWord = WORD.test(text[start]);
    const endsWithWord = WORD.test(text[end - 1]);
    return !(startsWithWord && WORD.test(before)) && !(endsWithWord && WORD.test(after));
  }

  function findRange(text, needle, from, taken) {
    const value = String(needle || '').trim();
    if (!value) return null;
    const haystack = text.toLowerCase();
    const target = value.toLowerCase();
    for (const start of [from, 0]) {
      let index = haystack.indexOf(target, start);
      while (index !== -1) {
        const end = index + target.length;
        if (!overlaps(index, end, taken) && atBoundary(text, index, end)) return { start: index, end };
        index = haystack.indexOf(target, index + 1);
      }
    }
    return null;
  }

  // 回傳 [{ text, kind }]，kind 為 mod / subj / verb / obj 或 null
  function segmentSentence(sentence) {
    const text = String(sentence.original || '');
    const ranges = [];
    const modifiers = [...(sentence.modifiers || [])].sort((a, b) => b.text.length - a.text.length);
    for (const modifier of modifiers) {
      const range = findRange(text, modifier.text, 0, ranges);
      if (range) ranges.push({ ...range, kind: 'mod' });
    }
    let cursor = 0;
    for (const [field, kind] of [['subject', 'subj'], ['main_verb', 'verb'], [sentence.object ? 'object' : 'complement', 'obj']]) {
      const range = findRange(text, sentence[field], cursor, ranges);
      if (range) {
        ranges.push({ ...range, kind });
        cursor = range.end;
      }
    }
    ranges.sort((a, b) => a.start - b.start);
    const segments = [];
    let position = 0;
    for (const range of ranges) {
      if (range.start > position) segments.push({ text: text.slice(position, range.start), kind: null });
      segments.push({ text: text.slice(range.start, range.end), kind: range.kind });
      position = range.end;
    }
    if (position < text.length) segments.push({ text: text.slice(position), kind: null });
    return segments;
  }

  const KIND_CLASSES = {
    dehydrate: { mod: 'dehydrate', subj: 'main-subj', verb: 'main-verb', obj: 'main-obj' },
    reattach: { mod: 'modifier', subj: 'main-subj', verb: 'main-verb', obj: 'main-obj' },
  };

  function renderMarked(sentence, mode) {
    const classes = KIND_CLASSES[mode];
    return segmentSentence(sentence).map((segment) => {
      const className = segment.kind && classes[segment.kind];
      return className ? `<span class="${className}">${escapeHtml(segment.text)}</span>` : escapeHtml(segment.text);
    }).join('');
  }

  function skeletonParts(sentence) {
    return {
      subject: sentence.subject || '—',
      verb: sentence.main_verb || '—',
      object: sentence.object || sentence.complement || '—',
    };
  }

  function renderSentence(sentence, index, mode) {
    const parts = skeletonParts(sentence);
    let body = '';
    if (mode === 'skeleton') {
      const hasSkeleton = sentence.subject || sentence.main_verb;
      body = hasSkeleton
        ? `<div class="skeleton-line"><span class="main-subj">${escapeHtml(parts.subject)}</span> <span class="main-verb">${escapeHtml(parts.verb)}</span>${parts.object !== '—' ? ` <span class="main-obj">${escapeHtml(parts.object)}</span>` : ''}.</div>`
        : `<div class="reading">${escapeHtml(sentence.original)}</div>`;
      if (sentence.skeleton_zh) body += `<p class="translation">${escapeHtml(sentence.skeleton_zh)}</p>`;
    } else if (mode === 'reattach') {
      body = `<div class="reading">${renderMarked(sentence, 'reattach')}</div>`;
      if (sentence.modifiers.length) {
        body += `<ul class="relations">${sentence.modifiers.map((modifier) => (
          `<li><span class="arrow">🔴 ${escapeHtml(modifier.text)} ↘</span> 修飾：<strong>${escapeHtml(modifier.target || '—')}</strong>`
          + `${modifier.type ? ` <small>（${escapeHtml(MODIFIER_LABELS[modifier.type] || modifier.type)}）</small>` : ''}`
          + `${modifier.explanation ? `<br>${escapeHtml(modifier.explanation)}` : ''}</li>`
        )).join('')}</ul>`;
      }
      if (sentence.translation) body += `<p class="translation">中譯：${escapeHtml(sentence.translation)}</p>`;
    } else {
      body = `<div class="reading">${renderMarked(sentence, 'dehydrate')}</div>`
        + `<dl class="qa"><dt>誰？</dt><dd>${escapeHtml(parts.subject)}</dd>`
        + `<dt>做什麼？</dt><dd>${escapeHtml(parts.verb)}</dd>`
        + `<dt>什麼？</dt><dd>${escapeHtml(parts.object)}</dd></dl>`;
    }
    return `<div class="sentence"><div class="sentence-label">Sentence ${index + 1}</div>${body}</div>`;
  }

  function roleLabel(role) {
    const key = String(role || '').toLowerCase().trim();
    return key ? (ROLE_LABELS[key] || role) : '';
  }

  // ---- 瀏覽器端 ----

  function start() {
    const $ = (id) => document.getElementById(id);
    const els = {
      settingsPanel: $('settingsPanel'), settingsToggle: $('settingsToggle'), settingsClose: $('settingsClose'),
      statusDot: $('statusDot'), statusLabel: $('statusLabel'),
      providerInputs: [...document.querySelectorAll('input[name="provider"]')],
      apiKeyInput: $('apiKeyInput'), toggleKeyButton: $('toggleKeyButton'), modelInput: $('modelInput'),
      rememberKey: $('rememberKey'), saveSettingsButton: $('saveSettingsButton'),
      testConnectionButton: $('testConnectionButton'), settingsMessage: $('settingsMessage'),
      articleInput: $('articleInput'), imageInput: $('imageInput'), imageName: $('imageName'),
      ocrButton: $('ocrButton'), clearButton: $('clearButton'), cancelButton: $('cancelButton'),
      startButton: $('startButton'), progress: $('progress'), progressBar: $('progressBar'),
      progressText: $('progressText'), inputMessage: $('inputMessage'),
      stepOne: $('stepOne'), articleTitle: $('articleTitle'), articleThesis: $('articleThesis'), outline: $('outline'),
      stepTwo: $('stepTwo'), modeHint: $('modeHint'), paragraphs: $('paragraphs'),
      modeButtons: [...document.querySelectorAll('.mode')],
    };

    const storage = {
      get(area, key) { try { return window[area].getItem(key) || ''; } catch { return ''; } },
      set(area, key, value) { try { value ? window[area].setItem(key, value) : window[area].removeItem(key); } catch { /* 無法存取時略過 */ } },
    };

    const state = {
      provider: storage.get('localStorage', 'tcr_provider') || 'gemini',
      models: {},
      keys: {},
      image: null,
      mode: 'dehydrate',
      overview: null,
      results: [],
      controller: null,
    };
    for (const provider of Object.keys(DEFAULT_MODELS)) {
      state.models[provider] = storage.get('localStorage', `tcr_model_${provider}`) || DEFAULT_MODELS[provider];
      state.keys[provider] = storage.get('localStorage', `tcr_key_${provider}`) || storage.get('sessionStorage', `tcr_key_${provider}`);
    }
    if (!DEFAULT_MODELS[state.provider]) state.provider = 'gemini';

    function setMessage(element, message, type = '') {
      element.textContent = message;
      element.className = `message${type ? ` ${type}` : ''}`;
    }

    function credentials() {
      return { provider: state.provider, apiKey: state.keys[state.provider] || '', model: state.models[state.provider] };
    }

    async function post(path, data, signal) {
      let response;
      try {
        response = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
          signal,
        });
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        throw new Error('連不到本機伺服器，請確認 app.py 還在執行。');
      }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error || `請求失敗（HTTP ${response.status}）。`);
        error.fatal = Boolean(payload.fatal);
        throw error;
      }
      return payload;
    }

    // ---- 設定 ----

    function renderSettings() {
      els.providerInputs.forEach((input) => { input.checked = input.value === state.provider; });
      els.apiKeyInput.value = state.keys[state.provider] || '';
      els.modelInput.value = state.models[state.provider];
      els.rememberKey.checked = Boolean(storage.get('localStorage', `tcr_key_${state.provider}`));
      renderStatus();
    }

    function renderStatus() {
      const hasKey = Boolean(state.keys[state.provider]);
      els.statusDot.className = `dot ${hasKey ? 'ready' : 'warn'}`;
      els.statusLabel.textContent = hasKey
        ? `${PROVIDER_LABELS[state.provider]} · ${state.models[state.provider]}`
        : '尚未設定 API Key';
    }

    function applySettings() {
      const key = els.apiKeyInput.value.trim();
      state.keys[state.provider] = key;
      state.models[state.provider] = els.modelInput.value.trim() || DEFAULT_MODELS[state.provider];
      const remember = els.rememberKey.checked;
      storage.set('localStorage', 'tcr_provider', state.provider);
      storage.set('localStorage', `tcr_model_${state.provider}`, state.models[state.provider]);
      storage.set('localStorage', `tcr_key_${state.provider}`, remember ? key : '');
      storage.set('sessionStorage', `tcr_key_${state.provider}`, remember ? '' : key);
      renderStatus();
      return key;
    }

    function openSettings(message = '', type = '') {
      els.settingsPanel.hidden = false;
      setMessage(els.settingsMessage, message, type);
      els.settingsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (!els.apiKeyInput.value) els.apiKeyInput.focus();
    }

    els.settingsToggle.addEventListener('click', () => {
      if (els.settingsPanel.hidden) openSettings();
      else els.settingsPanel.hidden = true;
    });
    els.settingsClose.addEventListener('click', () => { els.settingsPanel.hidden = true; });
    els.providerInputs.forEach((input) => input.addEventListener('change', () => {
      state.provider = input.value;
      storage.set('localStorage', 'tcr_provider', state.provider);
      renderSettings();
      setMessage(els.settingsMessage, '');
    }));
    els.toggleKeyButton.addEventListener('click', () => {
      const hidden = els.apiKeyInput.type === 'password';
      els.apiKeyInput.type = hidden ? 'text' : 'password';
      els.toggleKeyButton.textContent = hidden ? '隱藏' : '顯示';
    });
    els.saveSettingsButton.addEventListener('click', () => {
      const key = applySettings();
      setMessage(els.settingsMessage, key ? `已套用 ${PROVIDER_LABELS[state.provider]} 設定。` : '已套用模型設定；尚未輸入 API Key。', key ? 'success' : '');
      if (key) els.settingsPanel.hidden = true;
    });
    els.testConnectionButton.addEventListener('click', async () => {
      if (!applySettings()) return setMessage(els.settingsMessage, '請先輸入 API Key。', 'error');
      els.testConnectionButton.disabled = true;
      setMessage(els.settingsMessage, '測試連線中…');
      try {
        await post('/api/test', credentials());
        setMessage(els.settingsMessage, `連線成功：${PROVIDER_LABELS[state.provider]} 回應正常。`, 'success');
      } catch (error) {
        setMessage(els.settingsMessage, error.message, 'error');
      } finally {
        els.testConnectionButton.disabled = false;
      }
    });

    // ---- 圖片 ----

    function loadImage(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('無法讀取圖片。'));
        reader.onload = () => {
          const image = new Image();
          image.onerror = () => resolve({ dataUrl: reader.result, mimeType: file.type });
          image.onload = () => {
            const scale = Math.min(1, 2000 / Math.max(image.width, image.height));
            if (scale === 1 && file.size < 3 * 1024 * 1024) return resolve({ dataUrl: reader.result, mimeType: file.type });
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(image.width * scale);
            canvas.height = Math.round(image.height * scale);
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
            resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.9), mimeType: 'image/jpeg' });
          };
          image.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
    }

    els.imageInput.addEventListener('change', async () => {
      const file = els.imageInput.files?.[0];
      if (!file) return;
      try {
        state.image = await loadImage(file);
        els.imageName.textContent = file.name;
        els.ocrButton.disabled = false;
      } catch (error) {
        setMessage(els.inputMessage, error.message, 'error');
      }
    });

    els.ocrButton.addEventListener('click', async () => {
      if (!state.image) return;
      if (!state.keys[state.provider]) return openSettings('請先輸入 API Key。', 'error');
      if (els.articleInput.value.trim() && !window.confirm('要用圖片中的文字取代目前的文章嗎？')) return;
      els.ocrButton.disabled = true;
      setMessage(els.inputMessage, '正在從圖片擷取文字…');
      try {
        const result = await post('/api/ocr', { ...credentials(), image: state.image });
        els.articleInput.value = result.text;
        setMessage(els.inputMessage, '已擷取文字，請確認內容後按「開始分析」。', 'success');
      } catch (error) {
        setMessage(els.inputMessage, error.message, 'error');
      } finally {
        els.ocrButton.disabled = false;
      }
    });

    els.clearButton.addEventListener('click', () => {
      els.articleInput.value = '';
      els.imageInput.value = '';
      state.image = null;
      els.imageName.textContent = '未選圖片';
      els.ocrButton.disabled = true;
      setMessage(els.inputMessage, '');
    });

    // ---- 一段一段分析 ----

    function setRunning(running) {
      els.startButton.disabled = running;
      els.cancelButton.disabled = !running;
      els.progress.hidden = false;
    }

    function setProgress(done, total, text) {
      els.progressBar.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
      els.progressText.textContent = text;
    }

    function renderOutline() {
      const overview = state.overview;
      els.stepOne.hidden = false;
      els.articleTitle.textContent = overview.article_title;
      els.articleThesis.textContent = overview.thesis;
      els.articleThesis.hidden = !overview.thesis;
      els.outline.innerHTML = overview.paragraphs.map((paragraph, index) => {
        const result = state.results[index];
        const summary = result?.data?.summary || paragraph.summary || paragraph.text.slice(0, 80);
        const summaryZh = result?.data?.summary_zh || paragraph.summary_zh;
        const role = roleLabel(result?.data?.logic_role || paragraph.logic_role);
        const status = { pending: '等待中', running: '分析中…', done: '完成', error: '失敗' }[result.status];
        return `<li data-index="${index}"><span class="num">${index + 1}</span>`
          + `<span class="body">${escapeHtml(summary)}${role ? `<span class="role">${escapeHtml(role)}</span>` : ''}`
          + `${summaryZh ? `<span class="zh">${escapeHtml(summaryZh)}</span>` : ''}</span>`
          + `<span class="state ${result.status}">${status}</span></li>`;
      }).join('');
    }

    function renderParagraph(index) {
      const paragraph = state.overview.paragraphs[index];
      const result = state.results[index];
      let card = document.getElementById(`paragraph-${index}`);
      if (!card) {
        card = document.createElement('article');
        card.id = `paragraph-${index}`;
        els.paragraphs.appendChild(card);
      }
      card.className = `card paragraph ${result.status === 'done' ? '' : result.status === 'error' ? 'failed' : 'pending'}`;
      const role = roleLabel(result.data?.logic_role || paragraph.logic_role);
      const head = `<div class="card-head"><h3>第 ${index + 1} 段${role ? `<span class="role">${escapeHtml(role)}</span>` : ''}</h3></div>`;
      if (result.status === 'done') {
        const summary = result.data.summary_zh || result.data.summary;
        card.innerHTML = head
          + (summary ? `<p class="paragraph-summary">骨幹：${escapeHtml(summary)}</p>` : '')
          + result.data.sentences.map((sentence, sentenceIndex) => renderSentence(sentence, sentenceIndex, state.mode)).join('');
      } else if (result.status === 'error') {
        card.innerHTML = `${head}<p class="placeholder">${escapeHtml(result.error)}</p>`
          + `<div class="actions"><button type="button" data-retry="${index}">重試這一段</button></div>`;
      } else {
        const label = result.status === 'running' ? '分析中…' : '等待分析';
        card.innerHTML = `${head}<p class="placeholder">${label}</p><p class="reading">${escapeHtml(paragraph.text)}</p>`;
      }
    }

    function renderAllParagraphs() {
      state.results.forEach((_, index) => renderParagraph(index));
    }

    async function analyzeParagraph(index, signal) {
      const total = state.overview.paragraphs.length;
      state.results[index] = { status: 'running' };
      renderOutline();
      renderParagraph(index);
      try {
        const data = await post('/api/paragraph', {
          ...credentials(),
          paragraph: state.overview.paragraphs[index].text,
          index: index + 1,
          total,
          thesis: state.overview.thesis,
        }, signal);
        state.results[index] = { status: 'done', data };
      } catch (error) {
        if (error.name === 'AbortError') {
          state.results[index] = { status: 'pending' };
          throw error;
        }
        state.results[index] = { status: 'error', error: error.message };
        if (error.fatal) throw error;
      } finally {
        renderOutline();
        renderParagraph(index);
      }
    }

    function countDone() {
      return state.results.filter((result) => result.status === 'done').length;
    }

    async function runAnalysis() {
      const text = els.articleInput.value.trim();
      if (!text) return setMessage(els.inputMessage, '請先貼上英文文章。', 'error');
      if (!state.keys[state.provider]) return openSettings('要開始分析，請先輸入 API Key。', 'error');

      state.controller?.abort();
      const controller = new AbortController();
      state.controller = controller;
      setRunning(true);
      setMessage(els.inputMessage, '');
      els.paragraphs.innerHTML = '';
      els.stepTwo.hidden = true;
      els.stepOne.hidden = true;
      setProgress(0, 1, 'Step One：先讀完全文，整理文章骨幹…');

      try {
        state.overview = await post('/api/overview', { ...credentials(), text }, controller.signal);
        state.results = state.overview.paragraphs.map(() => ({ status: 'pending' }));
        const total = state.overview.paragraphs.length;
        renderOutline();
        els.stepTwo.hidden = false;
        renderAllParagraphs();
        for (let index = 0; index < total; index += 1) {
          setProgress(countDone(), total, `Step Two：第 ${index + 1} / ${total} 段分析中…`);
          await analyzeParagraph(index, controller.signal);
        }
        const failed = total - countDone();
        setProgress(countDone(), total, failed ? `完成 ${countDone()} / ${total} 段，${failed} 段失敗，可按「重試這一段」。` : `全部 ${total} 段分析完成。`);
      } catch (error) {
        if (error.name === 'AbortError') {
          setProgress(countDone(), state.results.length || 1, '已取消；已完成的段落會保留。');
        } else {
          setProgress(countDone(), state.results.length || 1, '分析中止。');
          setMessage(els.inputMessage, error.message, 'error');
          if (error.fatal) openSettings(error.message, 'error');
        }
        if (state.overview) renderOutline();
      } finally {
        if (state.controller === controller) state.controller = null;
        setRunning(false);
      }
    }

    els.startButton.addEventListener('click', runAnalysis);
    els.cancelButton.addEventListener('click', () => state.controller?.abort());
    els.articleInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) runAnalysis();
    });

    els.paragraphs.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-retry]');
      if (!button || state.controller) return;
      const controller = new AbortController();
      state.controller = controller;
      setRunning(true);
      const total = state.results.length;
      try {
        await analyzeParagraph(Number(button.dataset.retry), controller.signal);
      } catch (error) {
        if (error.name !== 'AbortError') setMessage(els.inputMessage, error.message, 'error');
      } finally {
        state.controller = null;
        setRunning(false);
        setProgress(countDone(), total, `完成 ${countDone()} / ${total} 段。`);
      }
    });

    els.outline.addEventListener('click', (event) => {
      const item = event.target.closest('li[data-index]');
      if (item) document.getElementById(`paragraph-${item.dataset.index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    function setMode(mode) {
      state.mode = mode;
      els.modeButtons.forEach((button) => {
        const active = button.dataset.mode === mode;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
      });
      els.modeHint.textContent = MODE_HINTS[mode];
      if (state.overview) renderAllParagraphs();
    }
    els.modeButtons.forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));

    renderSettings();
    setMode('dehydrate');
    if (!state.keys[state.provider]) openSettings('第一次使用：選擇 Provider，貼上 API Key 後按「套用」。');
    else els.settingsPanel.hidden = true;
  }

  return { escapeHtml, findRange, segmentSentence, renderSentence, roleLabel, start };
});
