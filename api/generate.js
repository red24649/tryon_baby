// サーバー側で安全にAIを呼び出すプログラム
export default async function handler(req, res) {
  // POSTリクエスト以外は弾く
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // フロントエンド（画面）から送られてきた指示と画像を受け取る
  const { prompt, imageBase64, mimeType } = req.body;
  
  // 環境変数からAPIキーを読み込む
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'サーバーのAPIキーが設定されていません。' });
  }

  const payload = {
    contents: [{
      role: "user",
      parts: [
        { text: prompt },
        { inlineData: { mimeType: mimeType, data: imageBase64 } }
      ]
    }],
    generationConfig: {
      responseModalities: ["IMAGE"]
    }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }
    
    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    console.error("生成エラー:", error);
    res.status(500).json({ error: '画像の生成に失敗しました。' });
  }
}

// 【重要】Vercelのタイムアウト時間を最大60秒に延長する設定
export const maxDuration = 60;
