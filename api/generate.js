// Vercelのタイムアウト時間を最大60秒に延長
export const maxDuration = 60;

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4.5mb',
    },
  },
};

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
      const { garmentImageBase64, gender, race, sleeveLength, pantsLength, itemType, pose } = req.body;

      let raceDescription = race;
      if (race === 'half-Caucasian, half-Japanese') {
        raceDescription = "Eurasian mixed-race (Caucasian-Japanese blend), leaning slightly more towards Caucasian facial features with soft brown hair";
      } else if (race === 'Japanese') {
        raceDescription = "fully Japanese";
      } else if (race === 'Caucasian') {
        raceDescription = "fully Caucasian";
      }

      let outfitDescription = "";
      let armsDescription = "bare forearms clearly visible";
      let legsDescription = "bare legs clearly visible";
      let chestDescription = "";
      let postureDescription = "sitting happily on the floor, perfectly facing forward, upright posture";
      let lightingDescription = "soft and natural lighting";

      if (pose === 'sitting_side') {
        postureDescription = "sitting happily on the floor, in a relaxed and natural posture, with the body angled slightly diagonally to the camera (3/4 profile view)";
      } else if (pose === 'standing') {
        postureDescription = "standing up, holding onto a small soft white baby sofa or padded prop for support, looking at the camera";
      }

      if (itemType === 'bib') {
        outfitDescription = "a simple, perfectly plain white short-sleeve bodysuit";
        chestDescription = "a perfectly smooth, flat white fabric over the chest without any wrinkles";
        postureDescription = "sitting happily on the floor, perfectly facing forward, upright posture";
      } else {
        chestDescription = "natural fabric texture with soft, realistic folds, creases, and gentle wrinkles that give the clothing a realistic 3D volume";
        lightingDescription = "soft directional lighting highlighting the natural 3D shape and wrinkles of the fabric";

        if (sleeveLength === 'sleeveless') {
          outfitDescription = "a plain white sleeveless bodysuit, slightly loose to show natural folds";
          armsDescription = "completely bare arms and shoulders clearly visible";
        } else if (sleeveLength === 'short sleeves') {
          outfitDescription = "a plain white short-sleeve bodysuit, slightly loose to show natural folds";
          armsDescription = "bare forearms clearly visible";
        } else if (sleeveLength === 'long sleeves') {
          outfitDescription = "a plain white long-sleeve bodysuit, slightly loose to show natural folds";
          armsDescription = "arms completely covered by sleeves with natural fabric folds";
        }

        if (pantsLength === 'no pants') {
          legsDescription = "completely bare legs";
        } else if (pantsLength === 'short pants') {
          legsDescription = "bare lower legs";
        } else if (pantsLength === 'long pants') {
          legsDescription = "legs completely covered by pants showing natural fabric folds";
        }
      }

      console.log("Generating baby image...");
      const imagenUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${geminiApiKey}`;
      
      const babyPrompt = `A professional studio photograph of a cute ${raceDescription} ${gender} baby, about 6-12 months old, ${postureDescription}. The baby is on a soft, plush, textured cream-colored rug or blanket. Wide angle shot, zoomed out. The ENTIRE head, face, and body MUST be completely visible perfectly inside the frame. The baby MUST be wearing ${outfitDescription} with ${chestDescription}. The baby has ${armsDescription} and ${legsDescription}. Bareheaded, strictly NO hats or hair accessories. The lighting is ${lightingDescription}. The background is a seamless, simple, neutral color filling the entire frame naturally without any borders, frames, or margins. High resolution, highly detailed, realistic.`;

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
        throw new Error(`Google AIエラー (モデル生成失敗): ${errorText}`);
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
          // クレジット消費を抑えるため標準モデルに変更（1回1クレジット）
          model_name: "tryon",
          
          // 最高精度モデル（1回2クレジット）に戻す場合はこちらを有効化してください
          // model_name: "tryon-max",
          
          inputs: {
            model_image: generatedBabyImage,
            product_image: garmentImageBase64
          }
        })
      });

      if (!fashnResponse.ok) {
        const errorDetail = await fashnResponse.text();
        throw new Error(`Fashn APIエラー (着画生成開始失敗): ${errorDetail}`);
      }
      const fashnData = await fashnResponse.json();
      
      return res.status(200).json({ jobId: fashnData.id });
    }
    
    else if (action === 'status') {
      const { jobId } = req.body;
      const response = await fetch(`https://api.fashn.ai/v1/status/${jobId}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${fashnApiKey}` }
      });

      if (!response.ok) {
        const errorDetail = await response.text();
        throw new Error(`ステータス確認エラー: ${errorDetail}`);
      }
      const data = await response.json();
      return res.status(200).json(data);
    }
    
    else if (action === 'delete') {
      const { jobId } = req.body;
      console.log(`Deleting job from Fashn.ai: ${jobId}`);
      
      const response = await fetch(`https://api.fashn.ai/v1/job/${jobId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${fashnApiKey}` }
      });

      if (!response.ok) {
        const errorDetail = await response.text();
        console.error(`Fashn API 削除エラー: ${errorDetail}`);
        return res.status(500).json({ error: '削除に失敗しました' });
      }

      return res.status(200).json({ message: 'Deleted successfully' });
    }

    else {
      return res.status(400).json({ error: 'Invalid action' });
    }

  } catch (error) {
    console.error("API Error:", error);
    res.status(500).json({ error: error.message });
  }
}
