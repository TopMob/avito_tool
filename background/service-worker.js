/**
 * Service Worker — фоновая координация расширения.
 */

// Сохраняем результаты парсинга
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PARSE_RESULT') {
    const data = msg.data;

    // Сохраняем последний результат
    chrome.storage.local.set({ lastParse: data });

    // Обновляем бейдж на иконке
    if (data.count > 0) {
      chrome.action.setBadgeText({ text: String(data.count), tabId: sender.tab?.id });
      chrome.action.setBadgeBackgroundColor({ color: '#6c5ce7', tabId: sender.tab?.id });
    }

    sendResponse({ ok: true });
  }

  return true;
});

// Очищаем бейдж при навигации
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    chrome.action.setBadgeText({ text: '', tabId });
  }
});
