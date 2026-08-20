// Vercelのタイムアウト時間を最大60秒に延長
export const maxDuration = 60;

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4.5mb',
    },
  },
};

// FASHN.aiのtry-onジョブを開始する共通関数
// modelImageBase64: ベースになるモデル画像（ベビー生成画像 or 前段の合成結果）
// garmentImageBase64: 重ねて着せたいアイテム画像
async function startFashnJob(fashnApiKey, modelImageBase64, garmentImageBase64) {
  // =================================================================
  // ★ ここでFashn.aiのモデル（クレジット消費）を切り替えられます
  // =================================================================
  // "tryon-max" : 最高精度モデル（1回 2クレジット）※推奨
  // "tryon-v1.6": 標準モデル（1回 1クレジット）
  const selectedModel = "tryon-max";

  const fashnInputs = {
    model_image: modelImageBase64
  };

  if (selectedModel === "tryon-max") {
    fashnInputs.product_image = garmentImageBase64; // maxモデル用の名前
  } else {
    fashnInputs.garment_image = garmentImageBase64; // v1.6モデル用の名前
  }

  const fashnResponse = await fetch('https://api.fashn.ai/v1/run', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${fashnApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model_name: selectedModel,
      inputs: fashnInputs,
      // セキュリティ強化：公開CDN URLではなくBase64で直接返却させ、
      // サーバー側の画像保持期間を短縮し、リクエスト履歴にも画像を残さない
      return_base64: true
    })
  });

  if (!fashnResponse.ok) {
    const errorDetail = await fashnResponse.text();
    throw new Error(`Fashn APIエラー (着画生成開始失敗): ${errorDetail}`);
  }
  const fashnData = await fashnResponse.json();
  return fashnData.id;
}

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
      // コーディネートの「1点目（土台）」を着せる工程。
      // itemType === 'clothes' の場合のみ、実際の丈感に合わせたベビー画像を生成する。
      // 'bib'（雑貨）や 'hat'（帽子）が1点目の場合は、従来通りプレーンな肌着姿で生成し、
      // FASHN側でそのアイテムを重ねて着せる。
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
      // シーン（寝具・カメラアングル・全体構図）の記述。ポーズによって切り替える。
      // 通常（おすわり・つかまり立ち）は床＋クリーム色のラグを俯瞰しない構図、
      // 'lying'（ねんね）のときだけ、真上からの俯瞰＋白いシーツに切り替える。
      let sceneDescription = "The baby is on a soft, plush, textured cream-colored rug or blanket. Wide angle shot, zoomed out.";

      // 改善：つかまり立ちのカメラアングルを水平（アイレベル）に指定
      if (pose === 'sitting_side') {
        postureDescription = "sitting happily on the floor, in a relaxed and natural posture, with the body angled slightly diagonally to the camera (3/4 profile view)";
      } else if (pose === 'standing') {
        postureDescription = "standing up, holding onto a small soft white baby sofa or padded prop for support, looking at the camera. Shot at the baby's eye level, horizontal camera angle, perfectly straight-on view, strictly NOT looking down from above";
      } else if (pose === 'lying') {
        // ねんね：仰向けに寝転がったベビーを真上から撮影する俯瞰（フラットレイ）構図
        postureDescription = "lying down on its back, relaxed and happy, looking straight up towards the camera, arms and legs resting naturally";
        sceneDescription = "The baby is lying on a soft, smooth, clean white bed sheet or blanket. Flat lay photo shot directly from straight above (top-down overhead bird's-eye view), camera pointing straight down at the baby, the whole body laid out flat in the frame. Wide angle shot, zoomed out.";
      }

      // itemType が 'clothes' 以外（'bib'＝雑貨 or 'hat'＝帽子）の場合は、
      // 従来の「雑貨のみ」時と同じプレーン肌着ベースを使う。
      // ウェアが別途あるコーディネートでは、ウェアが必ず1点目になるためこの分岐には入らない。
      if (itemType !== 'clothes') {
        outfitDescription = "a simple, perfectly plain white short-sleeve bodysuit";
        chestDescription = "a perfectly smooth, flat white fabric over the chest without any wrinkles";
        // 雑貨・帽子のみの場合はおすわり正面が基本だが、ねんねが選ばれていればその構図を尊重する
        if (pose !== 'lying') {
          postureDescription = "sitting happily on the floor, perfectly facing forward, upright posture";
        }
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
      // Imagen4系(imagen-4.0-generate-001)は2026年8月17日付けでシャットダウン済みのため、
      // Gemini画像生成モデル(Nano Banana系)の generateContent エンドポイントに切り替え
      const imagenUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent?key=${geminiApiKey}`;

      const babyPrompt = `A professional studio photograph of a cute ${raceDescription} ${gender} baby, about 6-12 months old, ${postureDescription}. ${sceneDescription} The ENTIRE head, face, and body MUST be completely visible perfectly inside the frame. The baby MUST be wearing ${outfitDescription} with ${chestDescription}. The baby has ${armsDescription} and ${legsDescription}. Bareheaded, strictly NO hats or hair accessories. The lighting is ${lightingDescription}. The background is a seamless, simple, neutral color filling the entire frame naturally without any borders, frames, or margins. High resolution, highly detailed, realistic.`;

      const imagenResponse = await fetch(imagenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: babyPrompt }] }],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
            imageConfig: { aspectRatio: "1:1" }
          }
        })
      });

      if (!imagenResponse.ok) {
        const errorText = await imagenResponse.text();
        throw new Error(`Google AIエラー (モデル生成失敗): ${errorText}`);
      }

      const imagenData = await imagenResponse.json();
      const imagePart = imagenData?.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      if (!imagePart) {
        throw new Error(`Google AIエラー (画像データが返されませんでした): ${JSON.stringify(imagenData)}`);
      }
      const generatedMimeType = imagePart.inlineData.mimeType || 'image/png';
      const generatedBabyImage = `data:${generatedMimeType};base64,${imagePart.inlineData.data}`;
      console.log("Baby image generated successfully.");

      console.log("Starting Fashn.ai job (item 1)...");
      const jobId = await startFashnJob(fashnApiKey, generatedBabyImage, garmentImageBase64);

      return res.status(200).json({ jobId });
    }

    else if (action === 'nextTryon') {
      // コーディネートの2点目以降（雑貨・帽子など）を、直前の合成結果の上に重ねて着せる工程。
      const { modelImageBase64, garmentImageBase64 } = req.body;

      if (!modelImageBase64 || !garmentImageBase64) {
        return res.status(400).json({ error: 'modelImageBase64 と garmentImageBase64 が必要です。' });
      }

      console.log("Starting Fashn.ai job (next item)...");
      const jobId = await startFashnJob(fashnApiKey, modelImageBase64, garmentImageBase64);

      return res.status(200).json({ jobId });
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
