(() => {
  if (window.__avitoParserInjected) return;
  window.__avitoParserInjected = true;

  const SHADOW_HOST_ID = 'avito-parser-root';

  let shadowRoot = null;
  let panelEl = null;
  let fabEl = null;
  let lastResult = null;
  let displayItems = [];
  let selectedIndices = new Set();
  let currentSort = 'default';
  let searchQuery = '';
  let filterDelivery = 'all';
  let filterInclude = '';
  let filterExclude = '';
  let hideReserved = true;
  let pagesLoaded = 1;
  let loadingPages = false;
  let isLoadingAll = false;
  let abortLoadingAll = false;

  let activeFields = {
    aiPrompt: true,
    title: true,
    price: true,
    delivery: false,
    description: true,
    location: false,
    date: false,
    seller: false,
    url: false,
    image: false,
  };

  const ICON_PARSE = `<svg class="ap-fab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  const ICON_LOADING = `<svg class="ap-fab-icon ap-spin-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`;

  function init() {
    if (document.getElementById(SHADOW_HOST_ID)) return;

    const host = document.createElement('div');
    host.id = SHADOW_HOST_ID;
    host.style.cssText = 'all:initial; position:fixed; z-index:2147483647;';
    document.body.appendChild(host);

    // Ensure any previously set theme attributes on documentElement are cleaned up
    document.documentElement.removeAttribute('data-avito-theme');
    document.documentElement.removeAttribute('data-avito-custom-theme');
    document.documentElement.removeAttribute('data-avito-preset-theme');

    shadowRoot = host.attachShadow({ mode: 'closed' });

    injectStyles();
    createFAB();
    createPanel();
    loadStoredFields();
  }

  async function injectStyles() {
    try {
      const url = chrome.runtime.getURL('content/content.css');
      const res = await fetch(url);
      const css = await res.text();
      const style = document.createElement('style');
      style.textContent = css;
      shadowRoot.appendChild(style);
    } catch {
      const style = document.createElement('style');
      style.textContent = ':host { font-family: system-ui, sans-serif; }';
      shadowRoot.appendChild(style);
    }
  }

  function createFAB() {
    fabEl = document.createElement('button');
    fabEl.className = 'ap-fab';
    fabEl.innerHTML = ICON_PARSE;
    fabEl.title = 'Собрать объявления';
    fabEl.addEventListener('click', handleParse);
    shadowRoot.appendChild(fabEl);
  }

  function createPanel() {
    panelEl = document.createElement('div');
    panelEl.className = 'ap-panel';
    panelEl.innerHTML = `
      <div class="ap-header">
        <div class="ap-header-top">
          <h2>Avito Parser</h2>
          <button class="ap-close" title="Закрыть">✕</button>
        </div>
        <div class="ap-stats" id="ap-stats"></div>
      </div>
      <div class="ap-search-bar" id="ap-search-bar" style="display:none">
        <div class="ap-search-input-wrap">
          <svg class="ap-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input type="text" class="ap-search-input" id="ap-search-input" placeholder="Поиск по номеру (№2) или тексту..." autocomplete="off">
          <button class="ap-search-clear" id="ap-search-clear" style="display:none" title="Очистить поиск">✕</button>
        </div>
        <span class="ap-search-count" id="ap-search-count"></span>
      </div>
      <div class="ap-filters-bar" id="ap-filters-bar" style="display:none">
        <div class="ap-filters-top-row">
          <span class="ap-filter-label">Доставка:</span>
          <div class="ap-pills" id="ap-delivery-pills">
            <button class="ap-pill ap-pill-active" data-delivery="all">Все</button>
            <button class="ap-pill" data-delivery="with" title="Только с Авито Доставкой">🚚 Есть</button>
            <button class="ap-pill" data-delivery="without" title="Только без доставки">Нет</button>
          </div>
          <label class="ap-filter-check" title="Не показывать товары со статусом 'Товар зарезервирован'">
            <input type="checkbox" id="ap-filter-hide-reserved" checked> Без резерва
          </label>
          <button class="ap-filter-reset-btn" id="ap-filter-reset" style="display:none" title="Сбросить фильтры">✕ Сброс</button>
        </div>
        <div class="ap-filters-kw-row">
          <div class="ap-kw-wrap" title="Показывать только если содержит эти слова (через запятую)">
            <span class="ap-kw-badge ap-kw-plus">+</span>
            <input type="text" class="ap-kw-input" id="ap-filter-include" placeholder="Обязательно содержит..." autocomplete="off">
          </div>
          <div class="ap-kw-wrap" title="Исключить объявления с этими словами (минус-слова, через запятую)">
            <span class="ap-kw-badge ap-kw-minus">−</span>
            <input type="text" class="ap-kw-input" id="ap-filter-exclude" placeholder="Минус-слова (запчасти, сломан...)" autocomplete="off">
          </div>
        </div>
      </div>
      <div class="ap-toolbar" id="ap-toolbar" style="display:none">
        <div class="ap-toolbar-group">
          <span class="ap-toolbar-label">Сортировка</span>
          <select class="ap-select" id="ap-sort">
            <option value="default">По умолчанию</option>
            <option value="price-asc">Цена: дешевле</option>
            <option value="price-desc">Цена: дороже</option>
          </select>
        </div>
        <div class="ap-toolbar-sep"></div>
        <div class="ap-toolbar-group">
          <span class="ap-selection-info" id="ap-selection-info">Выбрано: 0</span>
          <button class="ap-toolbar-btn" id="ap-select-all">Выбрать все</button>
          <button class="ap-toolbar-btn" id="ap-deselect-all" style="display:none">Снять все</button>
        </div>
        <div class="ap-toolbar-sep"></div>
        <div class="ap-toolbar-group">
          <span class="ap-page-info" id="ap-page-info">Стр. 1</span>
          <button class="ap-page-btn" id="ap-load-more" title="Загрузить следующую страницу">+ След. стр.</button>
          <button class="ap-page-btn" id="ap-load-all" title="Загружать страницы последовательно с защитной паузой">+ Все стр.</button>
        </div>
      </div>
      <div class="ap-fields-bar" id="ap-fields-bar" style="display:none">
        <div class="ap-fields-header">
          <span class="ap-fields-title">Копировать поля:</span>
          <button class="ap-preset-btn" id="ap-preset-ai" title="Только название, цена и описание">⚡ Пресет для ИИ</button>
        </div>
        <div class="ap-fields-chips" id="ap-fields-chips">
          <label class="ap-chip ap-chip-active" data-chip="aiPrompt"><input type="checkbox" data-field="aiPrompt" checked> Инструкция для ИИ</label>
          <label class="ap-chip" data-chip="title"><input type="checkbox" data-field="title" checked> Название</label>
          <label class="ap-chip" data-chip="price"><input type="checkbox" data-field="price" checked> Цена</label>
          <label class="ap-chip" data-chip="delivery"><input type="checkbox" data-field="delivery"> 🚚 Доставка</label>
          <label class="ap-chip" data-chip="description"><input type="checkbox" data-field="description" checked> Описание</label>
          <label class="ap-chip" data-chip="location"><input type="checkbox" data-field="location"> Локация</label>
          <label class="ap-chip" data-chip="url"><input type="checkbox" data-field="url"> Ссылка</label>
          <label class="ap-chip" data-chip="image"><input type="checkbox" data-field="image"> Фото</label>
        </div>
      </div>
      <div class="ap-export-row" id="ap-export-row" style="display:none">
        <button class="ap-btn ap-primary" data-format="md">Markdown</button>
        <button class="ap-btn" data-format="json">JSON</button>
        <button class="ap-btn" data-format="tsv">TSV</button>
      </div>
      <div class="ap-cards" id="ap-cards">
        <div class="ap-empty">
          <h3>Нажми кнопку парсинга</h3>
          <p>Расширение соберёт объявления<br>с текущей страницы Авито</p>
        </div>
      </div>
      <div class="ap-footer" id="ap-footer"></div>
    `;
    shadowRoot.appendChild(panelEl);

    panelEl.querySelector('.ap-close').addEventListener('click', closePanel);
    panelEl.querySelector('#ap-export-row').addEventListener('click', handleExport);
    panelEl.querySelector('#ap-sort').addEventListener('change', handleSort);
    panelEl.querySelector('#ap-load-more').addEventListener('click', handleLoadMore);
    panelEl.querySelector('#ap-load-all').addEventListener('click', handleLoadAll);
    panelEl.querySelector('#ap-select-all').addEventListener('click', selectAll);
    panelEl.querySelector('#ap-deselect-all').addEventListener('click', deselectAll);
    panelEl.querySelector('#ap-preset-ai').addEventListener('click', applyAiPreset);
    panelEl.querySelector('#ap-fields-chips').addEventListener('change', handleFieldChange);

    panelEl.querySelector('#ap-delivery-pills').addEventListener('click', handleDeliveryFilterClick);
    panelEl.querySelector('#ap-filter-include').addEventListener('input', handleFilterIncludeInput);
    panelEl.querySelector('#ap-filter-exclude').addEventListener('input', handleFilterExcludeInput);
    panelEl.querySelector('#ap-filter-hide-reserved').addEventListener('change', handleHideReservedChange);
    panelEl.querySelector('#ap-filter-reset').addEventListener('click', handleFiltersReset);

    const searchInput = panelEl.querySelector('#ap-search-input');
    const searchClear = panelEl.querySelector('#ap-search-clear');
    searchInput.addEventListener('input', handleSearchInput);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        handleSearchClear();
      }
    });
    searchClear.addEventListener('click', handleSearchClear);
  }

  // Field selection logic
  function handleFieldChange(e) {
    const input = e.target.closest('input[type="checkbox"]');
    if (!input) return;
    const field = input.dataset.field;
    if (!field) return;

    activeFields[field] = input.checked;
    const chip = input.closest('.ap-chip');
    if (chip) chip.classList.toggle('ap-chip-active', input.checked);

    saveStoredFields();
  }

  function applyAiPreset() {
    activeFields = {
      aiPrompt: true,
      title: true,
      price: true,
      delivery: false,
      description: true,
      location: false,
      date: false,
      seller: false,
      url: false,
      image: false,
    };
    syncFieldsUI();
    saveStoredFields();

    const btn = panelEl.querySelector('#ap-preset-ai');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✓ Включено';
      setTimeout(() => { btn.textContent = orig; }, 1200);
    }
  }

  function syncFieldsUI() {
    const chipsContainer = panelEl.querySelector('#ap-fields-chips');
    if (!chipsContainer) return;

    chipsContainer.querySelectorAll('input[type="checkbox"]').forEach(input => {
      const field = input.dataset.field;
      if (field in activeFields) {
        input.checked = !!activeFields[field];
        const chip = input.closest('.ap-chip');
        if (chip) chip.classList.toggle('ap-chip-active', input.checked);
      }
    });
  }

  function loadStoredFields() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['ap_export_fields'], (res) => {
        if (res && res.ap_export_fields) {
          activeFields = { ...activeFields, ...res.ap_export_fields };
          syncFieldsUI();
        }
      });
    }
  }

  function saveStoredFields() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ ap_export_fields: activeFields });
    }
  }

  // Search & Filter handlers
  function handleSearchInput(e) {
    searchQuery = e.target.value.trim().toLowerCase();
    const clearBtn = panelEl.querySelector('#ap-search-clear');
    if (clearBtn) clearBtn.style.display = searchQuery ? 'flex' : 'none';

    renderCards(getFilteredItems());
    updateSearchCount();
    updateSelectionInfo();
  }

  function handleSearchClear() {
    const input = panelEl.querySelector('#ap-search-input');
    if (input) {
      input.value = '';
      input.focus();
    }
    searchQuery = '';
    const clearBtn = panelEl.querySelector('#ap-search-clear');
    if (clearBtn) clearBtn.style.display = 'none';

    renderCards(getFilteredItems());
    updateSearchCount();
    updateSelectionInfo();
  }

  function handleDeliveryFilterClick(e) {
    const btn = e.target.closest('.ap-pill');
    if (!btn) return;
    const val = btn.dataset.delivery;
    if (!val) return;

    filterDelivery = val;
    panelEl.querySelectorAll('#ap-delivery-pills .ap-pill').forEach(b => {
      b.classList.toggle('ap-pill-active', b.dataset.delivery === val);
    });

    updateFilterResetVisibility();
    renderCards(getFilteredItems());
    updateSearchCount();
    updateSelectionInfo();
  }

  function handleFilterIncludeInput(e) {
    filterInclude = e.target.value.trim().toLowerCase();
    updateFilterResetVisibility();
    renderCards(getFilteredItems());
    updateSearchCount();
    updateSelectionInfo();
  }

  function handleFilterExcludeInput(e) {
    filterExclude = e.target.value.trim().toLowerCase();
    updateFilterResetVisibility();
    renderCards(getFilteredItems());
    updateSearchCount();
    updateSelectionInfo();
  }

  function handleHideReservedChange(e) {
    hideReserved = e.target.checked;
    updateFilterResetVisibility();
    renderCards(getFilteredItems());
    updateSearchCount();
    updateSelectionInfo();
  }

  function handleFiltersReset() {
    filterDelivery = 'all';
    filterInclude = '';
    filterExclude = '';
    hideReserved = true;

    const incInput = panelEl.querySelector('#ap-filter-include');
    if (incInput) incInput.value = '';
    const excInput = panelEl.querySelector('#ap-filter-exclude');
    if (excInput) excInput.value = '';
    const resCheck = panelEl.querySelector('#ap-filter-hide-reserved');
    if (resCheck) resCheck.checked = true;

    panelEl.querySelectorAll('#ap-delivery-pills .ap-pill').forEach(b => {
      b.classList.toggle('ap-pill-active', b.dataset.delivery === 'all');
    });

    updateFilterResetVisibility();
    renderCards(getFilteredItems());
    updateSearchCount();
    updateSelectionInfo();
  }

  function updateFilterResetVisibility() {
    const resetBtn = panelEl.querySelector('#ap-filter-reset');
    if (!resetBtn) return;
    const hasActive = filterDelivery !== 'all' || !hideReserved || !!filterInclude || !!filterExclude;
    resetBtn.style.display = hasActive ? 'inline-flex' : 'none';
  }

  function getFilteredItems() {
    if (!displayItems || displayItems.length === 0) return [];

    const incTerms = filterInclude
      .split(/[,;]+|\s+/)
      .map(t => t.trim().toLowerCase())
      .filter(Boolean);

    const excTerms = filterExclude
      .split(/[,;]+|\s+/)
      .map(t => t.trim().toLowerCase())
      .filter(Boolean);

    const hasFilters = !!searchQuery || filterDelivery !== 'all' || hideReserved || incTerms.length > 0 || excTerms.length > 0;
    if (!hasFilters) return displayItems;

    const numMatch = searchQuery ? searchQuery.match(/^(?:№|#|номер\s*|no\s*|лот\s*|lot\s*)?(\d+)$/i) : null;
    const targetNum = numMatch ? parseInt(numMatch[1], 10) : null;

    return displayItems.filter(item => {
      // Direct jump by lot number ignores other filters so user can always find the lot
      if (targetNum !== null) {
        return item.itemNum === targetNum;
      }

      // 1. Reserved filter
      if (hideReserved && item.isReserved) return false;

      // 2. Delivery
      if (filterDelivery === 'with' && !item.hasDelivery) return false;
      if (filterDelivery === 'without' && item.hasDelivery) return false;

      const hay = [
        `№${item.itemNum}`,
        `лот ${item.itemNum}`,
        `лот${item.itemNum}`,
        `#${item.itemNum}`,
        item.title,
        String(item.priceNum || ''),
        item.price,
        item.oldPrice || '',
        item.discount || '',
        item.description,
        item.location,
        item.seller,
        item.sellerRating || '',
        item.deliveryText || ''
      ].join(' ').toLowerCase();

      // 3. Search query
      if (searchQuery && !hay.includes(searchQuery)) return false;

      // 4. Must include terms (ALL terms must be present)
      if (incTerms.length > 0) {
        for (const term of incTerms) {
          if (!hay.includes(term)) return false;
        }
      }

      // 5. Must exclude terms (NONE of the terms can be present)
      if (excTerms.length > 0) {
        for (const term of excTerms) {
          if (hay.includes(term)) return false;
        }
      }

      return true;
    });
  }

  function updateSearchCount() {
    const countEl = panelEl.querySelector('#ap-search-count');
    if (!countEl) return;
    const hasFilters = !!searchQuery || filterDelivery !== 'all' || !!filterInclude || !!filterExclude;
    if (hasFilters) {
      const filtered = getFilteredItems();
      countEl.textContent = `${filtered.length} из ${displayItems.length}`;
    } else {
      countEl.textContent = '';
    }
  }

  // Parse
  function handleParse() {
    fabEl.classList.add('ap-loading');
    fabEl.innerHTML = ICON_LOADING;

    const cardsEl = panelEl.querySelector('#ap-cards');
    cardsEl.innerHTML = `
      <div class="ap-loading-state">
        <div class="ap-spinner"></div>
        <p>Собираю объявления со страницы…</p>
      </div>
    `;
    openPanel();

    setTimeout(() => {
      try {
        lastResult = AvitoParser.parse();
        pagesLoaded = 1;
        loadingPages = false;
        isLoadingAll = false;
        abortLoadingAll = false;
        currentSort = 'default';
        searchQuery = '';
        filterDelivery = 'all';
        filterInclude = '';
        filterExclude = '';
        selectedIndices = new Set();

        lastResult.items.forEach((item, idx) => {
          item.itemNum = idx + 1;
        });
        displayItems = [...lastResult.items];

        const searchInput = panelEl.querySelector('#ap-search-input');
        if (searchInput) searchInput.value = '';
        const searchClear = panelEl.querySelector('#ap-search-clear');
        if (searchClear) searchClear.style.display = 'none';

        const incInput = panelEl.querySelector('#ap-filter-include');
        if (incInput) incInput.value = '';
        const excInput = panelEl.querySelector('#ap-filter-exclude');
        if (excInput) excInput.value = '';

        panelEl.querySelectorAll('#ap-delivery-pills .ap-pill').forEach(b => {
          b.classList.toggle('ap-pill-active', b.dataset.delivery === 'all');
        });
        updateFilterResetVisibility();

        renderResults();

        const sortEl = panelEl.querySelector('#ap-sort');
        if (sortEl) sortEl.value = 'default';

        chrome.runtime.sendMessage({
          type: 'PARSE_RESULT',
          data: {
            query: AvitoParser.getSearchQuery(),
            count: lastResult.items.length,
            source: lastResult.source,
            url: window.location.href,
            parsedAt: new Date().toISOString(),
          },
        });
      } catch (err) {
        renderError(err);
      }

      fabEl.classList.remove('ap-loading');
      fabEl.innerHTML = ICON_PARSE;
    }, 150);
  }

  // Sort
  function handleSort(e) {
    currentSort = e.target.value;
    applySortAndRender();
  }

  function applySortAndRender() {
    if (!lastResult || lastResult.items.length === 0) return;

    displayItems = [...lastResult.items];

    if (currentSort === 'price-asc' || currentSort === 'price-desc') {
      const dir = currentSort === 'price-asc' ? 1 : -1;
      displayItems.sort((a, b) => {
        const pa = parsePrice(a.price);
        const pb = parsePrice(b.price);
        if (pa === null && pb === null) return 0;
        if (pa === null) return 1;
        if (pb === null) return -1;
        return (pa - pb) * dir;
      });
    }

    renderCards(getFilteredItems());
    updateSelectionInfo();
    updateSearchCount();
  }

  function parsePrice(str) {
    if (!str) return null;
    const cleaned = str.replace(/[^\d.,]/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }

  // Selection
  function toggleSelection(itemNum) {
    if (selectedIndices.has(itemNum)) {
      selectedIndices.delete(itemNum);
    } else {
      selectedIndices.add(itemNum);
    }
    updateCardSelectedState(itemNum);
    updateSelectionInfo();
  }

  function selectAll() {
    const visible = getFilteredItems();
    selectedIndices.clear();
    visible.forEach((item) => selectedIndices.add(item.itemNum));
    displayItems.forEach((item) => updateCardSelectedState(item.itemNum));
    updateSelectionInfo();
  }

  function deselectAll() {
    selectedIndices.clear();
    displayItems.forEach((item) => updateCardSelectedState(item.itemNum));
    updateSelectionInfo();
  }

  function updateCardSelectedState(itemNum) {
    const card = panelEl.querySelector(`[data-card-num="${itemNum}"]`);
    if (!card) return;
    const checkbox = card.querySelector('.ap-card-check');
    if (selectedIndices.has(itemNum)) {
      card.classList.add('ap-card-selected');
      if (checkbox) checkbox.checked = true;
    } else {
      card.classList.remove('ap-card-selected');
      if (checkbox) checkbox.checked = false;
    }
  }

  function updateSelectionInfo() {
    const info = panelEl.querySelector('#ap-selection-info');
    const selectAllBtn = panelEl.querySelector('#ap-select-all');
    const deselectAllBtn = panelEl.querySelector('#ap-deselect-all');

    const visible = getFilteredItems();
    const visibleTotal = visible.length;
    const selectedVisibleCount = visible.filter((item) => selectedIndices.has(item.itemNum)).length;

    if (info) {
      info.innerHTML = selectedVisibleCount > 0
        ? `Выбрано: <strong>${selectedVisibleCount}</strong> из ${visibleTotal}`
        : `Выбрано: 0 из ${visibleTotal}`;
    }

    if (selectAllBtn && deselectAllBtn) {
      if (selectedVisibleCount > 0) {
        selectAllBtn.style.display = 'none';
        deselectAllBtn.style.display = '';
      } else {
        selectAllBtn.style.display = '';
        deselectAllBtn.style.display = 'none';
      }
    }
  }

  // Pagination
  async function handleLoadMore() {
    if (loadingPages) return;

    const nextPage = pagesLoaded + 1;
    const nextUrl = buildPageUrl(nextPage);
    if (!nextUrl) return;

    const btn = panelEl.querySelector('#ap-load-more');
    const btnAll = panelEl.querySelector('#ap-load-all');
    btn.classList.add('ap-loading-pages');
    btn.textContent = 'Загрузка...';
    if (btnAll) btnAll.disabled = true;
    loadingPages = true;

    try {
      const html = await fetchPage(nextUrl);
      const newItems = parseHTMLForItems(html);

      if (newItems.length === 0) {
        btn.textContent = 'Страниц больше нет';
        btn.disabled = true;
        if (btnAll) {
          btnAll.textContent = 'Все загружены';
          btnAll.disabled = true;
        }
        loadingPages = false;
        return;
      }

      newItems.forEach((item, idx) => {
        item.itemNum = lastResult.items.length + idx + 1;
      });
      lastResult.items.push(...newItems);
      pagesLoaded = nextPage;

      applySortAndRender();
      updatePageInfo();
      updateStats();

      btn.textContent = '+ След. стр.';
    } catch {
      btn.textContent = 'Ошибка';
      setTimeout(() => { btn.textContent = '+ След. стр.'; }, 2000);
    } finally {
      btn.classList.remove('ap-loading-pages');
      if (btnAll && btn.textContent !== 'Страниц больше нет') {
        btnAll.disabled = false;
      }
      loadingPages = false;
    }
  }

  async function handleLoadAll() {
    const btnLoadAll = panelEl.querySelector('#ap-load-all');
    const btnLoadMore = panelEl.querySelector('#ap-load-more');
    if (!btnLoadAll) return;

    // Повторный клик во время загрузки останавливает процесс
    if (isLoadingAll) {
      abortLoadingAll = true;
      btnLoadAll.textContent = 'Остановка...';
      return;
    }

    if (loadingPages) return;

    loadingPages = true;
    isLoadingAll = true;
    abortLoadingAll = false;

    btnLoadAll.classList.add('ap-btn-stop');
    if (btnLoadMore) btnLoadMore.disabled = true;

    const MAX_PAGES = 50;

    try {
      while (!abortLoadingAll) {
        const nextPage = pagesLoaded + 1;
        if (nextPage > MAX_PAGES) {
          btnLoadAll.textContent = `Лимит (${MAX_PAGES} стр.)`;
          await new Promise(r => setTimeout(r, 1500));
          break;
        }

        const nextUrl = buildPageUrl(nextPage);
        if (!nextUrl) break;

        btnLoadAll.textContent = `⏹ Стоп (${nextPage}...)`;

        let html;
        try {
          html = await fetchPage(nextUrl);
        } catch {
          btnLoadAll.textContent = 'Ошибка сети';
          await new Promise(r => setTimeout(r, 1500));
          break;
        }

        if (abortLoadingAll) break;

        const newItems = parseHTMLForItems(html);
        if (newItems.length === 0) {
          btnLoadAll.textContent = 'Все загружены';
          btnLoadAll.disabled = true;
          if (btnLoadMore) {
            btnLoadMore.textContent = 'Страниц больше нет';
            btnLoadMore.disabled = true;
          }
          await new Promise(r => setTimeout(r, 1500));
          break;
        }

        newItems.forEach((item, idx) => {
          item.itemNum = lastResult.items.length + idx + 1;
        });
        lastResult.items.push(...newItems);
        pagesLoaded = nextPage;

        applySortAndRender();
        updatePageInfo();
        updateStats();

        if (abortLoadingAll) break;

        // Защитная пауза между страницами для предотвращения капчи и rate-limit от Авито
        await new Promise(r => setTimeout(r, 1200));
      }
    } finally {
      loadingPages = false;
      isLoadingAll = false;
      abortLoadingAll = false;

      btnLoadAll.classList.remove('ap-btn-stop');
      if (!btnLoadAll.disabled) {
        btnLoadAll.textContent = '+ Все стр.';
      }
      if (btnLoadMore && btnLoadMore.textContent !== 'Страниц больше нет') {
        btnLoadMore.disabled = false;
      }
    }
  }

  function buildPageUrl(page) {
    const url = new URL(window.location.href);
    url.searchParams.set('p', String(page));
    return url.toString();
  }

  async function fetchPage(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  }

  function parseHTMLForItems(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const scriptEl = doc.querySelector('script#__NEXT_DATA__');
    if (scriptEl) {
      try {
        const payload = JSON.parse(scriptEl.textContent);
        const items = findItemsInPayload(payload);
        if (items && items.length > 0) {
          return items.map(raw => normalizeItem(raw));
        }
      } catch { /* DOM fallback */ }
    }

    // 1. Search catalog cards
    const cards = doc.querySelectorAll('[data-marker="item"], [class*="iva-item-root"]');
    if (cards.length > 0) {
      return Array.from(cards).map(card => parseDOMCardFromDoc(card));
    }

    // 2. Feed / Recommendations cards
    const itemLinks = Array.from(doc.querySelectorAll('a[href*="_"]')).filter(a => {
      const href = a.getAttribute('href') || '';
      return /_(\d+)(?:\?|$|\/)/.test(href) && !href.includes('/user/') && !href.includes('/brands/');
    });

    if (itemLinks.length > 0) {
      const containers = new Set();
      const feedCards = [];
      for (const a of itemLinks) {
        const container = a.closest('div[class*="module"], div[class*="card"], div[class*="item"], div[class*="styles-module"]') || a.parentElement;
        if (container && !containers.has(container)) {
          containers.add(container);
          feedCards.push(container);
        }
      }
      if (feedCards.length > 0) {
        return feedCards.map(card => parseDOMCardFromDoc(card));
      }
    }

    const altCards = doc.querySelectorAll('[itemtype*="Product"]');
    return Array.from(altCards).map(card => parseDOMCardFromDoc(card));
  }

  function parseDOMCardFromDoc(card) {
    if (typeof AvitoParser !== 'undefined' && AvitoParser.parseDOMCard) {
      return AvitoParser.parseDOMCard(card);
    }

    const titleEl = card.querySelector('[data-marker="item-title"], [itemprop="name"], a[title]');
    const title = titleEl ? (AvitoParser.cleanText ? AvitoParser.cleanText(titleEl.textContent) : titleEl.textContent.trim()) : '';
    const price = AvitoParser.extractDOMPrice ? AvitoParser.extractDOMPrice(card) : '';
    const priceNum = AvitoParser.extractNumericPrice ? AvitoParser.extractNumericPrice(price) : null;
    const hasDelivery = AvitoParser.extractDOMDelivery ? AvitoParser.extractDOMDelivery(card) : false;
    const isReserved = AvitoParser.extractDOMReserved ? AvitoParser.extractDOMReserved(card) : false;
    const description = AvitoParser.extractDOMDescription ? AvitoParser.extractDOMDescription(card, title, price) : '';
    const linkEl = card.querySelector('a[data-marker="item-title"], a[href*="/"]');
    const dateEl = card.querySelector('[data-marker="item-date"], [class*="date"], time');
    const locEl = card.querySelector('[data-marker="item-address"], [class*="geo"], [class*="location"]');
    const imgEl = card.querySelector('img[src*="http"], img[data-marker*="image"]');
    const href = linkEl ? linkEl.getAttribute('href') : '';

    return {
      title,
      price: price || 'Цена не указана',
      priceNum,
      hasDelivery,
      isReserved,
      description,
      location: locEl ? (AvitoParser.cleanText ? AvitoParser.cleanText(locEl.textContent) : locEl.textContent.trim()) : '',
      url: AvitoParser.cleanUrl ? AvitoParser.cleanUrl(href) : (href.startsWith('http') ? href : `https://www.avito.ru${href}`),
      date: dateEl ? (AvitoParser.cleanText ? AvitoParser.cleanText(dateEl.textContent) : dateEl.textContent.trim()) : '',
      seller: AvitoParser.extractDOMSeller ? AvitoParser.extractDOMSeller(card) : '',
      image: imgEl ? (imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '') : '',
    };
  }

  function findItemsInPayload(obj) {
    const paths = [
      ['props', 'pageProps', 'data', 'catalog', 'items'],
      ['props', 'pageProps', 'initialState', 'catalog', 'list', 'items'],
      ['props', 'pageProps', 'serverData', 'catalog', 'items'],
    ];
    for (const path of paths) {
      let cursor = obj;
      for (const key of path) {
        if (cursor && typeof cursor === 'object' && key in cursor) {
          cursor = cursor[key];
        } else {
          cursor = null;
          break;
        }
      }
      if (Array.isArray(cursor) && cursor.length > 0) return cursor;
    }
    return null;
  }

  function normalizeItem(raw) {
    const getField = (keys) => {
      for (const k of keys) {
        if (raw[k] != null) return String(raw[k]).trim();
        for (const v of Object.values(raw)) {
          if (v && typeof v === 'object' && !Array.isArray(v) && v[k] != null) return String(v[k]).trim();
        }
      }
      return '';
    };

    let price = '';
    if (raw.price != null) {
      price = typeof raw.price === 'object'
        ? (raw.price.text || raw.price.value || raw.price.formatted || '')
        : String(raw.price);
    }
    price = AvitoParser.cleanPrice ? AvitoParser.cleanPrice(price) : price;
    const priceNum = AvitoParser.extractNumericPrice ? AvitoParser.extractNumericPrice(raw.price || price) : null;
    const hasDelivery = AvitoParser.extractNextDataDelivery ? AvitoParser.extractNextDataDelivery(raw) : false;
    const isReserved = AvitoParser.extractNextDataReserved ? AvitoParser.extractNextDataReserved(raw) : false;

    let rawUrl = raw.url || raw.urlPath || raw.itemUrl || '';
    if (rawUrl && !rawUrl.startsWith('http')) rawUrl = `https://www.avito.ru${rawUrl}`;
    if (!rawUrl && raw.id) rawUrl = `https://www.avito.ru/items/${raw.id}`;
    const url = AvitoParser.cleanUrl ? AvitoParser.cleanUrl(rawUrl) : rawUrl;

    let image = '';
    if (raw.images && Array.isArray(raw.images) && raw.images.length > 0) {
      const img = raw.images[0];
      image = typeof img === 'string' ? img : (img.url || img.src || img['640x480'] || '');
    } else if (raw.image) {
      image = typeof raw.image === 'string' ? raw.image : (raw.image.url || raw.image.src || '');
    }

    let location = '';
    for (const k of ['location', 'geo', 'address']) {
      if (raw[k]) {
        location = typeof raw[k] === 'string' ? raw[k] : (raw[k].name || raw[k].formattedAddress || '');
        if (location) break;
      }
    }

    let seller = '';
    if (raw.seller) seller = typeof raw.seller === 'object' ? (raw.seller.name || '') : String(raw.seller);
    if (AvitoParser.cleanSeller) seller = AvitoParser.cleanSeller(seller);

    let description = '';
    const descKeys = ['description', 'snippet', 'body', 'shortDescription', 'comment', 'text', 'shortText'];
    for (const k of descKeys) {
      if (raw[k] && typeof raw[k] === 'string' && raw[k].trim()) {
        description = raw[k].trim().replace(/\s+/g, ' ');
        break;
      }
      if (raw[k] && typeof raw[k] === 'object' && !Array.isArray(raw[k])) {
        const t = raw[k].text || raw[k].value || raw[k].plainText;
        if (t) {
          description = String(t).trim().replace(/\s+/g, ' ');
          break;
        }
      }
    }
    if (!description) {
      description = getField(descKeys).replace(/\s+/g, ' ');
    }

    return {
      title: getField(['title', 'name']),
      price,
      priceNum,
      hasDelivery,
      isReserved,
      description,
      location,
      url,
      date: getField(['time', 'date', 'sortTimeStamp', 'publishDate']),
      seller,
      image,
    };
  }

  function updatePageInfo() {
    const info = panelEl.querySelector('#ap-page-info');
    if (info) info.textContent = pagesLoaded > 1 ? `Стр. 1–${pagesLoaded}` : 'Стр. 1';
  }

  function updateStats() {
    const statsEl = panelEl.querySelector('#ap-stats');
    if (statsEl && lastResult) {
      statsEl.innerHTML = `
        <span class="ap-stat">Найдено: <strong>${lastResult.items.length}</strong></span>
        <span class="ap-stat">Запрос: <strong>${esc(AvitoParser.getSearchQuery())}</strong></span>
        <span class="ap-stat">Страниц: <strong>${pagesLoaded}</strong></span>
      `;
    }
  }

  // Render
  function renderResults() {
    const statsEl = panelEl.querySelector('#ap-stats');
    const searchBar = panelEl.querySelector('#ap-search-bar');
    const filtersBar = panelEl.querySelector('#ap-filters-bar');
    const toolbar = panelEl.querySelector('#ap-toolbar');
    const fieldsBar = panelEl.querySelector('#ap-fields-bar');
    const exportRow = panelEl.querySelector('#ap-export-row');
    const footerEl = panelEl.querySelector('#ap-footer');

    if (!lastResult || lastResult.items.length === 0) {
      statsEl.innerHTML = '';
      searchBar.style.display = 'none';
      if (filtersBar) filtersBar.style.display = 'none';
      toolbar.style.display = 'none';
      fieldsBar.style.display = 'none';
      exportRow.style.display = 'none';
      panelEl.querySelector('#ap-cards').innerHTML = `
        <div class="ap-empty">
          <h3>Объявления не найдены</h3>
          <p>Проверь, что ты на странице поиска Авито<br>с результатами, и попробуй ещё раз</p>
        </div>
      `;
      footerEl.textContent = '';
      return;
    }

    updateStats();

    const btnLoadMore = panelEl.querySelector('#ap-load-more');
    if (btnLoadMore) {
      btnLoadMore.textContent = '+ След. стр.';
      btnLoadMore.disabled = false;
      btnLoadMore.classList.remove('ap-loading-pages');
    }
    const btnLoadAll = panelEl.querySelector('#ap-load-all');
    if (btnLoadAll) {
      btnLoadAll.textContent = '+ Все стр.';
      btnLoadAll.disabled = false;
      btnLoadAll.classList.remove('ap-btn-stop');
    }

    searchBar.style.display = 'flex';
    if (filtersBar) filtersBar.style.display = 'flex';
    toolbar.style.display = 'flex';
    fieldsBar.style.display = 'flex';
    exportRow.style.display = 'flex';
    syncFieldsUI();
    updatePageInfo();
    renderCards(getFilteredItems());
    updateSelectionInfo();
    updateSearchCount();

    footerEl.innerHTML = `
      Источник: <span class="ap-source-tag">${lastResult.source}</span> · ${new Date().toLocaleTimeString('ru-RU')}
    `;
  }

  function renderCards(items) {
    const cardsEl = panelEl.querySelector('#ap-cards');

    if (items.length === 0) {
      cardsEl.innerHTML = `
        <div class="ap-empty">
          <h3>Ничего не найдено</h3>
          <p>По заданным фильтрам и поиску объявлений нет.<br>Попробуй изменить фильтры или сбросить их.</p>
        </div>
      `;
      return;
    }

    cardsEl.innerHTML = items.map((item) => {
      const hasImage = item.image && item.image.startsWith('http');
      const isSelected = selectedIndices.has(item.itemNum);

      let sellerMeta = '';
      if (item.seller) {
        const ratingHtml = item.sellerRating
          ? ` <span class="ap-card-rating" title="${esc(item.sellerReviews || 'Рейтинг')}">★ ${esc(item.sellerRating)}</span>`
          : '';
        sellerMeta = `<span class="ap-card-meta-item">${esc(item.seller)}${ratingHtml}</span>`;
      }

      const meta = [
        item.isReserved ? `<span class="ap-badge-reserved" title="Товар зарезервирован">Зарезервирован</span>` : '',
        item.hasDelivery ? `<span class="ap-badge-delivery" title="${esc(item.deliveryText || 'Доступна Авито Доставка')}">🚚 ${esc(item.deliveryText || 'Доставка')}</span>` : '',
        item.isPromoted ? `<span class="ap-badge-promoted" title="Продвигаемое объявление">Продвинуто ⬆</span>` : '',
        item.location ? `<span class="ap-card-meta-item">${esc(item.location)}</span>` : '',
        item.date ? `<span class="ap-card-meta-item">${esc(item.date)}</span>` : '',
        sellerMeta,
      ].filter(Boolean).join(' · ');

      const priceHtml = `
        <div class="ap-card-price-row">
          <span class="ap-card-price">${esc(item.price || 'Цена не указана')}</span>
          ${item.oldPrice ? `<span class="ap-card-old-price" title="Старая цена">${esc(item.oldPrice)}</span>` : ''}
          ${item.discount ? `<span class="ap-card-discount" title="Скидка">${esc(item.discount)}</span>` : ''}
        </div>
      `;

      return `
        <div class="ap-card ${isSelected ? 'ap-card-selected' : ''}" data-card-num="${item.itemNum}">
          <div class="ap-card-controls">
            <input type="checkbox" class="ap-card-check" ${isSelected ? 'checked' : ''} tabindex="0" aria-label="Выбрать объявление ${item.itemNum}">
            <span class="ap-card-num">№${item.itemNum}</span>
          </div>
          ${hasImage
            ? `<div class="ap-card-thumb"><img src="${esc(item.image)}" alt="" loading="lazy"></div>`
            : ''}
          <div class="ap-card-body">
            <div class="ap-card-title">${item.url
              ? `<a href="${esc(item.url)}" target="_blank" rel="noopener">${esc(item.title || 'Без названия')}</a>`
              : esc(item.title || 'Без названия')}</div>
            ${priceHtml}
            ${item.description ? `<div class="ap-card-desc">${esc(item.description)}</div>` : ''}
            ${meta ? `<div class="ap-card-meta">${meta}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');

    // Bind checkbox clicks
    cardsEl.querySelectorAll('.ap-card-check').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const card = e.target.closest('.ap-card');
        const num = parseInt(card.dataset.cardNum, 10);
        toggleSelection(num);
      });
    });

    // Click on card row toggles checkbox
    cardsEl.querySelectorAll('.ap-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('a') || e.target.closest('.ap-card-check')) return;
        const num = parseInt(card.dataset.cardNum, 10);
        toggleSelection(num);
      });
    });
  }

  function renderError(err) {
    const searchBar = panelEl.querySelector('#ap-search-bar');
    const filtersBar = panelEl.querySelector('#ap-filters-bar');
    const toolbar = panelEl.querySelector('#ap-toolbar');
    const fieldsBar = panelEl.querySelector('#ap-fields-bar');
    const exportRow = panelEl.querySelector('#ap-export-row');
    if (searchBar) searchBar.style.display = 'none';
    if (filtersBar) filtersBar.style.display = 'none';
    if (toolbar) toolbar.style.display = 'none';
    if (fieldsBar) fieldsBar.style.display = 'none';
    if (exportRow) exportRow.style.display = 'none';

    panelEl.querySelector('#ap-cards').innerHTML = `
      <div class="ap-error-state">
        <h3>Не удалось распарсить</h3>
        <p>${esc(err.message)}<br>Попробуй обновить страницу</p>
      </div>
    `;
  }

  // Export — selected items, or all filtered items if none selected
  function handleExport(e) {
    const btn = e.target.closest('.ap-btn');
    if (!btn || !displayItems || displayItems.length === 0) return;

    const visible = getFilteredItems();
    if (visible.length === 0) return;

    const selectedVisible = visible.filter((item) => selectedIndices.has(item.itemNum));
    const itemsToExport = selectedVisible.length > 0 ? selectedVisible : visible;

    const format = btn.dataset.format;
    let text = '';

    switch (format) {
      case 'md': text = AvitoParser.toMarkdown(itemsToExport, activeFields); break;
      case 'json': text = AvitoParser.toJSON(itemsToExport, activeFields); break;
      case 'tsv':
      case 'csv':
        text = AvitoParser.toTSV ? AvitoParser.toTSV(itemsToExport, activeFields) : AvitoParser.toCSV(itemsToExport, activeFields);
        break;
      default: return;
    }

    copyToClipboard(text, btn, itemsToExport.length);
  }

  async function copyToClipboard(text, btn, count) {
    try {
      await navigator.clipboard.writeText(text);
      showCopiedFeedback(btn, count);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showCopiedFeedback(btn, count);
    }
  }

  function showCopiedFeedback(btn, count) {
    const original = btn.textContent;
    btn.classList.add('ap-copied');
    btn.textContent = count > 0 ? `Скопировано (${count})` : 'Скопировано';

    setTimeout(() => {
      btn.classList.remove('ap-copied');
      btn.textContent = original;
    }, 1500);
  }

  function openPanel() {
    panelEl.classList.add('ap-open');
  }

  function closePanel() {
    panelEl.classList.remove('ap-open');
  }

  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Messages from popup / service worker
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'TRIGGER_PARSE') {
      handleParse();
      sendResponse({ ok: true });
    }
    if (msg.type === 'GET_LAST_RESULT') {
      sendResponse({
        ok: true,
        data: lastResult
          ? {
              count: lastResult.items.length,
              source: lastResult.source,
              query: AvitoParser.getSearchQuery(),
            }
          : null,
      });
    }
    return true;
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
