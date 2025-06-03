const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { OpenAI } = require('openai');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(express.json());
app.set('trust proxy', 1); // Required for rate limiting behind proxy

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use(['/analyze', '/process'], limiter);

// 🧠 Analyze endpoint
app.post('/analyze', async (req, res) => {
  const { videoUrl } = req.body;
  if (!videoUrl) return res.status(400).json({ error: 'Missing videoUrl' });

  const timestamp = Date.now();
  const videoPath = `video_${timestamp}.mp4`;

  try {
    console.log('🎥 Downloading video...');
    await new Promise((resolve, reject) => {
      exec(`yt-dlp "${videoUrl}" --output ${videoPath}`, (err, stdout, stderr) => {
        if (err) return reject(err);
        resolve();
      });
    });

    console.log('🧠 Transcribing with Whisper...');
    const transcript = await openai.audio.transcriptions.create({
      file: fs.createReadStream(videoPath),
      model: 'whisper-1',
    });

    console.log('🎯 Generating highlights...');
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You are an AI that analyzes video transcripts to find viral TikTok moments. Return ONLY a valid JSON array of highlights like:
[
  {
    "title": "Catchy title",
    "summary": "Why this moment could go viral",
    "start_time": 15,
    "end_time": 45,
    "viral_score": 8.5
  }
]`
        },
        {
          role: 'user',
          content: `Analyze this transcript and find viral TikTok moments:\n\n${transcript.text}`
        }
      ],
      temperature: 0.7
    });

    let highlights;
    try {
      highlights = JSON.parse(response.choices[0].message.content);
    } catch {
      highlights = [{
        title: "Fallback Clip",
        summary: "Could not parse AI output",
        start_time: 0,
        end_time: 30,
        viral_score: 5.0
      }];
    }

    console.log('✅ Done');
    res.json({ transcript: transcript.text, highlights });

    setTimeout(() => fs.unlink(videoPath, () => {}), 60000);
  } catch (err) {
    console.error('🔥 Analysis error:', err);
    res.status(500).json({ error: 'Failed to analyze video.' });
    fs.unlink(videoPath, () => {});
  }
});

// 🎬 Download endpoint
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

// ✅ Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
