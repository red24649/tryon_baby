// Vercelのタイムアウト時間を最大60秒に延長
export const maxDuration = 60;

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4.5mb',
    },
  },
};

// フィット感（着用感）の指定を、FASHNの prompt パラメータ用の英語指示に変換する。
// FASHN tryon-max には専用のフィット調整パラメータが無いため、prompt で誘導する。
function fitStyleToPrompt(fitStyle) {
  if (fitStyle === 'loose') {
    // ゆったり：ごく控えめなゆとり。効きすぎ（オーバーサイズ化）を避け、
    // おすわり系で自然に見える程度の、ほんの少しリラックスした着用感に留める。
    return "wear the garment with a slightly relaxed, comfortable fit with just a little bit of extra room, not tight or clinging to the body, but still a normal natural fit ? only gently loose, NOT oversized, NOT baggy, NOT several sizes too big";
  } else if (fitStyle === 'tight') {
    // じゃすと：体のラインに沿ってぴったり
    return "wear the clothing with a snug, fitted, close-to-the-body fit";
  }
  // 標準：特に指示しない（FASHNのデフォルト挙動）
  return "";
}

// FASHN.aiのtry-onジョブを開始する共通関数
// modelImageBase64: ベースになるモデル画像（ベビー生成画像 or 前段の合成結果）
// garmentImageBase64: 重ねて着せたいアイテム画像
// fitStyle: 着用感（'loose'＝ゆったり / 'tight'＝じゃすと / それ以外＝標準）
async function startFashnJob(fashnApiKey, modelImageBase64, garmentImageBase64, fitStyle) {
  // =================================================================
  // ★ ここでFashn.aiのモデル（クレジット消費）を切り替えられます
  // =================================================================
  // "tryon-max" : 最高精度モデル（1回 2クレジット）※推奨
  // "tryon-v1.6": 標準モデル（1回 1クレジット）
  const selectedModel = "tryon-max";

  const fashnInputs = {
    model_image: modelImageBase64,
    // FASHN APIでは出力形式・Base64返却の指定は inputs の中に入れる必要がある。
    // 高画質・無劣化で出力するため PNG を指定（保存ファイル拡張子も .png に合わせる）。
    output_format: "png",
    // 公開CDN URLではなくBase64のdata URIで直接返却させる。
    // → 別ドメインCDNへのfetchで起きるCORSエラーを回避でき、
    //   サーバー側の画像保持期間短縮・履歴に画像を残さない利点もある。
    return_base64: true
  };

  // フィット感の指示があれば prompt に渡す（空文字＝標準はFASHNデフォルト）
  const fitPrompt = fitStyleToPrompt(fitStyle);
  if (fitPrompt) {
    fashnInputs.prompt = fitPrompt;
  }

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
      inputs: fashnInputs
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
      const { garmentImageBase64, gender, race, sleeveLength, pantsLength, itemType, pose, fitStyle } = req.body;

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
      // おすわり（正面）：体はほぼ正面だが、上半身を少し斜めに向け、背中を軽くリラックスさせた自然な表現。
      const sittingFrontPosture = "sitting happily on the floor in a relaxed, natural, candid baby posture. The body is turned very slightly to one side (a gentle 3/4 angle rather than squared perfectly frontal to the camera), with the upper body and shoulders relaxed and the back softly and naturally rounded in a comfortable baby slouch (NOT a stiff, bolt-upright, perfectly straight spine). The head is slightly tilted and the face is turned just a little to one side (not perfectly frontal), and the gaze looks slightly off to the side or into the near distance rather than staring straight into the camera lens, with a relaxed natural happy expression. Soft, loose, slightly asymmetric arms and legs. Absolutely NOT a stiff, rigid, perfectly symmetric, straight-backed, straight-into-the-lens pose";
      let postureDescription = sittingFrontPosture;
      let lightingDescription = "soft and natural lighting";
      // シーン（寝具・カメラアングル・全体構図）の記述。ポーズによって切り替える。
      // 通常（おすわり・つかまり立ち）は床＋クリーム色のラグを俯瞰しない構図、
      // 'lying'（ねんね）のときだけ、真上からの俯瞰＋白いシーツに切り替える。
      let sceneDescription = "The baby is on a soft, plush, textured cream-colored rug or blanket. Wide angle shot, zoomed out.";

      // 改善：つかまり立ちのカメラアングルを水平（アイレベル）に指定
      if (pose === 'sitting_side') {
        postureDescription = "sitting happily on the floor, in a relaxed and natural posture, with the body angled slightly diagonally to the camera (3/4 profile view)";
      } else if (pose === 'standing') {
        postureDescription = "standing up on its own on a soft fluffy rug in a natural, candid, relaxed way, as if caught in a spontaneous happy moment (like just starting to toddle or shift weight). The body is turned very slightly to one side (a gentle 3/4 angle, NOT a stiff dead-straight frontal 'attention' pose), the weight resting a little more on one leg with one foot placed slightly forward or turned. Both arms are loose and relaxed in clearly different, asymmetric positions (for example one arm swinging slightly out or up and the other lower by the side), not identical and not hanging stiffly. The head is slightly tilted and the face is turned a little to one side (not perfectly frontal), with the gaze looking slightly off to the side or into the near distance rather than staring directly into the camera lens, wearing a happy natural expression. Balancing freely by itself, NOT holding onto anything. There is NO sofa, NO cushion, NO pillow, NO rolled-up blanket, NO stool, NO supporting hand and NO prop or object of any kind in the scene. Shot at the baby's eye level, horizontal camera angle, strictly NOT looking down from above. Absolutely NOT a stiff, rigid, symmetric, or standing-at-attention pose";
        // つかまり立ちの足元にも、他ポーズと同じ柔らかいラグを敷き、床が硬く見えないようにする
        sceneDescription = "The baby is on a soft, thick, plush cream-colored rug or fluffy blanket that spreads out and fills the floor of the frame, so the ground looks soft and cozy, not a hard floor. Wide angle shot, zoomed out.";
      } else if (pose === 'lying') {
        // ねんね：仰向けで手足を下げた落ち着いた自然な姿を、真上から撮影する俯瞰（フラットレイ）構図。
        // 左右対称の硬さは避けつつ、手足を上げすぎて暴れた印象にならないよう「下げる・ほぼ伸ばす」を明示する。
        postureDescription = "lying calmly and happily on its back in a candid, relaxed moment. Both legs are mostly extended and lowered down, resting low and close to the surface, only very slightly and softly bent (NOT raised, NOT kicking up, NOT knees pulled up high). Both arms are lowered down and rest near the sides of the body, only gently bent (NOT raised up, NOT reaching overhead). The head is gently tilted a little to one side rather than perfectly straight, and the pose has subtle natural left-right asymmetry (the two legs and the two arms at slightly different angles), but overall calm, settled and gently relaxed. Absolutely NOT a stiff mirror-symmetric pose, and absolutely NOT an over-active pose with limbs thrown up in the air";
        sceneDescription = "The baby is lying on an extremely soft, thick, deep, fluffy cushioned surface, like a plush cloud-like duvet, thick fluffy blanket or deep soft mattress, so soft that the baby's body gently sinks into it and looks completely comfortable and cozy. The soft bedding is very large and completely fills the entire frame from edge to edge in a warm cream or off-white tone, with absolutely NO hard floor, NO edges of a small rug, and NO surrounding surface visible. Flat lay photo shot directly from straight above (top-down overhead bird's-eye view), camera pointing straight down at the baby, the whole body laid out flat in the frame. Wide angle shot, zoomed out.";
      }

      // itemType が 'clothes' 以外（'bib'＝雑貨 or 'hat'＝帽子）の場合は、
      // 従来の「雑貨のみ」時と同じプレーン肌着ベースを使う。
      // ウェアが別途あるコーディネートでは、ウェアが必ず1点目になるためこの分岐には入らない。
      if (itemType !== 'clothes') {
        outfitDescription = "a simple, perfectly plain white short-sleeve bodysuit";
        chestDescription = "a perfectly smooth, flat white fabric over the chest without any wrinkles";
        // 雑貨・帽子のみの場合も、選ばれたポーズ（上で設定済みの postureDescription）を尊重する。
        // ポーズ未指定（おすわり正面）の場合は上のデフォルト sittingFrontPosture がそのまま使われる。
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
      const jobId = await startFashnJob(fashnApiKey, generatedBabyImage, garmentImageBase64, fitStyle);

      return res.status(200).json({ jobId });
    }

    else if (action === 'nextTryon') {
      // コーディネートの2点目以降（雑貨・帽子など）を、直前の合成結果の上に重ねて着せる工程。
      const { modelImageBase64, garmentImageBase64, fitStyle } = req.body;

      if (!modelImageBase64 || !garmentImageBase64) {
        return res.status(400).json({ error: 'modelImageBase64 と garmentImageBase64 が必要です。' });
      }

      console.log("Starting Fashn.ai job (next item)...");
      const jobId = await startFashnJob(fashnApiKey, modelImageBase64, garmentImageBase64, fitStyle);

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

      // 削除は生成完了後の「後片付け」。対象ジョブが既に無い場合（404）や
      // 期限切れ（410）は、成果物（生成画像）には影響しないため正常扱いにする。
      if (!response.ok) {
        const errorDetail = await response.text();
        if (response.status === 404 || response.status === 410) {
          console.log(`Fashn API: ジョブは既に存在しません (${response.status})。後片付けをスキップします。`);
          return res.status(200).json({ message: 'Already deleted or not found' });
        }
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
