const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ytdlp = require('yt-dlp-exec');
const openai = require('openai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

openai.apiKey = process.env.OPENAI_API_KEY;

// Utility to clean up files after request
const cleanupFiles = (files) => {
  files.forEach((file) => {
    fs.unlink(file, (err) => {
      if (err) console.warn(`Failed to delete ${file}:`, err.message);
    });
  });
};

app.post('/process', async (req, res) => {
  console.log('✅ Received /process request');

  const { videoUrl, clips } = req.body;

  if (!videoUrl || !clips || !Array.isArray(clips)) {
    return res.status(400).json({ error: 'Missing or invalid videoUrl/clips' });
  }

  const timestamp = Date.now();
  const videoPath = `video_${timestamp}.mp4`;

  try {
    // Download video
    console.log('🎥 Downloading video...');
    await ytdlp(videoUrl, { output: videoPath });

    // Transcribe video with Whisper
    console.log('🧠 Transcribing with Whisper...');
    const transcript = await openai.audio.transcriptions.create({
      file: fs.createReadStream(videoPath),
      model: 'whisper-1',
    });

    const clipPaths = [];

    for (let i = 0; i < clips.length; i++) {
      const { start, end, title } = clips[i];
      const output = `clip_${i}_${timestamp}.mp4`;
      console.log(`✂️ Creating clip: ${title} (${start}-${end}s)`);

      await new Promise((resolve, reject) => {
        ffmpeg(videoPath)
          .setStartTime(start)
          .setDuration(end - start)
          .videoFilters(
            'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2'
          )
          .outputOptions(['-c:v libx264', '-preset fast', '-crf 23', '-c:a aac', '-b:a 128k'])
          .output(output)
          .on('end', () => {
            clipPaths.push(output);
            resolve();
          })
          .on('error', (err) => {
            console.error(`❌ ffmpeg error on clip ${i}:`, err);
            reject(err);
          })
          .run();
      });
    }

    console.log('✅ All clips generated. Responding...');
    res.json({
      transcript: transcript.text,
      clips: clipPaths, // filenames — you can upload them to Supabase or serve statically if needed
    });

    // Optional: clean up files after response
    setTimeout(() => cleanupFiles([videoPath, ...clipPaths]), 60 * 1000);
  } catch (err) {
    console.error('🔥 Processing error:', err);
    res.status(500).json({ error: 'Failed to process video. Check logs for details.' });

    // Clean up partial files
    cleanupFiles([videoPath, ...clipPaths]);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
