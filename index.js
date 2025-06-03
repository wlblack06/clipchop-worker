const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ytdlp = require('yt-dlp-exec');
const openai = require('openai');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

openai.apiKey = process.env.OPENAI_API_KEY;

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Too many requests, please try again later.' }
});

app.use('/analyze', limiter);
app.use('/process', limiter);

const cleanupFiles = (files) => {
  files.forEach((file) => {
    fs.unlink(file, (err) => {
      if (err) console.warn(`Failed to delete ${file}:`, err.message);
    });
  });
};

app.post('/process', async (req, res) => {
  const { videoUrl, clips } = req.body;
  const timestamp = Date.now();
  const videoPath = `video_${timestamp}.mp4`;

  try {
    await ytdlp(videoUrl, { output: videoPath });

    const transcript = await openai.audio.transcriptions.create({
      file: fs.createReadStream(videoPath),
      model: 'whisper-1',
    });

    const clipPaths = [];

    for (let i = 0; i < clips.length; i++) {
      const { start, end, title } = clips[i];
      const output = `clip_${i}_${timestamp}.mp4`;

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

    res.json({ transcript: transcript.text, clips: clipPaths });
    setTimeout(() => cleanupFiles([videoPath, ...clipPaths]), 60 * 1000);
  } catch (err) {
    console.error('Processing error:', err);
    res.status(500).json({ error: 'Failed to process video.' });
    cleanupFiles([videoPath]);
  }
});

app.post('/analyze', async (req, res) => {
  const { videoUrl } = req.body;
  const timestamp = Date.now();
  const videoPath = `video_${timestamp}.mp4`;

  try {
    await ytdlp(videoUrl, { output: videoPath });

    const transcript = await openai.audio.transcriptions.create({
      file: fs.createReadStream(videoPath),
      model: 'whisper-1',
    });

    const highlightsResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an AI that analyzes video transcripts to find viral TikTok moments. Return ONLY a valid JSON array of highlights with this exact structure:
[
  {
    "title": "Brief catchy title",
    "summary": "Why this moment could go viral",
    "start_time": 15,
    "end_time": 45,
    "viral_score": 8.5
  }
]

Rules:
- Find 3-6 potential viral moments
- Each clip should be 15-60 seconds long
- viral_score should be 1-10 (higher = more viral potential)
- Focus on: funny moments, key insights, surprising facts, emotional peaks
- Return ONLY the JSON array, no other text`
        },
        {
          role: 'user',
          content: `Analyze this transcript and find viral TikTok moments:\n\n${transcript.text}`
        }
      ],
      temperature: 0.7,
    });

    let highlights;
    try {
      highlights = JSON.parse(highlightsResponse.choices[0].message.content);
    } catch {
      highlights = [
        {
          title: "Key Moment",
          summary: "Important insight from the video",
          start_time: 30,
          end_time: 60,
          viral_score: 7.5
        }
      ];
    }

    res.json({ transcript: transcript.text, highlights });
    setTimeout(() => cleanupFiles([videoPath]), 60 * 1000);
  } catch (err) {
    console.error('Analysis error:', err);
    res.status(500).json({ error: 'Failed to analyze video.' });
    cleanupFiles([videoPath]);
  }
});

app.get('/download/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(__dirname, filename);

  if (!fs.existsSync(filePath) || !filename.includes('clip_')) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  fs.createReadStream(filePath).pipe(res);
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
