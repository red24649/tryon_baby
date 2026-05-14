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
    if (action === 'start') {
      const { modelImage, garmentImageBase64 } = req.body;
      
      const response = await fetch('https://api.fashn.ai/v1/run', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model_name: "tryon-max",
          inputs: {
            model_image: modelImage,
            product_image: garmentImageBase64
          }
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        const errorDetail = data.error?.message || data.message || JSON.stringify(data);
        throw new Error(`Fashn APIエラー (${response.status}): ${errorDetail}`);
      }
      
      return res.status(200).json({ jobId: data.id });
    }
    
    else if (action === 'status') {
      const { jobId } = req.body;
      
      const response = await fetch(`https://api.fashn.ai/v1/status/${jobId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        }
      });

      const data = await response.json();
      if (!response.ok) {
        const errorDetail = data.error?.message || data.message || JSON.stringify(data);
        throw new Error(`ステータス確認エラー (${response.status}): ${errorDetail}`);
      }

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

// Vercelのタイムアウト時間を最大60秒に延長
export const maxDuration = 60;
