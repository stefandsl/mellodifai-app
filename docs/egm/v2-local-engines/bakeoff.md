# Bake-off: local engines in Italian (step 0, design section 8)

Date: 2026-11-01. Machine: Windows 11, RTX 3070 8 GB, driver 610.88 (CUDA 13.3), 128 GB RAM.
Runtime: ComfyUI 0.43.0 portable (Python 3.13.14, torch 2.14.1+cu130), driven only through its HTTP API
(`POST /prompt`, poll `/history/{id}`, fetch `/view`), one job at a time. kie was not called: its baseline is the
existing kie takes. Owner listening is still **pending**.

## 1. Verdict

| Engine                                                        | Median fidelity on kie's packs (kie 0.927) | Within 0.10?                          | Chosen take truncated?                                                                                 | Consecutive jobs                       | Verdict (before listening)            |
| ------------------------------------------------------------- | ------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------- | ------------------------------------- |
| YuE2 INT8, `max_duration` 330 (design default)                | 0.859 (-0.068)                             | yes                                   | **yes, 2 of 3 packs** (a, b hit the 330 s ceiling; b and c logged "semantic reached its token budget") | OK (6 back-to-back + 2 queued at once) | **FAIL** as configured                |
| YuE2 INT8, `max_duration` 420 (diagnostic, not in the design) | 0.820 (-0.107)                             | no, by 0.007 (0.851 over all 3 packs) | no: every take ended by itself (235-369 s, no budget warning)                                          | OK                                     | borderline: fails the margin by 0.007 |
| ACE-Step 1.5 2B turbo (8 steps)                               | 0.710 (-0.217)                             | **no**                                | 1 of 3 chosen takes ends abruptly                                                                      | OK                                     | **FAIL**                              |
| ACE-Step 1.5 2B SFT (30 steps, cfg 7)                         | 0.878 (-0.049)                             | yes                                   | **yes: all 6 takes stop at full volume at the fixed length** (end drop -6 to +1 dB)                    | OK                                     | **FAIL** on endings; fidelity passes  |

How to read it:
- "Fidelity" is `score_takes.py`: the share of the pack's sung lyric tokens that Groq Whisper hears, in order.
  The design's rule compares medians "on the same prompts", so the rule uses packs a and c, the two that have kie takes.
  The all-packs medians are in section 4.
- Truncation: for YuE2 a take is truncated if it ends within 5 s of `max_duration` or the log reports the token
  budget (design 5.4). ACE-Step always renders exactly the requested length and has no "ending" of its own, so a
  cut is visible only as an abrupt end. I used `score_takes.py`'s own rule (the last 1.5 s are not at least 12 dB
  quieter than the body) as the truncation stand-in for ACE.
- YuE2 is the closest engine: its fidelity passes, and the fix for its truncation is one number (see section 5).
  ACE-SFT reaches kie-level words on its good takes (0.93 on pack a), but it varies a lot between seeds (0.28 to 0.93),
  and every take ends mid-music because the length is fixed. ACE turbo loses too many words.
- The same seed does not repeat exactly: YuE2 at 330 vs 420 with identical seeds gave takes that differ by up to
  0.06 in fidelity and about 1 s in length before either reached the ceiling. Read differences under about 0.05 as noise.

## 2. Install (step 0)

All on E:. No files were left on C: (one partial YuE2 download that started in the wrong folder was moved to E:
after 54 MB). Caches and temp for the server were pointed at `E:\mellodifai\comfy-data\{temp,cache}`.

