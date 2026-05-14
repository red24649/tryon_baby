// Vercelのタイムアウト時間を最大60秒に延長
export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const fashnApiKey = process.env.FASHN_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!fashnApiKey || !geminiApiKey) {
    return res.status(500).json({ error: '必要なAPIキー（FASHN_API_KEY または GEMINI_API_KEY）が設定されていません。Vercelの設定を確認してください。' });
  }

  const { action } = req.body;

  try {
    // 【ステップ1】生成の開始リクエスト（ジョブの登録）
    if (action === 'start') {
      const { garmentImageBase64, gender, race } = req.body;

      // 1-1. まず、GoogleのAI (Imagen) で赤ちゃんの画像を生成する
      console.log("Generating baby image...");
      const imagenUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${geminiApiKey}`;
      const babyPrompt = `A professional photograph of a cute ${race} ${gender} baby, about 6-12 months old, sitting happily in a brightly lit, neutral studio setting with a plain background. Full body shot, facing forward. High resolution.`;

      const imagenResponse = await fetch(imagenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt: babyPrompt }],
          parameters: { sampleCount: 1, aspectRatio: "1:1" }
        })
      });

      if (!imagenResponse.ok) {
        const errorText = await imagenResponse.text();
        throw new Error(`Google AIエラー (赤ちゃん生成失敗): ${errorText}`);
      }

      const imagenData = await imagenResponse.json();
      // 生成された赤ちゃんの画像データをData URI形式に変換
      const generatedBabyImage = `data:image/jpeg;base64,${imagenData.predictions[0].bytesBase64Encoded}`;
      console.log("Baby image generated successfully.");

      // 1-2. 次に、Fashn.ai に服の合成を依頼する
      console.log("Starting Fashn.ai job...");
      const fashnResponse = await fetch('https://api.fashn.ai/v1/run', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${fashnApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model_name: "tryon-max",
          inputs: {
            model_image: generatedBabyImage, // ここにAIが生成した赤ちゃんの画像を入れる
            product_image: garmentImageBase64 // ここにユーザーがアップした服の画像を入れる
          }
        })
      });

      const fashnData = await fashnResponse.json();
      
      if (!fashnResponse.ok) {
        const errorDetail = fashnData.error?.message || fashnData.message || JSON.stringify(fashnData);
        throw new Error(`Fashn APIエラー (合成開始失敗): ${errorDetail}`);
      }
      
      // ジョブIDをフロントエンドに返す
      return res.status(200).json({ jobId: fashnData.id });
    }
    
    // 【ステップ2】生成状態の確認リクエスト（ポーリング）
    else if (action === 'status') {
      const { jobId } = req.body;
      
      const response = await fetch(`https://api.fashn.ai/v1/status/${jobId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${fashnApiKey}`
        }
      });

      const data = await response.json();
      if (!response.ok) {
        const errorDetail = data.error?.message || data.message || JSON.stringify(data);
        throw new Error(`ステータス確認エラー: ${errorDetail}`);
      }

      // status: 'starting', 'processing', 'completed', 'failed'
      return res.status(200).json(data);
    }
    
    else {
      return res.status(400).json({ error: 'Invalid action' });
    }

  } catch (error) {
    console.error("API Error:", error);
    res.status(500).json({ error: error.message });
  }
}
