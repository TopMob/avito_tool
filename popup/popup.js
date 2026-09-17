document.addEventListener('DOMContentLoaded', async () => {
  const statusDot  = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const btnParse   = document.getElementById('btn-parse');
  const lastParse  = document.getElementById('last-parse');
  const lastInfo   = document.getElementById('last-info');
  const formatSel  = document.getElementById('default-format');
  // Clear any leftover darkMode key from storage
  chrome.storage.local.remove(['darkMode']).catch(() => {});

  const stored = await chrome.storage.local.get(['defaultFormat', 'lastParse']);
  if (stored.defaultFormat) formatSel.value = stored.defaultFormat;

  if (stored.lastParse) {
    const lp = stored.lastParse;
    lastParse.style.display = 'block';
    lastInfo.innerHTML = `
      <strong>${lp.count}</strong> объявлений<br>
      ${lp.query ? `Запрос: ${esc(lp.query)}<br>` : ''}
      ${lp.parsedAt ? new Date(lp.parsedAt).toLocaleString('ru-RU') : ''}
    `;
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab && tab.url && /avito\.ru/i.test(tab.url)) {
      statusDot.classList.add('active');
      statusText.textContent = 'На странице Авито';
      btnParse.disabled = false;
    } else {
      statusDot.classList.add('inactive');
      statusText.textContent = 'Открой страницу Авито';
      btnParse.disabled = true;
    }
  } catch {
    statusDot.classList.add('inactive');
    statusText.textContent = 'Не удалось проверить вкладку';
  }

  btnParse.addEventListener('click', async () => {
    btnParse.disabled = true;
    btnParse.textContent = 'Парсинг…';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab.id, { type: 'TRIGGER_PARSE' });

      btnParse.textContent = 'Готово';
      setTimeout(() => {
        btnParse.textContent = 'Собрать объявления';
        btnParse.disabled = false;
      }, 1200);
    } catch {
      btnParse.textContent = 'Ошибка';
      setTimeout(() => {
        btnParse.textContent = 'Собрать объявления';
        btnParse.disabled = false;
      }, 1500);
    }
  });

  formatSel.addEventListener('change', () => {
    chrome.storage.local.set({ defaultFormat: formatSel.value });
  });

  function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
});