| File                                                                      | Bytes         | SHA-256 (verified locally, matches the source)                                             | Source                                                                              | Installed at                                                                                                                      |
| ------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `ComfyUI_windows_portable_nvidia.7z` (v0.43.0, cu130)                     | 2,039,673,203 | `4928f88e6a8407c4574d4f7d92cfeba020d782edba4a076b7d107ecc98955e50` (GitHub release digest) | github.com/Comfy-Org/ComfyUI/releases/download/v0.43.0/                             | archive kept in `E:\mellodifai\downloads\`; extracted (4,487,647,194 B, 62,234 files) to `E:\mellodifai\ComfyUI_windows_portable` |
| `yue2_3b_int8_convrot.safetensors`                                        | 3,960,938,800 | `96fe199377309001ed8cd26a944baeee8cc31a20ba7c36d1d3c0a7e1f4149db6`                         | huggingface.co/Comfy-Org/YuE2 `checkpoints/` (rev 2f76ca7)                          | `ComfyUI\models\checkpoints\`                                                                                                     |
| `acestep_v1.5_turbo.safetensors` (2B DiT)                                 | 4,787,825,604 | `3f6e0797fad420a39bd33979eb6e840e30989e34a3794e843d23b60ec6e422d7`                         | huggingface.co/Comfy-Org/ACE-Step-1.5 `split_files/diffusion_models/` (rev 371bb16) | `ComfyUI\models\diffusion_models\`                                                                                                |
| `acestep_v1.5_sft.safetensors` (2B DiT, renamed from `model.safetensors`) | 4,787,825,604 | `d4dd3a93870f06720027965b90771f529ab02094b3d29e2518f1d5e097e1af7e`                         | huggingface.co/ACE-Step/acestep-v15-sft (rev c410d24, MIT)                          | `ComfyUI\models\diffusion_models\`                                                                                                |
| `qwen_0.6b_ace15.safetensors` (text encoder)                              | 1,191,588,248 | `fd4590c82153b8ddb67e15a2e7aaa8afa8b83a858c8a9b82a4831063156aa7a7`                         | Comfy-Org/ACE-Step-1.5 `split_files/text_encoders/`                                 | `ComfyUI\models\text_encoders\`                                                                                                   |
| `qwen_1.7b_ace15.safetensors` (5 Hz LM)                                   | 3,708,523,360 | `ed63e9247d1f55f3ace04fa11e95b085fc82d459c82c5626f0b2e37b91ebd710`                         | Comfy-Org/ACE-Step-1.5 `split_files/text_encoders/`                                 | `ComfyUI\models\text_encoders\`                                                                                                   |
| `ace_1.5_vae.safetensors`                                                 | 337,431,732   | `6de92e3a862acd287e08b024ac90f0783a8635451b728721a33ff03565bcb2bb`                         | Comfy-Org/ACE-Step-1.5 `split_files/vae/`                                           | `ComfyUI\models\vae\`                                                                                                             |

Totals: 20,813,806,551 B downloaded (ComfyUI 2.04 GB + YuE2 3.96 GB + ACE-Step 14.81 GB); install on disk 22 GB.
**This is above the approved "about 11 GB"**, as the brief anticipated for ACE-Step:
- Comfy-Org ships no 2B SFT file. ComfyUI loads the official `ACE-Step/acestep-v15-sft/model.safetensors` as is.
  Proof: Comfy-Org's `acestep_v1.5_turbo.safetensors` has the same SHA-256 as the official
  `ACE-Step/Ace-Step1.5/acestep-v15-turbo/model.safetensors`.
- The official split template (`audio_ace_step_1_5_split.json`) needs `qwen_0.6b` and `qwen_1.7b` together.
  ComfyUI 0.43.0 only supports a 1.7B or 4B LM (`comfy/sd.py`: CLIPType.ACE picks `qwen3_2b` or `qwen3_4b`), so
  the smaller 0.6B ACE LM cannot replace the 1.7B.
- The AIO checkpoint `ace_step_1.5_turbo_aio.safetensors` (10,025,478,736 B) is turbo + VAE + both text
  encoders. Using it would have cost more, because SFT still needs its own DiT.
- Not downloaded: the 4B LM, the XL models (they do not fit 8 GB), YuE2 BF16, SheetSage2.

Server: started with the exact command from the brief (`tools/start_comfy.sh`). `GET /system_stats` reported
`comfyui_version 0.43.0` and `cuda:0 NVIDIA GeForce RTX 3070 : cudaMallocAsync`. `/object_info` lists
`YuE2GenerateABC`, `YuE2GenerateMusic`, `EmptyYuE2LatentAudio`, `TextEncodeAceStepAudio1.5`,
`EmptyAceStep1.5LatentAudio`, `ModelSamplingAuraFlow`, `SaveAudioAdvanced` (flac / mp3 / opus). No custom nodes.
The server is now stopped (port 8188 closed, GPU back to the desktop's ~0.6 GB).

## 3. Packs and settings

| Key            | Pack                       | Source                                                                              | kie baseline takes                                             | ACE length          | YuE2 words |
| -------------- | -------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------- | ---------- |
| a-vbp-passa    | Va bene, passa (VBP)       | `suno-remake/versions/it` (`lyrics.txt`, `style.txt`, `settings.json` duration 310) | `suno-remake/out/it/take-{1,2}.mp3` (cached Groq words reused) | 310 s (pack)        | 515        |
| b-effe-esse    | Effe-Esse (Fuori Servizio) | Supabase `versions.id = b545937e-...` (newest)                                      | none (no takes)                                                | 210 s (no duration) | 516        |
| c-vbp-pazienza | Va bene, Pazienza (VBP)    | Supabase `versions.id = 760a4ce6-...`                                               | `E:\mellodifai\projects\0ac445bb-...\it\out\it\take-{1,2}.mp3` | 210 s (no duration) | 546        |

Only 3 Italian packs exist. The third Supabase row (`fecea05b`, "Va bene, passa") has the same lyrics as pack a, so it
was not run twice. Files: `packs/<key>/{lyrics.txt, style.txt, yue2_lyrics.txt, meta.json}`.

- YuE2 lyrics (`tools/prep_packs.py`, design 5.4): one tag per line. `[Final Chorus]` and `[Chorus N]` become
  `[Chorus]`. Directions after `:` (and after `,`, as in `[Shouted, gang vocals]`) are dropped. Lines that are only a
  parenthesis are dropped, and `(x2)` is expanded (none occur in these packs). The style is the pack's style, verbatim.
- YuE2 graph: section 7.3 of the integration doc. ABC `temperature` 0.9. `max_duration` 330, which is the design
  value for packs of 600 words or fewer. 32 x `dpm_2`. Seeds 20261101 (take 1) and 20261102 (take 2).
- ACE-Step: the original pack lyrics and style. `language` it, `bpm` and `keyscale` from the style (118 / Eb major,
  124 / F major), time signature 4, LM `cfg_scale` 2, temperature 0.85, AuraFlow shift 3, euler / simple.
  Turbo uses the split template's 8 steps, cfg 1, LM top_p 0.9. SFT uses the XL-SFT template's sampler (cfg 7,
  LM top_p 1.0) with 30 steps, as the design asks. Same seeds as YuE2.
- Scoring: `suno-remake/tools/score_takes.py` runs **unmodified**, pointed at a per-(pack, engine) workspace through
  its own `ENGINE_WORKSPACE` hook (`tools/score_all.py`). Every engine is scored against the original pack lyrics.

## 4. Results per engine and pack

Peak VRAM is `nvidia-smi memory.used` sampled every 2 s, for the whole GPU, including the desktop (the baseline
before the job is in brackets). ComfyUI's dynamic VRAM fills whatever is free, so every engine peaked at 7.6-8.0 GB of
8.19 GB without failing. That number means "it ran on this card next to the desktop", not "it needs 8 GB". ACE-Step's
VAE decode ran out of memory on all 4 jobs of 310 s (pack a, turbo and SFT) and fell back to tiled decoding by itself.
The 210 s jobs did not need the fallback. Generation time is
submit-to-done, including model loading. The first YuE2 job also loaded the checkpoint from disk.

### kie

| Pack           | Take | Seed | Fidelity | Duration (s) | Gen time (s) | Peak VRAM MiB (baseline) | Ending           | Truncated | Notes                      |
| -------------- | ---- | ---- | -------- | ------------ | ------------ | ------------------------ | ---------------- | --------- | -------------------------- |
| a-vbp-passa    | 1    | -    | 0.919    | 309.2        | -            | -                        | fades (59.7 dB)  | n/a       | recommended by score_takes |
| a-vbp-passa    | 2    | -    | 0.919    | 308.4        | -            | -                        | fades (66.9 dB)  | n/a       |                            |
| c-vbp-pazienza | 1    | -    | 0.953    | 308.8        | -            | -                        | fades (21.0 dB)  | n/a       | recommended by score_takes |
| c-vbp-pazienza | 2    | -    | 0.936    | 308.8        | -            | -                        | ABRUPT (12.0 dB) | n/a       |                            |

### yue2

| Pack           | Take | Seed     | Fidelity | Duration (s) | Gen time (s) | Peak VRAM MiB (baseline) | Ending           | Truncated | Notes                                                                                                                                                        |
| -------------- | ---- | -------- | -------- | ------------ | ------------ | ------------------------ | ---------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| a-vbp-passa    | 1    | 20261101 | 0.871    | 329.9        | 263.2        | 7951 (3306)              | fades (14.8 dB)  | YES       | recommended by score_takes                                                                                                                                   |
| a-vbp-passa    | 2    | 20261102 | 0.704    | 233.7        | 134.7        | 7930 (1010)              | fades (60.8 dB)  | no        | weak: Bridge 25%                                                                                                                                             |
| b-effe-esse    | 1    | 20261101 | 0.851    | 304.2        | 203.2        | 7977 (764)               | ABRUPT (6.0 dB)  | no        |                                                                                                                                                              |
| b-effe-esse    | 2    | 20261102 | 0.869    | 330.0        | 232.8        | 7775 (739)               | ABRUPT (-0.5 dB) | YES       | recommended by score_takes; weak: Spoken Word 14% (spoken: verify on the vocal stem); [WARNING] YuE2 semantic reached its token budget before the end token. |
| c-vbp-pazienza | 1    | 20261101 | 0.892    | 248.0        | 154.8        | 7998 (1130)              | fades (23.7 dB)  | no        | recommended by score_takes                                                                                                                                   |
| c-vbp-pazienza | 2    | 20261102 | 0.847    | 330.0        | 221.0        | 7980 (726)               | fades (12.9 dB)  | YES       | [WARNING] YuE2 semantic reached its token budget before the end token.                                                                                       |

### ace-turbo

| Pack           | Take | Seed     | Fidelity | Duration (s) | Gen time (s) | Peak VRAM MiB (baseline) | Ending          | Truncated | Notes                                                                                                                                                           |
| -------------- | ---- | -------- | -------- | ------------ | ------------ | ------------------------ | --------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a-vbp-passa    | 1    | 20261101 | 0.659    | 310.0        | 136.6        | 7993 (1756)              | fades (51.7 dB) | n/a       | weak: Spoken Word 30% (spoken: verify on the vocal stem)                                                                                                        |
| a-vbp-passa    | 2    | 20261102 | 0.720    | 310.0        | 130.5        | 7993 (1070)              | ABRUPT (9.9 dB) | n/a       | recommended by score_takes; weak: Intro 5% (spoken: verify on the vocal stem)                                                                                   |
| b-effe-esse    | 1    | 20261101 | 0.547    | 210.0        | 54.3         | 7700 (1196)              | fades (50.2 dB) | n/a       | recommended by score_takes; weak: Verse 1 33%                                                                                                                   |
| b-effe-esse    | 2    | 20261102 | 0.278    | 210.0        | 108.4        | 7983 (1211)              | fades (51.9 dB) | n/a       | weak: Verse 1 21%, Post-Chorus 9%, Verse 2 5%, Final Chorus 22%, Outro 0% (spoken: verify on the vocal stem), Spoken Word 0% (spoken: verify on the vocal stem) |
| c-vbp-pazienza | 1    | 20261101 | 0.799    | 210.0        | 58.3         | 7729 (961)               | fades (23.0 dB) | n/a       | recommended by score_takes                                                                                                                                      |
| c-vbp-pazienza | 2    | 20261102 | 0.699    | 210.0        | 66.4         | 7985 (1223)              | ABRUPT (9.6 dB) | n/a       | weak: Verse 1 29%, Outro 20% (spoken: verify on the vocal stem), Spoken Word 0% (spoken: verify on the vocal stem)                                              |

### ace-sft

| Pack           | Take | Seed     | Fidelity | Duration (s) | Gen time (s) | Peak VRAM MiB (baseline) | Ending           | Truncated | Notes                                                                                                                                                         |
| -------------- | ---- | -------- | -------- | ------------ | ------------ | ------------------------ | ---------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a-vbp-passa    | 1    | 20261101 | 0.694    | 310.0        | 138.4        | 7957 (1174)              | ABRUPT (0.1 dB)  | n/a       |                                                                                                                                                               |
| a-vbp-passa    | 2    | 20261102 | 0.933    | 310.0        | 118.5        | 7920 (1064)              | ABRUPT (-6.3 dB) | n/a       | recommended by score_takes                                                                                                                                    |
| b-effe-esse    | 1    | 20261101 | 0.821    | 210.0        | 84.3         | 7810 (1464)              | ABRUPT (-6.1 dB) | n/a       | recommended by score_takes                                                                                                                                    |
| b-effe-esse    | 2    | 20261102 | 0.282    | 210.0        | 78.3         | 7953 (1184)              | ABRUPT (-3.1 dB) | n/a       | weak: Chorus 16%, Post-Chorus 31%, Bridge 0%, Final Chorus 0%, Outro 8% (spoken: verify on the vocal stem), Spoken Word 0% (spoken: verify on the vocal stem) |
| c-vbp-pazienza | 1    | 20261101 | 0.862    | 210.0        | 86.3         | 7979 (1609)              | ABRUPT (-5.0 dB) | n/a       |                                                                                                                                                               |
| c-vbp-pazienza | 2    | 20261102 | 0.894    | 210.0        | 78.3         | 7939 (950)               | ABRUPT (1.0 dB)  | n/a       | recommended by score_takes                                                                                                                                    |

### yue2-cap420

| Pack           | Take | Seed     | Fidelity | Duration (s) | Gen time (s) | Peak VRAM MiB (baseline) | Ending          | Truncated | Notes                      |
| -------------- | ---- | -------- | -------- | ------------ | ------------ | ------------------------ | --------------- | --------- | -------------------------- |
| a-vbp-passa    | 1    | 20261101 | 0.841    | 329.4        | 335.4        | 7993 (1551)              | fades (67.3 dB) | no        | recommended by score_takes |
| a-vbp-passa    | 2    | 20261102 | 0.760    | 234.6        | 174.8        | 7999 (1163)              | fades (59.9 dB) | no        |                            |
| b-effe-esse    | 1    | 20261101 | 0.861    | 304.2        | 259.4        | 7995 (1012)              | ABRUPT (6.0 dB) | no        |                            |
| b-effe-esse    | 2    | 20261102 | 0.911    | 368.7        | 273.0        | 7646 (631)               | fades (24.0 dB) | no        | recommended by score_takes |
| c-vbp-pazienza | 1    | 20261101 | 0.862    | 247.6        | 183.2        | 7995 (1443)              | ABRUPT (9.6 dB) | no        | recommended by score_takes |
| c-vbp-pazienza | 2    | 20261102 | 0.799    | 336.5        | 257.1        | 7703 (1388)              | fades (34.9 dB) | no        |                            |

### Medians (kie packs = a and c, the rule's "same prompts")

| Engine      | Median fidelity, all packs | Median fidelity, packs with a kie baseline | Median best-take fidelity (kie packs) | Median gen time (s) | Max peak VRAM MiB |
| ----------- | -------------------------- | ------------------------------------------ | ------------------------------------- | ------------------- | ----------------- |
| kie         | 0.927                      | 0.927                                      | 0.936                                 | -                   | -                 |
| yue2        | 0.860                      | 0.859                                      | 0.881                                 | 212                 | 7998              |
| ace-turbo   | 0.679                      | 0.710                                      | 0.760                                 | 87                  | 7993              |
| ace-sft     | 0.841                      | 0.878                                      | 0.913                                 | 85                  | 7979              |
| yue2-cap420 | 0.851                      | 0.820                                      | 0.851                                 | 258                 | 7999              |

## 5. What the YuE2 ceiling run shows

The design caps YuE2 at 330 s for packs of 600 words or fewer. These three packs have 515-546 sung words, and the
model wants **235-369 s** for them:

| Take              | `max_duration` 330                                   | `max_duration` 420 (same seed)          |
| ----------------- | ---------------------------------------------------- | --------------------------------------- |
| a / 1             | 329.9 s, at the ceiling (truncated)                  | 329.4 s, ended by itself, fades (67 dB) |
| b / 2             | 330.0 s, "semantic reached its token budget", abrupt | 368.7 s, ended by itself, fades (24 dB) |
| c / 2             | 330.0 s, "semantic reached its token budget"         | 336.5 s, ended by itself, fades (35 dB) |
| the other 3 takes | 234-304 s, ended by themselves                       | the same lengths (within 1 s)           |

Proposed change to design 5.4 (for the owner): raise the YuE2 ceiling to 420 s for every pack. This costs nothing on
songs that end earlier, because the model stops at its end token, and generation time grows only with the real
length. Keep the "ends within 5 s of the ceiling, or budget warning" flag. With 420 s, no take was truncated. Fidelity
went from 0.860 to 0.851 over all packs, which is within the seed noise.

## 6. Other checks

- **Consecutive jobs (ComfyUI #16416): OK.** 26 prompts ran on one server process with no restart and no error:
  6 YuE2 takes back-to-back, the 2-prompt queue test, 6 more YuE2 takes (cap 420), then 12 ACE takes. A literal queue test (`tools/queue_test.py`) posted two YuE2
  prompts at once, so the second one waited in the queue. Both finished, at 52 s and 96 s (`queue_test.jsonl`).
  The hang does not reproduce on 0.43.0 with this setup. Submitting take 2 after take 1 (design 5.3) is still the
  safe default.
- **Time per take** (310-370 s songs, RTX 3070): YuE2 135-263 s (median 212 s), so about 0.6-0.8 s of GPU per
  second of audio. Expect 4-9 min for two takes. ACE turbo 54-137 s (median 87 s). ACE SFT 78-138 s (median 85 s).
  ACE time is dominated by the 1.7B LM writing the 5 Hz audio codes (about 1,550 tokens for 310 s), so 30 SFT steps
  cost about the same as 8 turbo steps.
- **Peak VRAM:** see section 4. No out-of-memory failure. YuE2 staged 2,069 MB (AR) + 1,351 MB (NAR) + 253 MB (VAE),
  one at a time, as the research predicted. The desktop's own use moved between 0.6 and 3.3 GB during the run.
- **A 4:30+ song:** YuE2 a/1 (5:30) and b/2 (6:09, at the 420 s cap) completed with peaks of 7.95-8.0 GB total.
- **ACE length:** packs b and c have no `duration`, so ACE got 210 s for about 520-550 words (the design rule).
  It squeezes the lyrics in, scoring 0.80-0.89 on pack c, but drops sections on pack b with seed 2 (0.28 for both
  turbo and SFT). A per-pack duration taken from the word count would probably help. This was not tested.
- **Errors:** none. Warnings: the YuE2 budget lines above, ACE's VAE tiled fallback, and the expected `triton not
  installed` notice at startup.

## 7. Owner listening (pending)

Rate at least 3 of 5 as "usable" per engine (design 8). Also listen at 2:00 for a YuE2 seam and at the end of each
take. Start with the take `score_takes.py` picked per pack (marked with a star); the others are for comparison.

YuE2 INT8, cap 330 (design default):
- `E:\mellodifai\research\bakeoff\out\a-vbp-passa\yue2\take-1.mp3` (star, ends at the cap)
- `E:\mellodifai\research\bakeoff\out\a-vbp-passa\yue2\take-2.mp3`
- `E:\mellodifai\research\bakeoff\out\b-effe-esse\yue2\take-1.mp3`
- `E:\mellodifai\research\bakeoff\out\b-effe-esse\yue2\take-2.mp3` (star, budget cut)
- `E:\mellodifai\research\bakeoff\out\c-vbp-pazienza\yue2\take-1.mp3` (star)
- `E:\mellodifai\research\bakeoff\out\c-vbp-pazienza\yue2\take-2.mp3`

YuE2 INT8, cap 420 (diagnostic, every take ends by itself):
- `E:\mellodifai\research\bakeoff\out\a-vbp-passa\yue2-cap420\take-1.mp3` (star)
- `E:\mellodifai\research\bakeoff\out\a-vbp-passa\yue2-cap420\take-2.mp3`
- `E:\mellodifai\research\bakeoff\out\b-effe-esse\yue2-cap420\take-1.mp3`
- `E:\mellodifai\research\bakeoff\out\b-effe-esse\yue2-cap420\take-2.mp3` (star, 6:09)
- `E:\mellodifai\research\bakeoff\out\c-vbp-pazienza\yue2-cap420\take-1.mp3` (star)
- `E:\mellodifai\research\bakeoff\out\c-vbp-pazienza\yue2-cap420\take-2.mp3`

ACE-Step 1.5 2B turbo:
- `E:\mellodifai\research\bakeoff\out\a-vbp-passa\ace-turbo\take-1.mp3`
- `E:\mellodifai\research\bakeoff\out\a-vbp-passa\ace-turbo\take-2.mp3` (star)
- `E:\mellodifai\research\bakeoff\out\b-effe-esse\ace-turbo\take-1.mp3` (star)
- `E:\mellodifai\research\bakeoff\out\b-effe-esse\ace-turbo\take-2.mp3`
- `E:\mellodifai\research\bakeoff\out\c-vbp-pazienza\ace-turbo\take-1.mp3` (star)
- `E:\mellodifai\research\bakeoff\out\c-vbp-pazienza\ace-turbo\take-2.mp3`

ACE-Step 1.5 2B SFT, 30 steps:
- `E:\mellodifai\research\bakeoff\out\a-vbp-passa\ace-sft\take-1.mp3`
- `E:\mellodifai\research\bakeoff\out\a-vbp-passa\ace-sft\take-2.mp3` (star, 0.933)
- `E:\mellodifai\research\bakeoff\out\b-effe-esse\ace-sft\take-1.mp3` (star)
- `E:\mellodifai\research\bakeoff\out\b-effe-esse\ace-sft\take-2.mp3`
- `E:\mellodifai\research\bakeoff\out\c-vbp-pazienza\ace-sft\take-1.mp3`
- `E:\mellodifai\research\bakeoff\out\c-vbp-pazienza\ace-sft\take-2.mp3` (star)

kie baseline: `C:\Users\Asus\Documents\suno-remake\out\it\take-{1,2}.mp3` (pack a) and
`E:\mellodifai\projects\0ac445bb-6628-4ef0-8f3a-391f9b60fdc8\it\out\it\take-{1,2}.mp3` (pack c).

Each mp3 (320 kbps) sits next to its 48 kHz FLAC. Next to them are `take-N.comfy.log` and, for YuE2, the ABC score
`take-N.abc.txt`.

## 8. Graphs that worked (API format)

`E:\mellodifai\research\bakeoff\graphs\`:
- `TEMPLATE_yue2-int8-text2music.api.json`, `TEMPLATE_ace15-2b-turbo.api.json`,
  `TEMPLATE_ace15-2b-sft-30steps.api.json`: the three graphs with placeholders (`<STYLE>`, `<LYRICS>`, `<PREFIX>`).
  The YuE2 graph is section 7.3 of the integration doc, with the ABC temperature at 0.9; it was accepted without
  change. The fill map is the one in design 5.3 (`24`/`25` style, lyrics, seed; `25.max_duration`; `8.seed`;
  `10.filename_prefix`).
  The ACE fill map is `94.inputs.{tags, lyrics, seed, bpm, duration, keyscale, language}`, `98.inputs.seconds`
  (= duration), `3.inputs.seed`, and `107.inputs.filename_prefix`.
  Outputs: `10.audio[0]` / `107.audio[0]` (FLAC), and for YuE2 `14.text[0]` (ABC) and `23.text[0]` (seconds).
- `<engine>__<pack>__take-N.api.json`: the exact 26 graphs posted, with lyrics, plus `yue2__queue-test__take-{1,2}`.

`SaveAudioAdvanced.format` takes the plain value `"flac"`. For mp3 it would take `"mp3"` plus the sub-input
`format.quality` (V0 / 128k / 320k).

## 9. Reproduce

Tools are in `E:\mellodifai\research\bakeoff\tools\`, stdlib Python only, run with `python -I -B`:
`prep_packs.py` (packs + YuE2 mapping), `start_comfy.sh` (exact launch command, caches on E:),
`run_bakeoff.py <yue2|yue2-cap420|ace-turbo|ace-sft> [packs]` (HTTP API driver + nvidia-smi sampler, appends to
`results.jsonl`), `queue_test.py`, `score_all.py` (runs `score_takes.py` per workspace; writes `scores.json`,
`tables.md`, `summary.json`), `segdl.py` (parallel-range downloader; the line was capped at about 3.5 MB/s total).
Groq Whisper was the only paid-API-shaped call: free tier, key read at runtime by `whisper_words.py`, never printed.
No kie credits were used, and the mellodifai and suno-remake repositories were not modified (this file is the only
new file in the docs folder).
