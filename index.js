const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const openai = require('openai');
const ffmpeg = require('fluent-ffmpeg');
const ytdlp = require('yt-dlp-exec');

require('dotenv').config();

const app = express();
app.use(express.json());

openai.apiKey = process.env.OPENAI_API_KEY;

app.post('/process', async (req, res) => {
  const { videoUrl, clips } = req.body;

  const videoPath = `downloaded_${Date.now()}.mp4`;
  await ytdlp(videoUrl, { output: videoPath });

  const transcript = await openai.audio.transcriptions.create({
    file: fs.createReadStream(videoPath),
    model: 'whisper-1',
  });

  const clipPaths = [];

  for (let i = 0; i < clips.length; i++) {
    const { start, end, title } = clips[i];
    const output = `clip_${i}_${Date.now()}.mp4`;
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .setStartTime(start)
        .setDuration(end - start)
        .videoFilters('scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2')
        .outputOptions(['-c:v libx264', '-preset fast', '-crf 23', '-c:a aac', '-b:a 128k'])
        .output(output)
        .on('end', () => {
          clipPaths.push(output);
          resolve();
        })
        .on('error', reject)
        .run();
    });
  }

  res.json({
    transcript: transcript.text,
    clips: clipPaths,
  });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
