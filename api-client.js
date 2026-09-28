(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ThreeColorApi = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const PROVIDERS = {
    gemini: {
      id: 'gemini',
      label: 'Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com',
      model: 'gemini-flash-latest',
      supportsImages: true,
      imageDescription: '文字＋圖片（Gemini REST generateContent）',
    },
    deepseek: {
      id: 'deepseek',
      label: 'DeepSeek V4.1-Flash',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-flash',
      supportsImages: true,
      imageDescription: '文字＋圖片（OpenAI-compatible Chat Completions）',
    },
  };

  function getProviderConfig(provider) {
    const config = PROVIDERS[provider];
    if (!config) throw new Error(`不支援的 Provider：${provider}`);
    return { ...config };
  }

  function parseDataUrl(dataUrl, fallbackMimeType) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      throw new Error('圖片必須是 data URL。');
    }
    const match = dataUrl.match(/^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/);
    if (!match) throw new Error('圖片資料格式無法辨識。');
    return {
      mimeType: match[1] || fallbackMimeType || 'image/jpeg',
      data: match[2],
    };
  }

  function buildImageParts(image) {
    if (!image || !image.dataUrl) return null;
    const parsed = parseDataUrl(image.dataUrl, image.mimeType);
    return { ...parsed, dataUrl: image.dataUrl };
  }

  function buildProviderRequest({ provider, apiKey, model, text, image, imageDetail = 'auto' }) {
    if (!apiKey || !String(apiKey).trim()) throw new Error('請先輸入 API Key。');
    if (!text || !String(text).trim()) throw new Error('請先輸入文章或句子。');

    const config = getProviderConfig(provider);
    const selectedModel = model || config.model;
    const imageData = buildImageParts(image);

    if (provider === 'gemini') {
      const parts = [{ text: String(text) }];
      if (imageData) {
        parts.push({
          inline_data: {
            mime_type: imageData.mimeType,
            data: imageData.data,
          },
        });
      }
      return {
        method: 'POST',
        url: `${config.baseUrl}/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent`,
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': String(apiKey).trim(),
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            responseMimeType: 'application/json',
          },
        }),
      };
    }

    if (provider === 'deepseek') {
      const content = [{ type: 'text', text: String(text) }];
      if (imageData) {
        content.push({
          type: 'image_url',
          image_url: { url: imageData.dataUrl, detail: imageDetail },
        });
      }
      return {
        method: 'POST',
        url: `${config.baseUrl}/chat/completions`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${String(apiKey).trim()}`,
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [{ role: 'user', content }],
          thinking: { type: 'disabled' },
          response_format: { type: 'json_object' },
          temperature: 0.2,
        }),
      };
    }

    throw new Error(`不支援的 Provider：${provider}`);
  }

  function extractResponseText(provider, payload) {
    if (provider === 'gemini') {
      const parts = payload?.candidates?.[0]?.content?.parts || [];
      return parts.map((part) => part.text || '').join('').trim();
    }
    if (provider === 'deepseek') {
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content === 'string') return content.trim();
      if (Array.isArray(content)) {
        return content.map((part) => part.text || '').join('').trim();
      }
    }
    return '';
  }

  function cleanJsonText(text) {
    return String(text || '')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
  }

  async function analyzeWithProvider({ provider, apiKey, model, text, image, imageDetail, fetchImpl, signal }) {
    const request = buildProviderRequest({ provider, apiKey, model, text, image, imageDetail });
    const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) throw new Error('目前環境沒有 fetch。');

    let response;
    try {
      response = await doFetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal,
      });
    } catch (error) {
      throw new Error('無法連線到 AI API，請檢查網路或稍後重試。', { cause: error });
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(parseProviderError(response.status, payload, apiKey));

    const rawText = cleanJsonText(extractResponseText(provider, payload));
    if (!rawText) throw new Error('AI 回應沒有可讀內容。');
    try {
      return JSON.parse(rawText);
    } catch (error) {
      throw new Error('AI 回應不是有效 JSON，請重試或切換 Provider。', { cause: error });
    }
  }

  function parseProviderError(status, payload, apiKey) {
    const detail = payload?.error?.message || payload?.message || '';
    const safeDetail = String(detail).replaceAll(String(apiKey || ''), '[已隱藏]');
    if (status === 401 || status === 403) return `API Key 無效或沒有權限。${safeDetail ? ` ${safeDetail}` : ''}`;
    if (status === 429) return `API 額度或請求頻率已達限制。${safeDetail ? ` ${safeDetail}` : ''}`;
    if (status >= 500) return `AI 服務暫時異常（HTTP ${status}）。${safeDetail ? ` ${safeDetail}` : ''}`;
    return `AI API 請求失敗（HTTP ${status}）。${safeDetail ? ` ${safeDetail}` : ''}`;
  }

  function maskApiKey(apiKey) {
    const value = String(apiKey || '');
    if (value.length < 9) return '••••';
    return `${value.slice(0, 4)}••••${value.slice(-4)}`;
  }

  return {
    PROVIDERS,
    getProviderConfig,
    buildProviderRequest,
    analyzeWithProvider,
    extractResponseText,
    parseProviderError,
    maskApiKey,
  };
});
