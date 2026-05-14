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

  try {
    // 【ステップ1】Gemini 1.5 Flashで服の画像を分析し、デザインを言語化する
    const visionUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const visionPrompt = "Analyze this image and describe the clothing or accessory in extreme detail. Focus on the colors, patterns, texture, and style. Keep it concise but highly descriptive so another AI can draw it accurately.";
    
    const visionPayload = {
      contents: [{
        role: "user",
        parts: [
          { text: visionPrompt },
          { inlineData: { mimeType: mimeType, data: imageBase64 } }
        ]
      }]
    };

    const visionResponse = await fetch(visionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(visionPayload)
    });

    if (!visionResponse.ok) {
      throw new Error(`Vision API Error: ${visionResponse.status}`);
    }

    const visionData = await visionResponse.json();
    const clothesDescription = visionData.candidates[0].content.parts[0].text;

    // 【ステップ2】一般公開されている画像生成モデル（Imagen）で最終画像を生成する
    const imagenUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${apiKey}`;
    
    // 元の指示文（赤ちゃんの特徴など）と、服のデザイン説明を合体
    const finalPrompt = `${prompt} The baby is wearing EXACTLY this: ${clothesDescription}`;

    const imagenPayload = {
      instances: [
        { prompt: finalPrompt }
      ],
      parameters: {
        sampleCount: 1
      }
    };

    const imagenResponse = await fetch(imagenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(imagenPayload)
    });

    if (!imagenResponse.ok) {
      throw new Error(`Imagen API Error: ${imagenResponse.status}`);
    }

    const imagenData = await imagenResponse.json();
    
    // Base64画像データを取得
    const generatedImageBase64 = imagenData.predictions[0].bytesBase64Encoded;

    // フロントエンドが受け取れる形に変換して返す
    res.status(200).json({
      candidates: [{
        content: {
          parts: [{
            inlineData: {
              mimeType: 'image/jpeg',
              data: generatedImageBase64
            }
          }]
        }
      }]
    });

  } catch (error) {
    console.error("生成エラー:", error);
    res.status(500).json({ error: '画像の生成に失敗しました。詳細: ' + error.message });
  }
}

// 【重要】Vercelのタイムアウト時間を最大60秒に延長する設定
export const maxDuration = 60;
