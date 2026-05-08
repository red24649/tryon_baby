// サーバー側で安全にAIを呼び出すプログラム
export default async function handler(req, res) {
  // POSTリクエスト以外は弾く
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // フロントエンドから送られてきた画像データを受け取る
  const { imageBase64, mimeType } = req.body;
  
  // Vercelの環境変数からAPIキーを読み込む（コードには直接書きません！）
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'サーバーのAPIキーが設定されていません。' });
  }

  const prompt = "A cute, happy Japanese baby wearing the exact clothes shown in the provided image. High quality, photorealistic portrait of a baby, isolated on a pure white background, no background elements.";

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
