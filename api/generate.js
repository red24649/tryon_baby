// Vercelのタイムアウト時間を最大60秒に延長
export const maxDuration = 60;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const fashnApiKey = process.env.FASHN_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!fashnApiKey || !geminiApiKey) {
    return res.status(500).json({ error: '必要なAPIキー（FASHN_API_KEY または GEMINI_API_KEY）が設定されていません。' });
  }

  const { action } = req.body;

  try {
    if (action === 'start') {
      const { garmentImageBase64, gender, race, sleeveLength, pantsLength } = req.body;

      // ユーザーの選択に合わせて、赤ちゃんの着るベース服と露出度を決定
      let outfitDescription = "a simple, plain white tight-fitting short-sleeve bodysuit";
      let legsDescription = "bare legs and bare arms clearly visible";

      if (sleeveLength === 'sleeveless') outfitDescription = "a simple, plain white tight-fitting sleeveless bodysuit";
      else if (sleeveLength === 'short sleeves') outfitDescription = "a simple, plain white tight-fitting short-sleeve bodysuit";
      else if (sleeveLength === 'long sleeves') outfitDescription = "a simple, plain white tight-fitting long-sleeve bodysuit";

      if (pantsLength === 'no pants') legsDescription = "completely bare legs";
      else if (pantsLength === 'short pants') legsDescription = "bare lower legs";
      else if (pantsLength === 'long pants') legsDescription = "legs covered by long pants";

      console.log("Generating baby image...");
      const imagenUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${geminiApiKey}`;
      
      // 動的に変化するプロンプト
      const babyPrompt = `A professional studio photograph of a cute ${race} ${gender} baby, about 6-12 months old, sitting happily on the floor. Full body shot, facing forward. The baby MUST be wearing ${outfitDescription}, with ${legsDescription}. Bareheaded, strictly NO hats or hair accessories. The lighting is soft and natural, creating gentle shadows. The background is a simple, neutral color. High resolution, highly detailed, realistic.`;

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
      const generatedBabyImage = `data:image/jpeg;base64,${imagenData.predictions[0].bytesBase64Encoded}`;
      console.log("Baby image generated successfully.");

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
            model_image: generatedBabyImage,
            product_image: garmentImageBase64
          }
        })
      });

      const fashnData = await fashnResponse.json();
      
      if (!fashnResponse.ok) {
        const errorDetail = fashnData.error?.message || fashnData.message || JSON.stringify(fashnData);
        throw new Error(`Fashn APIエラー (合成開始失敗): ${errorDetail}`);
      }
      
      return res.status(200).json({ jobId: fashnData.id });
    }
    
    else if (action === 'status') {
      const { jobId } = req.body;
      const response = await fetch(`https://api.fashn.ai/v1/status/${jobId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${fashnApiKey}` }
      });

      const data = await response.json();
      if (!response.ok) {
        const errorDetail = data.error?.message || data.message || JSON.stringify(data);
        throw new Error(`ステータス確認エラー: ${errorDetail}`);
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
