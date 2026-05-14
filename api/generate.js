export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.FASHN_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'FASHN_API_KEYが設定されていません。' });
  }

  const { action } = req.body;

  try {
    // 【ステップ1】生成の開始リクエスト（ジョブの登録）
    if (action === 'start') {
      const { modelImage, garmentImageBase64, category } = req.body;
      
      const response = await fetch('https://api.fashn.ai/v1/run', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model_image: modelImage, // 赤ちゃんモデルの画像URL
          garment_image: garmentImageBase64, // アップロードされた服の画像（Data URI形式）
          category: category // tops, bottoms, one-pieces など
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || '生成の開始に失敗しました');
      
      // ジョブIDをフロントエンドに返す
      return res.status(200).json({ jobId: data.id });
    }
    
    // 【ステップ2】生成状態の確認リクエスト（ポーリング）
    else if (action === 'status') {
      const { jobId } = req.body;
      
      const response = await fetch(`https://api.fashn.ai/v1/status/${jobId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });

      const data = await response.json();
      if (!response.ok) throw new Error('ステータス確認に失敗しました');

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
